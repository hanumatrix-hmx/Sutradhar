// SDK: Page.waitFor + settle on goto/press/scroll, with an independent observer connection.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WT, startServer, puppeteer, rec, results, PIDS, pageFor, delay } from './lib.mjs';
const sdk = await import(pathToFileURL(path.join(WT, 'packages', 'sutradhar', 'dist', 'index.js')).href);
const srv = await startServer();
const browser = await sdk.launch({ headless: true });
const obs = await puppeteer.connect({ browserWSEndpoint: browser.getWsEndpoint(), defaultViewport: null });
const page = (await browser.pages())[0];
const T = async (f) => { const t0 = performance.now(); try { const v = await f(); return { ok: true, v, ms: Math.round(performance.now() - t0) }; } catch (e) { return { ok: false, e, ms: Math.round(performance.now() - t0) }; } };
try {
  await page.goto(srv.origin + '/toast?d=2000');
  const p1 = await pageFor(obs, srv.origin + '/toast');
  const a = await T(() => page.waitFor({ text: 'Probe toast shown', timeout: 8000 }));
  const e1 = (await p1.evaluate(() => window.__ev)).find((x) => x.w === 'shown');
  rec('sdk:waitFor-text', a.ok && a.v.success === true && !!e1, { ms: a.ms });
  const b = await T(() => page.waitFor({ text: 'Never appears', timeout: 1500 }));
  rec('sdk:waitFor-timeout-rejects', !b.ok && b.e.name === 'ActionFailedError' && /wait_for timed out after 1500ms/.test(b.e.message) && b.ms < 1500 + 1500 + 1000, { name: b.e?.name, ms: b.ms, msg: b.e?.message?.slice(0, 120) });
  const c = await T(() => page.waitFor({}));
  const d = await T(() => page.waitFor({ timeoutMs: 5, text: 'x' }));
  const e = await T(() => page.waitFor({ selector: '#x' }));
  rec('sdk:waitFor-validation', !c.ok && c.e instanceof TypeError && !d.ok && d.e instanceof TypeError && !e.ok && /wait_for_selector/.test(e.e.message), { c: c.e?.message, d: d.e?.message, e: e.e?.message });
  const j = await T(() => page.waitFor({ js: 'window.__nope.ready' }));
  rec('sdk:waitFor-js-throw', !j.ok && /js condition threw/.test(j.e.message) && j.ms < 1500, { ms: j.ms });
  // background
  await page.goto(srv.origin + '/toast?d=3000&bg=1');
  const pb = await pageFor(obs, srv.origin + '/toast?d=3000&bg=1');
  const other = await browser.newPage(); await other.bringToFront();
  const vis = await pb.evaluate(() => document.visibilityState);
  const bg = await T(() => page.waitFor({ text: 'Probe toast shown', timeout: 12000 }));
  const bt = await T(() => page.waitFor({ text: 'Nope', timeout: 2000 }));
  rec('sdk:background', vis === 'hidden' && bg.ok && !bt.ok && bt.ms >= 2000 && bt.ms < 2000 + 1500 + 1500, { vis, ms: bg.ms, timeoutElapsed: bt.ms });
  await other.close();
  // dialog mid-wait
  await page.goto(srv.origin + '/alert-now?d=800');
  const dg = await T(() => page.waitFor({ text: 'Never', timeout: 15000 }));
  rec('sdk:dialog', !dg.ok && /blocked by an open alert/.test(dg.e.message) && dg.ms < 5000, { ms: dg.ms });
  await browser.handleDialog?.('accept').catch?.(() => {});
} finally {
  await obs.disconnect().catch(() => {}); await browser.close().catch(() => {}); srv.close();
}
console.log(`SUMMARY sdk: ${results.filter((r) => r.pass).length}/${results.length}`);
fs.writeFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'sdk-probe.json'), JSON.stringify({ results, pids: PIDS }, null, 2));
