// FR2-04 audit-3, point 4: several tabs open and several unknown dialogs. Tabs:
//   A  = an unrelated, idle user tab (CLI newtab, its own renderer)
//   B1 = opener #1 whose url-popup P1 alerts inline (unknown)
//   B2 = opener #2 whose url-popup P2 alerts inline (unknown)
// Then `dialog accept` is repeated (max 6) and after each we record which target was closed and
// which targets are still blocked. Any close of A, B1 or B2 is a wrong-tab close.
// Usage: node multi-unknown-probe.mjs <trials> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, metrics } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const TAG = process.argv[3] ?? 'run';
const root = await makeRoot('multi');
const cli = makeCli(root);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/pop') return s.end(`<!doctype html><title>pop</title><script>alert('MU-${u.searchParams.get('n')}')</script>pop`);
  s.end(`<!doctype html><title>page ${u.searchParams.get('n')}</title><body>${u.searchParams.get('n')}</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
// second opener on a different SITE (localhost vs 127.0.0.1) so it lands in a different renderer
const BASE2 = `http://localhost:${server.address().port}`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    const cd = path.join(root.R, `m-${t}`); dirs.push(cd);
    const n = `mu${t}x${Date.now() % 100000}`;
    const row = { t, n, steps: [] };
    let b;
    try {
      await cli(['nav', `${BASE}/?n=${n}-A`], cd);
      await cli(['newtab', `${BASE}/?n=${n}-B1`], cd);
      await cli(['newtab', `${BASE2}/?n=${n}-B2`], cd);
      const st = await readState(cd);
      b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
      const byN = (suffix) => pageTargets(b).find((x) => x.url().includes(`n=${n}-${suffix}`));
      const names = new Map();
      for (const k of ['A', 'B1', 'B2']) names.set(idOf(byN(k)), k);
      for (const [k, base] of [['B1', BASE], ['B2', BASE2]]) {
        const before = new Set(pageTargets(b).map(idOf));
        const s = await byN(k).createCDPSession();
        await s.send('Runtime.evaluate', { expression: `void window.open('${base}/pop?n=${n}-${k}')`, userGesture: true }, { timeout: 3000 }).catch(() => {});
        await s.detach().catch(() => {});
        let pop; for (let i = 0; i < 60 && !pop; i++) { pop = pageTargets(b).find((x) => !before.has(idOf(x))); if (!pop) await delay(100); }
        if (pop) names.set(idOf(pop), `P${k.slice(1)}`);
      }
      await delay(800);
      const snapT = async (label) => {
        const o = {};
        for (const x of pageTargets(b)) { const s = await x.createCDPSession().catch(() => undefined); const m = s ? await metrics(s, 500) : { state: 'nosession' }; await s?.detach().catch(() => {}); o[names.get(idOf(x)) ?? `?${x.url().slice(0, 30)}`] = m.state; }
        row.steps.push({ step: label, targets: o });
        return o;
      };
      await snapT('initial');
      const d0 = await cli(['dialog'], cd, { capMs: 30000 });
      row.steps.push({ step: 'dialog', out: d0.stdout.trim().split('\n').map((l) => l.slice(0, 140)) });
      row.closed = [];
      for (let i = 0; i < 6; i++) {
        const acc = await cli(['dialog', 'accept'], cd, { capMs: 30000 });
        const id = /Tab (\w+) was closed/.exec(acc.stdout)?.[1];
        const who = id ? (names.get(id) ?? '?') : (acc.code === 0 ? 'handled:' + acc.stdout.trim().slice(0, 60) : `exit${acc.code}:` + acc.stderr.trim().slice(0, 80));
        row.closed.push(who);
        const tg = await snapT(`after-accept-${i}`);
        if (acc.code !== 0) break;
        if (!Object.values(tg).includes('blocked')) break;
      }
      row.wrongCloses = row.closed.filter((c) => ['A', 'B1', 'B2'].includes(c));
      const fin = await cli(['snap'], cd, { capMs: 30000 });
      row.finalSnap = { code: fin.code, ms: fin.ms, killedAtCap: fin.killedAtCap, first: fin.stdout.trim().split('\n')[0]?.slice(0, 120) };
      row.aliveAtEnd = pageTargets(b).map((x) => names.get(idOf(x)) ?? x.url().slice(0, 30));
      console.log(JSON.stringify({ t, closed: row.closed, wrong: row.wrongCloses, alive: row.aliveAtEnd, final: `${fin.code}${fin.killedAtCap ? '(CAP)' : ''}/${fin.ms}` }));
    } catch (e) { row.error = String(e?.stack || e).slice(0, 400); console.log('ERR', row.error); }
    rows.push(row);
    await b?.disconnect().catch(() => {});
    await cli(['close'], cd, { capMs: 30000 });
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, `multi-unknown-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
