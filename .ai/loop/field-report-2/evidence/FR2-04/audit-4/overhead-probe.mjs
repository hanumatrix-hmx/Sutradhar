// FR2-04 audit-4, points 2 (tab-count scaling) and 7 (gate overhead). Variants:
//   branch        : the real built CLI at HEAD (gate + ensureWarden health check each command)
//   nogate        : a temporary COPY of dist/cli.js with the gate short-circuited (verb treated as exempt for the gate only)
//   nogate-noens  : as nogate, and afterAttach's ensureWarden() call removed
//   master        : the pre-FR2-04 CLI dist in the main checkout (built at 7073142, read-only use)
// The copies live next to dist/cli.js (so relative imports resolve) and are deleted in finally;
// dist/cli.js's sha256 is recorded before and after to prove it was never modified.
// Usage: node overhead-probe.mjs <N> <tabCounts comma> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { makeRoot, makeCli, readState, readWarden, delay, cleanupRoot, here, repoRoot } from './lib.mjs';

const N = Number(process.argv[2] ?? 12);
const TABS = (process.argv[3] ?? '1').split(',').map(Number);
const TAG = process.argv[4] ?? 'run';
const DIST = path.join(repoRoot, 'packages/cli/dist');
const ORIG = path.join(DIST, 'cli.js');
const MASTER = process.env.MASTER_CLI ?? 'E:/HMX_Projects/Internal_Projects/PinchTab/packages/cli/dist/cli.js';
const sha = async (f) => crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
const shaBefore = await sha(ORIG);
const src = await fs.readFile(ORIG, 'utf-8');
const GATE_LINE = "            if (verbClass === 'exempt')\n                return;\n            const state = rawState;";
if (!src.includes("if (verbClass === 'exempt')")) throw new Error('gate anchor not found');
const ENS = 'await ensureWarden({ stateDir: STATE_DIR, wsEndpoint: nowState.wsEndpoint }).catch(() => undefined);';
if (!src.includes(ENS)) throw new Error('ensureWarden anchor not found');
// short-circuit ONLY the first occurrence (the gate dep inside withSession)
const idx = src.indexOf("if (verbClass === 'exempt')");
const nogate = src.slice(0, idx) + "if (true /* audit4-nogate */)" + src.slice(idx + "if (verbClass === 'exempt')".length);
const nogateNoens = nogate.replace(ENS, '/* audit4-noensure */;');
const NOGATE = path.join(DIST, 'cli.audit4-nogate.js');
const NOENS = path.join(DIST, 'cli.audit4-nogate-noens.js');
await fs.writeFile(NOGATE, nogate);
await fs.writeFile(NOENS, nogateNoens);

const root = await makeRoot('ovh');
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end('<title>go</title><body>go <button id="b">b</button><a href="#x">x</a></body>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const variants = { branch: ORIG, nogate: NOGATE, 'nogate-noens': NOENS, master: MASTER };
if (process.env.PRE) variants['pre-fr2-04(369cfee)'] = process.env.PRE;
if (process.env.ONLY) for (const k of Object.keys(variants)) if (!process.env.ONLY.split(',').includes(k)) delete variants[k];
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], min: s[0], max: s.at(-1), mean: Math.round(s.reduce((x, y) => x + y, 0) / s.length) }; };
const out = { shaBefore, N, rows: [] };
const dirs = [];
const cliBranch = makeCli(root, ORIG);
try {
  for (const tabs of TABS) {
    for (const [label, cliPath] of Object.entries(variants)) {
      if (label === 'master' && tabs !== TABS[0] && tabs > 1 && false) continue;
      const cli = makeCli(root, cliPath);
      const d = path.join(root.R, `st-${label}-${tabs}`); dirs.push(d);
      const nav = await cli(['nav', URL_ + '?t=0'], d);
      for (let i = 1; i < tabs; i++) await cli(['newtab', URL_ + '?t=' + i], d);
      await cli(['focustab', 'x'], d).catch(() => {});
      await cli(['snap'], d); // warm
      const snapMs = [], dialogMs = [], wardenListMs = [];
      for (let i = 0; i < N; i++) {
        const r = await cli(['snap'], d);
        if (r.code !== 0) { out.rows.push({ label, tabs, error: r.stderr.slice(0, 300) }); break; }
        snapMs.push(r.ms);
      }
      if (label !== 'master') {
        for (let i = 0; i < Math.min(N, 6); i++) dialogMs.push((await cli(['dialog'], d)).ms);
        const wf = await readWarden(d);
        if (wf) for (let i = 0; i < 6; i++) {
          const t0 = performance.now();
          await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` } }).then((r) => r.json());
          wardenListMs.push(Math.round(performance.now() - t0));
        }
      }
      const row = { label, tabs, navCode: nav.code, snap: stats(snapMs), dialogVerb: dialogMs.length ? stats(dialogMs) : null, wardenListHttp: wardenListMs.length ? stats(wardenListMs) : null };
      out.rows.push(row);
      console.log(JSON.stringify(row));
      await cliBranch(['close'], d, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  out.leftovers = await cleanupRoot(root, cliBranch, dirs);
  await fs.rm(NOGATE, { force: true }); await fs.rm(NOENS, { force: true });
  out.shaAfter = await sha(ORIG);
  out.distUntouched = out.shaAfter === shaBefore;
  out.copiesRemoved = !(await fs.stat(NOGATE).catch(() => null)) && !(await fs.stat(NOENS).catch(() => null));
  await fs.writeFile(path.join(here, `overhead-${TAG}.json`), JSON.stringify(out, null, 2));
  console.log('distUntouched', out.distUntouched, 'copiesRemoved', out.copiesRemoved, 'leftovers', JSON.stringify(out.leftovers));
  process.exit(0);
}
