// Live smoke test for Wave 10's widened detectBlock markers — these run inside page.evaluate
// so the existing mocked unit tests never actually exercise the real closure logic; this
// verifies the new CAPTCHA-provider markers and the OAuth-only auth-wall heuristic against a
// real Chrome page.
import { BrowserSessionManager, BrowserLauncher } from '../../browser/dist/index.js';
import { StructuredLogger } from '../../observability/dist/index.js';
import { detectBlock } from '../dist/core/block-detector.js';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => { console.error('WATCHDOG'); process.exit(2); }, 40000);

const logger = new StructuredLogger({ minLevel: 'warn' });
const launcher = new BrowserLauncher(logger);
const sessionManager = new BrowserSessionManager(launcher, undefined, logger);

try {
  const session = await sessionManager.createSession({ initialUrl: 'https://example.com' });
  const tab = session.getTabs()[0];

  log('[1] new CAPTCHA provider marker (GeeTest)...');
  await tab.page.evaluate(() => {
    document.body.innerHTML += '<div class="geetest_holder">verify</div>';
  });
  const geetest = await detectBlock(tab);
  log('    result=' + geetest);
  if (geetest !== 'captcha') throw new Error('expected GeeTest marker to be detected as captcha');

  log('[2] OAuth-only auth wall (no password field, sparse page, "Continue with Google")...');
  await tab.page.evaluate(() => {
    document.body.innerHTML = '<div><h1>Sign in</h1><button>Continue with Google</button></div>';
  });
  const oauth = await detectBlock(tab);
  log('    result=' + oauth);
  if (oauth !== 'auth_wall') throw new Error('expected OAuth-only login wall to be detected as auth_wall');

  log('[3] a normal, unrelated page must not be flagged...');
  await tab.page.evaluate(() => {
    const longParagraph = 'This is a perfectly ordinary article about gardening. '.repeat(20); // well over 500 chars
    document.body.innerHTML = `<div><h1>Welcome</h1><p>${longParagraph}</p><button>Continue with Google</button></div>`;
  });
  const normal = await detectBlock(tab);
  log('    result=' + normal);
  if (normal !== undefined) throw new Error('expected a long, mostly-unrelated page with an incidental OAuth button not to be flagged');

  log('✅ WAVE 10 detectBlock LIVE CHECKS PASSED');
} catch (e) {
  console.error('❌ FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await sessionManager.closeAllSessions().catch(() => {});
}
