/**
 * @file packages/browser/src/actions/action-types.ts
 * @description Parameter schemas, result DTOs, and type definitions for the Browser Action Engine.
 */

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

/** Optional expectations an action's caller can assert; checked post-hoc by {@link ExecutionVerifier}. */
export interface VerificationSpec {
  readonly expectedUrlSubstring?: string;
  readonly expectedElementText?: string;
  readonly shouldUrlChange?: boolean;
  readonly candidateConfidence?: number;
}

/** Result of an {@link ExecutionVerifier} check, attached to {@link ActionResultDto.verification}. */
export interface VerificationResultDto {
  readonly verified: boolean;
  readonly urlChanged: boolean;
  readonly elementFound: boolean;
  readonly confidence: number;
  readonly reason: string;
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
  /** Destination directory for 'download_file'. Defaults to the OS temp directory. */
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
