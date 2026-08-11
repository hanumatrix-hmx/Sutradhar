// Headless smoke test for @sutradhar/capability-runtime — line-buffered + watchdog.
// Run directly (no pipe): node packages/capability-runtime/scripts/smoke-headless.mjs
import { SutradharRuntime } from '../dist/index.js';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: exceeded 60s — hanging. Forcing exit.');
  process.exit(2);
}, 60000);

const runtime = new SutradharRuntime();
let sessionId;

try {
  log('[1] launch({ headless: true }) ...');
  const launched = await runtime.launch({ headless: true });
  sessionId = launched.sessionId;
  log('    sessionId=' + launched.sessionId + ' hasRealBrowser=' + launched.hasRealBrowser);
  if (!launched.hasRealBrowser) throw new Error('No real browser page after launch.');

  log('[2] navigate(https://example.com) ...');
  const nav = await runtime.navigate(sessionId, 'https://example.com');
  log('    url=' + nav.url + ' title=' + JSON.stringify(nav.title));

  log('[3] snapshot() ...');
  const snap = await runtime.snapshot(sessionId);
  log('    elementCount=' + snap.elementCount);
  log('    interactiveElements (first 300): ' + snap.interactiveElements.slice(0, 300));
  if (snap.elementCount === 0) throw new Error('Snapshot returned 0 elements.');

  log('[4] screenshot() ...');
  const shot = await runtime.screenshot(sessionId);
  log('    base64 length=' + shot.base64.length + ' (~' + Math.round((shot.base64.length * 0.75) / 1024) + ' KB)');

  log('[5] eval(document.title + h1) ...');
  const evalResult = await runtime.eval(sessionId, 'document.title + " | h1=" + (document.querySelector("h1")?.textContent ?? "none")');
  log('    result=' + JSON.stringify(evalResult));

  log('[6] tabs ...');
  const before = runtime.listTabs(sessionId);
  log('    tabs before=' + before.length + ' ' + JSON.stringify(before.map((t) => t.url)));
  const nt = await runtime.createTab(sessionId, 'https://example.org');
  const after = runtime.listTabs(sessionId);
  log('    newTab=' + nt.id + ' url=' + nt.url + ' | tabs after=' + after.length);

  log('✅ ALL CHECKS PASSED — substrate drives a real browser end-to-end.');
} catch (e) {
  console.error('\n❌ SMOKE TEST FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (sessionId) {
    try { await runtime.shutdown(sessionId); log('[cleanup] session shut down.'); } catch {}
  }
}
