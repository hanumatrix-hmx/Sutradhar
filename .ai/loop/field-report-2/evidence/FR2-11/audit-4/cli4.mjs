// AUDIT-4 CLI functional re-check (real CLI processes, real Chrome): no-history case; history.jsonl beside state.json;
// history / history --json (byte-identical); torn line; close + self-heal; REAL parallel appenders incl. lines > 64 KiB
// before the guard; 40 real `taskkill /F /PID` of CLI processes this probe started; clean append afterwards.
// Usage: node cli4.mjs <cli-js> <label>
import fs from 'node:fs/promises'; import fsS from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { here, runCli, logPid, delay } from './lib4.mjs';
const [cliPath, label] = process.argv.slice(2);
const cli = path.resolve(cliPath);
const server = http.createServer((q, s) => s.writeHead(200, { 'content-type': 'text/html' }).end('<title>c4</title><button id="b">b</button><p>body text</p>'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const O = 'http://127.0.0.1:' + server.address().port;
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a4cli-'));
const stateDir = path.join(scratch, 'state');
const env = { SUTRADHAR_CLI_STATE_DIR: stateDir };
const hist = path.join(stateDir, 'history.jsonl');
const run = (...a) => runCli(cli, a, { env, cwd: scratch });
const parse = async () => { const raw = await fs.readFile(hist, 'utf8'); const ls = raw.split('\n').filter((l) => l.trim() !== ''); let bad = 0; const ok = []; for (const l of ls) { try { const j = JSON.parse(l); if (j.v === 1) ok.push({ j, bytes: Buffer.byteLength(l) }); else bad++; } catch { bad++; } } return { ok, bad, endsNl: raw.endsWith('\n'), raw }; };
const out = { label };
try {
  const h0 = await run('history');
  out.noHistory = { code: h0.code, out: h0.out.trim().slice(0, 140), state: fsS.existsSync(path.join(stateDir, 'state.json')), file: fsS.existsSync(hist) };
  out.bogus = (({ code, err }) => ({ code, err: err.trim().slice(0, 100) }))(await run('history', '--bogus'));
  await run('nav', O + '/p?k=1'); await run('eval', 'document.title'); await run('click', '#b'); await run('snap');
  let p = await parse();
  out.beside = { state: fsS.existsSync(path.join(stateDir, 'state.json')), history: fsS.existsSync(hist), lines: p.ok.length, verbs: p.ok.map((x) => x.j.verb), acts: p.ok.map((x) => x.j.actions.map((a) => a.actionType).join('+')), keys: Object.keys(p.ok[0].j) };
  const hh = await run('history'); const hj = await run('history', '--json');
  out.historyCmd = { code: hh.code, header: hh.out.split('\n')[0], current: (hh.out.match(/\(current\)/g) ?? []).length, rows: hh.out.split('\n').filter((l) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\dZ  exit /.test(l)).length, jsonByteIdentical: hj.out === p.raw, jsonCode: hj.code, ms: hh.ms };
  await fs.appendFile(hist, '{"v":1,"type":"comm');
  const ht = await run('history'); const htj = await run('history', '--json');
  out.torn = { code: ht.code, note: ht.err.trim().slice(0, 140), jsonLines: htj.out.trim().split('\n').length };
  await run('eval', '2+2');
  p = await parse();
  out.afterTorn = { valid: p.ok.length, bad: p.bad, last: p.ok.at(-1).j.verb, endsNl: p.endsNl };
  const sid1 = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8')).sessionId;
  await run('close');
  const hc = await run('history');
  out.afterClose = { stateGone: !fsS.existsSync(path.join(stateDir, 'state.json')), history: fsS.existsSync(hist), current: (hc.out.match(/\(current\)/g) ?? []).length, lastVerb: (await parse()).ok.at(-1).j.verb };
  await run('nav', O + '/again');
  const sid2 = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8')).sessionId;
  const hs = await run('history');
  out.selfHeal = { newSession: sid1 !== sid2, sessionRows: (hs.out.match(/^--- session /gm) ?? []).length, current: (hs.out.match(/\(current\)/g) ?? []).length };
  // parallel appenders: 8 eval + 6 text with 150 args x 200 CJK chars (~100 KB of args before the guard)
  const big = Array.from({ length: 150 }, () => String.fromCharCode(0x4e2d).repeat(200));
  const before = (await parse()).ok.length;
  const par = [];
  for (let i = 0; i < 8; i++) par.push(run('eval', 'void ' + i));
  for (let i = 0; i < 6; i++) par.push(run('text', ...big));
  const pr = await Promise.all(par);
  p = await parse();
  const fresh = p.ok.slice(before);
  out.parallel = { started: par.length, exitCodes: pr.map((r) => r.code), newLines: fresh.length, bad: p.bad, maxLineBytes: Math.max(...fresh.map((x) => x.bytes)), truncated: fresh.filter((x) => x.j.truncated).length, bigArgsKept: fresh.filter((x) => x.j.verb === 'text').map((x) => x.j.args.length) };
  // 40 real kills
  const kills = []; let killed = 0, finished = 0;
  for (let i = 0; i < 40; i++) {
    const sleepMs = Math.floor(Math.random() * 1200);
    const child = spawn(process.execPath, [cli, 'eval', 'new Promise(r => setTimeout(() => r(' + (1000 + i) + '), ' + sleepMs + '))'], { env: { ...process.env, ...env }, cwd: scratch, windowsHide: true });
    logPid(child.pid, 'cli kill-target ' + i);
    const exited = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig })));
    const waitMs = Math.floor(Math.random() * (sleepMs + 350)) + 30; await delay(waitMs);
    const k = spawnSync('taskkill', ['/F', '/PID', String(child.pid)], { encoding: 'utf8' });
    const e = await Promise.race([exited, delay(30000).then(() => ({ timeout: true }))]);
    if (k.status === 0) killed++; else finished++;
    kills.push({ pid: child.pid, sleepMs, waitMs, taskkill: k.status, exit: e });
  }
  p = await parse();
  out.killDetail = kills; out.kills = { attempted: 40, killedByTaskkill: killed, finishedFirst: finished, valid: p.ok.length, bad: p.bad, endsNl: p.endsNl };
  await run('eval', 'void "after-kills"');
  p = await parse();
  out.afterKills = { bad: p.bad, last: p.ok.at(-1).j.args[0], endsNl: p.endsNl };
  await run('close');
} finally {
  if (fsS.existsSync(path.join(stateDir, 'state.json'))) await run('close');
  server.close();
  await fs.writeFile(path.join(here, 'cli4-' + label + '.json'), JSON.stringify(out, null, 1));
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(out, null, 1));
