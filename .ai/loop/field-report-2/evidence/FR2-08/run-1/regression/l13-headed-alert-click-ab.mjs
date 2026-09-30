// Isolation check for FR2-04's L13 (headed click that opens an alert): same steps against two CLI builds.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const fixture = await fs.readFile('E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/tools/scenario-suite/fixtures/fr2-04-dialogs.html', 'utf-8');
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(fixture); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/fx.html`;
const roots = { mine: 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041', base: 'E:/AI-Cache/tmp/fr208-master' };
const cli = (root, args, dir) => new Promise((resolve) => {
  const t0 = Date.now();
  const c = spawn(process.execPath, [path.join(root, 'packages/cli/dist/cli.js'), ...args], { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: dir }, cwd: dir });
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  const t = setTimeout(() => c.kill(), 90000);
  c.on('close', (code) => { clearTimeout(t); resolve({ code, ms: Date.now() - t0, out: out.trim().slice(0, 200), err: err.trim().slice(0, 120) }); });
});
for (const round of [1,2,3,4,5,6]) for (const name of ['base', 'mine']) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'l13cmp-'));
  await cli(roots[name], ['nav', `${base}?n=l13-${name}-${round}`, '--headed'], dir);
  const click = await cli(roots[name], ['click', '#alert'], dir);
  console.log(name, round, JSON.stringify(click));
  await cli(roots[name], ['dialog', 'accept'], dir);
  await cli(roots[name], ['close'], dir);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}
server.close();
process.exit(0);
