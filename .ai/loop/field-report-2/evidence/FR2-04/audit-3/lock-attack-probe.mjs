// FR2-04 audit-3, point 5: attack GAP-231's rename-then-confirm spawn lock and the warden-side
// singleton (pre-start rival check + 300 ms settle re-read of warden.json).
//  (x) EXCLUSIVE file lock on warden.json (a PowerShell child holds it open with FileShare.None)
//      while sequential and concurrent commands run; then release. Count wardens / warnings / ms.
//  (y) EXCLUSIVE lock on warden.lock (the spawn lock) the same way.
//  (k) kill the freshly spawned warden mid-startup (as soon as warden.json names it, i.e. inside
//      its settle window) and then race 4 commands; count wardens.
// Only PIDs this script spawned (the PowerShell holders, CLI children) or wardens whose payload
// stateFile is under this script's temp root are ever killed.
// Usage: node lock-attack-probe.mjs <rounds> <tag>
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { makeRoot, makeCli, readWarden, delay, cleanupRoot, here, wardensUnder, taskkill, pidAlive } from './lib.mjs';

const ROUNDS = Number(process.argv[2] ?? 3);
const TAG = process.argv[3] ?? 'run';
const root = await makeRoot('lockatk');
const cli = makeCli(root);
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>lock</title>lock'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const dirs = []; const out = { x: [], y: [], k: [] };
const holders = new Set();
const mine = (d) => wardensUnder(root).filter((w) => w.stateFile.startsWith(d));

function holdExclusive(file, ms) {
  // Opens (creating if needed) with FileShare.None and sleeps; killed by PID in finally.
  const ps = `$f=[System.IO.File]::Open('${file.replace(/'/g, "''")}', 'OpenOrCreate', 'ReadWrite', 'None'); Start-Sleep -Milliseconds ${ms}; $f.Close()`;
  const c = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true });
  holders.add(c.pid);
  c.on('exit', () => holders.delete(c.pid));
  return c;
}
const canOpen = async (f) => { try { const h = await fs.open(f, 'r'); await h.close(); return true; } catch (e) { return e.code; } };

try {
  const d = path.join(root.R, 'state-lockatk'); dirs.push(d);
  const nav = await cli(['nav', URL_], d);
  out.nav = nav.code;
  for (const [mode, file] of [['x', 'warden.json'], ['y', 'warden.lock']]) {
    for (let i = 0; i < ROUNDS; i++) {
      for (const w of mine(d)) taskkill(w.pid);
      await delay(300);
      await fs.rm(path.join(d, 'warden.lock'), { force: true });
      if (mode === 'x') await fs.rm(path.join(d, 'warden.json'), { force: true });
      const target = path.join(d, file);
      const h = holdExclusive(target, 14000);
      await delay(1500);
      const locked = await canOpen(target);
      const seq = [];
      for (let k = 0; k < 2; k++) { const r = await cli(['snap'], d, { capMs: 40000 }); seq.push({ code: r.code, ms: r.ms, warn: /warden did not start/.test(r.stderr), err: r.stderr.trim().slice(0, 160) }); }
      const conc = await Promise.all(Array.from({ length: 4 }, () => cli(['snap'], d, { capMs: 40000 })));
      const wardensWhileLocked = mine(d).length;
      taskkill(h.pid); await delay(800);
      const after = [];
      for (let k = 0; k < 2; k++) { const r = await cli(['snap'], d, { capMs: 40000 }); after.push({ code: r.code, ms: r.ms, warn: /warden did not start/.test(r.stderr) }); }
      await delay(1500);
      const ws = mine(d);
      const wf = await readWarden(d);
      const row = { i, lockedErr: locked, seq, conc: conc.map((r) => ({ code: r.code, ms: r.ms, warn: /warden did not start/.test(r.stderr) })), wardensWhileLocked, after, wardensAfter: ws.length, wardenPids: ws.map((w) => w.pid), wardenJsonPid: wf?.pid, wardenJsonNamesLive: wf ? ws.some((w) => w.pid === wf.pid) : false };
      out[mode].push(row); console.log(mode, JSON.stringify(row));
    }
  }
  for (let i = 0; i < ROUNDS * 2; i++) {
    for (const w of mine(d)) taskkill(w.pid);
    await delay(300);
    await fs.rm(path.join(d, 'warden.json'), { force: true }); await fs.rm(path.join(d, 'warden.lock'), { force: true });
    const p = cli(['snap'], d, { capMs: 40000 });
    let killedPid;
    for (let k = 0; k < 400; k++) { const wf = await readWarden(d); if (wf?.pid) { killedPid = wf.pid; taskkill(wf.pid); break; } await delay(10); }
    const first = await p;
    const rs = await Promise.all(Array.from({ length: 4 }, () => cli(['snap'], d, { capMs: 40000 })));
    await delay(1500);
    const ws = mine(d);
    const wf = await readWarden(d);
    const row = { i, killedPid, firstSnap: { code: first.code, ms: first.ms, warn: /warden did not start/.test(first.stderr) }, codes: rs.map((r) => r.code), maxMs: Math.max(...rs.map((r) => r.ms)), warnings: rs.filter((r) => /warden did not start/.test(r.stderr)).length, wardens: ws.length, wardenJsonNamesLive: wf ? ws.some((w) => w.pid === wf.pid) : false };
    out.k.push(row); console.log('k', JSON.stringify(row));
  }
} catch (e) { out.error = String(e?.stack || e); console.error(e); }
finally {
  for (const pid of holders) taskkill(pid, true);
  server.close();
  out.leftovers = await cleanupRoot(root, cli, dirs);
  const s = (a) => ({ rounds: a.length, multiWardenAfter: a.filter((r) => (r.wardensAfter ?? r.wardens) > 1).length, zeroWardenAfter: a.filter((r) => (r.wardensAfter ?? r.wardens) === 0).length, maxWardensWhileLocked: Math.max(0, ...a.map((r) => r.wardensWhileLocked ?? 0)), nonZeroExit: a.flatMap((r) => [...(r.seq ?? []), ...(r.conc ?? []), ...(r.after ?? [])].map((x) => x.code).concat(r.codes ?? [])).filter((c) => c !== 0).length });
  out.summary = { x: s(out.x), y: s(out.y), k: s(out.k) };
  await fs.writeFile(path.join(here, `lock-attack-${TAG}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.summary), 'leftovers', JSON.stringify(out.leftovers));
  process.exit(0);
}
