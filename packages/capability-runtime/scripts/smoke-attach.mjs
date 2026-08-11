// Engine attach-mode smoke test: launch a REAL Chrome with --remote-debugging-port, then
// use PinchTabRuntime.attach() to drive it via CDP. Proves the extension-path architecture
// works before any MV3/UI work. Run directly (no pipe).
//
//   node packages/capability-runtime/scripts/smoke-attach.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PinchTabRuntime } from '../dist/index.js';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: exceeded 60s — hanging. Forcing exit.');
  process.exit(2);
}, 60000);

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333; // avoid 9222 in case something else is on it
const endpoint = `http://127.0.0.1:${PORT}`;

// Use a throwaway user-data-dir so we don't touch the user's real profile during the test.
const profileDir = mkdtempSync(join(tmpdir(), 'pinchtab-attach-test-'));
log(`spawning Chrome (headless, --remote-debugging-port=${PORT}, profile=${profileDir}) ...`);
const chrome = spawn(CHROME, [
  `--headless=new`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  `--no-first-run`,
  `--no-default-browser-check`,
  'about:blank',
]);
chrome.stderr.on('data', () => {}); // swallow Chrome's noisy stderr

// Wait for the CDP discovery endpoint to come up.
log('waiting for CDP endpoint ...');
let up = false;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${endpoint}/json/version`);
    if (r.ok) { up = true; break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!up) { console.error('❌ Chrome CDP endpoint never came up'); process.exit(1); }
log('CDP endpoint is up.');

const runtime = new PinchTabRuntime();
let sessionId;
try {
  log('[1] attach() to external Chrome ...');
  sessionId = (await runtime.attach({ endpoint })).sessionId;
  log(`    attached. sessionId=${sessionId}`);

  log('[2] listTabs() of the external browser ...');
  const tabs = runtime.listTabs(sessionId);
  log(`    external browser has ${tabs.length} tab(s): ${JSON.stringify(tabs.map((t) => t.url))}`);

  log('[3] navigate() the external browser ...');
  const nav = await runtime.navigate(sessionId, 'https://example.com');
  log(`    navigated → ${nav.url} (${JSON.stringify(nav.title)})`);

  log('[4] snapshot() the external page ...');
  const snap = await runtime.snapshot(sessionId);
  log(`    elementCount=${snap.elementCount} → ${snap.interactiveElements.split('\n').slice(0, 3).join(' | ')}`);

  log('[5] screenshot() the external page ...');
  const png = (await runtime.screenshot(sessionId)).base64;
  log(`    base64 length=${png.length} (~${Math.round((png.length * 0.75) / 1024)} KB)`);

  log('✅ ENGINE ATTACH MODE WORKS — PinchTab drove an external Chrome over CDP.');
} catch (e) {
  console.error('\n❌ ATTACH TEST FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (sessionId) { try { await runtime.shutdown(sessionId); } catch {} }
  log('[cleanup] killing spawned Chrome.');
  chrome.kill();
}
