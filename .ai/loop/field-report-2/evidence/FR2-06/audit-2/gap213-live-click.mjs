// FR2-06 audit-2: GAP-206 re-verification with the AUDITOR'S OWN frame-hop scenarios (not fix-1's
// repro). A real 3-level nested iframe fixture (a2-top -> #l1 -> #l2 -> #l3). Every CDP message
// the Sutradhar runtime sends is counted at the WebSocket layer (same tap technique as audit-1),
// separated from the observer browser's own sockets.
// Run from repo root: node .ai/loop/field-report-2/evidence/FR2-06/audit-2/gap206-frame-hops.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const FIXTURE_URL = pathToFileURL(path.join(here, 'a2-top.html')).href;
const req = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const pptrPath = req.resolve('puppeteer-core');
const puppeteer = req('puppeteer-core');
const WS = createRequire(pptrPath)('ws');

const cdpLog = [];
const observerSockets = new Set();
let identifying = false;
const origSend = WS.prototype.send;
WS.prototype.send = function (data, ...rest) {
  if (identifying) observerSockets.add(this);
  let method = '<unparsed>';
  try { method = JSON.parse(String(data)).method; } catch {}
  cdpLog.push({ who: observerSockets.has(this) ? 'observer' : 'runtime', method });
  return origSend.call(this, data, ...rest);
};
const mark = () => cdpLog.length;
const runtimeSendsSince = (m) => cdpLog.slice(m).filter((e) => e.who === 'runtime');

const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const browserMod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));

const cases = [];
let ok = true;
function rec(c) {
  cases.push(c);
  if (!c.pass) ok = false;
  console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.case} sends=${c.sends} :: ${String(c.result ?? c.error ?? '').slice(0, 260)}`);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePath = process.env.CHROME_PATH ?? new browserMod.BrowserLauncher().findExecutablePath();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-06-audit2-'));
const observer = await puppeteer.launch({
  executablePath: chromePath, headless: true, userDataDir: profile,
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
identifying = true;
await observer.version();
identifying = false;

const runtime = new SutradharRuntime();
let sessionId;
async function attempt(fn) {
  const m = mark();
  let result, error;
  try { result = await fn(); } catch (e) { error = e?.message ?? String(e); }
  return { result, error, sends: runtimeSendsSince(m).length, methods: [...new Set(runtimeSendsSince(m).map((x) => x.method))] };
}
try {
  ({ sessionId } = await runtime.attach({ endpoint: observer.wsEndpoint() }));
  await runtime.navigate(sessionId, FIXTURE_URL);
  // wait until the deepest frame has loaded
  const pages = await observer.pages();
  const page = pages.find((p) => p.url().startsWith(FIXTURE_URL));
  for (let i = 0; i < 50 && page.frames().length < 4; i++) await delay(100);
  await delay(300);
  console.log('frames loaded:', page.frames().length);

  await page.evaluate(() => { window.__clicks = []; document.getElementById('notaframe').addEventListener('click', () => window.__clicks.push('notaframe')); });
  const clicks = () => page.evaluate(() => window.__clicks.length);
  {
    const r = await attempt(() => runtime.click(sessionId, 'pierce/ #notaframe'));
    const n = await clicks();
    rec({ case: 'K1 engine click with "pierce/ #notaframe" (space after prefix, valid CSS) still clicks', ...r, result: JSON.stringify(r.result).slice(0,160), pass: !r.error && r.result?.success === true && n === 1 });
  }
  {
    const r = await attempt(() => runtime.click(sessionId, 'pierce/ text=plain div'));
    rec({ case: 'K2 engine click "pierce/ text=plain div" rejected with zero CDP (GAP-213)', ...r, pass: r.sends === 0 && /"text=" is Playwright selector-engine syntax/.test(r.error ?? '') });
  }
  {
    const r = await attempt(() => runtime.click(sessionId, 'data-test-id=go'));
    rec({ case: 'K3 engine click data-test-id=go -> exact GAP-205 text, zero CDP', ...r, pass: r.sends === 0 && (r.error ?? '').includes('"data-test-id=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [data-test-id="…"].') });
  }
} catch (e) {
  console.error('HARNESS ERROR', e);
  ok = false;
  cases.push({ case: 'harness-error', error: String(e?.stack ?? e), pass: false });
} finally {
  if (sessionId) await runtime.shutdown(sessionId).catch(() => {});
  await observer.close().catch(() => {});
  for (let i = 0; i < 5; i++) {
    try { await fs.rm(profile, { recursive: true, force: true }); break; } catch { await delay(400); }
  }
}
await fs.writeFile(path.join(here, 'gap213-live-click-cases.json'), JSON.stringify({ ok, cases }, null, 2));
console.log('overall', ok);
process.exit(0);
