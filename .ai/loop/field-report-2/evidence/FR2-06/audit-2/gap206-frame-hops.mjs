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

  const EVAL = (fs_) => attempt(() => runtime.eval(sessionId, 'window.__marker', undefined, fs_));

  // ---- MUST-REJECT-WITH-ZERO-CDP (any hop has foreign-dialect syntax) ----
  const bad = [
    ['R1 3-hop, bad LAST hop (text=)', 'iframe#l1::iframe#l2::text=Deep', 'text=Deep', 'text='],
    ['R2 3-hop, bad MIDDLE hop (xpath=)', 'iframe#l1::xpath=//iframe::iframe#l3', 'xpath=//iframe', 'xpath='],
    ['R3 first hop valid CSS but NOT an iframe (semantically wrong), bad 2nd hop', 'div#notaframe::role=frame', 'role=frame', 'role='],
    ['R4 first hop valid CSS matching NOTHING, bad 3rd hop', 'iframe#nope::iframe#l2::>>iframe', null, '>>'],
    ['R5 4-hop, bad hop 4 with :has-text()', 'iframe#l1::iframe#l2::iframe#l3::button:has-text("Deep")', 'button:has-text("Deep")', ':has-text('],
    ['R6 whitespace-padded bad hop', 'iframe#l1 ::   id=l2  ', 'id=l2', 'id='],
    ['R7 numeric-node-id hop then bad hop', '5::internal:role=frame', null, 'internal:role='],
    ['R8 pierce/-prefixed valid first hop then pierce/ text= (GAP-213 shape) last hop', 'pierce/iframe#l1::pierce/ text=x', 'pierce/ text=x', 'text='],
    ['R9 bad hop is getByRole()', 'iframe#l1::getByRole("frame")', null, 'getByRole('],
    ['R10 bare-xpath hop', 'iframe#l1:://iframe', '//iframe', 'XPath'],
    ['R11 [#12] node-id-syntax hop', 'iframe#l1::[#12]', '[#12]', 'snapshot node id'],
    ['R12 aria= hop (GAP-205 text inside frame wrapper)', 'iframe#l1::aria=frame', 'aria=frame', '"aria=" is not supported; use the slash form "aria/".'],
  ];
  for (const [name, chain, hopExpect, reasonFrag] of bad) {
    const r = await EVAL(chain);
    const hopOk = hopExpect ? r.error?.includes(`Invalid frameSelector "${hopExpect}" (from the full chain "${chain}")`) : /Invalid frameSelector "/.test(r.error ?? '');
    const pass = r.sends === 0 && !!r.error && hopOk && r.error.includes(reasonFrag) && r.error.includes('Playwright-style selectors');
    rec({ case: name, chain, ...r, pass });
  }

  // extractData with a bad LAST hop too (the other resolveFrame caller)
  {
    const chain = 'iframe#l1::iframe#l2::role=frame';
    const r = await attempt(() => runtime.extractData(sessionId, { v: { selector: '.v' } }, undefined, chain));
    rec({ case: 'R13 extractData 3-hop bad LAST hop', chain, ...r, pass: r.sends === 0 && /Invalid frameSelector "role=frame"/.test(r.error ?? '') });
  }

  // ---- MUST-STILL-RESOLVE (no over-rejection) ----
  const good = [
    ['G1 all-valid 3-hop CSS chain', 'iframe#l1::iframe#l2::iframe#l3', 'l3'],
    ['G2 all-valid 2-hop', 'iframe#l1::iframe#l2', 'l2'],
    ['G3 single hop', 'iframe#l1', 'l1'],
    ['G4 whitespace + empty segments', '  iframe#l1 :: :: iframe#l2 ::  ', 'l2'],
    ['G5 pierce/ slash-prefixed hops', 'pierce/iframe#l1::pierce/iframe#l2::pierce/iframe#l3', 'l3'],
    ['G6 xpath/ slash-prefixed hop', 'xpath///iframe[@id="l1"]::iframe#l2', 'l2'],
    ['G7 CSS attribute that LOOKS Playwright-ish but is valid CSS', 'iframe[src="a2-l1.html"]::iframe[id="l2"]', 'l2'],
  ];
  for (const [name, chain, expect] of good) {
    const r = await EVAL(chain);
    rec({ case: name, chain, ...r, pass: r.result === expect && !r.error });
  }
  {
    const r = await attempt(() => runtime.extractData(sessionId, { v: { selector: '.v' } }, undefined, 'iframe#l1::iframe#l2::iframe#l3'));
    rec({ case: 'G8 extractData all-valid 3-hop', ...r, result: JSON.stringify(r.result), pass: JSON.stringify(r.result?.v) === '["deep-1","deep-2"]' });
  }

  // ---- semantically-wrong-but-syntactically-valid chains: must still hit the browser and give the
  // right (non-dialect) error -- pre-validation must not change these ----
  {
    const r = await EVAL('div#notaframe::iframe#l2');
    rec({ case: 'S1 valid syntax, first hop not an iframe -> "is not an <iframe>"', ...r, pass: r.sends > 0 && /Element matching "div#notaframe" is not an <iframe>/.test(r.error ?? '') });
  }
  {
    const r = await EVAL('iframe#l1::iframe#nope::iframe#l3');
    rec({ case: 'S2 valid syntax, 2nd hop matches nothing -> "No element matched" naming hop 2', ...r, pass: r.sends > 0 && /No element matched frameSelector "iframe#nope".*previous frame/.test(r.error ?? '') });
  }
  {
    // Invalid CSS (not a foreign dialect) on the LAST hop: spec §2.4 only pre-validates dialect;
    // the parser error is wrapped when reached. Informational: record send count.
    const r = await EVAL('iframe#l1::iframe#l2::div[');
    rec({ case: 'I1 (informational) invalid-CSS last hop -> wrapped parser error when reached', ...r, pass: /Invalid frameSelector "div\[" .*not a valid selector/.test(r.error ?? '') });
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
await fs.writeFile(path.join(here, 'gap206-frame-hops-cases.json'), JSON.stringify({ ok, cases }, null, 2));
console.log('overall', ok);
process.exit(0);
