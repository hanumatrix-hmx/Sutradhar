// AUDIT-3: 40 real taskkill /F /PID of CLI eval processes (started here) swept across their whole life, timed with a
// monotonic clock; then every line of history.jsonl must parse (or the reader skips a torn last line) and the next append is clean.
// Usage: node kill3.mjs <cli-js> <label>
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { here, runCli, startServer, logPid, delay } from './lib.mjs';
const [cliPath, label] = process.argv.slice(2);
const cli = path.resolve(cliPath);
const srv = await startServer();
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-a3kill-'));
const env = { SUTRADHAR_CLI_STATE_DIR: path.join(scratch, 'state') };
const hist = path.join(scratch, 'state', 'history.jsonl');
const { pathToFileURL } = await import('node:url');
const H = await import(pathToFileURL(path.resolve(here, '../../../../../../packages/cli/dist/history-file.js')).href);
const out = { label };
try {
  await runCli(cli, ['nav', srv.origin + '/p'], { env, cwd: scratch });
  const CODE = 'new Promise((r) => setTimeout(() => r(1), 1200))';
  const w = await runCli(cli, ['eval', CODE], { env, cwd: scratch });
  out.evalMs = w.ms;
  const kills = [];
  for (let i = 0; i < 40; i++) {
    const at = Math.round((i / 39) * w.ms * 1.1); // sweep the taskkill START from 0 to 1.1x a normal run (taskkill itself takes a few hundred ms to land)
    const t0 = performance.now();
    const c = spawn(process.execPath, [cli, 'eval', CODE + ' /*' + i + '*/'], { env: { ...process.env, ...env }, cwd: scratch, windowsHide: true });
    logPid(c.pid, 'kill3 eval ' + i);
    let exitAt = null; const done = new Promise((r) => c.on('exit', (code) => { exitAt = Math.round(performance.now() - t0); r(code); }));
    while (performance.now() - t0 < at && exitAt === null) await delay(5);
    const killAt = Math.round(performance.now() - t0);
    const t = await new Promise((res) => { const tk = spawn('taskkill', ['/F', '/PID', String(c.pid)], { windowsHide: true }); let so = ''; tk.stdout.on('data', (d) => (so += d)); tk.on('exit', () => res({ stdout: so })); });
    const code = await done;
    kills.push({ i, target: at, killAt, exitAt, killed: /SUCCESS/.test(t.stdout), code });
  }
  const r = await H.readHistoryFile(hist);
  const raw = await fs.readFile(hist, 'utf8');
  out.kills = { attempted: kills.length, killed: kills.filter((k) => k.killed).length, exitedFirst: kills.filter((k) => !k.killed).length, valid: r.lines.length, skipped: r.skipped, endsNl: raw.endsWith('\n'), linesFromSweep: r.lines.length - 2, killedButLineWritten: kills.filter((k) => k.killed && k.code !== 0).length };
  out.detail = kills.map((k) => [k.i, k.target, k.killAt, k.exitAt, k.killed ? 'K' : 'x']);
  await runCli(cli, ['eval', '"after"'], { env, cwd: scratch });
  const r2 = await H.readHistoryFile(hist);
  out.after = { valid: r2.lines.length, skipped: r2.skipped, last: r2.lines.at(-1)?.parsed.args };
  await runCli(cli, ['close'], { env, cwd: scratch });
} catch (e) { out.fatal = String(e.stack ?? e); } finally { await srv.close(); await fs.rm(scratch, { recursive: true, force: true }).catch(() => {}); }
await fs.writeFile(path.join(here, 'kill3-' + label + '.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ evalMs: out.evalMs, kills: out.kills, after: out.after, fatal: out.fatal }, null, 1));
