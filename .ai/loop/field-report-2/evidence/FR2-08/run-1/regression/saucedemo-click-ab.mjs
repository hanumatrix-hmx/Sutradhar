// UC-12's steps (headed saucedemo login + add-to-cart click) against the pre-change build (master 75b29c6, temp dir) and this branch,
// interleaved. Counts "Click failed: Action click timed out after 15000ms" (the symptom seen in the branch's full CLI-suite run).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const roots = { base: 'E:/AI-Cache/tmp/fr208-master', mine: 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041' };
const cli = (root, args, dir) => new Promise((resolve) => {
  const t0 = Date.now();
  const c = spawn(process.execPath, [path.join(root, 'packages/cli/dist/cli.js'), ...args], { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: dir }, cwd: dir });
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  const t = setTimeout(() => c.kill(), 120000);
  c.on('close', (code) => { clearTimeout(t); resolve({ code, ms: Date.now() - t0, out: out.trim(), err: err.trim().slice(0, 200) }); });
});
const tally = { base: { ok: 0, fail: 0 }, mine: { ok: 0, fail: 0 } };
const N = Number(process.argv[2] ?? 8);
for (let round = 1; round <= N; round++) for (const name of ['base', 'mine']) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sdclick-'));
  const R = roots[name];
  await cli(R, ['nav', 'https://www.saucedemo.com/', '--headed'], dir);
  await cli(R, ['type', '#user-name', 'standard_user'], dir);
  await cli(R, ['type', '#password', 'secret_sauce'], dir);
  await cli(R, ['click', '#login-button'], dir);
  const snap = await cli(R, ['snap'], dir);
  const addId = snap.out.split('\n').find((l) => /Add to cart/.test(l))?.match(/^\[#(\d+)\]/)?.[1];
  const click = addId ? await cli(R, ['click', addId], dir) : { code: -1, ms: 0, out: 'no add button' };
  const ok = click.code === 0 && /Clicked/.test(click.out);
  tally[name][ok ? 'ok' : 'fail']++;
  console.log(name, round, ok ? 'ok' : 'FAIL', click.ms, JSON.stringify(click.out.slice(0, 90)));
  await cli(R, ['close'], dir);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(tally));
process.exit(0);
