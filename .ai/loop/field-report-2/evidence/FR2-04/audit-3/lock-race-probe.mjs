// FR2-04 audit-2: spawn-lock (GAP-223 fix) adversarial checks, live against the built CLI.
// (a) STALE-lock race: a stale warden.lock (dead pid) is present when N commands race after a
//     warden death. tryAcquireSpawnLock's recovery is read -> rm -> retry with no atomicity, so two
//     racers can each rm the other's FRESH lock and both spawn. Count live wardens per session.
// (b) Crash mid-spawn: a CLI process killed while holding the lock leaves warden.lock behind;
//     does the next command still get a warden promptly (dead-pid recovery)?
// (c) Plain race (no stale lock), for comparison with audit-1's r10 setup.
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { makeRoot, makeCli, readState, readWarden, delay, cleanupRoot, here, wardensUnder, taskkill, pidAlive } from './lib.mjs';

const ROUNDS = Number(process.argv[2] ?? 10);
const N = Number(process.argv[3] ?? 4);
const root = await makeRoot('lock');
const cli = makeCli(root);
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>lock</title>lock'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const dirs = []; const out = { stale: [], plain: [], crash: [] };
const mine = (d) => wardensUnder(root).filter((w) => w.stateFile.startsWith(d));
try {
  const d = path.join(root.R, 'state-lock'); dirs.push(d);
  await cli(['nav', URL_], d);
  for (const mode of ['stale', 'plain']) {
    for (let i = 0; i < ROUNDS; i++) {
      for (const w of mine(d)) taskkill(w.pid);
      await delay(300);
      await fs.rm(path.join(d, 'warden.json'), { force: true });
      if (mode === 'stale') await fs.writeFile(path.join(d, 'warden.lock'), JSON.stringify({ pid: 999999, startedAt: Date.now() - 1000 }));
      else await fs.rm(path.join(d, 'warden.lock'), { force: true });
      const rs = await Promise.all(Array.from({ length: N }, () => cli(['snap'], d, { capMs: 30000 })));
      await delay(1200);
      const ws = mine(d);
      const lockLeft = await fs.readFile(path.join(d, 'warden.lock'), 'utf-8').catch(() => null);
      const row = { i, wardens: ws.length, codes: rs.map((r) => r.code), warnings: rs.filter((r) => /warden did not start/.test(r.stderr)).length, maxMs: Math.max(...rs.map((r) => r.ms)), lockLeft: !!lockLeft };
      out[mode].push(row); console.log(mode, JSON.stringify(row));
    }
  }
  // (b) crash mid-spawn: kill a CLI command right after it takes the lock (poll for the lock file)
  for (let i = 0; i < 4; i++) {
    for (const w of mine(d)) taskkill(w.pid);
    await delay(300);
    await fs.rm(path.join(d, 'warden.json'), { force: true }); await fs.rm(path.join(d, 'warden.lock'), { force: true });
    const child = spawn(process.execPath, [path.resolve(here, '../../../../../../packages/cli/dist/cli.js'), 'snap'], { env: { ...process.env, TEMP: root.TEMP, TMP: root.TEMP, SUTRADHAR_CLI_STATE_DIR: d }, stdio: 'ignore', windowsHide: true });
    let sawLock = false;
    for (let k = 0; k < 200; k++) { if (await fs.stat(path.join(d, 'warden.lock')).then(() => true, () => false)) { sawLock = true; break; } await delay(10); }
    taskkill(child.pid);
    await delay(1500);
    // the warden the killed CLI may already have spawned (detached) is a separate process; kill it so the next command must spawn
    const orphanWardens = mine(d).map((w) => w.pid);
    for (const p of orphanWardens) taskkill(p);
    await delay(300); await fs.rm(path.join(d, 'warden.json'), { force: true });
    const lockAfterCrash = await fs.readFile(path.join(d, 'warden.lock'), 'utf-8').catch(() => null);
    const t0 = Date.now(); const r = await cli(['snap'], d, { capMs: 30000 }); await delay(800);
    const row = { i, sawLock, lockAfterCrash, orphanWardensFromKilledCli: orphanWardens.length, nextSnap: { code: r.code, ms: Date.now() - t0, warn: /warden did not start/.test(r.stderr) }, wardensAfter: mine(d).length };
    out.crash.push(row); console.log('crash', JSON.stringify(row));
  }
} catch (e) { out.error = String(e?.stack || e); console.error(e); }
finally {
  server.close();
  out.leftovers = await cleanupRoot(root, cli, dirs);
  const s = (a) => ({ rounds: a.length, multiWardenRounds: a.filter((r) => r.wardens > 1).length, zeroWardenRounds: a.filter((r) => r.wardens === 0).length, maxWardens: Math.max(0, ...a.map((r) => r.wardens)) });
  out.summary = { stale: s(out.stale), plain: s(out.plain) };
  await fs.writeFile(path.join(here, 'lock-race-probe-' + (process.argv[4] ?? 'run') + '.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.summary), 'leftovers', JSON.stringify(out.leftovers));
  process.exit(0);
}
