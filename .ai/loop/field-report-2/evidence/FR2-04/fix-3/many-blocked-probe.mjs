// FR2-04 audit-3, point 2 (probe budget / parallelism): the warden probes untracked targets
// SEQUENTIALLY at 400 ms each, and the CLI's WardenBroker aborts /v1/dialogs after 5000 ms, which
// the gate maps to status 'unknown' => 'clear' => attach(). If K same-renderer tabs are collaterally
// blocked by one dialog, K*400 ms > 5000 ms (K >= 13) should turn a caught dialog into an attach hang.
// Usage: node many-blocked-probe.mjs <K list comma> <trials> <capMs> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets } from './lib.mjs';

const KS = (process.argv[2] ?? '4,14').split(',').map(Number);
const TRIALS = Number(process.argv[3] ?? 2);
const CAP = Number(process.argv[4] ?? 200000);
const TAG = process.argv[5] ?? 'run';
const root = await makeRoot('many');
const cli = makeCli(root);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/kid') return s.end(`<!doctype html><title>kid ${u.searchParams.get('i')}</title><body>kid</body>`);
  s.end(`<!doctype html><title>opener ${u.searchParams.get('n')}</title><body>opener</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const K of KS) {
      const cd = path.join(root.R, `k-${t}-${K}`); dirs.push(cd);
      const n = `mb${t}x${K}x${Date.now() % 100000}`;
      const row = { t, K, n };
      let b;
      try {
        await cli(['nav', `${BASE}/?n=${n}`], cd);
        const st = await readState(cd);
        b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
        const opener = pageTargets(b).find((x) => x.url().includes(n));
        const s = await opener.createCDPSession();
        for (let i = 0; i < K; i++) await s.send('Runtime.evaluate', { expression: `window.__k${i}=window.open('${BASE}/kid?i=${i}')`, userGesture: true });
        await delay(1500);
        row.pages = pageTargets(b).length;
        // one TRACKED dialog (typed) in the opener's renderer, raised by the opener's timer
        await s.send('Runtime.evaluate', { expression: `setTimeout(()=>alert('MB-${n}'),100)` });
        await s.detach().catch(() => {});
        await delay(1200);
        const wf = await readWarden(cd);
        const t0 = Date.now();
        try { const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(20000) }); const j = await r.json(); row.warden = { ms: Date.now() - t0, n: j.dialogs.length, types: [...new Set(j.dialogs.map((d) => d.type))] }; } catch (e) { row.warden = 'ERR ' + e.message; }
        const snap = await cli(['snap'], cd, { capMs: CAP });
        row.snap = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, first: snap.stdout.trim().split('\n')[0]?.slice(0, 160), err: snap.stderr.trim().slice(0, 200) };
        row.verdict = snap.killedAtCap ? 'HANG' : snap.code === 3 ? 'EXIT3' : /about:blank/.test(snap.stdout) ? 'EXIT0-ABOUTBLANK(WRONG)' : `exit${snap.code}`;
        console.log(JSON.stringify({ t, K, pages: row.pages, warden: row.warden, snap: `${snap.code}${snap.killedAtCap ? '(CAP)' : ''}/${snap.ms}`, first: row.snap.first, verdict: row.verdict }));
      } catch (e) { row.error = String(e?.stack || e).slice(0, 400); console.log('ERR', row.error); }
      rows.push(row);
      await b?.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, `many-blocked-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
