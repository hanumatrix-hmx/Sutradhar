/**
 * @file packages/browser/src/verifier/execution-verifier.ts
 * @description ExecutionVerifier service validating page mutations, URL transitions, and element presence with confidence integration.
 *
 * FR2-07: one verification contract. Every result carries `evidence: {tier, checks[]}` and a
 * confidence that follows the tier table below. Callers branch on the tier, never on the number.
 *
 *   tier            verified  confidence (c = candidate, default 0.9)
 *   verified        true      c
 *   low-confidence  false     c            (candidate below 0.5: pre-existing gate)
 *   unverifiable    false     c * 0.5      (0.45: no real check could run; the reason says why)
 *   contradicted    false     c * 0.1      (0.09: a check ran and found the effect did NOT happen)
 *   action-failed   false     0
 */

import type { Frame } from 'puppeteer-core';
import { IBrowserTab } from '../session/browser-tab.js';
import type {
  BuiltInVerdict,
  EvidenceCheck,
  EvidenceOutcome,
  VerificationSpec,
  VerificationResultDto,
  VerificationTier,
} from '../actions/action-types.js';
import { EXPECT_TEXT_TIMEOUT_MS, aDialog, bounded, capEvidence, pendingDialogType } from './post-conditions.js';

export type { VerificationSpec, VerificationResultDto };

/** The slice of an action result the verifier needs (an `ActionResultDto` is assignable). */
export interface VerifiableActionResult {
  readonly success: boolean;
  readonly actionType: string;
  readonly error?: string;
  readonly outputData?: Record<string, unknown>;
}

const LOW_CONFIDENCE_THRESHOLD = 0.5;
const VERIFIED_FACTOR = 1;
const UNVERIFIABLE_FACTOR = 0.5;
const CONTRADICTED_FACTOR = 0.1;

const EXPECT_KEYS = ['text', 'url', 'urlChanged'] as const;
type ExpectKey = (typeof EXPECT_KEYS)[number];

/** The `expect.*` keys the spec asks for, in contract order. */
export function specKeys(spec: VerificationSpec | undefined): ExpectKey[] {
  if (!spec) return [];
  const keys: ExpectKey[] = [];
  if (spec.expectedElementText) keys.push('text');
  if (spec.expectedUrlSubstring) keys.push('url');
  if (spec.shouldUrlChange !== undefined) keys.push('urlChanged');
  return keys;
}

/** Result of an action that failed: `action-failed`, confidence 0, every expectation `not-run`. */
export function failedVerification(error: string, expectKeys: readonly string[] = []): VerificationResultDto {
  const checks: EvidenceCheck[] = expectKeys.map((k) => ({
    check: `expect.${k}`,
    outcome: 'not-run' as const,
    detail: 'the action failed; expectations were not evaluated',
  }));
  return {
    verified: false,
    urlChanged: false,
    elementFound: false,
    confidence: 0,
    reason: `Action failed: ${error || 'Unknown error'}`,
    evidence: capEvidence({ tier: 'action-failed', checks }),
  };
}

/** Action types that accept no `expect` on any surface, so the "pass expect:{...}" coaching
 *  sentence would point at something the caller cannot do. */
const EXPECT_UNSUPPORTED = new Set(['wait', 'screenshot', 'take_screenshot', 'set_clipboard', 'get_clipboard']);

const UNVERIFIABLE_WHY_DEFAULT = 'this action type has no built-in post-condition check';
const NO_OBSERVATION_SUPPLIED =
  'no observation was supplied to the verifier for this action (it was verified outside the engine path that records one)';
const SCREENSHOT_WHY = 'a screenshot does not change the page, so there is no effect to verify';

/** Exact texts, used only when the caller supplied no built-in verdict. */
const UNVERIFIABLE_WHY: Record<string, string> = {
  wait: 'a fixed-duration sleep has no post-condition',
  take_screenshot: SCREENSHOT_WHY,
  screenshot: SCREENSHOT_WHY,
  press_key: NO_OBSERVATION_SUPPLIED,
  focus: NO_OBSERVATION_SUPPLIED,
  touch_tap: NO_OBSERVATION_SUPPLIED,
  download_file: NO_OBSERVATION_SUPPLIED,
  navigate: NO_OBSERVATION_SUPPLIED,
  go_back: NO_OBSERVATION_SUPPLIED,
  go_forward: NO_OBSERVATION_SUPPLIED,
  reload: NO_OBSERVATION_SUPPLIED,
  click_at_point: NO_OBSERVATION_SUPPLIED,
  drag_at_points: NO_OBSERVATION_SUPPLIED,
  set_clipboard: NO_OBSERVATION_SUPPLIED,
  get_clipboard: NO_OBSERVATION_SUPPLIED,
  upload_file_via_trigger: NO_OBSERVATION_SUPPLIED,
};

const SELF_VERIFYING_DETAIL: Record<string, string> = {
  click: 'occlusion and click-delivery were checked inside the action before it reported success',
  click_by_role: 'occlusion and click-delivery were checked inside the action before it reported success',
  click_by_text: 'occlusion and click-delivery were checked inside the action before it reported success',
  type: 'the typed value was read back from the element inside the action',
  type_by_label: 'the typed value was read back from the element inside the action',
  hover: 'occlusion at the hover point was checked inside the action',
  select_option: 'the selected value(s) were read back inside the action',
  upload_file: "the input's files list was read back inside the action",
  scroll: 'scroll position movement was read back inside the action',
  drag_and_drop: "a 'drop' event on the target was observed inside the action",
  wait_for_selector: 'the element was observed in the requested state inside the action',
};

function selfVerifyingPass(type: string): BuiltInVerdict {
  const detail = SELF_VERIFYING_DETAIL[type] ?? 'the action checks its own post-condition before reporting success';
  return { outcome: 'pass', reason: detail, checks: [{ check: `${type}.built-in`, outcome: 'pass', detail }] };
}

function unverifiableDefault(type: string): BuiltInVerdict {
  return { outcome: 'not-run', reason: UNVERIFIABLE_WHY[type] ?? UNVERIFIABLE_WHY_DEFAULT, checks: [] };
}

/** `'found'`/`'not-found'` are conclusions; `'unavailable'` carries why. */
export type VisibleTextResult = { result: 'found' | 'not-found'; detail?: undefined } | { result: 'unavailable'; detail: string };

/**
 * `expect.text` CONTRACT (FR2-07 fix-2): the text must be RENDERED, not "perceivable".
 *
 * A text node counts only if ALL hold:
 *  (i)   its Range has a client rect with a non-zero area (it is laid out: `display:none`, `[hidden]`,
 *        `<template>`, `<script>`/`<style>`, unslotted light DOM have none);
 *  (ii)  its container's computed `visibility` is `visible` (visibility is inherited, so this is the
 *        whole ancestor story: no ancestor walk);
 *  (iii) `Element.checkVisibility()` is true for the nearest non-`display:contents` flat-tree ancestor
 *        (false under a `content-visibility:hidden` ancestor and inside a closed `<details>`), and that
 *        element does not itself skip its contents (`content-visibility:hidden`);
 *  (iv)  every embedding frame up the chain has a frame element that is rendered and `visibility:visible`,
 *        judged from the PARENT side (see {@link frameElementRendered}); text in a hidden frame is not
 *        visible even though the frame's own document looks fine from the inside.
 *
 * COUNTED (documented, deliberately): `opacity:0`, `aria-hidden`, off-screen / scrolled-out text,
 * text clipped by `overflow`/`clip`, `content-visibility:auto` off-screen, text the same colour as its
 * background. Not reachable: text inside a CLOSED shadow root.
 * FAIL CLOSED: anything that cannot be judged throws (the caller reports `unavailable`), never "visible".
 *
 * Matching is over the FLAT tree (open shadow roots, slots) text nodes, whitespace-collapsed, with
 * `text-transform` applied, and may span inline siblings of one block (`a<b>c</b>` matches "ac") but
 * never a block boundary or `<br>` (innerText would put a newline there).
 */
export const EXPECT_TEXT_CONTRACT =
  'rendered text: laid out (non-empty client rects), computed visibility:visible, not under display:none / ' +
  'content-visibility:hidden / a closed <details>, and every embedding <iframe> itself rendered and visible; ' +
  'opacity:0, aria-hidden, off-screen and clipped text still count';

/**
 * In-page (self-contained; serialised by Puppeteer): does this document (not its child frames)
 * contain RENDERED text `t`? See the contract above. Returns a boolean; THROWS when the page cannot
 * be judged (no `checkVisibility`, work budget exhausted), which the caller turns into `unavailable`.
 */
export function visibleTextContainsInPage(t: string): boolean {
  const BUDGET = 400000;
  let spent = 0;
  const norm = (s: string): string => s.replace(/\s+/g, ' ');
  const want = norm(t);
  if (want.length === 0) return false;
  const wantLower = want.toLowerCase();
  const wantUpper = want.toUpperCase();

  // 1. collect the text nodes of the FLAT tree, in order; `null` marks a hard line break
  const items: Array<Text | null> = [];
  const stack: Node[] = [document];
  while (stack.length > 0) {
    const n = stack.pop() as Node;
    if (n.nodeType === 3) {
      items.push(n as Text);
      continue;
    }
    let kids: Node[];
    if (n.nodeType === 1) {
      const el = n as Element;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      if (tag === 'BR') items.push(null);
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) kids = Array.from(sr.childNodes);
      else if (tag === 'SLOT' && typeof (el as HTMLSlotElement).assignedNodes === 'function') {
        const assigned = (el as HTMLSlotElement).assignedNodes();
        kids = assigned.length > 0 ? assigned : Array.from(el.childNodes);
      } else kids = Array.from(el.childNodes);
    } else kids = Array.from(n.childNodes);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as Node);
  }

  // 2. cheap, style-free prefilter over the raw text: no candidate, no work
  let raw = '';
  for (const it of items) raw += it === null ? '\n' : it.data;
  raw = norm(raw);
  if (!raw.toLowerCase().includes(wantLower) && !raw.toUpperCase().includes(wantUpper)) return false;

  const flatParent = (n: Node): Element | null => {
    const slot = (n as Text | Element).assignedSlot;
    if (slot) return slot;
    if (n.parentElement) return n.parentElement;
    const root = n.getRootNode() as Node & { host?: Element };
    return root && root.host ? root.host : null;
  };
  const viewOf = (e: Element): Window => (e.ownerDocument && e.ownerDocument.defaultView) || window;
  const tick = (): void => {
    if (++spent > BUDGET) throw new Error('the text check exceeded its work budget; page too large to judge');
  };
  const styleOf = (e: Element): CSSStyleDeclaration & { contentVisibility?: string } => viewOf(e).getComputedStyle(e);

  // 3. is this text node rendered? (memoised)
  const memo = new Map<Text, boolean>();
  const rendered = (n: Text): boolean => {
    const known = memo.get(n);
    if (known !== undefined) return known;
    tick();
    let ok = false;
    const c = flatParent(n);
    if (c) {
      const rg = (n.ownerDocument || document).createRange();
      rg.selectNodeContents(n);
      const rects = rg.getClientRects();
      let laidOut = false;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i] as DOMRect;
        if (r.width > 0 && r.height > 0) {
          laidOut = true;
          break;
        }
      }
      if (laidOut && styleOf(c).visibility === 'visible') {
        let e: Element | null = c;
        while (e && styleOf(e).display === 'contents') e = flatParent(e);
        if (e) {
          if (typeof (e as Element & { checkVisibility?: unknown }).checkVisibility !== 'function') {
            throw new Error('Element.checkVisibility is unavailable in this browser; cannot judge rendering');
          }
          ok = e.checkVisibility() && styleOf(e).contentVisibility !== 'hidden';
        }
      }
    }
    memo.set(n, ok);
    return ok;
  };

  // 4. displayed text of a node (text-transform applied), and its block container
  const displayed = (n: Text): string => {
    const base = norm(n.data);
    const c = flatParent(n);
    const tt = c ? styleOf(c).textTransform : 'none';
    if (tt === 'uppercase') return base.toUpperCase();
    if (tt === 'lowercase') return base.toLowerCase();
    if (tt === 'capitalize') return base.replace(/(^|\s)(\S)/g, (_m: string, a: string, b: string) => a + b.toUpperCase());
    return base;
  };
  const blockOf = (n: Text): Element | null => {
    let e = flatParent(n);
    while (e) {
      const d = styleOf(e).display;
      if (d !== 'inline' && d !== 'contents') return e;
      e = flatParent(e);
    }
    return null;
  };

  // 5. match: a run of adjacent text nodes of ONE block, every non-blank node of the match rendered
  for (let i = 0; i < items.length; i++) {
    const first = items[i];
    if (!first) continue;
    const rawFirst = norm(first.data).toLowerCase();
    let startsHere = rawFirst.includes(wantLower);
    for (let k = Math.min(rawFirst.length, wantLower.length); !startsHere && k > 0; k--) {
      if (rawFirst.endsWith(wantLower.slice(0, k))) startsHere = true;
    }
    if (!startsHere && !norm(first.data).toUpperCase().includes(wantUpper)) continue;
    tick();
    const block = blockOf(first);
    const segs: Array<{ node: Text; from: number; to: number }> = [];
    let acc = '';
    for (let j = i; j < items.length; j++) {
      const it = items[j];
      if (!it) break;
      if (j > i && blockOf(it) !== block) break;
      let d = displayed(it);
      if (acc.endsWith(' ') && d.startsWith(' ')) d = d.slice(1);
      segs.push({ node: it, from: acc.length, to: acc.length + d.length });
      acc += d;
      const firstEnd = segs[0]!.to;
      // every occurrence that STARTS inside the first node
      for (let p = acc.indexOf(want); p >= 0 && p < firstEnd; p = acc.indexOf(want, p + 1)) {
        const end = p + want.length;
        let allRendered = true;
        for (const sg of segs) {
          if (sg.to <= p || sg.from >= end) continue;
          if (sg.node.data.trim() === '') continue;
          if (!rendered(sg.node)) {
            allRendered = false;
            break;
          }
        }
        if (allRendered) return true;
      }
      if (acc.length >= want.length + firstEnd) break;
    }
  }
  return false;
}

/**
 * In-page, run on a FRAME ELEMENT (`<iframe>`/`<frame>`/`<object>`) in its PARENT document: is the
 * embedded frame shown? Rendered (non-zero box, not `display:none`, not under `content-visibility:hidden`
 * or a closed `<details>`) and `visibility:visible`. This is the only place a hidden CROSS-ORIGIN frame
 * can be recognised; text inside it never counts otherwise. Throws when it cannot judge.
 */
export function frameElementRendered(el: Element): boolean {
  const w: Window = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  const cs: CSSStyleDeclaration & { contentVisibility?: string } = w.getComputedStyle(el);
  if (cs.visibility !== 'visible') return false;
  if (typeof (el as Element & { checkVisibility?: unknown }).checkVisibility !== 'function') {
    throw new Error('Element.checkVisibility is unavailable in this browser; cannot judge rendering');
  }
  if (!el.checkVisibility() || cs.contentVisibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && el.getClientRects().length > 0;
}

/** What one frame contributed to an `expect.text` check. */
type FrameOutcome = 'found' | 'absent' | 'hung' | 'failed' | 'unjudged';

/** Verdict on whether a frame's document is shown, judged from the parent side. */
type FrameShown = 'shown' | 'hidden' | 'unjudgeable';

/**
 * Is this frame shown? The top frame is. Any other frame needs a reachable frame element (Puppeteer
 * `frame.frameElement()` works for same-origin, srcdoc, sandboxed AND out-of-process frames) that passes
 * {@link frameElementRendered} in its parent, and a shown parent, recursively. `hidden` dominates
 * `unjudgeable` (a hidden link in the chain hides everything below it whatever else is unknown).
 */
async function frameShown(f: Frame, main: Frame | undefined, memo: Map<Frame, Promise<FrameShown>>): Promise<FrameShown> {
  if (f === main) return 'shown';
  const known = memo.get(f);
  if (known) return known;
  const p = (async (): Promise<FrameShown> => {
    const parent = typeof f.parentFrame === 'function' ? f.parentFrame() : null;
    if (!parent || typeof f.frameElement !== 'function') return 'unjudgeable';
    let own: FrameShown = 'unjudgeable';
    let handle: Awaited<ReturnType<Frame['frameElement']>> | undefined;
    try {
      handle = await f.frameElement();
      if (handle) own = (await handle.evaluate(frameElementRendered)) === true ? 'shown' : 'hidden';
    } catch {
      own = 'unjudgeable';
    } finally {
      try {
        await handle?.dispose();
      } catch {
        /* ignore */
      }
    }
    if (own === 'hidden') return 'hidden';
    const up = await frameShown(parent, main, memo);
    if (up === 'hidden') return 'hidden';
    return own === 'shown' && up === 'shown' ? 'shown' : 'unjudgeable';
  })();
  memo.set(f, p);
  return p;
}

/**
 * Best-effort, BOUNDED check that `text` appears in the page's RENDERED text ({@link EXPECT_TEXT_CONTRACT})
 * — any live frame (main first), including open shadow roots. Never uses `page.evaluate` (a pending dialog
 * freezes the main thread: it would hang until the 30 s auto-dismiss), so every evaluation goes through a
 * frame. Each frame is bounded by {@link EXPECT_TEXT_TIMEOUT_MS} on its own; `found` returns as soon as ANY
 * frame confirms (an unrelated out-of-process frame that never answers cannot mask text the main frame has);
 * `not-found` needs every frame to have answered, otherwise `unavailable` says how many did.
 */
export async function pageContainsVisibleText(tab: IBrowserTab, text: string): Promise<VisibleTextResult> {
  const dialog = pendingDialogType(tab);
  if (dialog) {
    return {
      result: 'unavailable',
      detail: `${aDialog(dialog)} is open (see dialogPending); the page can't be inspected until it's handled`,
    };
  }
  const page = tab.page;
  if (!page) return { result: 'unavailable', detail: 'there is no live browser page to inspect' };
  const run = async (): Promise<VisibleTextResult> => {
    const all = typeof page.frames === 'function' ? page.frames() : [];
    let frames = all.filter((f) => !f.isDetached());
    if (frames.length === 0 && typeof page.mainFrame === 'function') frames = [page.mainFrame()];
    if (frames.length === 0) return { result: 'unavailable', detail: 'the page exposes no frames to inspect' };
    const main = typeof page.mainFrame === 'function' ? page.mainFrame() : undefined;
    frames.sort((a, b) => Number(b === main) - Number(a === main));
    const shown = new Map<Frame, Promise<FrameShown>>();
    // One frame: judged from the parent side first (a hidden frame is answered without entering it: an
    // out-of-process frame that is hidden may never answer an evaluate), then asked, all under its OWN bound.
    const inspect = async (f: Frame): Promise<FrameOutcome> => {
      const r = await bounded(
        (async (): Promise<FrameOutcome> => {
          const s = await frameShown(f, main, shown);
          if (s === 'hidden') return 'absent';
          if (s === 'unjudgeable') return 'unjudged';
          return (await f.evaluate(visibleTextContainsInPage, text)) ? 'found' : 'absent';
        })(),
        EXPECT_TEXT_TIMEOUT_MS,
      );
      if (r.ok) return r.value;
      return r.timedOut ? 'hung' : 'failed';
    };
    // 'found' short-circuits the moment ANY frame confirms; 'not-found' needs EVERY frame to have answered.
    return new Promise<VisibleTextResult>((resolve) => {
      const tally: Record<FrameOutcome, number> = { found: 0, absent: 0, hung: 0, failed: 0, unjudged: 0 };
      let pending = frames.length;
      for (const f of frames) {
        void inspect(f).then((o) => {
          tally[o]++;
          if (o === 'found') return resolve({ result: 'found' });
          if (--pending > 0) return;
          if (tally.absent === frames.length) return resolve({ result: 'not-found' });
          const why = [
            tally.hung > 0 ? `${tally.hung} did not answer within ${EXPECT_TEXT_TIMEOUT_MS}ms` : '',
            tally.failed > 0 ? `${tally.failed} failed` : '',
            tally.unjudged > 0 ? `${tally.unjudged} could not be judged as shown` : '',
          ].filter(Boolean);
          resolve({ result: 'unavailable', detail: `only ${tally.absent} of ${frames.length} frames answered (${why.join(', ')})` });
        });
      }
    });
  };
  // backstop only: every frame is already bounded on its own
  const r = await bounded(run(), EXPECT_TEXT_TIMEOUT_MS + 500);
  if (r.ok) return r.value;
  return {
    result: 'unavailable',
    detail: r.timedOut
      ? `the page did not answer the text check within ${EXPECT_TEXT_TIMEOUT_MS}ms`
      : `the text check failed (${r.error ?? 'unknown error'})`,
  };
}

export class ExecutionVerifier {
  public async verifyAction(
    tab: IBrowserTab,
    previousUrl: string,
    actionResult: VerifiableActionResult,
    spec: VerificationSpec = {},
    builtIn?: BuiltInVerdict,
  ): Promise<VerificationResultDto> {
    const type = actionResult.actionType;
    const candidate = spec.candidateConfidence ?? 0.9;

    // Rule 2: the action failed — nothing to verify. Unchanged reason text.
    if (!actionResult.success) {
      return failedVerification(actionResult.error ?? 'Unknown error', specKeys(spec));
    }

    const currentUrl = tab.url;
    const urlChanged = currentUrl !== previousUrl;

    // Rule 3: the built-in verdict (engine/runtime supplied), else the legacy per-type default.
    const bi: BuiltInVerdict =
      builtIn ?? (type in SELF_VERIFYING_DETAIL ? selfVerifyingPass(type) : unverifiableDefault(type));

    // Rule 4: caller expectations. Evaluated in this order; recorded in contract order below.
    const expectChecks = new Map<ExpectKey, EvidenceCheck>();
    const failReasons: string[] = [];
    let expectNotRunDetail: string | undefined;

    if (spec.shouldUrlChange === true) {
      const pass = urlChanged;
      expectChecks.set('urlChanged', { check: 'expect.urlChanged', outcome: pass ? 'pass' : 'fail', expected: true, observed: urlChanged });
      if (!pass) failReasons.push(`Expected URL change from ${previousUrl}, but URL remained ${currentUrl}`);
    } else if (spec.shouldUrlChange === false) {
      const pass = !urlChanged;
      expectChecks.set('urlChanged', { check: 'expect.urlChanged', outcome: pass ? 'pass' : 'fail', expected: false, observed: urlChanged });
      if (!pass) failReasons.push(`Expected the URL to stay ${previousUrl}, but it changed to ${currentUrl}`);
    }
    if (spec.expectedUrlSubstring) {
      const pass = currentUrl.includes(spec.expectedUrlSubstring);
      expectChecks.set('url', { check: 'expect.url', outcome: pass ? 'pass' : 'fail', expected: spec.expectedUrlSubstring, observed: currentUrl });
      if (!pass) {
        failReasons.push(`Current URL ${currentUrl} does not contain expected substring ${spec.expectedUrlSubstring}`);
      }
    }
    if (spec.expectedElementText) {
      const t = await pageContainsVisibleText(tab, spec.expectedElementText);
      if (t.result === 'found') {
        expectChecks.set('text', { check: 'expect.text', outcome: 'pass', expected: spec.expectedElementText, observed: 'found' });
      } else if (t.result === 'not-found') {
        expectChecks.set('text', { check: 'expect.text', outcome: 'fail', expected: spec.expectedElementText, observed: 'not-found' });
        failReasons.push(`Expected text "${spec.expectedElementText}" was not found in the page's visible text after the action`);
      } else {
        expectChecks.set('text', { check: 'expect.text', outcome: 'not-run', expected: spec.expectedElementText, detail: t.detail });
        expectNotRunDetail = t.detail;
      }
    }
    const orderedExpect: EvidenceCheck[] = EXPECT_KEYS.flatMap((k) => {
      const c = expectChecks.get(k);
      return c ? [c] : [];
    });
    const allChecks = [...bi.checks, ...orderedExpect];
    const expectOutcomes = orderedExpect.map((c) => c.outcome as EvidenceOutcome);
    const anyExpectPass = expectOutcomes.includes('pass');
    const anyExpectNotRun = expectOutcomes.includes('not-run');
    const make = (
      tier: VerificationTier,
      verified: boolean,
      confidence: number,
      reason: string,
    ): VerificationResultDto => ({
      verified,
      urlChanged,
      elementFound: tier === 'verified' || tier === 'low-confidence',
      confidence,
      reason,
      evidence: capEvidence({ tier, checks: allChecks }),
    });

    // Rule 5: any failed expectation.
    if (failReasons.length > 0) {
      return make('contradicted', false, candidate * CONTRADICTED_FACTOR, failReasons[0]!);
    }
    // Rule 6: the built-in check ran and found the effect did not happen.
    if (bi.outcome === 'fail') {
      return make(
        'contradicted',
        false,
        candidate * CONTRADICTED_FACTOR,
        `'${type}' completed, but its post-condition check failed: ${bi.reason}.`,
      );
    }
    // Rule 7: a caller-supplied `candidateConfidence` below the threshold means the action
    // targeted an uncertain candidate (e.g. a fuzzy text match) — reporting `verified:true`
    // would be self-contradictory. Existing reason text, verbatim.
    if (candidate < LOW_CONFIDENCE_THRESHOLD) {
      return make(
        'low-confidence',
        false,
        candidate,
        `Action executed but its target candidate confidence (${candidate.toFixed(2)}) is below ` +
          `the verification threshold (${LOW_CONFIDENCE_THRESHOLD}) — the targeted element may not have been the intended one.`,
      );
    }
    // Rule 8: nothing real was checked (or an expectation couldn't be evaluated).
    const anyPass = bi.outcome === 'pass' || anyExpectPass;
    if (!anyPass || anyExpectNotRun) {
      const reason = anyExpectNotRun
        ? `Expectation could not be evaluated: ${expectNotRunDetail ?? 'no detail'}`
        : `'${type}' completed, but no built-in post-condition check could run: ${bi.reason}.` +
          (specKeys(spec).length === 0 && !EXPECT_UNSUPPORTED.has(type)
            ? ' Pass expect:{text|url|urlChanged} to assert the effect you intended.'
            : '');
      return make('unverifiable', false, candidate * UNVERIFIABLE_FACTOR, reason);
    }
    // Rule 9: verified.
    let reason: string;
    if (!builtIn && anyExpectPass) {
      reason = `Action execution verified successfully with confidence ${candidate.toFixed(2)}`;
    } else if (!builtIn) {
      reason =
        `'${type}' has a built-in post-condition check (verified inside the action itself before it could ` +
        `report success) — confidence ${candidate.toFixed(2)}`;
    } else if (bi.outcome === 'pass') {
      const met = orderedExpect.filter((c) => c.outcome === 'pass').map((c) => c.check.replace('expect.', ''));
      reason = `'${type}' verified: ${bi.reason}${met.length > 0 ? ` Expectations met: ${met.join(', ')}.` : ''}`;
    } else {
      // The action's own check could not run (not-run) and a caller expectation passed: say both.
      const met = orderedExpect.filter((c) => c.outcome === 'pass').map((c) => c.check.replace('expect.', ''));
      reason =
        `'${type}' verified by expectation only: its built-in post-condition check could not run: ${bi.reason}.` +
        (met.length > 0 ? ` Expectations met: ${met.join(', ')}.` : '');
    }
    return make('verified', true, candidate * VERIFIED_FACTOR, reason);
  }
}
