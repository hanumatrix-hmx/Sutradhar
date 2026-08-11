// Puppeteer-style API smoke test for the `pinchtab` package.
// Exercises the USER-FACING API (launch/Browser/Page), not internals.
// Run directly (no pipe): node packages/pinchtab/scripts/smoke.mjs

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

  log('[5] page.click("4")  // [#4] from snapshot ...');
  await page.click('4');
  log('    clicked OK');

  log('[6] page.evaluate(document.title) ...');
  const title = await page.evaluate('document.title');
  log('    title=' + JSON.stringify(title));

  log('[7] page.screenshot() ...');
  // The click above navigated to a new page; go back to a stable rendered page before screenshotting.
  await page.goto('https://example.com');
  const png = await page.screenshot();
  log('    base64 length=' + png.length + ' (~' + Math.round((png.length * 0.75) / 1024) + ' KB)');

  log('[8] browser.pages() ...');
  const pages = browser.pages();
  log('    page count=' + pages.length);

  log('✅ pinchtab Puppeteer-style API works end-to-end.');
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
