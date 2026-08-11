// Live smoke test for Wave 6: right-click, drag-and-drop, touch tap, real file download,
// PDF export, structured extraction, screenshot-on-failure, and action-history.
// Run directly (no pipe): node packages/capability-runtime/scripts/smoke-wave6.mjs
import { SutradharRuntime } from '../dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Note: the OS temp dir (os.tmpdir()) can be under aggressive AV/Defender scanning on some
// Windows machines, which races Chrome's own download-finalize step and cancels the download.
// A project-local scratch dir avoids that; downloadDir is caller-configurable precisely for
// environments like this.
const downloadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.wave6-downloads');
fs.mkdirSync(downloadDir, { recursive: true });

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => {
  console.error('WATCHDOG: exceeded 90s — hanging. Forcing exit.');
  process.exit(2);
}, 90000);

const runtime = new SutradharRuntime();
let sessionId;

try {
  log('[launch] headless: true ...');
  const launched = await runtime.launch({ headless: true });
  sessionId = launched.sessionId;
  if (!launched.hasRealBrowser) throw new Error('No real browser page after launch.');
  log('    sessionId=' + sessionId);

  // ── 1. Right-click ──────────────────────────────────────────────────────
  log('[1] right_click ...');
  await runtime.navigate(sessionId, 'https://example.com');
  await runtime.eval(
    sessionId,
    `(() => {
      const div = document.createElement('div');
      div.id = 'ctx-target';
      div.textContent = 'right-click me';
      div.style.cssText = 'position:fixed;top:10px;left:10px;width:150px;height:40px;background:#eee;z-index:9999';
      window.__ctxCount = 0;
      div.addEventListener('contextmenu', (e) => { e.preventDefault(); window.__ctxCount++; });
      document.body.appendChild(div);
    })()`,
  );
  const rc = await runtime.clickWithButton(sessionId, '#ctx-target', 'right');
  const ctxCount = await runtime.eval(sessionId, 'window.__ctxCount');
  log('    right_click success=' + rc.success + ' contextmenuFired=' + ctxCount);
  if (!rc.success || ctxCount !== 1) throw new Error('right_click did not deliver a single contextmenu event');

  // ── 2. Drag and drop ─────────────────────────────────────────────────────
  log('[2] drag_and_drop ...');
  await runtime.eval(
    sessionId,
    `(() => {
      const src = document.createElement('div');
      src.id = 'drag-source';
      src.draggable = true;
      src.textContent = 'drag me';
      src.style.cssText = 'position:fixed;top:60px;left:10px;width:100px;height:40px;background:#cde';
      const dst = document.createElement('div');
      dst.id = 'drop-target';
      dst.textContent = 'drop here';
      dst.style.cssText = 'position:fixed;top:60px;left:200px;width:100px;height:40px;background:#edc';
      window.__dropped = false;
      dst.addEventListener('dragover', (e) => e.preventDefault());
      dst.addEventListener('drop', (e) => { e.preventDefault(); window.__dropped = true; });
      src.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'x'));
      document.body.appendChild(src);
      document.body.appendChild(dst);
    })()`,
  );
  const dd = await runtime.dragAndDrop(sessionId, '#drag-source', '#drop-target');
  const dropped = await runtime.eval(sessionId, 'window.__dropped');
  log('    drag_and_drop success=' + dd.success + ' dropped=' + dropped);
  if (!dd.success) throw new Error('drag_and_drop action reported failure: ' + dd.error);

  // ── 3. Touch tap ─────────────────────────────────────────────────────────
  log('[3] touch_tap ...');
  await runtime.eval(
    sessionId,
    `(() => {
      const btn = document.createElement('button');
      btn.id = 'tap-target';
      btn.textContent = 'tap me';
      window.__tapCount = 0;
      btn.addEventListener('click', () => { window.__tapCount++; });
      document.body.appendChild(btn);
    })()`,
  );
  const tap = await runtime.touchTap(sessionId, '#tap-target');
  const tapCount = await runtime.eval(sessionId, 'window.__tapCount');
  log('    touch_tap success=' + tap.success + ' tapCount=' + tapCount);
  if (!tap.success || tapCount !== 1) throw new Error('touch_tap did not deliver a click event');

  // ── 4. Real file download via CDP ───────────────────────────────────────
  // A same-page blob download (via the `download` attribute) is deterministic and avoids
  // depending on an external test site's server-side download semantics.
  log('[4] download_file ...');
  await runtime.navigate(sessionId, 'https://example.com');
  await runtime.eval(
    sessionId,
    `(() => {
      const blob = new Blob(['Hello Wave 6!'], { type: 'text/plain' });
      const a = document.createElement('a');
      a.id = 'dl-link';
      a.href = URL.createObjectURL(blob);
      a.download = 'wave6-test.txt';
      a.textContent = 'download';
      document.body.appendChild(a);
    })()`,
  );
  const dl = await runtime.downloadFile(sessionId, '#dl-link', downloadDir);
  log('    download_file success=' + dl.success + ' output=' + JSON.stringify(dl.output));
  if (!dl.success || !dl.output?.downloadedPath) throw new Error('download_file did not report a downloaded path: ' + dl.error);

  // ── 5. PDF export ────────────────────────────────────────────────────────
  log('[5] export_pdf ...');
  await runtime.navigate(sessionId, 'https://example.com');
  const pdf = await runtime.exportPdf(sessionId);
  const pdfMagic = Buffer.from(pdf.base64.slice(0, 8), 'base64').toString('latin1');
  log('    pdf base64 length=' + pdf.base64.length + ' magic=' + JSON.stringify(pdfMagic));
  if (!pdfMagic.startsWith('%PDF')) throw new Error('export_pdf did not produce a valid PDF (bad magic bytes)');

  // ── 6. Structured extraction ────────────────────────────────────────────
  log('[6] extract_data ...');
  await runtime.navigate(sessionId, 'https://the-internet.herokuapp.com/tables');
  const rows = await runtime.extractData(sessionId, {
    lastNames: { selector: '#table1 tbody tr td:nth-child(2)' },
  });
  log('    extracted lastNames=' + JSON.stringify(rows.lastNames));
  if (!rows.lastNames || rows.lastNames.length === 0) throw new Error('extract_data returned no rows');

  // ── 7. Screenshot-on-failure ────────────────────────────────────────────
  log('[7] screenshot-on-failure ...');
  const fail = await runtime.click(sessionId, '#this-selector-does-not-exist-anywhere');
  log('    failed click success=' + fail.success + ' failureScreenshotLen=' + (fail.failureScreenshot?.length ?? 0));
  if (fail.success) throw new Error('expected click on nonexistent selector to fail');
  if (!fail.failureScreenshot) throw new Error('expected a failureScreenshot on the failed click result');

  // ── 8. Action history ────────────────────────────────────────────────────
  log('[8] get_action_history ...');
  const history = runtime.getActionHistory(sessionId);
  log('    history length=' + history.length + ' last=' + JSON.stringify(history[history.length - 1]));
  if (history.length === 0) throw new Error('action history is empty after several actions');

  log('✅ ALL WAVE 6 CHECKS PASSED');
} catch (e) {
  console.error('\n❌ WAVE 6 SMOKE TEST FAILED: ' + (e?.message || e));
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (sessionId) {
    try { await runtime.shutdown(sessionId); log('[cleanup] session shut down.'); } catch {}
  }
}
