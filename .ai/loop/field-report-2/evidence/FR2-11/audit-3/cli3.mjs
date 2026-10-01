// AUDIT-3 CLI functional re-check (real CLI processes, real Chrome): history before any session; history.jsonl next to
// state.json; history / history --json; torn line; REAL parallel CLI appenders incl. lines over 64 KiB before the guard;
// 40 real taskkill /F /PID of CLI processes this probe started; a clean append afterwards; self-heal after close.
// Usage: node cli3.mjs <cli-js> <label>
import fs from 'node:fs/promises'; import fsS from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { here, runCli, startServer, logPid, delay } from './lib.mjs';
const [cliPath, label] = process.argv.slice(2);
const cli = path.resolve(cliPath);
const srv = await startServer();
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a3cli-'));
const stateDir = path.join(scratch, 'state');
const env = { SUTRADHAR_CLI_STATE_DIR: stateDir };
const hist = path.join(stateDir, 'history.jsonl');
const out = { label };
const run = (...args) => runCli(cli, args, { env, cwd: scratch });
const parse = async () => { const raw = await fs.readFile(hist, 'utf8'); const ls = raw.split('\n').filter((l) => l.trim()); let bad = 0; const ok = []; for (const l of ls) { try { const j = JSON.parse(l); if (j.v === 1) ok.push(j); else bad++; } catch { bad++; } } return { raw, ok, bad, endsNl: raw.endsWith('\n') }; };
try {
  const h0 = await run('history');
  out.noHistory = { code: h0.code, out: h0.out.trim().slice(0, 120), ms: h0.ms, stateJsonExists: fsS.existsSync(path.join(stateDir, 'state.json')), historyExists: fsS.existsSync(hist) };
  const hb = await run('history', '--bogus');
  out.bogusFlag = { code: hb.code, err: hb.err.trim().slice(0, 120) };
  await run('nav', srv.origin + '/p');
  await run('eval', '1+1');
  out.besideState = { state: fsS.existsSync(path.join(stateDir, 'state.json')), history: fsS.existsSync(hist) };
  let p = await parse();
  out.afterTwo = { lines: p.ok.length, verbs: p.ok.map((l) => l.verb), actionTypes: p.ok.map((l) => l.actions.map((a) => a.actionType).join('+')), sessionIds: [...new Set(p.ok.map((l) => l.sessionId))].length };
  // torn line
  await fs.appendFile(hist, '{"v":1,"ty');
  const ht = await run('history');
  const hj = await run('history', '--json');
  out.torn = { code: ht.code, stderr: ht.err.trim().slice(0, 160), header: ht.out.split('\n')[0], jsonLines: hj.out.trim().split('\n').length, jsonCode: hj.code };
  await run('eval', '2+2');
  p = await parse();
  out.afterTorn = { valid: p.ok.length, bad: p.bad, lastVerb: p.ok.at(-1).verb, endsNl: p.endsNl };
  // real parallel CLI appenders: 10 eval + 6 text with 160 args of 200 CJK chars (~96 KB of args before the guard)
  const cjk = String.fromCharCode(0x6f22).repeat(200);
  const before = p.ok.length;
  const par = [];
  for (let i = 0; i < 10; i++) par.push(run('eval', 'void ' + i));
  for (let i = 0; i < 6; i++) par.push(run('text', ...Array.from({ length: 160 }, () => cjk)));
  const res = await Promise.all(par);
  p = await parse();
  const fresh = p.ok.slice(before);
  out.parallel = { procs: res.length, exits: res.map((r) => r.code).join(','), newValid: fresh.length, bad: p.bad, textLines: fresh.filter((l) => l.verb === 'text').map((l) => ({ truncated: !!l.truncated, args: l.args.length, bytes: Buffer.byteLength(JSON.stringify(l)) })), maxLineBytes: Math.max(...p.raw.split('\n').map((l) => Buffer.byteLength(l))), endsNl: p.endsNl };
  // 40 real kills of CLI processes at random points of their life (spawn .. attach .. append)
  const kills = [];
  for (let round = 0; round < 20; round++) {
    const kids = [0, 1].map((k) => { const c = spawn(process.execPath, [cli, 'eval', 'void ' + round + k], { env: { ...process.env, ...env }, cwd: scratch, windowsHide: true }); logPid(c.pid, 'cli3 kill-target eval'); return { c, done: new Promise((r) => c.on('exit', (code) => r(code))) }; });
    await delay(80 + Math.floor(Math.random() * 900));
    for (const k of kids) { const t = spawnSync('taskkill', ['/F', '/PID', String(k.c.pid)], { encoding: 'utf8' }); kills.push({ pid: k.c.pid, ok: /SUCCESS/.test(t.stdout), already: /not found/i.test(t.stderr) }); }
    await Promise.all(kids.map((k) => k.done));
  }
  p = await parse();
  out.kills = { attempted: kills.length, killed: kills.filter((k) => k.ok).length, alreadyExited: kills.filter((k) => k.already).length, validAfter: p.ok.length, bad: p.bad, endsNl: p.endsNl };
  await run('eval', '"after-kills"');
  p = await parse();
  out.afterKills = { lastVerb: p.ok.at(-1).verb, lastArgs: p.ok.at(-1).args, bad: p.bad };
  const hh = await run('history');
  out.historyHuman = { code: hh.code, header: hh.out.split('\n')[0], stderr: hh.err.trim().slice(0, 200) };
  // close, then a command self-heals into a NEW session; the line carries the new id
  await run('close');
  const sAfterClose = fsS.existsSync(path.join(stateDir, 'state.json'));
  await run('eval', '3+3');
  p = await parse();
  out.selfHeal = { stateJsonAfterClose: sAfterClose, lastTwo: p.ok.slice(-2).map((l) => [l.verb, l.sessionId, l.exitCode]) };
  await run('close');
} catch (e) { out.fatal = String(e.stack ?? e); } finally {
  await srv.close();
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
await fs.writeFile(path.join(here, 'cli3-' + label + '.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
