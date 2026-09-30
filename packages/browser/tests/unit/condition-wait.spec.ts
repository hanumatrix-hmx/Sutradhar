/**
 * @file packages/browser/tests/unit/condition-wait.spec.ts
 * @description FR2-08: `wait_for`'s pure core (validation, the Node-side polling loop, the failure
 * messages) against mock pages. The mock frames are shaped like Puppeteer frames well enough for the
 * SHARED visible-text probe (FR2-07's `probeVisibleText`) to run unchanged: a child frame exposes
 * `parentFrame()`/`frameElement()` so it is judged "shown"; the probe's in-page function is executed
 * for real against the fake DOM in the shared-definition matrix at the bottom.
 *
 * No wall-clock upper bounds are asserted (load-sensitive); "bounded" behaviour is proven by the call
 * RETURNING although a probe never answers, measured with the monotonic clock.
 */

import {
  WAIT_FOR_DIALOG_GRACE_MS,
  WAIT_FOR_PASS_TIMEOUT_MS,
  describePageCondition,
  displayPageCondition,
  formatConditionFailure,
  isTransientContextError,
  normalizePageCondition,
  pageContainsVisibleText,
  waitForPageCondition,
  wrapJsCondition,
  type ConditionPage,
  type IBrowserTab,
  type PageCondition,
} from '../../src/index.js';
import { attachShadow, el, makeDoc, page as fakePage, runIn, text as fakeText, type FDoc, type FNode } from './fake-dom.js';

type Step = boolean | 'throw' | 'hang' | Error | ((...a: unknown[]) => unknown);

/** A frame whose text-probe evaluate walks `steps` (last one repeats) and whose js evaluate walks `jsSteps`. */
function mkFrame(steps: Step[] = [false], jsSteps: Step[] = [false], extra: Record<string, unknown> = {}) {
  let ti = 0;
  let ji = 0;
  const next = (arr: Step[], idx: number): Step => arr[Math.min(idx, arr.length - 1)]!;
  const evaluate = vi.fn((fn: unknown, ...args: unknown[]) => {
    const isJs = typeof fn === 'string';
    const step = isJs ? next(jsSteps, ji++) : next(steps, ti++);
    if (step === 'hang') return new Promise(() => {});
    if (step === 'throw') return Promise.reject(new Error('Protocol error: Target closed'));
    if (step instanceof Error) return Promise.reject(step);
    if (typeof step === 'function') return Promise.resolve(step(fn, ...args));
    return Promise.resolve(step);
  });
  return {
    isDetached: () => false,
    evaluate,
    parentFrame: (): unknown => null,
    frameElement: async () => null as unknown,
    url: () => 'about:blank',
    ...extra,
  };
}
type MockFrame = ReturnType<typeof mkFrame>;
/** Makes `child` a frame whose element is rendered/visible in `parent` (so the shared probe judges it shown). */
function embed(child: MockFrame, parent: MockFrame): MockFrame {
  child.parentFrame = () => parent;
  child.frameElement = async () => ({ evaluate: async () => true, dispose: async () => undefined });
  return child;
}
function mkPage(main: MockFrame, children: MockFrame[] = [], urls: string[] = ['https://x/']) {
  let u = 0;
  const forbidden = () => {
    throw new Error('must not be called');
  };
  const p = {
    url: vi.fn(() => urls[Math.min(u++, urls.length - 1)]!),
    isClosed: vi.fn(() => false),
    mainFrame: () => main,
    frames: () => [main, ...children],
    // W19: the in-page pollers Puppeteer offers must never be used
    waitForFunction: vi.fn(forbidden),
    waitForSelector: vi.fn(forbidden),
    evaluateHandle: vi.fn(forbidden),
    evaluate: vi.fn(forbidden),
  };
  for (const f of [main, ...children]) {
    Object.assign(f, { waitForFunction: vi.fn(forbidden), waitForSelector: vi.fn(forbidden), evaluateHandle: vi.fn(forbidden) });
  }
  return p;
}
const asPage = (p: unknown): ConditionPage => p as ConditionPage;
const wait = (p: unknown, c: PageCondition, o: { timeoutMs: number; pollMs?: number; getPendingDialog?: () => any }) =>
  waitForPageCondition(asPage(p), c, { pollMs: 10, ...o });

describe('FR2-08 waitForPageCondition', () => {
  it('W1: text found on the 3rd pass', async () => {
    const main = mkFrame([false, false, true]);
    const r = await wait(mkPage(main), { text: 'Saved' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(3);
    expect(r.last.text).toBe('met');
  });

  it('W2: text only in the second frame is found on pass 1', async () => {
    const main = mkFrame([false]);
    const child = embed(mkFrame([true]), main);
    const r = await wait(mkPage(main, [child]), { text: 'Saved' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(1);
  });

  it('W3: text never appears -> unsatisfied with the exact failure message (never "Action ...")', async () => {
    const main = mkFrame([false]);
    const child = embed(mkFrame([false]), main);
    const c = { text: 'Never' };
    const r = await wait(mkPage(main, [child]), c, { timeoutMs: 120 });
    expect(r.satisfied).toBe(false);
    const msg = formatConditionFailure(c, r, 120);
    expect(msg).toMatch(/^wait_for timed out after 120ms waiting for text="Never"/);
    expect(msg).toContain('was not found in the visible text of 2 frame(s)');
    expect(msg.startsWith('Action ')).toBe(false);
  });

  it('W4: textGone: found, found, not-found -> satisfied, presentAtStart true', async () => {
    const r = await wait(mkPage(mkFrame([true, true, false])), { textGone: 'Loading' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(3);
    expect(r.presentAtStart).toBe(true);
  });

  it('W5: textGone never present -> satisfied on pass 1 with presentAtStart false', async () => {
    const r = await wait(mkPage(mkFrame([false])), { textGone: 'Nope' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(1);
    expect(r.presentAtStart).toBe(false);
  });

  it('W6: textGone: an unavailable pass is NOT "gone"; presentAtStart comes from the first DEFINITIVE pass', async () => {
    const main = mkFrame([false]);
    const child = embed(mkFrame(['throw', false]), main);
    const r = await wait(mkPage(main, [child]), { textGone: 'X' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(2); // pass 1: child could not answer -> unavailable, not met
    expect(r.presentAtStart).toBe(false);
  });

  it('W6b: textGone with a frame that stays unavailable never succeeds (unavailable is not gone)', async () => {
    const main = mkFrame([false]);
    const child = embed(mkFrame(['throw']), main);
    const c = { textGone: 'X' };
    const r = await wait(mkPage(main, [child]), c, { timeoutMs: 100 });
    expect(r.satisfied).toBe(false);
    expect(r.last.textGone).toBe('unavailable');
    expect(r.presentAtStart).toBeUndefined();
    expect(formatConditionFailure(c, r, 100)).toContain('textGone "X" could not be checked');
  });

  it('W7: a transient context error on pass 1 is survived', async () => {
    const r = await wait(mkPage(mkFrame([new Error('Execution context was destroyed'), true])), { text: 'A' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(2);
  });

  it('W8: url only: no frame is ever evaluated (no page contact)', async () => {
    const main = mkFrame();
    const p = mkPage(main, [], ['https://a', 'https://a', 'https://b/?stage=done']);
    const r = await wait(p, { url: 'stage=done' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(3);
    expect(main.evaluate).not.toHaveBeenCalled();
    expect(p.evaluate).not.toHaveBeenCalled();
  });

  it('W9: js is wrapped into a STRING (compiled by CDP, not new Function) and polled until truthy', async () => {
    const main = mkFrame([false], [false, true]);
    const r = await wait(mkPage(main), { js: 'window.x === 1' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(main.evaluate).toHaveBeenNthCalledWith(1, '(async () => !!(await (window.x === 1\n)))()');
    expect(wrapJsCondition('a // c')).toBe('(async () => !!(await (a // c\n)))()');
  });

  it('W10: a js throw fails the wait at once, with the page message', async () => {
    const main = mkFrame([false], [new Error("Evaluation failed: TypeError: Cannot read properties of undefined (reading 'ready')")]);
    const t0 = performance.now();
    const r = await wait(mkPage(main), { js: 'window.__nope.ready' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(false);
    expect(r.fatal?.kind).toBe('js-threw');
    expect(r.polls).toBe(1);
    expect(performance.now() - t0).toBeLessThan(4000); // did not wait for the 5s timeout (generous)
    expect(r.fatal?.message).toMatch(/^wait_for failed: js condition threw after \d+ms: /);
    expect(r.fatal?.message).toContain('Cannot read properties');
    expect(formatConditionFailure({ js: 'x' }, r, 5000)).toBe(r.fatal!.message);
  });

  it('W11: a js SyntaxError is fatal on pass 1', async () => {
    const r = await wait(mkPage(mkFrame([false], [new Error('Evaluation failed: SyntaxError: Unexpected end of input')])), { js: 'x ===' }, { timeoutMs: 5000 });
    expect(r.fatal?.kind).toBe('js-threw');
    expect(r.polls).toBe(1);
  });

  it('W12: a transient js error (context destroyed) is not fatal and polling continues', async () => {
    const r = await wait(
      mkPage(mkFrame([false], [new Error('Execution context was destroyed, most likely because of a navigation'), true])),
      { js: 'window.ok' },
      { timeoutMs: 5000 },
    );
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(2);
    expect(r.fatal).toBeUndefined();
  });

  it('W13: AND: every key must hold on the same pass; failure lists met and unmet parts', async () => {
    const ok = await wait(mkPage(mkFrame([true]), [], ['a', 'a', 'https://q/z']), { text: 'S', url: 'z' }, { timeoutMs: 5000 });
    expect(ok.satisfied).toBe(true);
    expect(ok.polls).toBe(3);
    const c = { text: 'S', url: 'Z' };
    const bad = await wait(mkPage(mkFrame([true]), [], ['https://cur/']), c, { timeoutMs: 100 });
    expect(bad.satisfied).toBe(false);
    const msg = formatConditionFailure(c, bad, 100);
    expect(msg).toContain('text "S" is visible');
    expect(msg).toContain('url does not contain "Z" (current URL: https://cur/)');
  });

  it('W13b: text met on an EARLIER pass than the url does not count: the same pass must satisfy all keys', async () => {
    // text alternates true,false,true,false ...; url is met only from pass 3; the pass where url is
    // first met has text false -> not satisfied there. Satisfied only when both hold on one pass.
    const main = mkFrame([true, false, false, true]);
    const r = await wait(mkPage(main, [], ['a', 'a', 'z', 'z']), { text: 'S', url: 'z' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(r.polls).toBe(4);
  });

  it('W14: validation (exact messages, before any browser contact)', () => {
    const bad: Array<[unknown, unknown, string]> = [
      ['x', undefined, 'wait_for: the condition must be an object like {text: "Saved"}'],
      [null, undefined, 'wait_for: the condition must be an object like {text: "Saved"}'],
      [[], undefined, 'wait_for: the condition must be an object like {text: "Saved"}'],
      [{ selector: '#t' }, undefined, 'wait_for: unknown key "selector" — to wait for an element\'s state use wait_for_selector'],
      [{ foo: 1 }, undefined, 'wait_for: unknown key "foo" — allowed: text, textGone, url, js, timeoutMs'],
      [{}, undefined, 'wait_for: give at least one of text, textGone, url, js'],
      [{ timeoutMs: 5 }, undefined, 'wait_for: give at least one of text, textGone, url, js'],
      [{ text: '' }, undefined, 'wait_for: "text" must be a non-empty string'],
      [{ url: 3 }, undefined, 'wait_for: "url" must be a non-empty string'],
      [{ js: null }, undefined, 'wait_for: "js" must be a non-empty string'],
      [{ text: 'X', textGone: 'X' }, undefined, 'wait_for: text and textGone are both "X" — that can never be satisfied'],
      [{ text: 'a' }, 'abc', 'wait_for: timeoutMs must be a number of milliseconds (0-300000)'],
      [{ text: 'a' }, NaN, 'wait_for: timeoutMs must be a number of milliseconds (0-300000)'],
      [{ text: 'a' }, Infinity, 'wait_for: timeoutMs must be a number of milliseconds (0-300000)'],
      [{ text: 'a' }, 300001, 'wait_for: timeoutMs 300001 exceeds the maximum 300000 (5 minutes)'],
    ];
    for (const [input, t, msg] of bad) {
      expect(() => normalizePageCondition(input, t), JSON.stringify(input)).toThrow(new TypeError(msg));
    }
    expect(normalizePageCondition({ text: 'a' }, -5).timeoutMs).toBe(0);
    expect(normalizePageCondition({ text: 'a' }).timeoutMs).toBe(10000);
    expect(normalizePageCondition({ text: 'a' }, 1500.7).timeoutMs).toBe(1500);
    expect(normalizePageCondition({ text: 'a', timeoutMs: 42 }).timeoutMs).toBe(42);
    expect(normalizePageCondition({ text: 'a', timeoutMs: 42 }, 7).timeoutMs).toBe(7);
    expect(normalizePageCondition({ text: 'a', url: undefined }).condition).toEqual({ text: 'a' });
    expect(normalizePageCondition({ text: 'a' }, 300000).timeoutMs).toBe(300000);
  });

  it('W15: timeoutMs 0 means exactly one pass, both outcomes', async () => {
    const c = { text: 'x' };
    const miss = await wait(mkPage(mkFrame([false])), c, { timeoutMs: 0 });
    expect(miss.polls).toBe(1);
    expect(miss.satisfied).toBe(false);
    expect(formatConditionFailure(c, miss, 0)).toContain('timed out after 0ms');
    const hit = await wait(mkPage(mkFrame([true])), c, { timeoutMs: 0 });
    expect(hit.polls).toBe(1);
    expect(hit.satisfied).toBe(true);
  });

  it('W16: a dialog pending past the grace fails fast (never hangs to the 30 s auto-dismiss); no frame is touched', async () => {
    const main = mkFrame([true]);
    const p = mkPage(main);
    const dialog = () => ({ dialogType: 'alert', message: 'hi there' });
    const t0 = performance.now();
    const r = await wait(p, { text: 'Never appears' }, { timeoutMs: 15000, getPendingDialog: dialog });
    const el_ = performance.now() - t0;
    expect(r.fatal?.kind).toBe('dialog');
    expect(el_).toBeGreaterThanOrEqual(WAIT_FOR_DIALOG_GRACE_MS - 50);
    expect(r.fatal?.message).toMatch(/^wait_for blocked by an open alert dialog \("hi there"\) after \d+ms — handle it/);
    expect(main.evaluate).not.toHaveBeenCalled();
  });

  it('W16b: url-only is unaffected by a pending dialog; a dialog that goes away in time is not fatal', async () => {
    const main = mkFrame([true]);
    const r = await wait(mkPage(main, [], ['https://a/ok']), { url: 'ok' }, { timeoutMs: 5000, getPendingDialog: () => ({ dialogType: 'alert', message: 'm' }) });
    expect(r.satisfied).toBe(true);
    let calls = 0;
    const r2 = await wait(mkPage(main), { text: 'A' }, { timeoutMs: 5000, getPendingDialog: () => (++calls <= 2 ? { dialogType: 'confirm', message: 'm' } : undefined) });
    expect(r2.satisfied).toBe(true);
    expect(r2.fatal).toBeUndefined();
  });

  it('W16d (audit-1 F2, X1): a js-only condition is gated by a pending dialog too (the js probe is never run into it)', async () => {
    const main = mkFrame([false], [true]);
    const p = mkPage(main);
    const r = await wait(p, { js: 'window.x === 1' }, { timeoutMs: 15000, getPendingDialog: () => ({ dialogType: 'alert', message: 'm' }) });
    expect(r.fatal?.kind).toBe('dialog');
    expect(r.last.js).toBe('unavailable');
    expect(main.evaluate).not.toHaveBeenCalled();
    const r0 = await wait(mkPage(main), { js: 'true' }, { timeoutMs: 0, getPendingDialog: () => ({ dialogType: 'confirm', message: 'm' }) });
    expect(r0.satisfied).toBe(false);
    expect(main.evaluate).not.toHaveBeenCalled();
  });

  it('W16e (audit-1 F2, X2): the dialog grace restarts after a dialog is handled: a second dialog is not instantly fatal', async () => {
    // dialog A for 0-600 ms, none for 600-1200 ms, dialog B from 1200 ms on. The wait ends at 1700 ms,
    // so B is open for ~500 ms (< the 1000 ms grace) but ~1700 ms after A first appeared.
    const main = mkFrame([false]);
    const t0 = performance.now();
    const dialog = () => {
      const t = performance.now() - t0;
      return t < 600 || t >= 1200 ? { dialogType: 'alert', message: 'm' } : undefined;
    };
    const r = await wait(mkPage(main), { text: 'Never' }, { timeoutMs: 1700, getPendingDialog: dialog });
    expect(r.fatal).toBeUndefined();
    expect(r.satisfied).toBe(false);
    expect(r.last.text).toBe('unavailable'); // ended while B was open
    expect(main.evaluate).toHaveBeenCalled(); // the clear window really ran probes
  }, 15000);

  it('W16c: a dialog open at the deadline is reported as the reason (a 0-timeout wait during a dialog is unavailable, not unmet)', async () => {
    const c = { text: 'x' };
    const r = await wait(mkPage(mkFrame([true])), c, { timeoutMs: 0, getPendingDialog: () => ({ dialogType: 'alert', message: 'm' }) });
    expect(r.satisfied).toBe(false);
    expect(r.last.text).toBe('unavailable');
    expect(formatConditionFailure(c, r, 0)).toContain('an alert dialog is open');
  });

  it('W17: a probe that never answers is bounded: it returns, with the reason, and leaves no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      let rejectLater: (e: Error) => void = () => undefined;
      const main = mkFrame([() => new Promise((_res, rej) => (rejectLater = rej))]);
      const c = { text: 'x' };
      const t0 = performance.now();
      const r = await wait(mkPage(main), c, { timeoutMs: 200 });
      const el_ = performance.now() - t0;
      expect(r.satisfied).toBe(false);
      expect(el_).toBeGreaterThan(WAIT_FOR_PASS_TIMEOUT_MS - 100); // the bound, not an early exit
      expect(r.last.text).toBe('unavailable');
      expect(formatConditionFailure(c, r, 200)).toMatch(/did not answer within \d+ms/);
      rejectLater(new Error('late rejection of the abandoned probe'));
      await new Promise((res) => setTimeout(res, 30));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 15000);

  it('W17b: an unresolved js evaluate makes the pass unavailable ("did not settle"), not met and not fatal', async () => {
    const main = mkFrame([false], ['hang']);
    const c = { js: 'new Promise(() => {})' };
    const r = await wait(mkPage(main), c, { timeoutMs: 50 });
    expect(r.satisfied).toBe(false);
    expect(r.last.js).toBe('unavailable');
    expect(r.fatal).toBeUndefined();
    expect(formatConditionFailure(c, r, 50)).toContain(`did not settle within ${WAIT_FOR_PASS_TIMEOUT_MS}ms`);
  }, 15000);

  it('W18: the tab closing mid-wait is fatal page-closed', async () => {
    const p = mkPage(mkFrame([false]));
    let n = 0;
    p.isClosed.mockImplementation(() => ++n >= 2);
    const r = await wait(p, { text: 'x' }, { timeoutMs: 5000 });
    expect(r.fatal?.kind).toBe('page-closed');
    expect(r.fatal?.message).toMatch(/the tab was closed while waiting/);
  });

  it('W19: never uses Puppeteer\'s in-page pollers (GAP-008 regression guard); every key exercised', async () => {
    const main = mkFrame([true], [true]);
    const p = mkPage(main, [], ['https://a/ok']);
    const r = await wait(p, { text: 'a', url: 'ok', js: '1' }, { timeoutMs: 100 });
    expect(r.satisfied).toBe(true);
    const r2 = await wait(mkPage(mkFrame([false, false, false])), { textGone: 'a' }, { timeoutMs: 100 });
    expect(r2.satisfied).toBe(true);
    for (const f of [main, ...([] as MockFrame[])]) {
      expect((f as any).waitForFunction).not.toHaveBeenCalled();
      expect((f as any).waitForSelector).not.toHaveBeenCalled();
      expect((f as any).evaluateHandle).not.toHaveBeenCalled();
    }
    expect(p.waitForFunction).not.toHaveBeenCalled();
    expect(p.waitForSelector).not.toHaveBeenCalled();
    expect(p.evaluateHandle).not.toHaveBeenCalled();
    expect(p.evaluate).not.toHaveBeenCalled();
  });

  it('W20: passes never overlap: one frame never has two evaluates in flight across passes', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let n = 0;
    const main = mkFrame([
      () => {
        const i = n++;
        order.push(`start:${i}`);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((res) =>
          setTimeout(() => {
            inFlight--;
            order.push(`end:${i}`);
            res(i >= 3);
          }, 15),
        );
      },
    ]);
    const r = await wait(mkPage(main), { text: 'x' }, { timeoutMs: 5000 });
    expect(r.satisfied).toBe(true);
    expect(maxInFlight).toBe(1);
    expect(order.slice(0, 4)).toEqual(['start:0', 'end:0', 'start:1', 'end:1']);
  });

  it('W21: messages carry the caller\'s needle but never page text or a js return value; js is capped', async () => {
    const SENTINEL = 'PAGE-TEXT-SENTINEL-9f3';
    const main = mkFrame([false], [SENTINEL as unknown as boolean]);
    const long = `window.a === ${'x'.repeat(500)}`;
    const c = { text: 'needle', js: long };
    const r = await wait(mkPage(main), { text: 'needle', js: 'window.q' }, { timeoutMs: 0 });
    const msg = formatConditionFailure({ text: 'needle', js: 'window.q' }, r, 0);
    expect(msg).toContain('needle');
    expect(msg).not.toContain(SENTINEL);
    const shown = describePageCondition(c);
    expect(shown.length).toBeLessThan(200);
    const full = formatConditionFailure(c, { ...r, last: { text: 'unmet', js: 'unmet' } }, 0);
    expect(full).toContain(`${long.slice(0, 200)}…`);
    expect(full).not.toContain(long.slice(0, 201));
    expect(displayPageCondition(c).js!.length).toBe(201);
  });

  it('W22: describePageCondition is exact and in the fixed key order', () => {
    expect(describePageCondition({ url: 'u', text: 't', js: 'x' })).toBe('text="t" AND url~"u" AND js(x)');
    expect(describePageCondition({ textGone: 'g', js: 'y' })).toBe('textGone="g" AND js(y)');
  });

  it('isTransientContextError matches navigation/teardown noise only', () => {
    for (const m of [
      'Execution context was destroyed, most likely because of a navigation',
      'Cannot find context with specified id',
      'Attempted to use detached Frame',
      'Execution context is not available in detached frame',
      'Protocol error: Target closed',
      'Session closed. Most likely the page has been closed.',
    ]) {
      expect(isTransientContextError(new Error(m)), m).toBe(true);
    }
    expect(isTransientContextError(new Error('TypeError: x is not a function'))).toBe(false);
    expect(isTransientContextError(new Error('SyntaxError: Unexpected end of input'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Generated matrices
// ─────────────────────────────────────────────────────────────────────────────

describe('FR2-08 generated matrix: per-frame outcomes -> text / textGone verdicts (independent oracle)', () => {
  type O = 'found' | 'absent' | 'throw';
  const all: O[] = ['found', 'absent', 'throw'];
  const combos: O[][] = [];
  for (let k = 1; k <= 3; k++) {
    const rec = (acc: O[]): void => {
      if (acc.length === k) return void combos.push(acc);
      for (const o of all) rec([...acc, o]);
    };
    rec([]);
  }
  for (const combo of combos) {
    it(`frames [${combo.join(', ')}]`, async () => {
      const mk = (o: O) => mkFrame([o === 'found' ? true : o === 'absent' ? false : 'throw']);
      const frames = combo.map(mk);
      for (let i = 1; i < frames.length; i++) embed(frames[i]!, frames[0]!);
      const p = mkPage(frames[0]!, frames.slice(1));
      const anyFound = combo.includes('found');
      const anyThrow = combo.includes('throw');
      // ORACLE (independent of the implementation): text is met iff some frame confirms it; textGone is met iff
      // EVERY frame answered "absent". A frame that could not answer is never evidence of absence.
      const textR = await wait(p, { text: 'T' }, { timeoutMs: 0 });
      expect(textR.satisfied).toBe(anyFound);
      expect(textR.last.text).toBe(anyFound ? 'met' : anyThrow ? 'unavailable' : 'unmet');
      const goneR = await wait(mkPage(frames[0]!, frames.slice(1)), { textGone: 'T' }, { timeoutMs: 0 });
      expect(goneR.satisfied).toBe(!anyFound && !anyThrow);
      expect(goneR.last.textGone).toBe(anyFound ? 'unmet' : anyThrow ? 'unavailable' : 'met');
    });
  }
});

describe('FR2-08 shared definition: wait_for text/textGone agree with expect.text on real in-page predicate runs', () => {
  const TOKEN = 'WAIT-TOKEN';
  type Build = (doc: FDoc) => { hideTargets: FNode[] };
  const placements: Array<{ name: string; build: Build }> = [
    {
      name: 'main frame element',
      build: (doc) => {
        const p = el(doc, 'p', {}, [fakeText(doc, TOKEN)]);
        const wrap = el(doc, 'div', {}, [p]);
        fakePage(doc, [wrap]);
        return { hideTargets: [p, wrap] };
      },
    },
    {
      name: 'open shadow root, bare text node',
      build: (doc) => {
        const host = el(doc, 'div');
        attachShadow(host, [fakeText(doc, TOKEN)]);
        fakePage(doc, [host]);
        return { hideTargets: [host] };
      },
    },
  ];
  const mechs: Array<{ name: string; counted: boolean; apply: (n: FNode) => void }> = [
    { name: 'none', counted: true, apply: () => undefined },
    { name: 'display:none', counted: false, apply: (n) => void Object.assign(n.own, { display: 'none' }) },
    { name: 'visibility:hidden', counted: false, apply: (n) => void Object.assign(n.own, { visibility: 'hidden' }) },
    { name: 'content-visibility:hidden', counted: false, apply: (n) => void Object.assign(n.own, { contentVisibility: 'hidden' }) },
    { name: 'zero-area', counted: false, apply: (n) => void (n.zeroArea = true) },
    { name: 'opacity:0 (counted)', counted: true, apply: () => undefined },
  ];
  for (const pl of placements) {
    for (const m of mechs) {
      it(`${pl.name} x ${m.name}`, async () => {
        for (let ti = 0; ; ti++) {
          const doc = makeDoc();
          const { hideTargets } = pl.build(doc);
          if (ti >= hideTargets.length) break;
          m.apply(hideTargets[ti]!);
          const frame: any = {
            isDetached: () => false,
            parentFrame: () => null,
            frameElement: async () => null,
            url: () => 'u',
            evaluate: (fn: (...a: any[]) => unknown, ...args: unknown[]) => Promise.resolve(runIn(doc, fn as any, ...(args as []))),
          };
          const p = { url: () => 'u', isClosed: () => false, mainFrame: () => frame, frames: () => [frame], evaluate: vi.fn() };
          const expectText = await pageContainsVisibleText({ url: 'u', page: p } as unknown as IBrowserTab, TOKEN);
          const waitText = await waitForPageCondition(p as unknown as ConditionPage, { text: TOKEN }, { timeoutMs: 0 });
          const waitGone = await waitForPageCondition(p as unknown as ConditionPage, { textGone: TOKEN }, { timeoutMs: 0 });
          expect(expectText.result).toBe(m.counted ? 'found' : 'not-found');
          expect(waitText.satisfied, `text, target #${ti}`).toBe(m.counted);
          expect(waitGone.satisfied, `textGone, target #${ti}`).toBe(!m.counted);
          expect(waitGone.presentAtStart).toBe(m.counted);
        }
      });
    }
  }

  it('a child frame that is hidden from the PARENT side is not visible text for wait_for either (same probe)', async () => {
    const mainDoc = makeDoc();
    fakePage(mainDoc, [el(mainDoc, 'p', {}, [fakeText(mainDoc, 'main only')])]);
    const childDoc = makeDoc();
    fakePage(childDoc, [el(childDoc, 'p', {}, [fakeText(childDoc, TOKEN)])]);
    const main: any = {
      isDetached: () => false,
      parentFrame: () => null,
      frameElement: async () => null,
      url: () => 'm',
      evaluate: (fn: any, ...a: unknown[]) => Promise.resolve(runIn(mainDoc, fn, ...(a as []))),
    };
    const child: any = {
      isDetached: () => false,
      parentFrame: () => main,
      frameElement: async () => ({ evaluate: async () => false, dispose: async () => undefined }), // frameElementRendered -> false
      url: () => 'c',
      evaluate: (fn: any, ...a: unknown[]) => Promise.resolve(runIn(childDoc, fn, ...(a as []))),
    };
    const p = { url: () => 'u', isClosed: () => false, mainFrame: () => main, frames: () => [main, child] };
    expect((await waitForPageCondition(p as unknown as ConditionPage, { text: TOKEN }, { timeoutMs: 0 })).satisfied).toBe(false);
    expect((await waitForPageCondition(p as unknown as ConditionPage, { textGone: TOKEN }, { timeoutMs: 0 })).satisfied).toBe(true);
    child.frameElement = async () => ({ evaluate: async () => true, dispose: async () => undefined });
    expect((await waitForPageCondition(p as unknown as ConditionPage, { text: TOKEN }, { timeoutMs: 0 })).satisfied).toBe(true);
  });
});
