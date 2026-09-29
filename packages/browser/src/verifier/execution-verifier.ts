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
 * In-page (self-contained; serialised by Puppeteer): does the VISIBLE text of this document
 * contain `t`? `innerText` excludes `display:none`, `<script>` and `<style>` text. Open shadow
 * roots are searched recursively through their child elements' `innerText`.
 *
 * `innerText` of a node that is NOT RENDERED falls back to its `textContent` (the text of a
 * `display:none` shadow host's shadow tree, or of a `display:none` iframe's body, would otherwise
 * count as "visible"), so every candidate match is confirmed rendered: no ancestor along the FLAT
 * tree (parent element, else shadow host, else the embedding `<iframe>` element when same-origin)
 * has `display:none` or, above the node itself, `content-visibility:hidden`; and the document
 * itself has a box (a frame that is display:none — including a cross-origin one whose embedding
 * element we cannot reach — has no layout, so its `documentElement` has no client rects).
 * Confirmation runs only on a text match, so the cost is bounded by the number of matches.
 * (`checkVisibility()` is deliberately not used: it reports false for `display:contents` hosts
 * whose children ARE rendered.)
 */
export function visibleTextContainsInPage(t: string): boolean {
  const styleOf = (e: Element): { display: string; contentVisibility?: string } | undefined => {
    try {
      const w: Window = (e.ownerDocument && e.ownerDocument.defaultView) || window;
      return w.getComputedStyle(e) as unknown as { display: string; contentVisibility?: string };
    } catch {
      return undefined;
    }
  };
  const rendered = (start: Element): boolean => {
    const de = document.documentElement as HTMLElement | null;
    if (de && typeof de.getClientRects === 'function' && de.getClientRects().length === 0) return false;
    let e: Element | null = start;
    for (let guard = 0; e && guard < 10000; guard++) {
      const cs = styleOf(e);
      if (cs && (cs.display === 'none' || (e !== start && cs.contentVisibility === 'hidden'))) return false;
      let next: Element | null = e.parentElement;
      if (!next) {
        const root: (Node & { host?: Element }) | undefined =
          typeof e.getRootNode === 'function' ? (e.getRootNode() as Node & { host?: Element }) : undefined;
        if (root && root.host) next = root.host;
        else {
          try {
            const w: Window = (e.ownerDocument && e.ownerDocument.defaultView) || window;
            next = (w.frameElement as Element | null) ?? null;
          } catch {
            next = null;
          }
        }
      }
      e = next;
    }
    return true;
  };
  const body = document.body as HTMLElement | null;
  if (body && typeof body.innerText === 'string' && body.innerText.includes(t) && rendered(body)) return true;
  const walk = (root: ParentNode): boolean => {
    const all = Array.from(root.querySelectorAll('*'));
    for (const el of all) {
      const sr = (el as HTMLElement).shadowRoot;
      if (!sr) continue;
      for (const child of Array.from(sr.children)) {
        const it = (child as HTMLElement).innerText;
        if (typeof it === 'string' && it.includes(t) && rendered(child)) return true;
      }
      if (walk(sr)) return true;
    }
    return false;
  };
  return walk(document);
}

/**
 * Best-effort, BOUNDED check that `text` appears in the page's visible text — any live frame
 * (main first), including open shadow roots. Never uses `page.evaluate` (a pending dialog freezes
 * the main thread: it would hang until the 30 s auto-dismiss), so every evaluation goes through a
 * frame and the whole loop races {@link EXPECT_TEXT_TIMEOUT_MS}.
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
    let failed = 0;
    let anyFound = false;
    await Promise.all(
      frames.map(async (f) => {
        try {
          if (await f.evaluate(visibleTextContainsInPage, text)) anyFound = true;
        } catch {
          failed++;
        }
      }),
    );
    if (anyFound) return { result: 'found' };
    if (failed > 0) return { result: 'unavailable', detail: `${failed} of ${frames.length} frames could not be inspected` };
    return { result: 'not-found' };
  };
  const r = await bounded(run(), EXPECT_TEXT_TIMEOUT_MS);
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
