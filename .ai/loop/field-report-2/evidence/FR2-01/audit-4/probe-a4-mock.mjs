// FR2-01 audit-4: deterministic code-path probes against the BUILT engine (packages/browser/dist)
// with minimal fake Page/Frame/Handle objects (same shape as the unit-test mocks in
// packages/browser/tests/unit/browser-action-engine.spec.ts). Each case isolates ONE place where a
// probe's error/timeout is converted into a boolean/negative answer OUTSIDE the FrameProbeVerdict
// tri-state that fix-3 introduced.
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { BrowserActionEngine } = await import(pathToFileURL(path.join(repoRoot, 'packages/browser/dist/index.js')));

const mockTab = (page) => {
  const hist = [];
  return { id: 'tab_1', url: 'https://example.com', title: 'Example', active: true, isActive: true, isClosed: false, page,
    setActive() {}, async navigate() { return {}; }, async executeAction() { return {}; }, async close() {}, toDto() { return {}; },
    getActionHistory: () => hist, recordAction: (e) => hist.push(e) };
};
const handle = (evaluateImpl) => ({ evaluate: evaluateImpl, dispose: async () => {} });
const frame = ($impl, extra = {}) => ({ isDetached: () => false, $: $impl, ...extra });
const pageOf = (frames) => ({ frames: () => frames, mainFrame: () => frames[0], isClosed: () => false });
const run = async (page, params) => {
  const t0 = Date.now();
  const r = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'wait_for_selector', maxRetries: 0, ...params });
  return { success: r.success, output: r.outputData, error: r.error, ms: Date.now() - t0 };
};
const out = [];
const rec = (o) => { console.log('RESULT ' + JSON.stringify(o)); out.push(o); };

// K1: probe answers (a real match), but the VISIBILITY half of the check (isHandleVisible ->
// handle.evaluate) rejects with a tab/target-closed error. isHandleVisible's `.catch(() => false)`
// turns "the check failed to run" into "not visible", which isHiddenInEveryFrame reads as hidden.
for (const msg of ['Protocol error (Runtime.callFunctionOn): Target closed', 'Protocol error (Runtime.callFunctionOn): Session closed. Most likely the page has been closed.']) {
  const main = frame(async () => handle(async () => { throw new Error(msg); }));
  rec({ id: `K1-hidden: visibility evaluate rejects "${msg.slice(0, 50)}"`, truth: 'element state UNKNOWN (check never ran) — must not be success',
    ...(await run(pageOf([main]), { selector: '#spinner', state: 'hidden', timeoutMs: 1000 })) });
}

// K2: frame.$ itself rejects with a NON-timeout error that is neither a syntax error nor matched by
// isFatalFrameCheckError. pierceFirstMatch's catch-all maps ANY such error to 'no-match' (a
// definitive negative), not 'unknown'.
for (const msg of ['Execution context was destroyed, most likely because of a navigation.', 'Some unexpected internal error']) {
  const main = frame(async () => { throw new Error(msg); });
  rec({ id: `K2-hidden: frame.$ rejects "${msg.slice(0, 50)}" on every pass`, truth: 'check never produced an answer on ANY pass',
    ...(await run(pageOf([main]), { selector: '#spinner', state: 'hidden', timeoutMs: 1000 })) });
}

// K3: probe answers fast (match), but the visibility evaluate HANGS (frame became busy between the
// two round-trips). isHandleVisible is not bounded by FRAME_PROBE_TIMEOUT_MS at all.
for (const state of ['hidden', 'visible']) {
  const main = frame(async () => handle(() => new Promise(() => {})));
  rec({ id: `K3-${state}: visibility evaluate hangs after a fast frame.$`, note: 'GAP-030 per-frame bound covers frame.$ only',
    ...(await run(pageOf([main]), { selector: '#spinner', state, timeoutMs: 500 })) });
}

// K4: visible-timeout diagnosis: main frame has an attached-but-hidden match; a second frame's
// $$eval hangs. diagnoseSelectorVisibility is sequential + unbounded per frame, its 1000ms race
// resolves null, and the message falls through to describeMissingElement ("No element found").
{
  const hiddenHandle = handle(async () => false);
  const main = frame(async () => hiddenHandle, { $$eval: async () => [false] });
  const busy = frame(async () => null, { $$eval: () => new Promise(() => {}) });
  rec({ id: 'K4-visible-timeout: main has hidden match, 2nd frame $$eval hangs', truth: '1 element matches (display:none) in main frame',
    ...(await run(pageOf([main, busy]), { selector: '#ghost', state: 'visible', timeoutMs: 300 })) });
}

// K5: hidden success path: countOtherVisibleMatches — main frame's first match hidden, a LATER
// match visible; a busy frame listed first/second makes the 500ms race resolve 0 -> the
// otherVisibleMatches warning (GAP-016) silently disappears.
{
  const main = frame(async () => handle(async () => false), { $$eval: () => new Promise(() => {}) });
  const other = frame(async () => null, { $$eval: async () => [false, true] });
  rec({ id: 'K5-hidden success: busy frame suppresses otherVisibleMatches', truth: '1 later match is visible in frame 2',
    ...(await run(pageOf([main, other]), { selector: '#banner', state: 'hidden', timeoutMs: 300 })) });
  const main2 = frame(async () => handle(async () => false), { $$eval: async () => [false] });
  rec({ id: 'K5-control: no busy frame', ...(await run(pageOf([main2, other]), { selector: '#banner', state: 'hidden', timeoutMs: 300 })) });
}

fs.writeFileSync(path.join(here, 'probe-a4-mock-results.json'), JSON.stringify(out, null, 2));
process.exit(0);
