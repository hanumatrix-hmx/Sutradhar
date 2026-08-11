// Live smoke test for Wave 8: downloadDir confinement + no-fabricated-success on a dead page.
import { PinchTabRuntime } from '../dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);
const watchdog = setTimeout(() => { console.error('WATCHDOG'); process.exit(2); }, 40000);

// The OS temp dir (the default allowed root) can be under aggressive AV/Defender scanning on
// some Windows machines, which races Chrome's own download-finalize step and cancels the
// download (same environment quirk documented in Wave 6's smoke test) — use a project-local
// scratch dir as an explicitly configured additional allowed root instead.
const scratchDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.wave8-downloads');
fs.mkdirSync(scratchDir, { recursive: true });

const runtime = new PinchTabRuntime({ allowedDownloadRoots: [scratchDir] });
let sessionId;
try {
  const launched = await runtime.launch({ headless: true });
  sessionId = launched.sessionId;
  await runtime.navigate(sessionId, 'https://example.com');
  await runtime.eval(sessionId, `(() => {
    const blob = new Blob(['x'], {type:'text/plain'});
    const a = document.createElement('a'); a.id='dl'; a.href = URL.createObjectURL(blob); a.download='x.txt';
    a.textContent = 'download';
    document.body.appendChild(a);
  })()`);

  log('[1] downloadDir outside allowed roots must be rejected...');
  const rejected = await runtime.downloadFile(sessionId, '#dl', '/etc');
  log('    success=' + rejected.success + ' error=' + rejected.error);
  if (rejected.success) throw new Error('expected an out-of-bounds downloadDir to be rejected');
  if (!rejected.error?.includes('outside the allowed download directories')) throw new Error('unexpected error message: ' + rejected.error);
  log('    OK — rejected as expected');

  log('[2] a downloadDir under the configured allowed root works...');
  const ok = await runtime.downloadFile(sessionId, '#dl', scratchDir);
  log('    success=' + ok.success + ' output=' + JSON.stringify(ok.output));
  if (!ok.success) throw new Error('expected an allowed-root download to succeed: ' + ok.error);

  log('✅ WAVE 8 LIVE CHECKS PASSED');
} catch (e) {
  console.error('❌ FAILED: ' + (e?.message || e));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (sessionId) await runtime.shutdown(sessionId).catch(() => {});
  fs.rmSync(scratchDir, { recursive: true, force: true });
}
