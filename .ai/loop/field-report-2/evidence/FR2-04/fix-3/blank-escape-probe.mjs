// FR2-04 audit-3, point 2: is GAP-228 caught on its own merits, or only because the OPENER shares
// the popup's renderer? listPageTargets() drops every about:blank target, so a blank popup is never
// probed itself. Here the opener starts a cross-site navigation and then opens a blank popup that
// alerts synchronously; with site isolation the opener commits in a NEW renderer (responsive), the
// popup stays in the old one (blocked), and nothing the gate probes is blocked any more.
// Variants: 'xsite-nav' (as above), 'same-site' (control: same shape without the navigation).
// Usage: node blank-escape-probe.mjs <trials> <capMs> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, metrics } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const CAP = Number(process.argv[3] ?? 60000);
const TAG = process.argv[4] ?? 'run';
const root = await makeRoot('blankesc');
const cli = makeCli(root);
let PORT;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/other') return s.end(`<!doctype html><title>other ${u.searchParams.get('n')}</title><body>other</body>`);
  s.end(`<!doctype html><title>opener ${u.searchParams.get('n')}</title><body>opener</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
const server6 = http.createServer(server.listeners('request')[0]);
await new Promise((r) => server6.listen(PORT, '::1', r)).catch(() => {});
const BASE = `http://127.0.0.1:${PORT}`;
const VARIANTS = {
  'xsite-nav': (n) => `(function(){location.href='http://localhost:${PORT}/other?n=${n}';var w=window.open('');w.document.write('<script>alert("ESC-${n}")<\\/script>');})()`,
  'xsite-nav-w.setTimeout': (n) => `(function(){location.href='http://localhost:${PORT}/other?n=${n}';var w=window.open('');w.setTimeout(function(){w.alert('ESC3-${n}')},50);})()`,
  'xsite-nav-docwrite-timer': (n) => `(function(){var w=window.open('');w.document.write('<script>setTimeout(function(){alert("ESC2-${n}")},1500)<\\/script>');w.document.close();location.href='http://localhost:${PORT}/other?n=${n}';})()`,
  'same-site-control': (n) => `(function(){var w=window.open('');w.alert('CTL-${n}');})()`,
};
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const [vname, expr] of Object.entries(VARIANTS)) {
      const cd = path.join(root.R, `b-${t}-${vname}`); dirs.push(cd);
      const n = `be${t}x${Date.now() % 100000}`;
      const row = { t, variant: vname, n };
      let b;
      try {
        await cli(['nav', `${BASE}/?n=${n}`], cd);
        const st = await readState(cd);
        b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
        const opener = pageTargets(b).find((x) => x.url().includes(n));
        const s = await opener.createCDPSession();
        await s.send('Runtime.evaluate', { expression: expr(n), userGesture: true }, { timeout: 3000 }).catch(() => {});
        await s.detach().catch(() => {});
        await delay(3000);
        const tg = [];
        for (const x of pageTargets(b)) { const ss = await x.createCDPSession().catch(() => undefined); const m = ss ? await metrics(ss, 500) : { state: 'nosession' }; await ss?.detach().catch(() => {}); tg.push(`${x.url().slice(0, 45)}:${m.state}`); }
        row.targets = tg;
        row.anyBlocked = tg.some((x) => x.endsWith(':blocked'));
        const wf = await readWarden(cd);
        try { const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(8000) }); row.warden = (await r.json()).dialogs.map((d) => `${d.type}:${d.url.slice(0, 40)}`); } catch (e) { row.warden = 'ERR ' + e.message; }
        const snap = await cli(['snap'], cd, { capMs: CAP });
        row.snap = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, first: snap.stdout.trim().split('\n').slice(0, 2).join(' | ').slice(0, 200), err: snap.stderr.trim().slice(0, 200) };
        row.verdict = !row.anyBlocked ? 'NOT-BLOCKED(no test)' : snap.killedAtCap ? 'MISS-HANG' : snap.code === 3 ? 'CAUGHT' : /about:blank/.test(snap.stdout) ? 'MISS-EXIT0-ABOUTBLANK' : `MISS-exit${snap.code}`;
        console.log(JSON.stringify({ t, v: vname, targets: tg, warden: row.warden, snap: `${snap.code}${snap.killedAtCap ? '(CAP)' : ''}/${snap.ms}`, first: row.snap.first.slice(0, 100), verdict: row.verdict }));
      } catch (e) { row.error = String(e?.stack || e).slice(0, 400); console.log('ERR', vname, row.error); }
      rows.push(row);
      await b?.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close(); server6.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  const sum = {};
  for (const r of rows) { (sum[r.variant] ??= {})[r.verdict ?? 'ERR'] = (sum[r.variant][r.verdict ?? 'ERR'] ?? 0) + 1; }
  await fs.writeFile(path.join(here, `blank-escape-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, summary: sum, leftovers }, null, 2));
  console.log(JSON.stringify(sum)); console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
