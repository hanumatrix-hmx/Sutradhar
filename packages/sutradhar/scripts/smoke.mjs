// Puppeteer-style API smoke test for the `sutradhar` package.
// Exercises the USER-FACING API (launch/Browser/Page), not internals.
// Run directly (no pipe): node packages/sutradhar/scripts/smoke.mjs

import { launch } from '../dist/index.js';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: exceeded 60s — hanging. Forcing exit.');
  process.exit(2);
}, 60000);

let browser;
try {
  log('[1] launch() ...');
  browser = await launch();
  log('    sessionId=' + browser.sessionId);

  log('[2] newPage() ...');
  const page = await browser.newPage();
  log('    tabId=' + page.tabId);

  log('[3] page.goto(example.com) ...');
  await page.goto('https://example.com');

  log('[4] page.snapshot() ...');
  const snap = await page.snapshot();
  log('    elementCount=' + snap.elementCount + ' interactiveElements=' + JSON.stringify(snap.interactiveElements.slice(0, 120)));

  log('[5] page.click("4")  // [#4] from snapshot ("Learn more" — a real link that navigates) ...');
  await page.click('4');
  log('    clicked OK');

  // The click above triggers a REAL navigation (example.com's "Learn more" link goes to
  // iana.org) — click() itself doesn't wait for it to finish (same as Puppeteer's own
  // ElementHandle.click()), so calling evaluate() immediately after races the navigation and
  // can throw "Execution context was destroyed" if it fires mid-evaluate. Go back to a known,
  // stable page first — the same real requirement page.screenshot() below also has.
  log('[6] page.goto(example.com) again — settle after the navigating click before evaluating ...');
  await page.goto('https://example.com');

  log('[7] page.evaluate(document.title) ...');
  const title = await page.evaluate('document.title');
  log('    title=' + JSON.stringify(title));

  log('[8] page.screenshot() ...');
  const png = await page.screenshot();
  log('    base64 length=' + png.length + ' (~' + Math.round((png.length * 0.75) / 1024) + ' KB)');

  log('[9] browser.pages() ...');
  const pages = await browser.pages();
  log('    page count=' + pages.length);

  log('✅ sutradhar Puppeteer-style API works end-to-end.');
} catch (e) {
  console.error('\n❌ SMOKE TEST FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (browser) {
    try { await browser.close(); log('[cleanup] browser closed.'); } catch {}
  }
}
