// AUDIT-1: torn line, empty file, huge file, stale/missing session, Chrome crash mid-command, unwritable path.
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { here, startServer, runCli, logPid, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const cli = path.join(repo, 'packages/cli/dist/cli.js');
const srv = await startServer();
const out = {};
const mk = async () => { const s = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-rob-')); return { s, st: path.join(s, 'state'), env: { SUTRADHAR_CLI_STATE_DIR: path.join(s, 'state') } }; };
const cleanup = [];
const lastV1 = (text) => { const ls = text.split('\n').filter(Boolean).reverse(); for (const l of ls) { try { const p = JSON.parse(l); if (p.v === 1) return p; } catch { /* skip */ } } return undefined; };
try {
  { const { s, st, env } = await mk(); cleanup.push(s);
    const m = await runCli(cli, ['history'], { env, cwd: s }); const mj = await runCli(cli, ['history', '--json'], { env, cwd: s });
    const createdState = await fs.stat(path.join(st, 'state.json')).then(() => true, () => false);
    await fs.mkdir(st, { recursive: true }); await fs.writeFile(path.join(st, 'history.jsonl'), '');
    const e = await runCli(cli, ['history'], { env, cwd: s }); const ej = await runCli(cli, ['history', '--json'], { env, cwd: s });
    out.missingEmpty = { missing: [m.code, m.out.trim()], missingJson: [mj.code, mj.out], createdState, empty: [e.code, e.out.trim(), e.err.trim()], emptyJson: [ej.code, JSON.stringify(ej.out)], ms: m.ms }; }
  { const { s, st, env } = await mk(); cleanup.push(s);
    await runCli(cli, ['nav', srv.origin + '/p'], { env, cwd: s });
    const pid = JSON.parse(await fs.readFile(path.join(st, 'state.json'), 'utf8')).chromePid; logPid(pid, 'chrome (robust torn)');
    await fs.appendFile(path.join(st, 'history.jsonl'), '{"v":1,"type":"comm');
    const ev = await runCli(cli, ['eval', '6*7'], { env, cwd: s });
    await fs.appendFile(path.join(st, 'history.jsonl'), '[1,2]\n{"v":"x"}\n\n{"v":2,"type":"command","ts":"2030-01-01T00:00:00.000Z","sessionId":"future"}\n');
    const h = await runCli(cli, ['history'], { env, cwd: s }); const hj = await runCli(cli, ['history', '--json'], { env, cwd: s });
    const raw = await fs.readFile(path.join(st, 'history.jsonl'), 'utf8');
    out.torn = { evalExit: ev.code, historyExit: h.code, note: h.err.trim(), head: h.out.split('\n')[0], v2shown: /history line version 2/.test(h.out), jsonLines: hj.out.split('\n').filter(Boolean).length, jsonHasV2: hj.out.includes('"v":2'), evalLineIntact: raw.split('\n').some((l) => { try { return JSON.parse(l).verb === 'eval'; } catch { return false; } }) };
    const c = spawn(process.execPath, [cli, 'eval', 'new Promise(r=>setTimeout(()=>r(1),4000))'], { env: { ...process.env, ...env }, cwd: s, windowsHide: true });
    logPid(c.pid, 'cli eval (chrome crash)');
    let cout = ''; c.stdout.on('data', (d) => (cout += d)); c.stderr.on('data', (d) => (cout += d));
    const ex = new Promise((r) => c.on('exit', (code) => r(code)));
    await delay(1500);
    const tk = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { encoding: 'utf8' });
    const code = await Promise.race([ex, delay(120000).then(() => 'timeout')]);
    const last = lastV1(await fs.readFile(path.join(st, 'history.jsonl'), 'utf8'));
    out.crash = { killedChrome: /SUCCESS/.test(tk.stdout), cliExit: code, out: cout.trim().slice(0, 300), lastLine: last && { verb: last.verb, exitCode: last.exitCode, error: last.error, actions: (last.actions ?? []).map((a) => a.actionType + ':' + a.success + ':' + (a.error ?? '').slice(0, 80)), actionsUnavailable: last.actionsUnavailable } };
    const st0 = JSON.parse(await fs.readFile(path.join(st, 'state.json'), 'utf8').catch(() => '{}'));
    const n2 = await runCli(cli, ['nav', srv.origin + '/p'], { env, cwd: s });
    const st1 = JSON.parse(await fs.readFile(path.join(st, 'state.json'), 'utf8'));
    logPid(st1.chromePid, 'chrome (robust self-heal)');
    const l2 = lastV1(await fs.readFile(path.join(st, 'history.jsonl'), 'utf8'));
    const hh = await runCli(cli, ['history'], { env, cwd: s });
    out.selfHeal = { stateBefore: st0.sessionId ?? '(cleared)', navExit: n2.code, newSession: st1.sessionId, lineSession: l2.sessionId, match: l2.sessionId === st1.sessionId, currentMarked: hh.out.includes('--- session ' + st1.sessionId + ' (current) ---') };
    await runCli(cli, ['close'], { env, cwd: s }); }
  { const { s, st, env } = await mk(); cleanup.push(s);
    await fs.mkdir(st, { recursive: true });
    const line = JSON.stringify({ v: 1, type: 'command', ts: '2026-01-01T00:00:00.000Z', sessionId: 's', cwd: 'c', verb: 'eval', args: ['x'.repeat(150)], exitCode: 0, durationMs: 1, actions: [{ actionType: 'eval', success: true, target: 'y'.repeat(200) }], actionsEvicted: 0 }) + '\n';
    const block = line.repeat(Math.ceil(1048576 / line.length));
    const fh = await fs.open(path.join(st, 'history.jsonl'), 'w'); for (let i = 0; i < 60; i++) await fh.write(block); await fh.close();
    const size = (await fs.stat(path.join(st, 'history.jsonl'))).size;
    const h = await runCli(cli, ['history'], { env, cwd: s, timeoutMs: 300000 });
    const hj = await runCli(cli, ['history', '--json'], { env, cwd: s, timeoutMs: 300000 });
    out.huge = { sizeMB: (size / 1048576).toFixed(1), humanExit: h.code, humanMs: h.ms, humanOutMB: (h.out.length / 1048576).toFixed(1), jsonExit: hj.code, jsonMs: hj.ms, jsonLines: hj.out.split('\n').filter(Boolean).length, errTail: (h.err + hj.err).slice(0, 200) }; }
  { const { s, st, env } = await mk(); cleanup.push(s);
    await fs.mkdir(path.join(st, 'history.jsonl'), { recursive: true });
    const n = await runCli(cli, ['nav', srv.origin + '/p'], { env, cwd: s });
    logPid(JSON.parse(await fs.readFile(path.join(st, 'state.json'), 'utf8')).chromePid, 'chrome (robust unwritable)');
    const h = await runCli(cli, ['history'], { env, cwd: s });
    await runCli(cli, ['close'], { env, cwd: s });
    out.unwritable = { navExit: n.code, navOut: n.out.trim().slice(0, 100), warn: n.err.trim().slice(0, 200), historyExit: h.code, historyErr: h.err.trim().slice(0, 200) }; }
} finally {
  await fs.writeFile(path.join(here, 'robustness.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  await srv.close();
  for (const s of cleanup) await fs.rm(s, { recursive: true, force: true }).catch(() => {});
}
