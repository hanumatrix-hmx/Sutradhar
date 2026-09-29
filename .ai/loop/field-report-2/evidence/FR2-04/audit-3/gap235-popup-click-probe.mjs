// FR2-04 audit-3, point 6: GAP-235 ("Requesting main frame too early!" in adoptPopupPage) on a
// real CLI `click` of a button that opens an immediately-alerting popup. How often, and is the
// outcome a wrong result (exit 0 claiming success / wrong tab) or a clear error? Then: what do the
// next commands (`dialog`, `snap`, `tabs`) do?
// Usage: node gap235-popup-click-probe.mjs <trials> <capMs> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, metrics } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 10);
const CAP = Number(process.argv[3] ?? 40000);
const TAG = process.argv[4] ?? 'run';
const root = await makeRoot('g235');
const cli = makeCli(root);
const FX = await fs.readFile(path.join(here, '..', '..', '..', '..', '..', '..', 'tools/scenario-suite/fixtures/fr2-04-dialogs.html'), 'utf-8');
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/pop') return s.end(`<!doctype html><title>pop</title><script>alert('P235-${u.searchParams.get('n')}')</script>pop`);
  if (u.pathname === '/opener') return s.end(`<!doctype html><title>op</title><button id="b" onclick="window.open('/pop?n=${u.searchParams.get('n')}')">b</button><button id="bb" onclick="var w=window.open('');w.alert('BB-${u.searchParams.get('n')}')">bb</button>`);
  s.end(FX);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const VARIANTS = [
  { name: 'fixture#popup(onloadAlert head)', url: (n) => `${BASE}/fx.html?n=${n}`, sel: '#popup' },
  { name: 'opener#b(body inline alert)', url: (n) => `${BASE}/opener?n=${n}`, sel: '#b' },
  { name: 'opener#bb(blank popup sync alert)', url: (n) => `${BASE}/opener?n=${n}`, sel: '#bb' },
];
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const v of VARIANTS) {
      const cd = path.join(root.R, `p-${t}-${v.name.replace(/\W/g, '_')}`); dirs.push(cd);
      const n = `p${t}x${Date.now() % 100000}`;
      const row = { t, variant: v.name, n };
      let b;
      try {
        await cli(['nav', v.url(n)], cd);
        const click = await cli(['click', v.sel], cd, { capMs: CAP });
        row.click = { code: click.code, ms: click.ms, killedAtCap: click.killedAtCap, out: click.stdout.trim().slice(0, 400), err: click.stderr.trim().slice(0, 400) };
        row.mainFrameTooEarly = /main frame too early/i.test(click.stdout + click.stderr);
        const st = await readState(cd);
        b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
        const tg = [];
        for (const x of pageTargets(b)) { const s = await x.createCDPSession().catch(() => undefined); const m = s ? await metrics(s, 500) : { state: 'nosession' }; await s?.detach().catch(() => {}); tg.push(`${x.url().slice(0, 50)}:${m.state}`); }
        row.targets = tg;
        const dlg = await cli(['dialog'], cd, { capMs: 20000 });
        row.dialog = { code: dlg.code, out: dlg.stdout.trim().slice(0, 300) };
        const snap = await cli(['snap'], cd, { capMs: CAP });
        row.snap = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, first: snap.stdout.trim().split('\n')[0]?.slice(0, 160), err: snap.stderr.trim().slice(0, 200) };
        const clickClaimsSuccess = click.code === 0 && /Clicked|Click dispatched/.test(click.stdout);
        const clickReportsDialog = /dialogPending/.test(click.stdout);
        row.clickVerdict = click.killedAtCap ? 'CLICK-HANG' : row.mainFrameTooEarly ? (click.code === 0 ? 'CRASH-BUT-EXIT0' : `CRASH-exit${click.code}`) : clickClaimsSuccess ? (clickReportsDialog ? 'OK-with-dialogPending' : 'OK-no-dialog-report') : `other-exit${click.code}`;
        row.snapVerdict = snap.killedAtCap ? 'SNAP-HANG' : snap.code === 3 ? 'SNAP-EXIT3' : snap.code === 0 ? (/about:blank/.test(snap.stdout) ? 'SNAP-EXIT0-ABOUTBLANK(WRONG)' : 'SNAP-EXIT0') : `SNAP-exit${snap.code}`;
        console.log(JSON.stringify({ t, v: v.name, click: `${click.code}${click.killedAtCap ? '(CAP)' : ''}/${click.ms}ms`, early: row.mainFrameTooEarly, cv: row.clickVerdict, clickOut: click.stdout.trim().split('\n')[0]?.slice(0, 90), clickErr: click.stderr.trim().split('\n')[0]?.slice(0, 120), snap: row.snapVerdict, targets: tg }));
      } catch (e) { row.error = String(e?.stack || e).slice(0, 400); console.log('ERR', v.name, row.error); }
      rows.push(row);
      await b?.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  const sum = {};
  for (const r of rows) { const k = r.variant; (sum[k] ??= {}); const kk = `${r.clickVerdict ?? 'ERR'} | ${r.snapVerdict ?? 'ERR'}`; sum[k][kk] = (sum[k][kk] ?? 0) + 1; }
  await fs.writeFile(path.join(here, `gap235-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, summary: sum, leftovers }, null, 2));
  console.log(JSON.stringify(sum, null, 1)); console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
