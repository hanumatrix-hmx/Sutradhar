// audit-6 COPY of escalation-2 cli-repro-probe.mjs with ONE fix: inline onclick handlers called open(...), which inside an inline event handler resolves to document.open() (wipes the opener, never opens a popup). Replaced with window.open(...).
// FR2-04 audit-5: PURE-CLI reproductions (no observer connection at all) of A5-02 and A5-03, to
// judge real reach through CLI verbs only.
//  - xhr-after-open: a button whose click handler opens a blank popup and then does a synchronous
//    XHR to fetch the URL it will navigate the popup to (the legacy "open-then-fetch" pattern).
//    No dialog anywhere. (A5-02 shape.)
//  - type-two-popups: an input whose keydown handler opens a same-site cross-origin popup per key;
//    the 2nd page alerts while loading. `type #in ab` = two activations in one CLI command. (A5-03.)
// Afterwards follow the CLI's own hint: snap, dialog, dialog accept x2, snap. The page's own
// window.name bookkeeping + the closed tab's URL in the recovery message identify what closed.
// usage: node cli-repro-probe.mjs [trials] [variant,variant]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const VARIANTS = (process.argv[3] ?? 'xhr-after-open,xhr-after-open-timer,type-two-popups').split(',');
let PORT;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/slow') { setTimeout(() => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('/?n=popup-target'); }, Number(u.searchParams.get('ms') || 8000)); return; }
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>inline</title><script>alert('inline-${u.searchParams.get('n')}')</script><body>inline</body>`);
  if (u.pathname === '/xhr-after-open') return s.end(`<!doctype html><title>xhr-after-open</title><body>
<button id="b" onclick="window.w=window.open('');var x=new XMLHttpRequest();x.open('GET','/slow?ms=12000',false);x.send();w.location=x.responseText;">open report</button></body>`);
  if (u.pathname === '/xhr-after-open-timer') return s.end(`<!doctype html><title>xhr-after-open-timer</title><body>
<button id="b" onclick="window.w=window.open('');setTimeout(()=>{var x=new XMLHttpRequest();x.open('GET','/slow?ms=12000',false);x.send();w.location=x.responseText;},100);">open report</button></body>`);
  if (u.pathname === '/delayed-open-xhr') return s.end(`<!doctype html><title>delayed-open-xhr</title><body>
<button id="b" onclick="setTimeout(()=>{window.w=window.open('');setTimeout(()=>{var x=new XMLHttpRequest();x.open('GET','/slow?ms=12000',false);x.send();w.location=x.responseText;},150);},4300);">open report later</button></body>`);
  if (u.pathname === '/url-open-xhr') return s.end(`<!doctype html><title>url-open-xhr</title><body>
<button id="b" onclick="window.w=window.open('/?n=report-window');setTimeout(()=>{var x=new XMLHttpRequest();x.open('GET','/slow?ms=12000',false);x.send();},150);">open report</button></body>`);
  if (u.pathname === '/type-two-popups') return s.end(`<!doctype html><title>type</title><body><input id="in">
<script>let k=0;document.getElementById('in').addEventListener('keydown',()=>{k++;open('http://localhost:${PORT}/'+(k===1?'?n=first-innocent':'alert-inline?n=second-holder'));});</script></body>`);
  return s.end(`<!doctype html><title>page ${u.searchParams.get('n')}</title><body>page</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const root = await makeRoot('clirepro');
const cli = makeCli(root);
const dirs = [];
const results = [];
const outFile = path.join(here, `cli-repro-fixed-${process.argv[4] ?? 'run1'}.json`);
const short = (r) => ({ args: r.args, code: r.code, ms: r.ms, cap: r.killedAtCap, out: r.stdout.trim().slice(0, 500), err: r.stderr.trim().slice(0, 600) });

try {
  for (const variant of VARIANTS) {
    for (let t = 0; t < TRIALS; t++) {
      const cd = path.join(root.R, `c-${variant}-${t}`);
      dirs.push(cd);
      const rec = { variant, trial: t, steps: [] };
      const run = async (args, capMs = 45000) => { const r = await cli(args, cd, { capMs }); rec.steps.push(short(r)); return r; };
      await run(['nav', `${BASE}/${variant}?t=${t}`]);
      if (variant.startsWith('xhr-after-open') || variant === 'delayed-open-xhr' || variant === 'url-open-xhr') await run(['click', '#b']);
      else await run(['type', '#in', 'ab']);
      await delay(variant === 'delayed-open-xhr' ? 4800 : 1200);
      await run(['snap']);
      await run(['dialog']);
      const accs = [];
      for (let i = 0; i < 4; i++) { accs.push(await run(['dialog', 'accept'])); await run(['dialog']); }
      rec.closedUrls = accs.map((r) => /was closed/.test(r.stdout) ? (/\((http[^)]*|about:blank)\)/.exec(r.stdout)?.[1] ?? 'closed(no url)') : null);
      await delay((variant.startsWith('xhr-after-open') || variant === 'delayed-open-xhr' || variant === 'url-open-xhr') ? 12000 : 500);
      await run(['tabs']);
      const c = await run(['close'], 30000);
      rec.closeCode = c.code;
      results.push(rec);
      console.log(JSON.stringify({ variant, t, codes: rec.steps.map((s) => `${s.args.split(' ').slice(0, 2).join('+')}=${s.code}`).join(' '), closedUrls: rec.closedUrls }));
      await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
