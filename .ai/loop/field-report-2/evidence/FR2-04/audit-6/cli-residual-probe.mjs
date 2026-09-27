// FR2-04 audit-6: PURE-CLI reproduction (no observer connection at all) of escalation-2's DISCLOSED
// RESIDUAL -- a popup that is busy from birth (its own first script does a synchronous XHR, i.e.
// the legacy `$.ajax({async:false})` pattern, against a slow endpoint). No dialog exists anywhere,
// so ANY close is an innocent close. Controls: the same popup shapes with a REAL load-time alert
// (a close there is the CORRECT recovery -- the thing the residual is the price of).
// Each trial: nav -> click (opens popup) -> short settle -> snap -> dialog -> dialog accept ->
// dialog -> (wait for the XHR to have finished) -> tabs -> close. Records whether the popup was
// closed, and (via `tabs`) whether it would have survived / loaded normally.
// usage: node cli-residual-probe.mjs [trials] [variant,variant] [tag]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const ALL = ['own-xhr-3000', 'own-xhr-8000', 'own-xhr-20000', 'link-xhr-20000', 'xs-own-xhr-20000', 'ctl-own-alert', 'ctl-link-alert', 'ctl-xs-alert'];
const VARIANTS = (process.argv[3] && process.argv[3] !== 'all' ? process.argv[3] : ALL.join(',')).split(',');
const TAG = process.argv[4] ?? 'run1';
let PORT;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  const n = u.searchParams.get('n') ?? '';
  if (u.pathname === '/slow') { setTimeout(() => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('ok'); }, Number(u.searchParams.get('ms') || 8000)); return; }
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/xhr-inline') return s.end(`<!doctype html><title>report ${n}</title><script>var x=new XMLHttpRequest();x.open('GET','/slow?ms=${u.searchParams.get('ms')}',false);x.send();document.title='loaded ${n}';</script><body>report</body>`);
  if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>alerting ${n}</title><script>alert('inline-${n}')</script><body>inline</body>`);
  if (u.pathname === '/opener') {
    const v = u.searchParams.get('v');
    const ms = /xhr-(\d+)/.exec(v)?.[1];
    const tgt = v === 'own-xhr-3000' || v === 'own-xhr-8000' || v === 'own-xhr-20000' ? `/xhr-inline?n=popup&ms=${ms}`
      : v === 'xs-own-xhr-20000' ? `http://localhost:${PORT}/xhr-inline?n=popup&ms=20000`
      : v === 'link-xhr-20000' ? `/xhr-inline?n=popup&ms=20000`
      : v === 'ctl-own-alert' || v === 'ctl-link-alert' ? '/alert-inline?n=popup'
      : `http://localhost:${PORT}/alert-inline?n=popup`;
    const el = v.startsWith('link') || v === 'ctl-link-alert'
      ? `<a id="b" href="${tgt}" target="_blank">open report</a>`
      : `<button id="b" onclick="window.w=window.open('${tgt}')">open report</button>`;
    return s.end(`<!doctype html><title>opener ${v}</title><body>${el}</body>`);
  }
  return s.end(`<!doctype html><title>page ${n}</title><body>page</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const root = await makeRoot('clires');
const cli = makeCli(root);
const dirs = [];
const results = [];
const outFile = path.join(here, `cli-residual-${TAG}.json`);
const short = (r) => ({ args: r.args, code: r.code, ms: r.ms, cap: r.killedAtCap, out: r.stdout.trim().slice(0, 700), err: r.stderr.trim().slice(0, 700) });

try {
  for (const v of VARIANTS) {
    for (let t = 0; t < TRIALS; t++) {
      const cd = path.join(root.R, `c-${v}-${t}`);
      dirs.push(cd);
      const rec = { variant: v, trial: t, steps: [] };
      const run = async (args, capMs = 45000) => { const r = await cli(args, cd, { capMs }); rec.steps.push(short(r)); return r; };
      const t0 = Date.now();
      await run(['nav', `${BASE}/opener?v=${v}&t=${t}`]);
      const clickAt = Date.now();
      await run(['click', '#b']);
      await delay(800);
      const snap = await run(['snap']);
      await run(['dialog']);
      const acc = await run(['dialog', 'accept']);
      rec.acceptAtMsAfterClick = Date.now() - clickAt;
      rec.accept = { code: acc.code, closed: /was closed/.test(acc.stdout), out: acc.stdout.trim().slice(0, 300), err: acc.stderr.trim().slice(0, 300) };
      await run(['dialog']);
      const ms = Number(/xhr-(\d+)/.exec(v)?.[1] ?? 0);
      const waitLeft = Math.max(0, ms + 1500 - (Date.now() - clickAt));
      await delay(waitLeft);
      const tabs = await run(['tabs']);
      rec.popupSurvived = /popup/.test(tabs.stdout) || /report|loaded/.test(tabs.stdout);
      rec.popupLoaded = /loaded popup/.test(tabs.stdout);
      rec.snapCode = snap.code;
      const c = await run(['close'], 30000);
      rec.closeCode = c.code;
      rec.totalMs = Date.now() - t0;
      results.push(rec);
      console.log(JSON.stringify({ v, t, snap: snap.code, acceptCode: acc.code, closedPopup: rec.accept.closed, acceptAtMs: rec.acceptAtMsAfterClick, popupSurvived: rec.popupSurvived, popupLoaded: rec.popupLoaded, tabs: tabs.stdout.trim().replace(/\n/g, ' || ').slice(0, 260) }));
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
