// FR2-04 audit-6: PURE-CLI reach of "GAP-252 with its anchor removed". GAP-252's fix links two
// cross-site sibling popups THROUGH their (responsive) opener. If that opener goes away (here: it
// is itself a script-opened window that closes itself right after its work, e.g. a small
// "compose"/"search" window), the two siblings are unlinked again. Pure CLI steps only:
//   nav main -> click #open (opens the typer window W) -> focustab W -> type #in ab
//   (keystroke 1 opens an innocent cross-site popup, keystroke 2 opens one whose page alerts on
//   load; then W closes itself) -> snap -> dialog -> dialog accept x3 -> tabs.
// Any close of the '?n=first-innocent' popup before the holder is a wrong (innocent) close.
// usage: node cli-252-openerclosed-probe.mjs [trials] [closeDelayMs]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 4);
const CLOSE_MS = Number(process.argv[3] ?? 600);
let PORT;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>holder</title><script>alert('inline-${u.searchParams.get('n')}')</script><body>inline</body>`);
  if (u.pathname === '/typer') return s.end(`<!doctype html><title>typer</title><body><input id="in">
<script>let k=0;document.getElementById('in').addEventListener('keydown',()=>{k++;open('http://localhost:${PORT}/'+(k===1?'?n=first-innocent':'alert-inline?n=second-holder'));if(k===2)setTimeout(()=>window.close(),${CLOSE_MS});});</script></body>`);
  if (u.pathname === '/main') return s.end(`<!doctype html><title>main</title><body><button id="open" onclick="window.w=window.open('/typer','typer')">compose</button></body>`);
  return s.end(`<!doctype html><title>page ${u.searchParams.get('n')}</title><body>page</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
const root = await makeRoot('c252');
const cli = makeCli(root);
const dirs = [];
const results = [];
const outFile = path.join(here, `cli-252-openerclosed-${CLOSE_MS}.json`);
const short = (r) => ({ args: r.args, code: r.code, ms: r.ms, out: r.stdout.trim().slice(0, 700), err: r.stderr.trim().slice(0, 900) });
try {
  for (let t = 0; t < TRIALS; t++) {
    const cd = path.join(root.R, `c-${t}`);
    dirs.push(cd);
    const rec = { trial: t, steps: [] };
    const run = async (args) => { const r = await cli(args, cd, { capMs: 45000 }); rec.steps.push(short(r)); return r; };
    await run(['nav', `${BASE}/main?t=${t}`]);
    await run(['click', '#open']);
    const tabs0 = await run(['tabs']);
    const typerTab = /(tab_\S+)\s+typer/.exec(tabs0.stdout)?.[1];
    if (typerTab) await run(['focustab', typerTab]);
    await run(['type', '#in', 'ab']);
    await delay(CLOSE_MS + 1200);
    await run(['snap']);
    await run(['dialog']);
    const closes = [];
    for (let i = 0; i < 3; i++) {
      const a = await run(['dialog', 'accept']);
      if (/was closed/.test(a.stdout)) closes.push(a.stdout.trim().slice(0, 200));
      const l = await run(['dialog']);
      if (/No dialog is open/.test(l.stdout)) break;
    }
    const tabs = await run(['tabs']);
    rec.innocentSurvived = /first-innocent/.test(tabs.stdout);
    rec.holderGone = !/second-holder/.test(tabs.stdout);
    rec.closes = closes;
    results.push(rec);
    console.log(JSON.stringify({ t, typerTab: !!typerTab, closes: closes.length, innocentSurvived: rec.innocentSurvived, holderGone: rec.holderGone, tabs: tabs.stdout.trim().replace(/\n/g, ' || ').slice(0, 300) }));
    await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    await run(['close']);
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
