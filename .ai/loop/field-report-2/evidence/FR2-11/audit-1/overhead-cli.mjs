// AUDIT-1: CLI per-command wall time, HEAD vs master, alternating (each side its own state dir + Chrome).
import path from 'node:path'; import fs from 'node:fs/promises'; import os from 'node:os';
import { here, runCli, startServer, logPid } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const CLIS = { head: path.join(repo, 'packages/cli/dist/cli.js'), master: 'E:/AI-Cache/tmp/fr211-master/packages/cli/dist/cli.js' };
const srv = await startServer();
const ctx = {};
for (const side of ['head', 'master']) { const s = await fs.mkdtemp(path.join(os.tmpdir(), 'fr211-audit-ocli-')); ctx[side] = { s, env: { SUTRADHAR_CLI_STATE_DIR: path.join(s, 'state') }, t: [] }; const r = await runCli(CLIS[side], ['nav', srv.origin + '/p'], { env: ctx[side].env, cwd: s }); logPid(JSON.parse(await fs.readFile(path.join(s, 'state', 'state.json'), 'utf8')).chromePid, 'chrome overhead-cli ' + side); if (r.code !== 0) throw new Error(side + ' nav ' + r.err); }
try {
  for (let i = 0; i < 20; i++) for (const side of i % 2 ? ['master', 'head'] : ['head', 'master']) { const r = await runCli(CLIS[side], ['eval', String(i)], { env: ctx[side].env, cwd: ctx[side].s }); ctx[side].t.push(r.ms); }
} finally { for (const side of ['head', 'master']) { await runCli(CLIS[side], ['close'], { env: ctx[side].env, cwd: ctx[side].s }); } await srv.close(); }
const st = (a) => { const s = [...a].sort((x, y) => x - y); return { n: a.length, mean: Math.round(a.reduce((x, y) => x + y, 0) / a.length), median: s[Math.floor(s.length / 2)] }; };
const out = { head: st(ctx.head.t), master: st(ctx.master.t) };
out.deltaMedianMs = out.head.median - out.master.median;
console.log(JSON.stringify(out));
await fs.writeFile(path.join(here, 'overhead-cli.json'), JSON.stringify(out, null, 1));
for (const side of ['head', 'master']) await fs.rm(ctx[side].s, { recursive: true, force: true }).catch(() => {});
