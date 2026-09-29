// FR2-06 audit-1 (independent auditor harness) — runtime surface, in-process, with EVERY CDP
// message the Sutradhar runtime sends counted at the WebSocket layer (not inferred from timing).
// Run: node .ai/loop/field-report-2/evidence/FR2-06/audit-1/audit-runtime.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const OUT = here;
const FIXTURE_URL = pathToFileURL(path.join(here, 'fixture-audit.html')).href;
const req = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const pptrPath = req.resolve('puppeteer-core');
const puppeteer = req('puppeteer-core');
const WS = createRequire(pptrPath)('ws');

// ── CDP send tap ───────────────────────────────────────────────────────────────────────────
const cdpLog = [];
const observerSockets = new Set();
let identifying = false;
const origSend = WS.prototype.send;
WS.prototype.send = function (data, ...rest) {
  if (identifying) observerSockets.add(this);
  let method = '<unparsed>';
  let fn;
  try {
    const m = JSON.parse(String(data));
    method = m.method;
    fn = m.params?.functionDeclaration?.slice(0, 90);
  } catch {}
  cdpLog.push({ t: Date.now(), who: observerSockets.has(this) ? 'observer' : 'runtime', method, fn });
  return origSend.call(this, data, ...rest);
};
function mark() {
  return cdpLog.length;
}
function runtimeSendsSince(m) {
  return cdpLog.slice(m).filter((e) => e.who === 'runtime');
}

const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const browserMod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));

const cases = [];
let ok = true;
function rec(c) {
  cases.push(c);
  if (!c.pass) ok = false;
  console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.case}${c.pass ? '' : ' :: ' + JSON.stringify(c).slice(0, 600)}`);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePath = process.env.CHROME_PATH ?? new browserMod.BrowserLauncher().findExecutablePath();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-06-audit1-rt-'));
const observer = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox'] });
identifying = true;
await observer.version();
identifying = false;
console.log('observer sockets identified:', observerSockets.size);

const runtime = new SutradharRuntime();
let sessionId;
try {
  ({ sessionId } = await runtime.attach({ endpoint: observer.wsEndpoint() }));
  await runtime.navigate(sessionId, `${FIXTURE_URL}?t=${Date.now()}`);
  const pages = await observer.pages();
  const page = pages.find((p) => p.url().startsWith(FIXTURE_URL));
  await page.waitForFunction(() => window.__a && window.__a.ready, { timeout: 5000 });
  const lastClick = () => page.evaluate(() => window.__a.clicks[window.__a.clicks.length - 1] ?? null);

  // Idle baseline: does the runtime send anything on its own when nothing is called?
  {
    const m = mark();
    await delay(500);
    const s = runtimeSendsSince(m);
    rec({ case: 'idle-baseline-500ms-no-runtime-cdp', sends: s.length, pass: s.length === 0 });
  }

  // ── Q1: Playwright syntax → ZERO CDP messages, across every engine-routed method ──────────
  const pw = [
    'text=Submit', 'TEXT=Submit', '  text=Submit  ', 'text="Submit"i', 'role=button[name="Submit"]', 'Role = button',
    'button >> text=OK', 'div>>span', 'div:has-text("x")', ':text("x")', 'button:text-is("OK")', 'a:text-matches("x")',
    ':nth-match(li, 2)', 'button:visible', "getByRole('button')", 'page.getByLabel("Email")', 'internal:role=button',
    'internal:has-text="x"', 'css=button', 'xpath=//button', 'aria=Submit', 'pierce=#x', 'id=main', 'data-testid=go',
    'pierce/text=Submit', 'pierce/div >> span', '//button[@id="x"]', '(//a)[1]', './/span', '../div', '#12', '[#12]',
    '"Submit"', "'Submit'",
  ];
  const methods = {
    click: (s) => runtime.click(sessionId, s),
    rightClick: (s) => runtime.clickWithButton(sessionId, s, 'right'),
    type: (s) => runtime.type(sessionId, s, 'v'),
    hover: (s) => runtime.hover(sessionId, s),
    focus: (s) => runtime.focus(sessionId, s),
    waitForSelector: (s) => runtime.waitForSelector(sessionId, s, 5000),
    selectOption: (s) => runtime.selectOption(sessionId, s, 'v'),
    selectOptions: (s) => runtime.selectOptions(sessionId, s, ['v']),
    touchTap: (s) => runtime.touchTap(sessionId, s),
    scrollTarget: (s) => runtime.scroll(sessionId, 'down', 100, undefined, s),
    uploadFile: (s) => runtime.uploadFile(sessionId, s, path.join(here, 'fixture-audit.html')),
    downloadFile: (s) => runtime.downloadFile(sessionId, s),
    dragSrc: (s) => runtime.dragAndDrop(sessionId, s, '#plain-btn'),
    dragDest: (s) => runtime.dragAndDrop(sessionId, '#plain-btn', s),
    uploadViaTrigger: (s) => runtime.uploadFileViaTrigger(sessionId, s, '/definitely/not/here.txt'),
    evalFrameSingleHop: (s) => runtime.eval(sessionId, '1', undefined, s),
    extractField: (s) => runtime.extractData(sessionId, { f: { selector: s } }),
  };
  const q1Fails = [];
  let q1Total = 0;
  let q1MaxMs = 0;
  for (const [mname, fn] of Object.entries(methods)) {
    for (const s of pw) {
      q1Total++;
      const m = mark();
      const t0 = performance.now();
      let err;
      try {
        await fn(s);
      } catch (e) {
        err = e;
      }
      const ms = performance.now() - t0;
      q1MaxMs = Math.max(q1MaxMs, ms);
      const sends = runtimeSendsSince(m);
      const msg = err?.message ?? '';
      const good = !!err && sends.length === 0 && /Playwright-style/.test(msg) && /click_by_text/.test(msg);
      if (!good) q1Fails.push({ method: mname, selector: s, sends: sends.map((x) => x.method), errName: err?.name, msg: msg.slice(0, 160) });
    }
  }
  rec({ case: 'Q1-playwright-zero-cdp-all-methods', total: q1Total, maxMs: Math.round(q1MaxMs * 100) / 100, fails: q1Fails, pass: q1Fails.length === 0 });

  // Q1b: name/kind of the throw on an engine-routed method (D7: InvalidSelectorError, rejects not resolves)
  {
    const e = await runtime.click(sessionId, 'text=Submit').then(() => null, (x) => x);
    rec({ case: 'Q1b-runtime-click-rejects-InvalidSelectorError', name: e?.name, kind: e?.kind, pass: e?.name === 'InvalidSelectorError' && e?.kind === 'foreign-dialect' });
  }

  // Q1c: TWO-hop frame chain with a Playwright SECOND hop (spec §2.4: "hops are normalized up front,
  // so a bad second hop costs no first-hop round trip"; spec R7: page $ never called, not even first hop)
  {
    const m = mark();
    const e = await runtime.eval(sessionId, '1', undefined, 'iframe#f::role=frame').then(() => null, (x) => x);
    const sends = runtimeSendsSince(m);
    rec({
      case: 'Q1c-two-hop-frame-chain-bad-second-hop-zero-cdp (spec §2.4/R7)',
      sends: sends.map((x) => x.method),
      msg: e?.message?.slice(0, 140),
      pass: !!e && sends.length === 0,
    });
  }
  // Q1d: same, but the (valid) FIRST hop matches nothing: which error does the caller get?
  {
    const m = mark();
    const e = await runtime.eval(sessionId, '1', undefined, 'iframe#missing::role=frame').then(() => null, (x) => x);
    const sends = runtimeSendsSince(m);
    rec({
      case: 'Q1d-two-hop-missing-first-hop-then-playwright-hop: caller should be coached about role=',
      sends: sends.length,
      msg: e?.message?.slice(0, 160),
      pass: !!e && /Invalid frameSelector "role=frame"/.test(e.message),
    });
  }

  // ── Q2: busy main thread proof (independent of CDP counting) ─────────────────────────────
  {
    await page.evaluate(() => {
      setTimeout(() => {
        const t = Date.now();
        while (Date.now() - t < 3000) {}
      }, 0);
    });
    await delay(150);
    const busyStart = Date.now();
    const timings = {};
    for (const [label, fn] of [
      ['click', () => runtime.click(sessionId, 'text=Submit')],
      ['extract', () => runtime.extractData(sessionId, { a: { selector: 'text=Buy' } })],
      ['evalFrame', () => runtime.eval(sessionId, '1', undefined, 'role=frame')],
      ['uploadViaTrigger', () => runtime.uploadFileViaTrigger(sessionId, 'text=Browse', '/x.txt')],
      ['waitForSelector', () => runtime.waitForSelector(sessionId, 'div:has-text("x")')],
    ]) {
      const t0 = Date.now();
      const e = await fn().then(() => null, (x) => x);
      timings[label] = { ms: Date.now() - t0, rejected: !!e };
    }
    const ctl0 = Date.now();
    const ctl = await runtime.waitForSelector(sessionId, '#plain-btn', 8000, undefined, 'attached');
    const ctlMs = Date.now() - ctl0;
    const fastAll = Object.values(timings).every((x) => x.rejected && x.ms < 100);
    rec({
      case: 'Q2-busy-page-playwright-returns-fast + control-blocks',
      timings,
      control: { ms: ctlMs, success: ctl.success, sinceBusyStart: Date.now() - busyStart },
      pass: fastAll && ctlMs >= 2000 && ctl.success === true,
    });
    await delay(300);
  }

  // ── Q3: invalid CSS/XPath → exactly ONE probe round trip, no DOM query, no retry ─────────
  for (const [label, fn, expectSel] of [
    ['click div[', () => runtime.click(sessionId, 'div['), 'div['],
    ['click xpath///[', () => runtime.click(sessionId, 'xpath///['), 'xpath///['],
    ['waitForSelector div[ attached', () => runtime.waitForSelector(sessionId, 'div[', 5000, undefined, 'attached'), 'div['],
    ['drag #plain-btn -> div[', () => runtime.dragAndDrop(sessionId, '#plain-btn', 'div['), 'div['],
    ['click "   "', () => runtime.click(sessionId, '   '), '   '],
    ['click #host >>> #x', () => runtime.click(sessionId, '#host >>> #x'), '#host >>> #x'],
  ]) {
    const m = mark();
    const t0 = Date.now();
    const r = await fn().then((x) => x, (e) => ({ thrown: e.message }));
    const ms = Date.now() - t0;
    const sends = runtimeSendsSince(m);
    const nonProbe = sends.filter((x) => !(x.method === 'Runtime.callFunctionOn' && /selectorSyntaxProbeInPage|createDocumentFragment|createExpression/.test(x.fn ?? '')));
    const observerTruth = await page.evaluate((sel) => {
      const x = sel.startsWith('xpath/') ? sel.slice(6) : sel;
      try {
        sel.startsWith('xpath/') ? document.createExpression(x) : document.createDocumentFragment().querySelector(x);
        return null;
      } catch (e) {
        return e.message;
      }
    }, expectSel);
    rec({
      case: `Q3-invalid-syntax-one-probe: ${label}`,
      ms,
      retriesUsed: r.retriesUsed,
      success: r.success,
      failureScreenshot: !!r.failureScreenshot,
      error: (r.error ?? r.thrown ?? '').slice(0, 220),
      sends: sends.map((x) => x.method + (x.fn ? `(${x.fn.slice(0, 40)})` : '')),
      nonProbeSends: nonProbe.length,
      observerTruth,
      pass:
        r.success === false &&
        r.retriesUsed === 0 &&
        !r.failureScreenshot &&
        sends.length >= 1 &&
        nonProbe.length === 0 &&
        observerTruth !== null &&
        (r.error ?? '').includes(observerTruth) &&
        ms < 1000,
    });
  }

  // ── Q4: D8 no-retry when the probe is INCONCLUSIVE (main thread busy > 500 ms probe bound) ──
  for (const [label, fn] of [
    ['waitForSelector div[ visible', () => runtime.waitForSelector(sessionId, 'div[', 5000, undefined, 'visible')],
    ['waitForSelector div[ attached', () => runtime.waitForSelector(sessionId, 'div[', 5000, undefined, 'attached')],
    ['click div[', () => runtime.click(sessionId, 'div[')],
  ]) {
    await page.evaluate(() => {
      setTimeout(() => {
        const t = Date.now();
        while (Date.now() - t < 1500) {}
      }, 0);
    });
    await delay(100);
    const t0 = Date.now();
    const r = await fn().then((x) => x, (e) => ({ thrown: e.message }));
    const ms = Date.now() - t0;
    rec({
      case: `Q4-inconclusive-probe-then-parse-error: ${label}`,
      ms,
      retriesUsed: r.retriesUsed,
      error: (r.error ?? r.thrown ?? '').slice(0, 200),
      // Informational: spec D8 claims the no-retry regex covers the probe-inconclusive case.
      pass: r.success === false && r.retriesUsed === 0,
      informational: true,
    });
    await delay(1600);
  }

  // ── Q5: extractData collects ALL invalid fields ─────────────────────────────────────────
  {
    const m = mark();
    const e = await runtime
      .extractData(sessionId, {
        good: { selector: '.price' },
        bad1: { selector: 'text=Buy' },
        bad2: { selector: 'button >> span' },
        bad3: { selector: 'div:has-text("x")' },
        bad4: { selector: '#12' },
        bad5: { selector: "getByRole('x')" },
      })
      .then(() => null, (x) => x);
    const msg = e?.message ?? '';
    const named = ['bad1', 'bad2', 'bad3', 'bad4', 'bad5'].filter((n) => msg.includes(`field "${n}"`));
    const hintCount = msg.split('Playwright-style selectors').length - 1;
    rec({
      case: 'Q5a-extract-5-dialect-fields-all-named, hint once, zero CDP',
      named,
      hintCount,
      sends: runtimeSendsSince(m).length,
      mentionsGood: msg.includes('field "good"'),
      msg: msg.slice(0, 900),
      pass: named.length === 5 && hintCount === 1 && runtimeSendsSince(m).length === 0 && !msg.includes('field "good"'),
    });
  }
  {
    // Mixed kinds: a Playwright field AND a browser-parser-invalid CSS field in one request.
    const e = await runtime
      .extractData(sessionId, { good: { selector: '.price' }, pwBad: { selector: 'text=Buy' }, cssBad: { selector: 'div[' } })
      .then(() => null, (x) => x);
    const msg = e?.message ?? '';
    rec({
      case: 'Q5b-extract-mixed-kinds (Playwright + invalid CSS): are BOTH named in one error?',
      namesPw: msg.includes('field "pwBad"'),
      namesCss: msg.includes('field "cssBad"'),
      msg: msg.slice(0, 500),
      pass: msg.includes('field "pwBad"') && msg.includes('field "cssBad"'),
      informational: true,
    });
  }
  {
    const r = await runtime.extractData(sessionId, { p: { selector: '.price' } });
    rec({ case: 'Q5c-extract-valid-still-works', r, pass: JSON.stringify(r.p) === '["1","2"]' });
  }

  // ── Q6: near-miss CSS — detection vs the browser's own parser, then live clicks ──────────
  const nearMiss = [
    '/* note */ #cmt-btn', '/**/#cmt-btn', '#cmt-btn /* >> text=x */', '.text\\=Submit', 'button.text\\=Submit',
    '.has-text\\:x', '[data-visible]', '[data-u^="//"]', '[data-u="//cdn/x"]', 'button:not(:focus-visible)',
    'button:visited', 'svg text', 'text', '*|text', 'button:lang(text)', ':is(#plain-btn)', 'button:nth-child(2 of .x)',
    'input:placeholder-shown', '::-webkit-scrollbar', '#plain-btn:state(visible)', 'a[title="getByRole(x)"]',
    '.internal', 'div.internal:hover', 'button[class~="internal:x"]', '#a\\>\\>b', 'button >>> span', 'div >>>> span',
    '[data-x=\'a >> b\']', 'button:where(.x, .y)', 'textarea', 'role', 'css', 'aria', 'pierce', 'xpath', 'id', 'data-testid',
    '#pw-text-btn', 'html > body > button', 'button:has(+ button)', ':root button', '\\31 2', '#\\31 2',
  ];
  const detectRows = [];
  for (const s of nearMiss) {
    const det = browserMod.detectForeignSelectorDialect(s);
    const chromeValid = await page.evaluate((x) => {
      try {
        document.createDocumentFragment().querySelector(x);
        return true;
      } catch (e) {
        return e.name === 'SyntaxError' ? false : 'other';
      }
    }, s);
    detectRows.push({ s, detected: det ? det.rule : null, chromeValid, falsePositive: !!det && chromeValid === true });
  }
  const fps = detectRows.filter((r) => r.falsePositive);
  rec({ case: 'Q6a-near-miss-css-detection-vs-chrome-parser', total: detectRows.length, falsePositives: fps, rows: detectRows, pass: fps.length === 0 });

  for (const [s, id] of [
    ['/* note */ #cmt-btn', 'cmt-btn'],
    ['.text\\=Submit', 'esc-eq'],
    ['.has-text\\:x', 'colon-cls'],
    ['[data-visible]', 'vis-attr'],
    ['[data-u^="//"]', 'href-like'],
  ]) {
    const r = await runtime.click(sessionId, s).then((x) => x, (e) => ({ thrown: e.message }));
    const last = await lastClick();
    rec({ case: `Q6b-near-miss-live-click ${s}`, success: r.success, thrown: r.thrown?.slice(0, 160), last, pass: r.success === true && last === id });
  }

  // ── Q7: Sutradhar-prefix adversarial (supported prefix vs rejected Playwright shape) ─────
  for (const [s, expect] of [
    ['aria/text=Submit', 'aria-pw'],
    ['xpath///button[text()="text=Submit"]', 'pw-text-btn'],
    ['text/text=Submit', 'CLICK'],
    ['pierce/[data-u="//cdn/x"]', 'href-like'],
    ['pierce/#pw-text-btn', 'pw-text-btn'],
    ['pierce/text=Submit', 'REJECT'],
    ['pierce/ text=Submit', 'REJECT'],
    ['pierce/#12', 'REJECT'],
    ['pierce///button', 'REJECT'],
    ['xpath=//button', 'REJECT'],
    ['  aria/text=Submit', 'aria-pw'],
    ['#in-frame-btn', 'in-frame-btn'],
  ]) {
    await page.evaluate(() => (window.__a.clicks.length = 0));
    let fr;
    try {
      fr = await observer.pages().then((ps) => ps.find((p) => p.url().startsWith(FIXTURE_URL)).frames().find((f) => f !== page.mainFrame()));
      if (fr) await fr.evaluate(() => { window.__c = []; document.addEventListener('click', (e) => window.__c.push(e.target.id), { capture: true, once: false }); });
    } catch {}
    const m = mark();
    const t0 = Date.now();
    const r = await runtime.click(sessionId, s).then((x) => x, (e) => ({ thrown: e.message, name: e.name }));
    const ms = Date.now() - t0;
    const last = await lastClick();
    const frameLast = fr ? await fr.evaluate(() => window.__c[window.__c.length - 1] ?? null).catch(() => null) : null;
    const sends = runtimeSendsSince(m).length;
    let pass;
    if (expect === 'REJECT') pass = r.success !== true && (!!r.thrown || /Invalid selector/.test(r.error ?? ''));
    else if (expect === 'CLICK') pass = r.success === true;
    else if (expect === 'in-frame-btn') pass = r.success === true && frameLast === 'in-frame-btn';
    else pass = r.success === true && last === expect;
    rec({
      case: `Q7-prefix ${JSON.stringify(s)} expect ${expect}`,
      ms,
      success: r.success,
      thrownName: r.name,
      err: (r.thrown ?? r.error ?? '').slice(0, 200),
      coached: /Playwright-style|slash form|node id/.test(r.thrown ?? r.error ?? ''),
      viaDetection: !!r.thrown,
      cdpSends: sends,
      last,
      frameLast,
      pass,
    });
  }
} catch (e) {
  console.error('HARNESS ERROR', e);
  ok = false;
  cases.push({ case: 'harness-error', error: String(e?.stack ?? e), pass: false });
} finally {
  if (sessionId) await runtime.shutdown(sessionId).catch(() => {});
  await observer.close().catch(() => {});
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(profile, { recursive: true, force: true });
      break;
    } catch {
      await delay(400);
    }
  }
}
await fs.writeFile(path.join(OUT, 'audit-runtime-cases.json'), JSON.stringify({ ok, profile, cases }, null, 2));
console.log('overall', ok, 'profile', profile);
process.exit(0);
