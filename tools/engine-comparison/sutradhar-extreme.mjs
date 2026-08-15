// Sutradhar vs the 7 "extreme" real-world scenarios in extreme-scenarios.mjs, using
// SutradharRuntime directly (same direct-API approach as sutradhar-hard.mjs /
// sutradhar-harness.mjs — no MCP layer, no host-AI round trip, fair comparison against the
// other three engines' harnesses which are also plain direct scripts).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SutradharRuntime } from '../../packages/capability-runtime/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => pathToFileURL(path.join(here, 'hard-fixtures', name)).href;
const HEADLESS = process.env.HEADFUL !== '1';
const runtime = new SutradharRuntime({ logger: { info() {}, warn() {}, error() {}, debug() {} } });

async function withSession(fn) {
  const { sessionId } = await runtime.launch({ headless: HEADLESS });
  try {
    await runtime.setViewport(sessionId, { width: 1100, height: 750 });
    return await fn(sessionId);
  } finally {
    await runtime.shutdown(sessionId).catch(() => {});
  }
}

async function timed(id, title, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    return { id, title, engine: 'sutradhar', success: true, ms: Date.now() - start, detail: detail ?? null, error: null };
  } catch (err) {
    return { id, title, engine: 'sutradhar', success: false, ms: Date.now() - start, detail: null, error: err.message };
  }
}

function assertSuccess(result, label) {
  if (!result.success) throw new Error(`${label} failed: ${result.error}`);
  return result;
}

// Same marker list as packages/agent/src/core/block-detector.ts's detectBlock() — that function
// takes an internal IBrowserTab, which SutradharRuntime doesn't expose publicly, so this
// scenario re-runs the identical check via eval() against the real page instead of reimporting
// internals. Kept byte-for-byte in sync with the real detector's marker list.
const CAPTCHA_MARKERS = [
  'recaptcha', 'hcaptcha', 'cf-turnstile', 'g-recaptcha', 'captcha-delivery.com',
  'arkoselabs', 'funcaptcha', 'geetest', 'awswaf', 'aws-waf-token', 'perimeterx',
  'px-captcha', 'human-challenge', 'are you a human', 'verify you are human',
  'i am not a robot', 'please enable javascript and disable any ad blocker',
];

// ── 1. Nested shadow root inside a same-origin iframe ──────────────────────────────────────
async function scenarioNestedShadowIframe() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('nested-shadow-in-iframe.html'));
    assertSuccess(await runtime.waitForSelector(sid, 'iframe#nested-frame', 8000), 'wait for iframe element');
    await new Promise((r) => setTimeout(r, 500)); // let the iframe's own document finish loading

    // Real, unexpected discovery made while building this scenario: because the iframe's src is
    // a SEPARATE local file (nested-shadow-in-iframe-inner.html), Chrome treats it as its own
    // opaque file:// origin — genuinely cross-origin from the outer page's JS context, even
    // though both files sit in the same directory. Verified directly: `document.querySelector(
    // '#nested-frame').contentDocument` is `null` from the outer page's own eval(). (The
    // existing hard-scenarios fixture that DOES report iframe access working uses `srcdoc=` —
    // which inherits the parent origin — not a separate file, so it never hit this.) This means
    // eval()/extractData() (both implemented as page.evaluate() on the outer page only, see
    // runtime.ts) cannot read this iframe's contents at all, regardless of shadow DOM.
    let typeReportedSuccess = false;
    let clickReportedSuccess = false;
    let typeError = null;
    let clickError = null;
    try {
      const typeResult = await runtime.type(sid, '#nested-input', 'hello-nested');
      typeReportedSuccess = typeResult.success;
      if (!typeResult.success) typeError = typeResult.error;
      const clickResult = await runtime.click(sid, '#nested-submit');
      clickReportedSuccess = clickResult.success;
      if (!clickResult.success) clickError = clickResult.error;
    } catch (err) {
      typeError = typeError ?? (err.message || String(err)).split('\n')[0];
    }

    // Try to independently verify via eval() anyway (expected to fail per the discovery above —
    // confirming honestly rather than trusting type/click's own success:true, per this project's
    // "verify, don't trust the action's own report" standard).
    let evalResult = null;
    let evalError = null;
    try {
      evalResult = await runtime.eval(
        sid,
        `document.querySelector('#nested-frame').contentDocument.querySelector('nested-widget').shadowRoot.getElementById('nested-result').textContent`,
      );
    } catch (err) {
      evalError = (err.message || String(err)).split('\n')[0];
    }
    const independentlyVerified = evalResult === 'submitted:hello-nested';

    if (!independentlyVerified) {
      throw new Error(
        `type/click reported success (type=${typeReportedSuccess}, click=${clickReportedSuccess}) suggesting Sutradhar's action engine DID reach across the iframe+shadow boundary (unlike eval(), which is restricted to the outer page's JS context), but the actual result text could NOT be independently verified: eval() readback failed with "${evalError}" because this fixture's separately-hosted file:// iframe is a distinct opaque origin in Chrome (confirmed: contentDocument is null from the outer page). No public SutradharRuntime API (eval/extractData) can read into this frame. typeError=${typeError} clickError=${clickError}`,
      );
    }
    return { typeReportedSuccess, clickReportedSuccess, evalResult, independentlyVerified };
  });
}

// ── 2. Real ProseMirror contenteditable editor ──────────────────────────────────────────────
async function scenarioRichTextEditor() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://prosemirror.net/examples/basic/');
    assertSuccess(await runtime.waitForSelector(sid, '.ProseMirror', 15000), 'wait for editor to mount');
    assertSuccess(await runtime.click(sid, '.ProseMirror'), 'click into editor');

    const before = await runtime.eval(sid, `document.querySelector('.ProseMirror').innerText`);
    const typeResult = await runtime.type(sid, '.ProseMirror', 'Sutradhar extreme-scenario test sentence.');
    const after = (await runtime.eval(sid, `document.querySelector('.ProseMirror').innerText`)).trim();

    const genuinelyPresent = after.includes('Sutradhar extreme-scenario test sentence.');
    if (!genuinelyPresent) {
      throw new Error(`type() reported success=${typeResult.success} but text not genuinely present. before="${before}" after="${after}"`);
    }
    return { typeActionSuccess: typeResult.success, before, after, genuinelyPresent };
  });
}

// ── 3. Custom pointer-only drag (no HTML5 DnD events at all) ───────────────────────────────
async function scenarioCustomDragDrop() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('dnd-custom-pointer.html'));

    // Attempt 1: the high-level element-to-element dragAndDrop(), built around HTML5 DnD events
    // (dragstart/dragover/drop) per runtime.ts's own docs — this fixture listens for NONE of
    // those, only real mousedown/mousemove/mouseup, so this is expected to be a no-op.
    const highLevelResult = await runtime.dragAndDrop(sid, '#card', '#target');
    const afterHighLevel = await runtime.eval(sid, `document.getElementById('pointer-dnd-result').textContent`);
    const highLevelWorked = afterHighLevel === 'dropped:card-in-target';

    let lowLevelWorked = false;
    let lowLevelError = null;
    let afterLowLevel = afterHighLevel;
    if (!highLevelWorked) {
      // Attempt 2: dragAtPoints() — the coordinate-only mousedown->move->mouseup primitive,
      // exactly the kind of manual pointer sequence this fixture requires.
      try {
        const cardBox = await runtime.eval(sid, `(() => { const r = document.getElementById('card').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
        const targetBox = await runtime.eval(sid, `(() => { const r = document.getElementById('target').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
        // A single mousedown->move->up (what dragAtPoints does) may not fire enough intermediate
        // mousemove events for elementFromPoint-based drop detection to register mid-flight, so
        // this also checks whether one dragAtPoints call is sufficient on its own.
        const r = await runtime.dragAtPoints(sid, cardBox.x, cardBox.y, targetBox.x, targetBox.y);
        if (!r.success) throw new Error(r.error);
        afterLowLevel = await runtime.eval(sid, `document.getElementById('pointer-dnd-result').textContent`);
        lowLevelWorked = afterLowLevel === 'dropped:card-in-target';
      } catch (err) {
        lowLevelError = (err.message || String(err)).split('\n')[0];
      }
    }

    return {
      highLevelDragAndDropWorked: highLevelWorked,
      afterHighLevel,
      lowLevelDragAtPointsWorked: lowLevelWorked,
      afterLowLevel,
      lowLevelError,
      anyPathWorked: highLevelWorked || lowLevelWorked,
    };
    // Note: this scenario reports honestly via `detail` above regardless of outcome — the
    // caller (timed()) only throws/fails the scenario if returning detail itself throws, so a
    // "no working path" outcome is captured as data, not as a thrown error, per the task's
    // instruction to report this either way.
  });
}

// ── 4. Genuinely cross-origin iframe (example.com inside a local page) ─────────────────────
async function scenarioCrossOriginIframe() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('cross-origin-iframe.html'));
    assertSuccess(await runtime.waitForSelector(sid, 'iframe#cross-origin-frame', 10000), 'wait for cross-origin iframe');
    // Give the cross-origin document a moment to finish its own load inside the iframe.
    await new Promise((r) => setTimeout(r, 1500));

    let selectorEvalWorked = false;
    let selectorEvalError = null;
    let heading = null;
    try {
      // This is exactly what the fixture's own comment calls out: the OUTER page's JS context
      // cannot read contentDocument across origins (browser same-origin policy) — this call
      // goes through runtime.eval(), which executes in the outer page's JS context via
      // page.evaluate(), so it inherits that same restriction.
      heading = await runtime.eval(sid, `document.querySelector('#cross-origin-frame').contentDocument.querySelector('h1').textContent`);
      selectorEvalWorked = heading === 'Example Domain';
    } catch (err) {
      selectorEvalError = (err.message || String(err)).split('\n')[0];
    }

    // Real fallback: Puppeteer/CDP-level frame access, which operates outside the page's own JS
    // context and so isn't blocked by same-origin policy the way page.evaluate() is. Sutradhar's
    // runtime doesn't expose a public "get frame by selector" API, so this reaches it via the
    // one CDP-level primitive that IS exposed: eval() on a specific tabId isn't frame-scoped
    // either, so there's genuinely no documented Sutradhar API for cross-origin frame content
    // read — reported honestly below instead of inventing a workaround outside the public API.
    return {
      selectorEvalWorked,
      selectorEvalError,
      heading,
      note: selectorEvalWorked
        ? 'eval() reached the cross-origin iframe heading directly'
        : 'eval() blocked by same-origin policy as expected (runs in outer page JS context); no other public SutradharRuntime API exposes CDP-level cross-origin frame content access',
    };
  });
}

// ── 5. Real Cloudflare Turnstile challenge — detection only, no bypass ─────────────────────
async function scenarioCaptchaDetection() {
  return withSession(async (sid) => {
    const navStart = Date.now();
    await runtime.navigate(sid, 'https://demo.turnstile.workers.dev/');
    const navMs = Date.now() - navStart;
    await new Promise((r) => setTimeout(r, 2500)); // let the Turnstile widget's iframe mount

    const htmlLower = (await runtime.eval(sid, `document.documentElement.outerHTML.toLowerCase()`));
    const matchedMarkers = CAPTCHA_MARKERS.filter((m) => htmlLower.includes(m));
    const markerDetected = matchedMarkers.length > 0;

    const turnstileIframeCount = await runtime.eval(
      sid,
      `Array.from(document.querySelectorAll('iframe')).filter(f => (f.src||'').includes('challenges.cloudflare.com') || (f.title||'').toLowerCase().includes('turnstile') || (f.title||'').toLowerCase().includes('widget containing')).length`,
    );

    const detected = markerDetected || turnstileIframeCount > 0;
    if (!detected) throw new Error('failed to detect the Turnstile challenge widget by either HTML-marker or iframe-title check');

    return { navMs, matchedMarkers, turnstileIframeCount, detected, method: 'runtime.eval() against document.documentElement.outerHTML + iframe scan, mirroring packages/agent/src/core/block-detector.ts markers' };
  });
}

// ── 6. Large DOM: 13 columns x 50+ rows ─────────────────────────────────────────────────────
async function scenarioLargeDom() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://the-internet.herokuapp.com/large');
    assertSuccess(await runtime.waitForSelector(sid, '.row-50 .column-1', 10000), 'wait for row 50');
    const cellText = (await runtime.eval(sid, `document.querySelector('.row-50 .column-1').textContent.trim()`)).trim();
    // the-internet's large table's row-N column-1 cell text is actually "<row>.<col>" (e.g.
    // "50.1"), not the bare row number — verified live rather than assumed.
    if (cellText !== '50.1') {
      throw new Error(`unexpected cell text: "${cellText}"`);
    }

    const snapStart = Date.now();
    const snap = await runtime.snapshot(sid);
    const snapshotMs = Date.now() - snapStart;

    const axStart = Date.now();
    const ax = await runtime.axSnapshot(sid);
    const axSnapshotMs = Date.now() - axStart;

    const totalDomNodes = await runtime.eval(sid, `document.querySelectorAll('*').length`);

    return {
      cellText,
      totalDomNodes,
      snapshotMs,
      snapshotElementCount: snap.elementCount,
      axSnapshotMs,
      axSnapshotSize: JSON.stringify(ax).length,
    };
  });
}

// ── 7. 5 concurrent independent sessions, same login flow ──────────────────────────────────
async function scenarioConcurrencyStress() {
  async function oneSession(index) {
    const start = Date.now();
    const { sessionId } = await runtime.launch({ headless: HEADLESS });
    try {
      await runtime.navigate(sessionId, 'https://the-internet.herokuapp.com/login');
      assertSuccess(await runtime.type(sessionId, '#username', 'tomsmith'), `[${index}] type username`);
      assertSuccess(await runtime.type(sessionId, '#password', 'SuperSecretPassword!'), `[${index}] type password`);
      assertSuccess(await runtime.click(sessionId, 'button[type="submit"]'), `[${index}] submit`);
      assertSuccess(await runtime.waitForSelector(sessionId, '.flash.success', 10000), `[${index}] wait for flash`);
      const text = (await runtime.eval(sessionId, `document.querySelector('.flash').textContent.trim()`)).trim();
      const success = text.includes('You logged into a secure area');
      return { index, success, ms: Date.now() - start, text, error: null };
    } catch (err) {
      return { index, success: false, ms: Date.now() - start, text: null, error: err.message.split('\n')[0] };
    } finally {
      await runtime.shutdown(sessionId).catch(() => {});
    }
  }

  const results = await Promise.all([0, 1, 2, 3, 4].map(oneSession));
  const successCount = results.filter((r) => r.success).length;
  const msValues = results.map((r) => r.ms);
  const min = Math.min(...msValues);
  const max = Math.max(...msValues);
  const avg = Math.round(msValues.reduce((a, b) => a + b, 0) / msValues.length);
  if (successCount === 0) throw new Error('all 5 concurrent sessions failed');
  return { successCount, total: 5, min, max, avg, perSession: results };
}

export async function runExtremeScenarios() {
  return [
    await timed('nested-shadow-iframe', 'Open shadow root nested inside a same-origin iframe', scenarioNestedShadowIframe),
    await timed('rich-text-editor', 'Real ProseMirror contenteditable editor (official reference example)', scenarioRichTextEditor),
    await timed('custom-drag-drop', 'Custom pointer-based drag (no native HTML5 draggable/dataTransfer at all)', scenarioCustomDragDrop),
    await timed('cross-origin-iframe', 'Genuinely cross-origin iframe (local outer page, example.com inner)', scenarioCrossOriginIframe),
    await timed('captcha-detection', 'Real Cloudflare Turnstile challenge widget (official demo page)', scenarioCaptchaDetection),
    await timed('large-dom', 'Large table: 13 columns x 50 rows, deep real DOM', scenarioLargeDom),
    await timed('concurrency-stress', '5 concurrent sessions running the same login-flow scenario simultaneously', scenarioConcurrencyStress),
  ];
}

const results = await runExtremeScenarios();
console.log(JSON.stringify(results, null, 2));

const outPath = path.join(here, 'results', 'sutradhar-extreme.json');
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(results, null, 2));
await runtime.shutdownAll().catch(() => {});
