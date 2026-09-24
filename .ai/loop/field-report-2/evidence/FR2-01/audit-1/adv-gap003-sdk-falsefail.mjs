// GAP-003 end-to-end via the real public SDK (headless launch, default retries): two tabs, wait on
// the non-foreground one. The page itself reveals #toast at T+revealAtMs (page timer, no CDP poke).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages/sutradhar/dist/index.js')));
const FIX = pathToFileURL(path.join(here, 'adv-singleframe.html')).href;
const browser = await sdk.launch({ headless: true });
const out = [];
try {
  const [pageA] = await browser.pages();
  await pageA.goto(FIX + '?a=1');
  const pageB = await browser.newPage('data:text/html,<h1>B</h1>');
  for (const [label, timeout, revealAt] of [['reveal-during-attempt-1', 3000, 1000], ['reveal-during-attempt-3', 2000, 6000]]) {
    await pageA.goto(FIX + '?n=' + Date.now());
    await pageB.evaluate('1'); // keep B as the most recently used
    const vis = await pageA.evaluate('document.visibilityState');
    await pageA.evaluate(`setTimeout(() => window.__fx.reveal('toast'), ${revealAt})`);
    const t0 = Date.now();
    let err;
    try { await pageA.waitForSelector('#toast', { timeout }); } catch (e) { err = e.message; }
    const t1 = Date.now();
    const truth = await pageA.evaluate(`(() => { const el = document.querySelector('#toast'); const r = el.getBoundingClientRect(); return { display: getComputedStyle(el).display, w: r.width, h: r.height, revealedAt: (window.__fx.events[0]||{}).at }; })()`);
    const rec = { label, timeout, revealAtMs: revealAt, visibilityStateA: vis, threw: !!err, error: err, elapsedMs: t1 - t0, revealedMsAfterCall: truth.revealedAt ? truth.revealedAt - t0 : null, truthAtEnd: truth };
    console.log(JSON.stringify(rec)); out.push(rec);
  }
} finally { await browser.close(); }
(await import('node:fs')).writeFileSync(path.join(here, 'adv-gap003-sdk-falsefail-results.json'), JSON.stringify(out, null, 2));
