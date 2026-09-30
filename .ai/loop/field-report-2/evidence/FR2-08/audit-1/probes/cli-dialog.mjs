// CLI: a dialog that opens DURING waitfor (FR2-08 path, not FR2-04's pre-command gate).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { WT, startServer, rec, results, PIDS, logPid } from './lib.mjs';
const CLI = path.join(WT, 'packages', 'cli', 'dist', 'cli.js');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-fr208-cli2-'));
const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir };
const run = (args, to = 60000) => new Promise((res) => { const t0 = performance.now(); const c = spawn(process.execPath, [CLI, ...args], { env }); logPid(c.pid, 'cli ' + args[0]); let o = ''; let e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); const k = setTimeout(() => c.kill(), to); c.on('close', (code) => { clearTimeout(k); res({ code, out: o, err: e, ms: Math.round(performance.now() - t0) }); }); });
const srv = await startServer();
try {
  for (const [id, args] of [['text', ['--text', 'Never appears']], ['textGone-present', ['--text-gone', 'Hello visible']]]) {
    await run(['nav', srv.origin + '/alert-now?d=2500&t=Hello%20visible&i=' + id]);
    const r = await run(['waitfor', '15000', ...args]);
    rec('cli:dialog-mid-wait-' + id, r.code === 3 && /blocked by an open alert/.test(r.out) && r.ms < 9000, { code: r.code, ms: r.ms, out: r.out.slice(0, 160) });
    await run(['dialog', 'accept']);
  }
} finally { await run(['close']); srv.close(); }
fs.writeFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'cli-dialog.json'), JSON.stringify({ results, pids: PIDS }, null, 2));
