// A/B of a plain HEADED `click` (no dialog) between the pre-change build (master 75b29c6, temp dir) and this branch:
// 12 interleaved rounds; counts click failures (the UC-12 symptom "Action click timed out after 15000ms").
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const html = '<!doctype html><html><body><button id="b" onclick="document.title=\'clicked\'">go</button></body></html>';
const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); r.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const roots = { base: 'E:/AI-Cache/tmp/fr208-master', mine: 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041' };
const cli = (root, args, dir) => new Promise((resolve) => {
  const t0 = Date.now();
  const c = spawn(process.execPath, [path.join(root, 'packages/cli/dist/cli.js'), ...args], { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: dir }, cwd: dir });
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  const t = setTimeout(() => c.kill(), 90000);
  c.on('close', (code) => { clearTimeout(t); resolve({ code, ms: Date.now() - t0, out: out.trim().slice(0, 100) }); });
});
const tally = { base: { ok: 0, fail: 0 }, mine: { ok: 0, fail: 0 } };
for (let round = 1; round <= 12; round++) for (const name of ['base', 'mine']) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hclick-'));
  await cli(roots[name], ['nav', `${base}?n=${name}${round}`, '--headed'], dir);
  const click = await cli(roots[name], ['click', '#b'], dir);
  const ok = click.code === 0 && /Clicked/.test(click.out);
  tally[name][ok ? 'ok' : 'fail']++;
  console.log(name, round, ok ? 'ok' : 'FAIL', click.ms, JSON.stringify(click.out));
  await cli(roots[name], ['close'], dir);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(tally));
server.close();
process.exit(0);
