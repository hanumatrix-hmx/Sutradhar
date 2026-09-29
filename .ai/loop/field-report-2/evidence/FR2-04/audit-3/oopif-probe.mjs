// FR2-04 audit-3, point 2 (converse) + GAP-226: can a dialog be open while the page target's
// Performance.getMetrics still answers? Candidate: a dialog raised inside a cross-SITE iframe
// (127.0.0.1 page embedding a localhost iframe => an out-of-process iframe with site isolation).
// The observer confirms the iframe really is a separate 'iframe' target (OOPIF), raises the alert
// from the iframe target's own session (between commands), then asks the product.
// Usage: node oopif-probe.mjs <trials> <capMs> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, metrics, live } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const CAP = Number(process.argv[3] ?? 200000);
const TAG = process.argv[4] ?? 'run';
const root = await makeRoot('oopif');
const cli = makeCli(root);
let PORT;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/ifr') return s.end(`<!doctype html><title>ifr</title><body>iframe ${u.searchParams.get('n')}</body>`);
  s.end(`<!doctype html><title>main ${u.searchParams.get('n')}</title><body>main<iframe id="f" src="http://localhost:${PORT}/ifr?n=${u.searchParams.get('n')}"></iframe></body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
// localhost must resolve to 127.0.0.1 for the iframe; listen on both stacks just in case
const server6 = http.createServer(server.listeners('request')[0]);
await new Promise((r) => server6.listen(PORT, '::1', r)).catch(() => {});
const BASE = `http://127.0.0.1:${PORT}`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    const cd = path.join(root.R, `o-${t}`); dirs.push(cd);
    const n = `of${t}x${Date.now() % 100000}`;
    const row = { t, n };
    let b;
    try {
      await cli(['nav', `${BASE}/?n=${n}`], cd);
      const st = await readState(cd);
      b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
      await delay(800);
      const main = pageTargets(b).find((x) => x.url().includes(n));
      const ifrT = b.targets().find((x) => (x.type() === 'iframe' || x.type() === 'other') && x.url().includes('/ifr'));
      row.oopifTargetExists = !!ifrT;
      row.targetTypes = b.targets().map((x) => `${x.type()}:${x.url().slice(0, 40)}`);
      if (!ifrT) throw new Error('iframe is not an out-of-process target');
      const si = await ifrT.createCDPSession();
      await si.send('Runtime.evaluate', { expression: `setTimeout(()=>alert('OOPIF-${n}'),0)` });
      await delay(700);
      const sm = await main.createCDPSession();
      row.mainGetMetrics = await metrics(sm, 400);
      row.mainRuntimeEval = await live(sm, 400);
      row.iframeRuntimeEval = await live(si, 400);
      const wf = await readWarden(cd);
      try { const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(8000) }); row.warden = (await r.json()).dialogs.map((d) => `${d.type}:${d.message}`); } catch (e) { row.warden = 'ERR ' + e.message; }
      const dlg = await cli(['dialog'], cd, { capMs: 30000 });
      row.dialog = dlg.stdout.trim().slice(0, 300);
      const snap = await cli(['snap'], cd, { capMs: CAP });
      row.snap = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, first: snap.stdout.trim().split('\n').slice(0, 2).join(' | ').slice(0, 200), err: snap.stderr.trim().slice(0, 200) };
      row.iframeStillBlocked = (await live(si, 600)) === 'blocked';
      row.urlsAfter = pageTargets(b).map((x) => x.url());
      row.verdict = snap.killedAtCap ? 'HANG' : snap.code === 3 ? 'EXIT3' : snap.code === 0 ? (/about:blank/.test(snap.stdout) ? 'EXIT0-ABOUTBLANK(WRONG)' : (row.iframeStillBlocked ? 'EXIT0-while-dialog-open' : 'EXIT0')) : `exit${snap.code}`;
      console.log(JSON.stringify({ t, oopif: row.oopifTargetExists, mainGM: row.mainGetMetrics, mainRT: row.mainRuntimeEval, ifrRT: row.iframeRuntimeEval, warden: row.warden, dialog: row.dialog.slice(0, 100), snap: `${snap.code}${snap.killedAtCap ? '(CAP)' : ''}/${snap.ms}`, first: row.snap.first.slice(0, 100), verdict: row.verdict }));
      await si.detach().catch(() => {}); await sm.detach().catch(() => {});
    } catch (e) { row.error = String(e?.stack || e).slice(0, 400); console.log('ERR', row.error); }
    rows.push(row);
    await b?.disconnect().catch(() => {});
    await cli(['close'], cd, { capMs: 30000 });
  }
} finally {
  server.close(); server6.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, `oopif-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
