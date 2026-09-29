// FR2-04 audit-3: GAP-233 -- beforeunload in a POPUP, between commands. The popup gets real sticky
// activation (observer Runtime.evaluate userGesture:true on the popup itself), then navigates itself
// away, which must raise its beforeunload dialog. Then: what do the warden, `snap` and
// `dialog accept` do? Also checks which tab `dialog accept` acts on.
// Usage: node gap233-bu-popup-probe.mjs <trials> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, waitBlocked } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const TAG = process.argv[3] ?? 'run';
const root = await makeRoot('g233');
const cli = makeCli(root);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/pop') return s.end(`<!doctype html><title>pop</title><script>onbeforeunload=function(e){e.preventDefault();e.returnValue='x';return 'x';};</script>pop`);
  if (u.pathname === '/left') return s.end(`<!doctype html><title>left</title>left`);
  s.end(`<!doctype html><title>opener ${u.searchParams.get('n')}</title>opener`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    const cd = path.join(root.R, `g-${t}`); dirs.push(cd);
    const n = `bu${t}x${Date.now() % 100000}`;
    const row = { t, n };
    let b;
    try {
      await cli(['nav', `${BASE}/?n=${n}`], cd);
      const st = await readState(cd);
      b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
      const opener = pageTargets(b).find((x) => x.url().includes(n));
      const openerId = idOf(opener);
      const before = new Set(pageTargets(b).map(idOf));
      const os_ = await opener.createCDPSession();
      await os_.send('Runtime.evaluate', { expression: `void window.open('${BASE}/pop')`, userGesture: true });
      await os_.detach().catch(() => {});
      let pop; for (let i = 0; i < 60 && !pop; i++) { pop = pageTargets(b).find((x) => !before.has(idOf(x))); if (!pop) await delay(100); }
      await delay(800);
      const ps = await pop.createCDPSession();
      await ps.send('Runtime.evaluate', { expression: '1', userGesture: true }); // sticky activation on the popup
      await ps.send('Runtime.evaluate', { expression: `setTimeout(()=>{location.href='/left'},100)` });
      row.popupBlocked = await waitBlocked(ps, 4000);
      await delay(600);
      const wf = await readWarden(cd);
      try { const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(8000) }); row.warden = (await r.json()).dialogs.map((d) => `${d.targetId === openerId ? 'OPENER' : d.targetId === idOf(pop) ? 'POP' : '?'}:${d.type}`); } catch (e) { row.warden = 'ERR ' + e.message; }
      const snap = await cli(['snap'], cd, { capMs: 60000 });
      row.snap = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, first: snap.stdout.trim().split('\n')[0]?.slice(0, 160) };
      const acc = await cli(['dialog', 'accept'], cd, { capMs: 30000 });
      row.accept = { code: acc.code, out: acc.stdout.trim().slice(0, 200) };
      await delay(1500);
      row.urlsAfter = pageTargets(b).map((x) => `${idOf(x) === openerId ? 'OPENER' : 'other'}:${x.url().replace(BASE, '')}`);
      row.openerAlive = pageTargets(b).some((x) => idOf(x) === openerId);
      row.popupLeft = pageTargets(b).some((x) => x.url().endsWith('/left'));
      console.log(JSON.stringify({ t, popupBlocked: row.popupBlocked, warden: row.warden, snap: `${snap.code}/${snap.ms}`, first: row.snap.first?.slice(0, 90), accept: row.accept.out.slice(0, 110), openerAlive: row.openerAlive, popupLeft: row.popupLeft }));
      await ps.detach().catch(() => {});
    } catch (e) { row.error = String(e?.stack || e).slice(0, 400); console.log('ERR', row.error); }
    rows.push(row);
    await b?.disconnect().catch(() => {});
    await cli(['close'], cd, { capMs: 30000 });
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, `gap233-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
