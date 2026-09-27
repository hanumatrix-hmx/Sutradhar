// FR2-04 audit-6: PURE-CLI reproduction (no observer, no raw CDP at all) of the crashed-renderer
// session lockout, against both builds:
//   cur    = this worktree's dist (HEAD 36eefa4)
//   master = the main checkout's pre-FR2-04 dist (no __dialog-warden in it)
// Steps: nav <page> -> newtab <page2> -> (let it settle) -> nav chrome://crash (crashes the ACTIVE
// tab's renderer, a real Chrome renderer crash / "Aw, Snap!") -> snap -> tabs -> dialog ->
// dialog accept -> closetab <crashed tab id, if tabs printed it> -> focustab <other> -> nav <page3>
// -> snap. Records exit code of each step.
// usage: node cli-crash-probe.mjs [trials]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here, CLI_DEFAULT } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 2);
const MASTER_CLI = 'E:/HMX_Projects/Internal_Projects/PinchTab/packages/cli/dist/cli.js';
const server = http.createServer((q, s) => { const n = new URL(q.url, 'http://x').searchParams.get('n'); s.writeHead(200, { 'content-type': 'text/html' }); s.end(`<!doctype html><title>page ${n}</title><body>page ${n}</body>`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const root = await makeRoot('clicrash');
const clis = { cur: makeCli(root, CLI_DEFAULT), master: makeCli(root, MASTER_CLI) };
const dirs = [];
const results = [];
const outFile = path.join(here, 'cli-crash.json');
const short = (r) => ({ args: r.args, code: r.code, ms: r.ms, cap: r.killedAtCap, out: r.stdout.trim().split('\n').slice(0, 3).join(' | ').slice(0, 300), err: r.stderr.trim().split('\n').slice(0, 2).join(' | ').slice(0, 300) });
try {
  for (const which of ['cur', 'master']) {
    const cli = clis[which];
    for (let t = 0; t < TRIALS; t++) {
      const cd = path.join(root.R, `${which}-${t}`);
      dirs.push(cd);
      const rec = { which, trial: t, steps: [] };
      const run = async (args, capMs = 60000) => { const r = await cli(args, cd, { capMs }); rec.steps.push(short(r)); return r; };
      await run(['nav', `${BASE}/?n=keep${t}`]);
      await run(['newtab', `${BASE}/?n=victim${t}`]);
      await delay(1200);
      await run(['nav', 'chrome://crash']);
      await delay(1500);
      await run(['snap']);
      const tabs = await run(['tabs']);
      await run(['dialog']);
      await run(['dialog', 'accept']);
      const ids = [...tabs.stdout.matchAll(/(tab_\S+)\s+(.*)/g)].map((m) => ({ id: m[1], rest: m[2] }));
      const victim = ids.find((x) => /victim|crash/.test(x.rest));
      const keep = ids.find((x) => /keep/.test(x.rest));
      if (victim) await run(['closetab', victim.id]);
      if (keep) await run(['focustab', keep.id]);
      await run(['nav', `${BASE}/?n=after${t}`]);
      const fin = await run(['snap']);
      rec.finalSnap = fin.code;
      results.push(rec);
      console.log(JSON.stringify({ which, t, codes: rec.steps.map((x) => `${x.args.split(' ').slice(0, 2).join('+').replace(/http\S+/, 'url')}=${x.code}`).join(' '), final: fin.code }));
      await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
      await run(['close'], 30000);
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, clis.cur, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
