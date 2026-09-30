// AUDIT-1: real CLI processes killed with taskkill /F /PID mid-command (PIDs this script started only).
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { here, startServer, runCli, logPid, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const cli = path.join(repo, 'packages/cli/dist/cli.js');
const srv = await startServer();
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-kill-'));
const stateDir = path.join(scratch, 'state');
const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir };
const out = { rounds: [] };
try {
  const n = await runCli(cli, ['nav', `${srv.origin}/p`], { env, cwd: scratch });
  const st = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8'));
  logPid(st.chromePid, 'chrome (cli-kill)');
  out.nav = n.code;
  const delays = Array.from({ length: 30 }, (_, i) => 680 + i * 6);
  for (const d of delays) {
    const c = spawn(process.execPath, [cli, 'eval', 'new Promise(r=>setTimeout(()=>r(7),700))'], { env, cwd: scratch, windowsHide: true });
    logPid(c.pid, `cli eval (kill after ${d}ms)`);
    const exited = new Promise((r) => c.on('exit', (code, sig) => r({ code, sig })));
    const t0 = performance.now();
    await Promise.race([delay(d), exited]);
    const k = spawnSync('taskkill', ['/F', '/PID', String(c.pid)], { encoding: 'utf8' });
    const e = await exited;
    const raw = await fs.readFile(path.join(stateDir, 'history.jsonl'), 'utf8').catch(() => '');
    out.rounds.push({ delay: d, killed: /SUCCESS/.test(k.stdout), exit: e, lines: raw.split('\n').filter(Boolean).length, endsNl: raw === '' || raw.endsWith('\n'), elapsed: Math.round(performance.now() - t0) });
  }
  const after = await runCli(cli, ['eval', '1+1'], { env, cwd: scratch });
  const hj = await runCli(cli, ['history', '--json'], { env, cwd: scratch });
  const h = await runCli(cli, ['history'], { env, cwd: scratch });
  const raw = await fs.readFile(path.join(stateDir, 'history.jsonl'), 'utf8');
  const all = raw.split('\n').filter(Boolean);
  let bad = 0; for (const l of all) { try { JSON.parse(l); } catch { bad++; } }
  out.final = { afterEvalExit: after.code, afterOut: after.out.trim(), jsonLines: hj.out.split('\n').filter(Boolean).length, fileLines: all.length, unparseable: bad, historyStderr: h.err.trim(), historyHead: h.out.split('\n')[0], lastVerb: JSON.parse(all.at(-1)).verb, lastActions: JSON.parse(all.at(-1)).actions.length };
  console.log(JSON.stringify(out.rounds.map((r) => `${r.delay}:${r.killed ? 'K' : '-'}:${r.exit.code}:${r.lines}`)), JSON.stringify(out.final));
} finally {
  const c = await runCli(cli, ['close'], { env, cwd: scratch });
  out.close = c.code;
  await fs.writeFile(path.join(here, 'cli-kill-fine.json'), JSON.stringify(out, null, 1));
  await srv.close();
  await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
}
