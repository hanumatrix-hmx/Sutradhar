/**
 * @file packages/browser/src/actions/action-types.ts
 * @description Parameter schemas, result DTOs, and type definitions for the Browser Action Engine.
 */

/**
 * GAP-134/135 (FR2-01 audit-6, closed by the GAP-132-fix round): the exact message fragments
 * `BrowserActionEngine`'s `wait_for_selector`/`state:'hidden'` path uses to distinguish a
 * genuinely CONFIRMED-visible timeout from every other outcome (an honest "couldn't verify"
 * timeout, or a hard failure — tab/session/target closed — wrapped by the `wait_for_selector
 * failed waiting for state=hidden: ...` prefix). These are exported so `@sutradhar/mcp-server`'s
 * `ERROR_HINTS` table can match/exclude against the SAME literal strings the engine actually
 * produces, instead of a hand-maintained copy that can silently drift out of sync with the
 * engine's real wording (exactly what happened to GAP-135: the old exclusion list referenced a
 * phrase — "could not determine" — the engine never actually emits, which is "could not be
 * determined").
 */
export const WAIT_HIDDEN_CONFIRMED_VISIBLE_FRAGMENT = 'is still visible';
export const WAIT_HIDDEN_COULD_NOT_VERIFY_FRAGMENT = 'could not verify: one or more frames were unresponsive';
/** The prefix `wait_for_selector`'s `state:'hidden'` path uses to wrap a HARD failure (tab
 *  closed, session closed, target closed, a genuine per-frame throw) — as opposed to a real
 *  timeout, whose messages always start with `wait_for_selector timed out after`. A hard
 *  failure must never be read as a confirmed-visible timeout, no matter what text the wrapped
 *  underlying error happens to contain. */
export const WAIT_HIDDEN_HARD_FAILURE_PREFIX = 'wait_for_selector failed waiting for state=hidden:';
/** Message thrown when a `wait_for_selector` check discovers, via `Page.isClosed()`'s own
 *  synchronous and definitive signal (not an inferred error-text guess), that the tab itself
 *  closed mid-check — GAP-132's fix. Exported so tests (and any future caller that wants to
 *  special-case this specific failure) can assert against the exact wording without duplicating
 *  the literal string. */
export const TAB_CLOSED_MID_WAIT_MESSAGE = 'Tab was closed while wait_for_selector was checking its state.';

export type ActionType =
  | 'navigate'
  | 'click'
  | 'click_by_text'
  | 'click_by_role'
  | 'type'
  | 'type_by_label'
  | 'press_key'
  | 'scroll'
  | 'wait'
  | 'wait_for_selector'
  | 'select_option'
  | 'hover'
  | 'focus'
  | 'take_screenshot'
  | 'download_file'
  | 'upload_file'
  | 'drag_and_drop'
  | 'touch_tap';

/** Element state 'wait_for_selector' waits for. See BrowserActionEngine for the exact visibility test. */
export type WaitForSelectorState = 'visible' | 'attached' | 'hidden';

/** Optional expectations an action's caller can assert; checked post-hoc by {@link ExecutionVerifier}. */
export interface VerificationSpec {
  readonly expectedUrlSubstring?: string;
  /** Must appear in the page's RENDERED text (any live frame, open shadow roots): laid out, `visibility:visible`,
   *  not under `display:none` / `content-visibility:hidden` / a closed `<details>`, and every enclosing `<iframe>`
   *  rendered and visible. `opacity:0`, `aria-hidden`, off-screen and clipped text still count. FR2-07: this used
   *  to be `textContent`, which counted `display:none` and `<script>` text. */
  readonly expectedElementText?: string;
  /** true: the URL must differ from the pre-action URL. false (FR2-07): the URL must be
   *  identical (it used to be silently ignored). undefined: not checked. */
  readonly shouldUrlChange?: boolean;
  readonly candidateConfidence?: number;
}

/** How a verification was concluded (FR2-07). Callers branch on this, not on the confidence number. */
export type VerificationTier =
  | 'verified' // at least one real post-condition check passed and none failed
  | 'contradicted' // a check ran and found the effect did NOT happen (built-in or expect.*)
  | 'unverifiable' // no real check could run (the reason says exactly why)
  | 'low-confidence' // the caller's candidateConfidence is below 0.5 (pre-existing gate)
  | 'action-failed'; // success:false — nothing to verify; expect.* checks are 'not-run'

export type EvidenceOutcome = 'pass' | 'fail' | 'not-run';
export type EvidenceScalar = string | number | boolean | null;

export interface EvidenceCheck {
  /** Stable id: `<actionType>.<name>` for built-in checks, `expect.text|expect.url|expect.urlChanged`
   *  for caller expectations. Ids are part of the public contract. */
  readonly check: string;
  readonly outcome: EvidenceOutcome;
  /** Strings are capped at 200 chars ('…' suffix). */
  readonly expected?: EvidenceScalar;
  /** NEVER a field value or clipboard content (FR2-07 D11). */
  readonly observed?: EvidenceScalar;
  /** One sentence, capped at 300 chars. */
  readonly detail?: string;
}

export interface VerificationEvidence {
  readonly tier: VerificationTier;
  /** At most 8, built-in checks first (record order), then expect.* (text, url, urlChanged). */
  readonly checks: readonly EvidenceCheck[];
}

/** Result of an {@link ExecutionVerifier} check, attached to {@link ActionResultDto.verification}. */
export interface VerificationResultDto {
  readonly verified: boolean;
  readonly urlChanged: boolean;
  readonly elementFound: boolean;
  readonly confidence: number;
  readonly reason: string;
  /** FR2-07: what was actually checked and what was observed. */
  readonly evidence: VerificationEvidence;
}

/** The engine's {@link ActionType} plus the runtime-level actions that bypass the engine. */
export type VerifiableActionType =
  | ActionType
  | 'go_back'
  | 'go_forward'
  | 'reload'
  | 'click_at_point'
  | 'drag_at_points'
  | 'set_clipboard'
  | 'get_clipboard'
  | 'upload_file_via_trigger'
  | 'screenshot';

/** A built-in post-condition's conclusion, produced by the dispatch path and consumed by the verifier. */
export interface BuiltInVerdict {
  readonly outcome: EvidenceOutcome; // pass | fail | not-run
  /** The <why>/<what> sentence, WITHOUT the `'<type>' ...` prefix. */
  readonly reason: string;
  readonly checks: readonly EvidenceCheck[];
}

export interface ActionParams {
  readonly actionType: ActionType;
  readonly url?: string;
  readonly selector?: string;
  readonly text?: string;
  readonly role?: string;
  readonly name?: string;
  readonly label?: string;
  readonly value?: string;
  readonly key?: string;
  /** Modifier keys held down for the duration of 'press_key' or 'click' (e.g. Ctrl+click,
   *  Shift+click, Ctrl+A). Order doesn't matter; each is pressed before and released after
   *  the underlying action. */
  readonly modifiers?: readonly ('Control' | 'Shift' | 'Alt' | 'Meta')[];
  readonly direction?: 'up' | 'down' | 'top' | 'bottom';
  readonly amount?: number;
  readonly milliseconds?: number;
  readonly options?: readonly string[];
  /** Multiple values to select on a `<select multiple>` for 'select_option'. Takes precedence
   *  over `value` when both are given. */
  readonly values?: readonly string[];
  readonly tabId?: string;
  readonly filePath?: string;
  readonly fullPage?: boolean;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Mouse button for 'click' — defaults to 'left'. */
  readonly button?: 'left' | 'right' | 'middle';
  /** Click/hover at a specific point within the target element's bounding box, relative to its
   *  top-left corner, instead of the default (its center). Needed to interact with
   *  canvas-rendered UI, where the element itself (e.g. a `<canvas>`) has no sub-selectors for
   *  the thing actually drawn inside it — the only way in is a precise pixel offset. */
  readonly offset?: { readonly x: number; readonly y: number };
  /** Drop-target selector for 'drag_and_drop' (source is `selector`). */
  readonly targetSelector?: string;
  /** Destination directory for 'download_file'. Must resolve inside an allowed download root
   *  (symlinks/junctions followed, and case-corrected against the real on-disk directory — see
   *  `path-containment.ts`'s `findContainingRoot`); an outside path is rejected. Defaults to the
   *  first allowed download root, which itself defaults to `<os.tmpdir()>/sutradhar-downloads`
   *  (NOT the bare OS temp directory) unless the operator configured otherwise. */
  readonly downloadDir?: string;
  /** Owning session id, used only for event-bus correlation. */
  readonly sessionId?: string;
  /** Optional post-action expectations, checked by {@link ExecutionVerifier}. */
  readonly verificationSpec?: VerificationSpec;
  /**
   * Opt-in post-action settle wait — after the action itself completes (and before
   * verification runs), wait for the page to stop actively changing: no DOM mutations for
   * `mutationQuietMs`, and no in-flight network requests for `networkIdleMs`, both checked in
   * parallel and bounded by `timeoutMs` overall. `true` uses the defaults ({@link
   * DEFAULT_SETTLE_SPEC}); an object overrides individual fields. Off by default — most
   * actions don't need it and it adds real latency, so this is deliberately opt-in per call,
   * not a blanket auto-wait. See INSIGHTS.md Insight 2: "flakiness lives at state transitions,
   * not at actions... a built-in post-action settle would make first-run reliability equal
   * retry reliability."
   */
  readonly settle?: boolean | SettleSpec;
  /** Element state to wait for. Only meaningful for 'wait_for_selector'. Default 'visible'. */
  readonly state?: WaitForSelectorState;
}

export interface SettleSpec {
  /** No DOM mutations observed for this long counts as "DOM quiet". */
  readonly mutationQuietMs?: number;
  /** No in-flight network requests for this long counts as "network idle". */
  readonly networkIdleMs?: number;
  /** Overall bound — a page with continuous background chatter (ads, polling, a live ticker)
   *  will never go quiet on its own, so this guarantees the wait falls through instead of
   *  hanging indefinitely. Not an error if reached — it just means "waited as long as asked,
   *  the page may still be settling." */
  readonly timeoutMs?: number;
}

export interface ActionResultDto {
  readonly success: boolean;
  readonly actionType: ActionType;
  readonly executionTimeMs: number;
  readonly currentUrl?: string;
  readonly title?: string;
  readonly outputData?: Record<string, unknown>;
  readonly error?: string;
  readonly retriesUsed?: number;
  /** Post-action verification signal — did the action's observable effect match expectations? */
  readonly verification?: VerificationResultDto;
  /** Base64 PNG captured automatically when the action ultimately failed, for debugging. */
  readonly failureScreenshot?: string;
}
