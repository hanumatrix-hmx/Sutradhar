// Live smoke test for Wave 12: keyboard modifiers, multi-select, viewport resize, clipboard,
// timezone/locale/color-scheme emulation, file-chooser upload trigger, and shadow-DOM text
// verification — all against real Chrome.
import { SutradharRuntime } from '../dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => { console.error('WATCHDOG'); process.exit(2); }, 60000);

const scratchDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.wave12-scratch');
fs.mkdirSync(scratchDir, { recursive: true });
const uploadFilePath = path.join(scratchDir, 'upload-me.txt');
fs.writeFileSync(uploadFilePath, 'wave 12 upload test');

const runtime = new SutradharRuntime({ allowedDownloadRoots: [scratchDir] });
let sessionId;

try {
  const launched = await runtime.launch({ headless: true });
  sessionId = launched.sessionId;
  await runtime.navigate(sessionId, 'https://example.com');

  // ── 1. Keyboard modifiers: Ctrl+A selects all text in a field, confirmed via document.execCommand ──
  log('[1] keyboard modifiers (Ctrl+A select-all)...');
  await runtime.eval(sessionId, `(() => {
    const input = document.createElement('input');
    input.id = 'kbtest';
    input.value = 'hello world';
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 0); // start with nothing selected
  })()`);
  await runtime.click(sessionId, '#kbtest');
  await runtime.pressKey(sessionId, 'a', undefined, ['Control']);
  const selection = await runtime.eval(sessionId, `document.getElementById('kbtest').selectionStart + '-' + document.getElementById('kbtest').selectionEnd`);
  log('    selection=' + selection);
  if (selection !== '0-11') throw new Error('expected Ctrl+A to select the full 11-char value, got ' + selection);

  // ── 2. Multi-select ──────────────────────────────────────────────────────
  log('[2] multi-select...');
  await runtime.eval(sessionId, `(() => {
    const sel = document.createElement('select');
    sel.id = 'multisel';
    sel.multiple = true;
    ['a','b','c'].forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
    document.body.appendChild(sel);
  })()`);
  await runtime.selectOptions(sessionId, '#multisel', ['a', 'c']);
  const selected = await runtime.eval(sessionId, `Array.from(document.getElementById('multisel').selectedOptions).map(o => o.value)`);
  log('    selected=' + JSON.stringify(selected));
  if (JSON.stringify(selected) !== JSON.stringify(['a', 'c'])) throw new Error('expected a and c selected, got ' + JSON.stringify(selected));

  // ── 3. Viewport resize ──────────────────────────────────────────────────
  log('[3] viewport resize...');
  await runtime.setViewport(sessionId, { width: 500, height: 400 });
  const dims = await runtime.eval(sessionId, `window.innerWidth + 'x' + window.innerHeight`);
  log('    dims=' + dims);
  if (dims !== '500x400') throw new Error('expected viewport 500x400, got ' + dims);

  // ── 4. Clipboard ─────────────────────────────────────────────────────────
  log('[4] clipboard...');
  await runtime.grantPermissions(sessionId, 'https://example.com', ['clipboard-read', 'clipboard-write']);
  await runtime.setClipboard(sessionId, 'sutradhar wave 12');
  const clip = await runtime.getClipboard(sessionId);
  log('    clip=' + clip);
  if (clip !== 'sutradhar wave 12') throw new Error('expected clipboard round-trip to match, got ' + clip);

  // ── 5. Timezone/locale/color-scheme emulation ───────────────────────────
  log('[5] emulation (timezone/locale/color-scheme)...');
  await runtime.emulateSettings(sessionId, { timezone: 'America/New_York', locale: 'fr-FR', colorScheme: 'dark' });
  const tz = await runtime.eval(sessionId, `Intl.DateTimeFormat().resolvedOptions().timeZone`);
  const locale = await runtime.eval(sessionId, `navigator.language`);
  const prefersDark = await runtime.eval(sessionId, `window.matchMedia('(prefers-color-scheme: dark)').matches`);
  log('    tz=' + tz + ' locale=' + locale + ' prefersDark=' + prefersDark);
  if (tz !== 'America/New_York') throw new Error('expected timezone override, got ' + tz);
  if (locale !== 'fr-FR') throw new Error('expected locale override, got ' + locale);
  if (!prefersDark) throw new Error('expected prefers-color-scheme: dark to be emulated');

  // ── 6. File-chooser upload trigger (JS-triggered picker, not a plain <input>) ──
  log('[6] upload_file_via_trigger...');
  await runtime.eval(sessionId, `(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.id = 'hidden-file-input';
    input.style.display = 'none';
    document.body.appendChild(input);
    const btn = document.createElement('button');
    btn.id = 'browse-btn';
    btn.textContent = 'Browse...';
    btn.addEventListener('click', () => input.click());
    document.body.appendChild(btn);
    window.__uploadedName = null;
    input.addEventListener('change', () => { window.__uploadedName = input.files[0]?.name ?? null; });
  })()`);
  await runtime.uploadFileViaTrigger(sessionId, '#browse-btn', uploadFilePath);
  const uploadedName = await runtime.eval(sessionId, `window.__uploadedName`);
  log('    uploadedName=' + uploadedName);
  if (uploadedName !== 'upload-me.txt') throw new Error('expected the triggered file input to receive the uploaded file, got ' + uploadedName);

  // ── 7. Shadow-DOM text verification (ExecutionVerifier.pageContainsText) ───
  log('[7] shadow-DOM text verification...');
  await runtime.eval(sessionId, `(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>secret-shadow-text-12345</p>';
  })()`);
  // Trigger a scroll action with a verificationSpec expecting shadow-only text.
  const sessMgr = runtime.getSessionManager();
  const session = sessMgr.getSession(sessionId);
  const tab = session.getTabs()[0];
  const { BrowserActionEngine } = await import('../../browser/dist/index.js');
  const engine = new BrowserActionEngine();
  const result = await engine.executeAction(tab, {
    actionType: 'scroll',
    maxRetries: 0,
    verificationSpec: { expectedElementText: 'secret-shadow-text-12345' },
  });
  log('    verified=' + result.verification?.verified + ' reason=' + result.verification?.reason);
  if (!result.verification?.verified) throw new Error('expected shadow-DOM text to be found by pageContainsText');

  log('✅ WAVE 12 LIVE CHECKS PASSED');
} catch (e) {
  console.error('❌ FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (sessionId) await runtime.shutdown(sessionId).catch(() => {});
  fs.rmSync(scratchDir, { recursive: true, force: true });
}
