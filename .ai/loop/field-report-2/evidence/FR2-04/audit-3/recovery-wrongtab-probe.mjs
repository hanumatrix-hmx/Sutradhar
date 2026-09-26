// FR2-04 audit-3, point 4: GAP-230 recovery (Target.closeTarget of an `unknown` target).
// Q1: does recovery close the tab that is ACTUALLY blocked, or a same-renderer sibling (opener)?
// Q2: GAP-234 — what does the NEXT command (tabs / snap / eval / nav) do right after recovery?
// Q3: `tabs` is now gate-exempt but still calls runtime.attach(); what does it do with a plain,
//     tracked orphan alert open (no recovery at all)?
// Usage: node recovery-wrongtab-probe.mjs <trials> <caseRegex> <capMs> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, waitBlocked, live, metrics, updateFindings } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 1);
const FILTER = new RegExp(process.argv[3] ?? '.');
const CAP = Number(process.argv[4] ?? 200000);
const TAG = process.argv[5] ?? 'run';
const root = await makeRoot('rec');
const cli = makeCli(root);
const FX = await fs.readFile(path.join(here, '..', '..', '..', '..', '..', '..', 'tools/scenario-suite/fixtures/fr2-04-dialogs.html'), 'utf-8');
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/pop') return s.end(`<!doctype html><title>pop</title><script>alert('P-${u.searchParams.get('n')}')</script>pop`);
  if (u.pathname === '/fx.html') return s.end(FX);
  s.end(`<!doctype html><title>opener ${u.searchParams.get('n')}</title><body>opener<input id="keep" value="user-work"></body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// shape: how the blocked target is produced
const SHAPES = {
  'urlpopup': (n) => `void window.open('${BASE}/pop?n=${n}')`,
  'blankpopup': (n) => `(function(){var w=window.open('');w.alert('B-${n}');})()`,
};
const CASES = [];
for (const shape of Object.keys(SHAPES)) for (const next of ['tabs', 'snap', 'eval', 'nav']) CASES.push({ name: `${shape}/accept-then-${next}`, shape, next });
CASES.push({ name: 'plain-orphan-alert/tabs', shape: 'plain', next: 'tabs' });
CASES.push({ name: 'plain-orphan-alert/dialog-accept-then-tabs', shape: 'plain', next: 'tabs', recover: true });

const rows = []; const dirs = [];
const nextArgs = (next, n) => next === 'tabs' ? ['tabs'] : next === 'snap' ? ['snap'] : next === 'eval' ? ['eval', 'document.title'] : ['nav', `${BASE}/?n=${n}-after`];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const c of CASES) {
      if (!FILTER.test(c.name)) continue;
      const cd = path.join(root.R, `s-${t}-${c.name.replace(/\W/g, '_')}`); dirs.push(cd);
      const n = `r${t}x${Date.now() % 100000}`;
      const row = { t, case: c.name, n, steps: [] };
      let b;
      try {
        if (c.shape === 'plain') {
          await cli(['nav', `${BASE}/fx.html?n=${n}`], cd);
        } else {
          await cli(['nav', `${BASE}/?n=${n}`], cd);
        }
        const st = await readState(cd);
        b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
        const opener = pageTargets(b).find((x) => x.url().includes(n));
        const openerId = idOf(opener);
        const before = new Set(pageTargets(b).map(idOf));
        let popId;
        if (c.shape === 'plain') {
          const r = await cli(['click', '#alert'], cd);
          row.steps.push({ step: 'click #alert', code: r.code, ms: r.ms, out: r.stdout.trim().slice(0, 200) });
        } else {
          const os_ = await opener.createCDPSession();
          await os_.send('Runtime.evaluate', { expression: SHAPES[c.shape](n), userGesture: true }, { timeout: 3000 }).catch(() => {});
          await os_.detach().catch(() => {});
          let pop; for (let i = 0; i < 60 && !pop; i++) { pop = pageTargets(b).find((x) => !before.has(idOf(x))); if (!pop) await delay(100); }
          popId = pop && idOf(pop);
          row.popUrl = pop?.url();
        }
        await delay(600);
        // independent read: which targets are blocked (getMetrics is the product's own signal; Runtime.evaluate the audit-2 one)
        const snapTargets = async (label) => {
          const out = [];
          for (const x of pageTargets(b)) {
            const s = await x.createCDPSession().catch(() => undefined);
            const m = s ? await metrics(s, 500) : { state: 'nosession' };
            await s?.detach().catch(() => {});
            out.push(`${idOf(x) === openerId ? 'OPENER' : idOf(x) === popId ? 'POPUP' : 'other'}:${x.url().slice(0, 40)}:${m.state}`);
          }
          row.steps.push({ step: `targets@${label}`, targets: out });
          return out;
        };
        await snapTargets('after-trigger');
        const d0 = await cli(['dialog'], cd, { capMs: 30000 });
        row.steps.push({ step: 'dialog', code: d0.code, ms: d0.ms, out: d0.stdout.trim().slice(0, 400) });
        if (c.shape !== 'plain' || c.recover) {
          const acc = await cli(['dialog', 'accept'], cd, { capMs: 30000 });
          row.steps.push({ step: 'dialog accept', code: acc.code, ms: acc.ms, out: acc.stdout.trim().slice(0, 300), err: acc.stderr.trim().slice(0, 300) });
          const closedId = /Tab (\w+) was closed/.exec(acc.stdout)?.[1];
          row.closedWhich = closedId ? (closedId === openerId ? 'OPENER' : closedId === popId ? 'POPUP' : 'OTHER:' + closedId) : 'none';
          await snapTargets('after-accept');
        }
        const nx = await cli(nextArgs(c.next, n), cd, { capMs: CAP });
        row.steps.push({ step: `next:${c.next}`, code: nx.code, ms: nx.ms, killedAtCap: nx.killedAtCap, out: nx.stdout.trim().slice(0, 400), err: nx.stderr.trim().slice(0, 400) });
        await snapTargets('after-next');
        row.urlsAfter = pageTargets(b).map((x) => x.url());
        console.log(JSON.stringify({ t, c: c.name, closed: row.closedWhich, next: `${nx.code}${nx.killedAtCap ? '(CAP)' : ''}/${nx.ms}ms`, out: nx.stdout.trim().split('\n').slice(0, 2).join(' | ').slice(0, 160), err: nx.stderr.trim().slice(0, 120), urls: row.urlsAfter.map((u) => u.slice(0, 45)) }));
      } catch (e) { row.error = String(e?.stack || e).slice(0, 500); console.log('ERR', c.name, row.error); }
      rows.push(row);
      await b?.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, `recovery-wrongtab-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
