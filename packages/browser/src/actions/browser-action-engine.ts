/**
 * @file packages/browser/src/actions/browser-action-engine.ts
 * @description Core BrowserActionEngine executing 19 browser actions with retries, timeout, and event emission.
 *
 * Every selector-targeted action resolves its target across the page's frames (iframes, at
 * any nesting depth) and through open shadow roots within each frame — see {@link resolveElement}.
 */

import path from 'node:path';
import { access } from 'node:fs/promises';
import { EventBus } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';
import { SessionId } from '@sutradhar/contracts';
import { Browser, CDPSession, ElementHandle, Frame, KeyInput, Page } from 'puppeteer-core';
import { IBrowserTab } from '../session/browser-tab.js';
import { ExecutionVerifier } from '../verifier/execution-verifier.js';
import { SD_GENERATION_ATTR, SD_CURRENT_GENERATION_ATTR, SD_FINGERPRINT_ATTR } from '../dom/dom-semantic-engine.js';
import { defaultDownloadRoot, findContainingRoot, isPathWithinRoot } from './path-containment.js';
import { acquireDownloadLock } from './download-lock.js';
import {
  ActionParams,
  ActionResultDto,
  SettleSpec,
  WaitForSelectorState,
  TAB_CLOSED_MID_WAIT_MESSAGE,
  WAIT_HIDDEN_HARD_FAILURE_PREFIX,
  WAIT_HIDDEN_COULD_NOT_VERIFY_FRAGMENT,
  WAIT_HIDDEN_CONFIRMED_VISIBLE_FRAGMENT,
} from './action-types.js';
import {
  invalidSelectorSyntaxError,
  selectorProbeTarget,
  selectorSyntaxProbeInPage,
  toPuppeteerQuery,
  SELECTOR_SYNTAX_PROBE_TIMEOUT_MS,
  type SelectorProbeTarget,
} from './selector-dialect.js';

export interface IBrowserActionEngine {
  executeAction(tab: IBrowserTab, params: ActionParams): Promise<ActionResultDto>;
}

/** Action types that mutate page state — subject to the duplicate-action guard.
 *
 *  `press_key` is deliberately NOT included (see PROB-037): the guard's `target` derivation
 *  falls through to the raw key name (`params.key`) when there's no selector/role/text, which
 *  made every repeated press of the SAME key within 1000ms — regardless of what element is
 *  currently focused — look identical to the guard, and get silently rejected as an "accidental
 *  double-dispatch". That's backwards for keyboard input specifically: repeatedly pressing the
 *  same key (Tab-Tab-Tab through a form, ArrowDown-ArrowDown through a dropdown, Backspace-
 *  Backspace to clear several characters) is one of the most common, completely legitimate
 *  keyboard-navigation patterns there is — unlike a click or type, which really do carry a
 *  meaningful "target" a rapid repeat on could plausibly be an accidental double-submit of.
 *  Found live: a real Tab-Tab-Tab flow through a 2-field form moved focus correctly on the
 *  first Tab, then silently got stuck on the second field for every subsequent Tab press. */
const MUTATING_ACTIONS = new Set([
  'click',
  'click_by_text',
  'click_by_role',
  'type',
  'type_by_label',
  'select_option',
  'upload_file',
  'drag_and_drop',
  'touch_tap',
  'download_file',
]);

/** How long a (tab, actionType, target) combination is remembered to guard against accidental
 *  rapid double-dispatch (e.g. a submit button clicked twice in quick succession). */
const DUPLICATE_ACTION_WINDOW_MS = 1000;

/** Bounded grace period the retry loop waits for a timed-out dispatch to settle on its own
 *  before starting a new attempt — prevents two concurrent dispatches (e.g. two `clearAndType`
 *  calls) from interleaving on the same element. Best-effort, not a guarantee: a dispatch that
 *  takes even longer than this to actually finish will still race against a fresh retry. */
const TIMEOUT_SETTLEMENT_GRACE_MS = 2000;

/** Extra time the outer per-attempt race (`executeActionSerialized`) grants `wait_for_selector`
 *  specifically, on top of its own `timeoutMs`. Without this, a caller-supplied `timeoutMs` sizes
 *  BOTH the inner state-aware wait AND the outer generic race identically, so they finish at
 *  effectively the same instant — and the outer race, which names no state, usually wins,
 *  producing the old undiagnostic `Action wait_for_selector timed out after Xms` instead of the
 *  state-naming message the inner wait would have produced a moment later (FR2-01). */
let WAIT_FOR_SELECTOR_OUTER_GRACE_MS = 2000;

/** Test-only hook (FR2-01 fix-1, GAP-013): lets a unit test temporarily zero out the grace
 *  period to PROVE a test actually depends on it (by showing the test fails without it), then
 *  restore the real value. Not re-exported from the package's public `index.ts`, and not part
 *  of the engine's public surface — imported directly from this module path by the spec file. */
export function __TEST_ONLY_setWaitForSelectorOuterGraceMs(ms: number): number {
  const previous = WAIT_FOR_SELECTOR_OUTER_GRACE_MS;
  WAIT_FOR_SELECTOR_OUTER_GRACE_MS = ms;
  return previous;
}

/** Hard cap (GAP-010) on the best-effort failure screenshot in {@link executeActionSerialized}.
 *  Found live during FR2-01 audit-1: a screenshot attempt against a backgrounded/non-foreground
 *  tab can hang far longer than any reasonable "best effort" — up to the CDP protocol timeout
 *  (~180s) — turning an already-failed action into a multi-minute stall. The screenshot is
 *  diagnostic-only, so racing it against this bound and skipping it (with a logged warning) on
 *  timeout is strictly better than blocking the actual result on it. */
const FAILURE_SCREENSHOT_TIMEOUT_MS = 3000;

/** GAP-030 (FR2-01 audit-2): the bound a SINGLE frame's probe (`frame.$(...)`) gets within one
 *  poll pass of {@link pierceFirstMatch}, before that pass treats the frame as "no match yet"
 *  and moves on. Without this, one busy/unresponsive cross-origin (out-of-process) iframe — a
 *  synchronous-blocking script, a hung renderer — stalls the CDP round-trip for that frame
 *  indefinitely, which stalls detecting an ALREADY-satisfied condition in every other, healthy
 *  frame on the very same poll pass. A frame that times out here is retried on the next pass
 *  (never permanently excluded), since a busy frame commonly recovers. Reproduced live:
 *  audit-2/probe-busy-oopif-2s.mjs / probe-busy-oopif.mjs. */
const FRAME_PROBE_TIMEOUT_MS = 250;

/** Unique sentinel {@link raceFrameProbe} resolves its timeout branch to, distinguishing "the
 *  probe timed out" from a legitimate `null` (genuinely no match) result of the real probe. */
const FRAME_PROBE_TIMED_OUT = Symbol('frame-probe-timed-out');

/** Unique sentinel {@link raceBounded} resolves to on timeout — the general-purpose counterpart
 *  of {@link FRAME_PROBE_TIMED_OUT} for probes that don't return a disposable `ElementHandle`
 *  (a plain boolean visibility check, a `$$eval` array, etc.), so those callers don't need
 *  {@link raceFrameProbe}'s handle-dispose-on-late-resolve machinery. */
const BOUNDED_TIMED_OUT = Symbol('bounded-probe-timed-out');

/**
 * GAP-057 (FR2-01 audit-3): the shared tri-state outcome of ANY bounded, per-frame probe in this
 * file's `wait_for_selector` code path. A probe against one frame genuinely has THREE possible
 * outcomes — it found a match ('match'), it definitively found no match ('no-match'), or it
 * simply didn't answer within its own bound because the frame was busy ('unknown') — and every
 * place that reduces a set of per-frame probes to a single yes/no verdict MUST keep 'unknown' as
 * its own state all the way through, rather than collapsing it into either of the other two.
 *
 * Collapsing 'unknown' into 'no-match' is exactly what caused GAP-057: `isHiddenInEveryFrame`
 * read a busy frame's probe timeout as "no match in this frame", which is indistinguishable from
 * "this frame confirms not-visible" for the `hidden` state's all-frames-must-agree rule — so a
 * `hidden` wait could fully "agree" and report FALSE SUCCESS while the element was still visible
 * in the one frame that never got to answer. Collapsing 'unknown' into 'match' would be just as
 * wrong the other direction (a false failure/false "still visible"). Neither collapse is safe;
 * only treating it as its own state — "try again next pass, don't conclude anything from this
 * frame yet" — is.
 */
type FrameProbeVerdict =
  | { readonly kind: 'match'; readonly handle: ElementHandle<Element> }
  | { readonly kind: 'no-match' }
  | { readonly kind: 'unknown' };

/** The all-frames-considered verdict {@link BrowserActionEngine.isHiddenInEveryFrame} produces
 *  for one pass: 'hidden' (every live frame explicitly confirmed no-match/not-visible),
 *  'visible' (some frame explicitly confirmed a visible match — a definitive answer, since
 *  `hidden` requires every frame to agree), or 'unknown' (no frame confirmed visible, but at
 *  least one frame's probe timed out rather than confirming no-match — GAP-057: this must NEVER
 *  be treated the same as 'hidden'). */
type FrameSetHiddenVerdict = 'hidden' | 'visible' | 'unknown';

/**
 * GAP-081/GAP-086 (FR2-01 fix-4): the tri-state result of {@link BrowserActionEngine.isHandleVisible}
 * checking a single, already-resolved handle. Mirrors {@link FrameProbeVerdict}'s reasoning one
 * level down — a visibility check on a handle genuinely has three outcomes: it confirms visible,
 * it confirms not-visible (a real computed-style/bounding-box read that says so), or it simply
 * couldn't tell (the check itself timed out, or the tab/session closed mid-check). Before this
 * fix, `isHandleVisible`'s `.catch(() => false)` conflated ALL of those into "not visible",
 * including a tab-closed/session-closed error — exactly GAP-031's bug surviving one call deeper,
 * inside the very function fix-3 rewrote to fix it at the frame level.
 */
type HandleVisibilityVerdict = 'visible' | 'not-visible' | 'unknown';

/** GAP-032 (FR2-01 audit-2): a `timeoutMs` this large no longer fits in Node's/CDP's own
 *  32-bit-signed-int `setTimeout` delay range (2**31 - 1 ms, ~24.8 days) and gets silently
 *  clamped to fire almost immediately by the runtime — producing exactly the "outer deadline
 *  fires almost immediately while the inner poll loop's deadline never really arrives" mismatch
 *  the gap describes. Any finite `timeoutMs` above this is clamped down to it rather than
 *  trusted as-is. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Defaults for {@link ActionParams.settle} when passed as `true` instead of a full spec. */
const DEFAULT_SETTLE_SPEC: Required<SettleSpec> = {
  mutationQuietMs: 300,
  networkIdleMs: 500,
  timeoutMs: 5000,
};

export class BrowserActionEngine implements IBrowserActionEngine {
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;
  private readonly verifier: ExecutionVerifier;
  /** key: `${tabId}:${actionType}:${target}` -> last-dispatched timestamp. */
  private readonly recentActions = new Map<string, number>();
  /** Directories a 'download_file' action is allowed to write into (each resolved to an
   *  absolute path). Defaults to a dedicated subdirectory of the OS temp directory — NOT the
   *  bare temp root itself. Found live: Chrome's `Browser.downloadProgress` reports
   *  `state:'canceled'` for a download targeted directly at the OS temp root (e.g.
   *  `C:\WINDOWS\TEMP` on Windows) every time, while the identical download into any
   *  subdirectory of that same root succeeds — the exact same page, click, and CDP wiring, only
   *  the target directory differs. CDP creates a non-existent target directory automatically, so
   *  no separate `mkdir` is needed here. A caller-supplied `downloadDir` that doesn't resolve
   *  under one of these is rejected rather than trusted blindly, since it ultimately reaches
   *  CDP's `Browser.setDownloadBehavior` as a real filesystem write target. */
  private readonly allowedDownloadRoots: readonly string[];
  /** Directories an 'upload_file' action is allowed to read from, each resolved to an
   *  absolute path. Unset (the default) means unrestricted — uploading an arbitrary local
   *  file the caller specifies is the intended feature, unlike downloads (which write NEW
   *  files and so default-sandbox to the OS temp dir). Configure this when the calling LLM
   *  is untrusted enough that an attacker-controlled page could plausibly talk it into
   *  uploading a sensitive file (e.g. via prompt injection in page content). */
  private readonly allowedUploadRoots?: readonly string[];
  /** key: tabId -> a promise that resolves once every action queued against that tab so far
   *  has finished. Two concurrent `executeAction` calls against the SAME tab would otherwise
   *  interleave their CDP calls against one Puppeteer `Page` — nondeterministic and hard to
   *  debug (a `type` racing a `navigate`, for instance). Different tabs are never serialized
   *  against each other. */
  private readonly tabQueues = new Map<string, Promise<unknown>>();
  /**
   * key: the real Puppeteer `Browser` object -> a lazily-created, NEVER-DETACHED CDP session
   * dedicated to that browser's download behavior (`Browser.setDownloadBehavior`,
   * `Browser.downloadWillBegin`/`downloadProgress`).
   *
   * FR2-05 audit-2 (GAP-301, cause 1, live-confirmed): fix-1 created a FRESH `CDPSession` per
   * `download_file` call and `client.detach()`ed it in the `finally` block, right after
   * resetting `Browser.setDownloadBehavior` to `'deny'`. Live-tested end-to-end: after a
   * successful `download_file`, a plain, unrelated `browser.click` on a download link still
   * landed the file in the real OS Downloads folder 3/3 — the `'deny'` reset did not stick.
   * Root cause: detaching the session that last configured `Browser.setDownloadBehavior`
   * appears to make Chrome silently revert that browser-wide setting to its own platform
   * default, undoing the reset moments after it "succeeded". fix-1's own code comment claiming
   * the reset "fails closed" was therefore false in practice.
   *
   * The fix is structural, not another reset: keep ONE CDP session per browser instance for
   * download-behavior management and never detach it for the lifetime of that browser (Chrome/
   * Puppeteer detaches it automatically when the browser itself closes) — so there is no
   * detach event to trigger Chrome's own reversion, ever.
   */
  private readonly downloadSessions = new WeakMap<object, Promise<CDPSession>>();

  public constructor(
    eventBus?: EventBus,
    logger?: StructuredLogger,
    verifier?: ExecutionVerifier,
    allowedDownloadRoots?: readonly string[],
    allowedUploadRoots?: readonly string[],
  ) {
    this.eventBus = eventBus;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
    this.verifier = verifier ?? new ExecutionVerifier();
    this.allowedDownloadRoots = (allowedDownloadRoots?.length ? allowedDownloadRoots : [defaultDownloadRoot()]).map(
      (root) => path.resolve(root),
    );
    this.allowedUploadRoots = allowedUploadRoots?.map((root) => path.resolve(root));
  }

  /**
   * Confirms `filePath` exists and, when {@link allowedUploadRoots} is configured, that it
   * falls within one of those roots (symlink-resolved the same way {@link resolveDownloadDir}
   * checks download destinations) before it's handed to Puppeteer's `uploadFile`/file-chooser
   * APIs — which read the file and hand its contents to the page.
   */
  private async assertUploadPathAllowed(filePath: string): Promise<void> {
    const resolved = path.resolve(filePath);
    try {
      await access(resolved);
    } catch {
      throw new Error(`Upload file "${filePath}" does not exist or is not accessible.`);
    }

    if (!this.allowedUploadRoots || this.allowedUploadRoots.length === 0) return;

    let hit: string | undefined;
    let why = '';
    try {
      hit = await findContainingRoot(resolved, this.allowedUploadRoots);
    } catch (e) {
      why = `: ${(e as Error).message}`;
    }
    if (hit) return;
    throw new Error(
      `Upload file "${filePath}" is outside the allowed upload directories ` +
        `(${this.allowedUploadRoots.join(', ')})${why}.`,
    );
  }

  /**
   * Resolve the requested download directory (defaulting to the first allowed root when none
   * is given) and reject it outright if it doesn't fall under one of {@link allowedDownloadRoots}
   * — prevents an MCP caller from directing a real CDP download to an arbitrary filesystem
   * location.
   *
   * Containment is checked against the REAL (symlink/junction-resolved, and — since FR2-05
   * fix-2, GAP-300 — on-disk-case-corrected) path of both the requested directory and each
   * allowed root, not just the literal string. This goes through {@link findContainingRoot},
   * which walks up to the deepest EXISTING ancestor for a not-yet-created target (rather than
   * falling back to the literal string the moment the full path doesn't exist — the original
   * B2/GAP-294 bug, which let a link with a nonexistent tail escape), and which compares
   * segments case-sensitively whenever the real on-disk directory is confirmed case-sensitive
   * (GAP-300 — a folder can be marked case-sensitive without admin rights, e.g. WSL-created
   * ones default to it, and a blanket case-insensitive assumption let `root` vs `ROOT` escape).
   */
  private async resolveDownloadDir(requested: string | undefined): Promise<string> {
    const resolved = requested ? path.resolve(requested) : this.allowedDownloadRoots[0]!;

    let hit: string | undefined;
    let why = '';
    try {
      hit = await findContainingRoot(resolved, this.allowedDownloadRoots);
    } catch (e) {
      why = `: ${(e as Error).message}`;
    }
    if (hit) return resolved; // CDP still gets `resolved`, not the canonical form (D3)

    throw new Error(
      `downloadDir "${requested ?? resolved}" is outside the allowed download directories ` +
        `(${this.allowedDownloadRoots.join(', ')})${why}. Pass a path under one of these, or configure more ` +
        'roots (SutradharRuntimeOptions.allowedDownloadRoots; SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS for the ' +
        'sutradhar-mcp server and CLI).',
    );
  }

  public async executeAction(tab: IBrowserTab, params: ActionParams): Promise<ActionResultDto> {
    // Chain onto whatever's already queued for this tab so overlapping calls serialize
    // instead of interleaving CDP calls against the same Page. `.catch(() => {})` on the
    // predecessor means one call failing never blocks the next one from starting.
    const previous = this.tabQueues.get(tab.id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.executeActionSerialized(tab, params));
    const settleMarker = run.catch(() => {});
    this.tabQueues.set(tab.id, settleMarker);
    // Once this call (and anything chained after it so far) settles, drop the map entry if
    // nothing newer replaced it — keeps `tabQueues` from growing unbounded across a long
    // process lifetime with many tabs opened and closed over time.
    void settleMarker.finally(() => {
      if (this.tabQueues.get(tab.id) === settleMarker) {
        this.tabQueues.delete(tab.id);
      }
    });
    return run;
  }

  private async executeActionSerialized(tab: IBrowserTab, params: ActionParams): Promise<ActionResultDto> {
    // FR2-06: one browser-side parse of every CALLER selector, before the duplicate guard (a
    // rejected selector must not occupy the duplicate window) and before the retry loop (never
    // retried, never counted against timeoutMs).
    const invalidSelector = await this.rejectInvalidCallerSelector(tab, params);
    if (invalidSelector) {
      return invalidSelector;
    }
    const duplicateError = this.checkDuplicateAction(tab.id, params);
    if (duplicateError) {
      return duplicateError;
    }
    // GAP-032: validate `timeoutMs` at the boundary, before it can reach ANY poll loop or
    // `setTimeout` call below (the outer race's own `timeoutMs` computed right here, or the
    // per-state inner waits `wait_for_selector` dispatches to) — see {@link checkInvalidTimeoutMs}.
    const timeoutMsError = this.checkInvalidTimeoutMs(params);
    if (timeoutMsError) {
      return timeoutMsError;
    }

    const startTime = Date.now();
    const sanitizedTimeoutMs = BrowserActionEngine.sanitizeTimeoutMs(params.timeoutMs);
    // `wait_for_selector` gets a grace period on top of its own `timeoutMs` here so its inner,
    // state-naming wait (which uses the same `timeoutMs`) finishes and throws its own diagnostic
    // error BEFORE this outer race's generic timeout can win instead — see
    // WAIT_FOR_SELECTOR_OUTER_GRACE_MS. The final `Math.min(MAX_TIMEOUT_MS, ...)` re-clamps
    // AFTER adding that grace period too — an already-clamped `sanitizedTimeoutMs` plus
    // `WAIT_FOR_SELECTOR_OUTER_GRACE_MS` could otherwise creep back over Node's own `setTimeout`
    // ceiling (GAP-032).
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      params.actionType === 'wait_for_selector'
        ? Math.max(1, sanitizedTimeoutMs ?? 10000) + WAIT_FOR_SELECTOR_OUTER_GRACE_MS
        : sanitizedTimeoutMs ?? 15000,
    );
    // GAP-058 (FR2-01 audit-3): `wait_for_selector` with `timeoutMs <= 0` documents "check once,
    // don't wait or retry" (GAP-011/GAP-036) — but that contract lives entirely in
    // `checkWaitForSelectorOnce`'s own single-pass logic, and this OUTER retry loop had no idea
    // about it: it still applied the ordinary `maxRetries ?? 2` default, so a "check once"
    // failure got retried up to 2 more times anyway (confirmed live: retriesUsed:2, ~1.5s total
    // for a call documented as instantaneous). A caller-supplied `params.maxRetries` is still
    // honored as an explicit override either way — this only replaces the *default* of 2 with 0
    // specifically for this one documented case.
    const maxRetries =
      params.maxRetries ??
      (params.actionType === 'wait_for_selector' && params.timeoutMs !== undefined && params.timeoutMs <= 0 ? 0 : 2);
    const previousUrl = tab.url;
    let attempt = 0;
    let lastError: Error | undefined;

    this.logger.info(`[BrowserActionEngine] Executing action ${params.actionType}`, {
      tabId: tab.id,
      url: params.url,
      selector: params.selector,
      text: params.text,
    });

    // Tracks the most recently dispatched `dispatchAction` call so a timeout can await its real
    // settlement (bounded) before the loop starts a second, concurrent one — see the catch
    // block below for why this matters.
    let inFlightDispatch: Promise<unknown> | undefined;

    while (attempt <= maxRetries) {
      // FR2-05 fix-2 (GAP-301 cause 3): a fresh controller per attempt, so a timed-out attempt's
      // signal can be aborted without affecting a later retry's own dispatch.
      const abortController = new AbortController();
      let dispatchSettled = false;
      try {
        const dispatchPromise = this.dispatchAction(tab, params, abortController.signal);
        dispatchPromise.then(
          () => {
            dispatchSettled = true;
          },
          () => {
            dispatchSettled = true;
          },
        );
        inFlightDispatch = dispatchPromise;
        const resultData = await this.raceWithTimeout(dispatchPromise, params.actionType, timeoutMs);
        if (params.settle && tab.page) {
          const spec = params.settle === true ? DEFAULT_SETTLE_SPEC : { ...DEFAULT_SETTLE_SPEC, ...params.settle };
          await this.waitForSettle(tab.page, spec);
        }
        const executionTimeMs = Date.now() - startTime;

        const result: ActionResultDto = {
          success: true,
          actionType: params.actionType,
          executionTimeMs,
          currentUrl: tab.url,
          title: tab.title,
          outputData: resultData,
          retriesUsed: attempt,
        };
        const verification = await this.verifier.verifyAction(
          tab,
          previousUrl,
          result,
          params.verificationSpec,
        );
        const finalResult: ActionResultDto = { ...result, verification };

        tab.recordAction({
          actionType: params.actionType,
          selector: params.selector,
          success: true,
          executionTimeMs,
          timestamp: new Date().toISOString(),
        });

        if (this.eventBus && params.sessionId) {
          await this.eventBus.publish(
            'browser:action:executed',
            {
              sessionId: params.sessionId as SessionId,
              tabId: tab.id,
              actionType: params.actionType,
              success: true,
              durationMs: executionTimeMs,
            },
            `corr_act_${Date.now()}`,
          );
        }

        return finalResult;
      } catch (err) {
        lastError = err as Error;
        attempt++;

        // A *timeout* failure (as opposed to dispatchAction throwing a real error, which means
        // it already settled) leaves the previous dispatchAction call still running — Promise
        // rejection from the race does not cancel it. Without waiting here, the next loop
        // iteration would start a second, concurrent dispatchAction on the SAME element (e.g.
        // two overlapping `clearAndType` calls interleaving keystrokes) before the first one
        // finishes. Give the in-flight call a bounded grace period to settle on its own before
        // proceeding — this is a best-effort bound, not a guarantee, for the rare case where
        // dispatch takes even longer than that to actually finish.
        const wasTimeout = this.isTimeoutError(lastError, params.actionType);
        if (wasTimeout && inFlightDispatch) {
          await Promise.race([
            inFlightDispatch.catch(() => {}),
            new Promise((r) => setTimeout(r, TIMEOUT_SETTLEMENT_GRACE_MS)),
          ]);
          // FR2-05 fix-2 (GAP-301 cause 3): the grace period elapsed and this dispatch STILL
          // hasn't settled — it's now genuinely abandoned. Abort its signal so `download_file`
          // (the only action type that consults it) stops driving shared browser-wide state in
          // the background instead of running unattended until its own inner timeout, possibly
          // clobbering a later retry's/call's download configuration in the meantime.
          if (!dispatchSettled) {
            abortController.abort();
          }
        }

        this.logger.warn(
          `[BrowserActionEngine] Action ${params.actionType} failed (attempt ${attempt}/${maxRetries + 1}): ${lastError.message}`,
        );
        // FR2-06 (D8): a selector-parse error is deterministic — the browser's own parser will
        // reject the exact same string again on the next attempt, so retrying only wastes the
        // backoff below (and, without this, pierceFirstMatch's syntax-error fast-fail on the
        // 'attached' path would still burn `maxRetries` retries on something that can never
        // succeed).
        if (/is not a valid selector|is not a valid XPath expression/.test(lastError.message)) {
          break;
        }
        if (attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }

    const executionTimeMs = Date.now() - startTime;

    // Capture a debugging screenshot on the way out when the action ultimately failed — best
    // effort only; a page that's mid-navigation or already torn down shouldn't turn a real
    // action failure into a screenshot-capture failure instead.
    let failureScreenshot: string | undefined;
    if (tab.page) {
      try {
        const buf = await Promise.race([
          tab.page.screenshot({ encoding: 'base64' }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`failure screenshot exceeded ${FAILURE_SCREENSHOT_TIMEOUT_MS}ms`)),
              FAILURE_SCREENSHOT_TIMEOUT_MS,
            ),
          ),
        ]);
        failureScreenshot = String(buf);
      } catch (err) {
        // best-effort — leave undefined. GAP-010: a hung screenshot (e.g. a backgrounded tab)
        // must not itself block the already-failed result past FAILURE_SCREENSHOT_TIMEOUT_MS.
        this.logger.warn(
          `[BrowserActionEngine] Skipping failure screenshot: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }

    const failResult: ActionResultDto = {
      success: false,
      actionType: params.actionType,
      executionTimeMs,
      currentUrl: tab.url,
      title: tab.title,
      error: lastError?.message ?? 'Unknown action error',
      retriesUsed: attempt - 1,
      failureScreenshot,
    };
    const verification = await this.verifier.verifyAction(
      tab,
      previousUrl,
      failResult,
      params.verificationSpec,
    );

    tab.recordAction({
      actionType: params.actionType,
      selector: params.selector,
      success: false,
      error: failResult.error,
      executionTimeMs,
      timestamp: new Date().toISOString(),
    });

    return { ...failResult, verification };
  }

  /** Caller-supplied selectors only — never the selectors the engine builds itself for
   *  click_by_text (XPath from free text), click_by_role (aria/ from role+name) or type_by_label
   *  (both plain CSS built from a caller-given LABEL string, not a selector). */
  private static callerSelectorsOf(p: ActionParams): string[] {
    switch (p.actionType) {
      case 'click':
      case 'type':
      case 'wait_for_selector':
      case 'select_option':
      case 'hover':
      case 'focus':
      case 'touch_tap':
      case 'download_file':
      case 'upload_file':
      case 'scroll':
        return p.selector ? [p.selector] : [];
      case 'drag_and_drop':
        return [p.selector, p.targetSelector].filter((s): s is string => !!s);
      default:
        return [];
    }
  }

  /**
   * FR2-06: a single, cheap, browser-side parse of every caller-supplied selector for this
   * action, run once BEFORE the retry loop (so it's never retried) and BEFORE the duplicate
   * guard (so a rejected selector doesn't occupy the duplicate-dispatch window). Returns a
   * failed {@link ActionResultDto} when the browser's own parser DEFINITELY rejects a selector;
   * `undefined` when every selector is valid, or when the probe was inconclusive (no
   * `mainFrame().evaluate`, a pending dialog, a timeout, ...) — in which case today's path
   * (`resolveElement`'s `.catch(() => null)`) is unchanged.
   */
  private async rejectInvalidCallerSelector(
    tab: IBrowserTab,
    params: ActionParams,
  ): Promise<ActionResultDto | undefined> {
    const page = tab.page;
    const selectors = BrowserActionEngine.callerSelectorsOf(params);
    if (!page || selectors.length === 0) return undefined;
    if (tab.getPendingDialog?.()) return undefined; // main-thread evaluate would block on the dialog
    const start = Date.now();
    for (const selector of selectors) {
      const target = selectorProbeTarget(selector);
      if (!target) continue;
      const parserMessage = await this.probeSelectorSyntax(page, target);
      if (parserMessage === null) continue; // valid OR inconclusive -> today's path
      const error = invalidSelectorSyntaxError(selector, parserMessage, { enginePath: true }).message;
      const executionTimeMs = Date.now() - start;
      const failResult: ActionResultDto = {
        success: false,
        actionType: params.actionType,
        executionTimeMs,
        currentUrl: tab.url,
        title: tab.title,
        error,
        retriesUsed: 0, // no failureScreenshot: nothing on the page is relevant to a parse error
      };
      const verification = await this.verifier.verifyAction(tab, tab.url, failResult, params.verificationSpec);
      tab.recordAction({
        actionType: params.actionType,
        selector: params.selector,
        success: false,
        error,
        executionTimeMs,
        timestamp: new Date().toISOString(),
      });
      this.logger.warn(`[BrowserActionEngine] Rejected invalid selector before dispatch: ${error}`);
      return { ...failResult, verification };
    }
    return undefined;
  }

  /**
   * Returns the browser parser's message iff it DEFINITELY rejects the selector; `null` when
   * valid or when the probe can't run/answer in time (never a guess). Bounded by
   * {@link SELECTOR_SYNTAX_PROBE_TIMEOUT_MS} — a busy main thread or a slow/detached frame must
   * never add real latency to an action whose selector turns out to be fine.
   */
  private async probeSelectorSyntax(page: Page, target: SelectorProbeTarget): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const frame = page.mainFrame();
      if (!frame || typeof frame.evaluate !== 'function' || frame.isDetached?.()) return null;
      const probe = frame.evaluate(selectorSyntaxProbeInPage, target.kind, target.expr);
      probe.catch(() => {}); // PROB-015: an abandoned probe (we raced it away below) must never go unhandled
      return await Promise.race([
        probe.then((r) => (typeof r === 'string' ? r : null)),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), SELECTOR_SYNTAX_PROBE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Guard against an accidental rapid double-dispatch of the same mutating action on the same
   * target (e.g. a submit button clicked twice within a second) — a common way a slow response
   * or an over-eager caller-side retry causes a duplicate form submission. Only applies across
   * separate top-level `executeAction` calls; the internal retry loop above is unaffected since
   * this check runs once, before that loop starts.
   */
  private checkDuplicateAction(tabId: string, params: ActionParams): ActionResultDto | undefined {
    if (!MUTATING_ACTIONS.has(params.actionType)) return undefined;

    // `click_by_role`/`click_by_text` carry their real target in `role`/`name`/`text`, not
    // `selector` — omitting them here (found live in the field-report remediation's Phase 1
    // baseline, independently on the SDK and MCP surfaces) collapsed every such call's key to
    // the same `''` target, so two genuinely different role/text clicks on the same tab within
    // DUPLICATE_ACTION_WINDOW_MS were rejected as duplicates of each other.
    const target =
      params.selector ??
      (params.role !== undefined ? `role:${params.role}:${params.name ?? ''}` : undefined) ??
      (params.text !== undefined ? `text:${params.text}` : undefined) ??
      params.key ??
      '';
    const key = `${tabId}:${params.actionType}:${target}`;
    const now = Date.now();

    // Opportunistically prune stale entries so this map never grows unbounded.
    for (const [k, t] of this.recentActions) {
      if (now - t >= DUPLICATE_ACTION_WINDOW_MS) this.recentActions.delete(k);
    }

    const lastAt = this.recentActions.get(key);
    if (lastAt !== undefined && now - lastAt < DUPLICATE_ACTION_WINDOW_MS) {
      return {
        success: false,
        actionType: params.actionType,
        executionTimeMs: 0,
        error:
          `Duplicate '${params.actionType}' on the same target within ${DUPLICATE_ACTION_WINDOW_MS}ms — ` +
          'likely an accidental double-dispatch (e.g. a submit button clicked twice). If this is ' +
          'intentional, wait a moment and retry.',
        retriesUsed: 0,
      };
    }

    this.recentActions.set(key, now);
    return undefined;
  }

  /**
   * Races an *already-started* dispatch against a timeout, rather than starting the dispatch
   * itself — the caller keeps its own reference to the dispatch promise so it can await the
   * loser's real settlement after a timeout instead of abandoning it mid-flight (see the retry
   * loop in {@link executeActionSerialized}, and {@link isTimeoutError} for how a caller
   * distinguishes this timeout from dispatchAction's own thrown errors).
   */
  private async raceWithTimeout<T>(dispatchPromise: Promise<T>, actionType: string, timeoutMs: number): Promise<T> {
    return Promise.race([
      dispatchPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(this.timeoutMessage(actionType, timeoutMs))), timeoutMs),
      ),
    ]);
  }

  private timeoutMessage(actionType: string, timeoutMs: number): string {
    return `Action ${actionType} timed out after ${timeoutMs}ms`;
  }

  /**
   * GAP-032: validates a caller-supplied `timeoutMs` BEFORE it can reach any `setTimeout` call
   * or poll-loop deadline arithmetic — mirrors {@link checkDuplicateAction}'s "return a proper
   * failure result, don't throw" shape, so a bad `timeoutMs` is reported the same honest way as
   * any other action failure (an MCP/CLI/SDK caller, or a script calling `runtime.waitForSelector`
   * directly, gets back `{success:false, error}`, not an uncaught rejection). `undefined` (the
   * normal "use the default" case) and any finite number — including 0 or a negative one, which
   * `wait_for_selector` gives its own "check once, don't wait" meaning to — are fine. `NaN`
   * (e.g. the CLI's `Number('5s')`) or `Infinity`/`-Infinity` are REJECTED rather than silently
   * reinterpreted, because `Date.now() + NaN` is itself `NaN`, and a poll loop's `remaining <= 0`
   * deadline check is always `false` for `NaN` — the loop never legitimately ends, and
   * `setTimeout(fn, NaN)` fires in ~0ms, so it spins at CPU-bound speed until whatever it's
   * polling (a tab, a session) goes away.
   */
  private checkInvalidTimeoutMs(params: ActionParams): ActionResultDto | undefined {
    const raw = params.timeoutMs;
    if (raw === undefined || Number.isFinite(raw)) return undefined;
    return {
      success: false,
      actionType: params.actionType,
      executionTimeMs: 0,
      error:
        `Invalid timeoutMs (${String(raw)}) for action "${params.actionType}" — timeoutMs must be a ` +
        'finite number of milliseconds (NaN and Infinity are rejected, not silently reinterpreted).',
      retriesUsed: 0,
    };
  }

  /**
   * GAP-032: clamps an already-validated (finite-or-undefined; see {@link checkInvalidTimeoutMs})
   * `timeoutMs` down to {@link MAX_TIMEOUT_MS} when it's too large for Node's own `setTimeout`
   * (a 32-bit signed int of milliseconds) to represent. A merely too-large finite value is
   * CLAMPED, not rejected — it's a well-formed request; silently doing the equivalent of "wait
   * as long as this process reasonably can" is the more useful behavior than an error for what's
   * very likely a caller who intended "a very long time," not a hostile input.
   */
  private static sanitizeTimeoutMs(raw: number | undefined): number | undefined {
    if (raw === undefined) return undefined;
    return raw > MAX_TIMEOUT_MS ? MAX_TIMEOUT_MS : raw;
  }

  /** True if `err` is the timeout rejection {@link raceWithTimeout} manufactures for this
   *  specific action type — as opposed to a real error `dispatchAction` itself threw (which
   *  means dispatchAction already settled, so there's nothing to wait for). The exact `Nms`
   *  suffix is deliberately not matched, only the fixed prefix `raceWithTimeout` always uses. */
  private isTimeoutError(err: Error, actionType: string): boolean {
    return err.message.startsWith(`Action ${actionType} timed out after `);
  }

  private async dispatchAction(
    tab: IBrowserTab,
    params: ActionParams,
    /** FR2-05 fix-2 (GAP-301, cause 3): only consulted by `download_file`. When the OUTER retry
     *  loop in {@link executeActionSerialized} gives up waiting on this dispatch (its bounded
     *  grace period after a timeout elapses with the dispatch still unsettled), it aborts this
     *  signal so the abandoned in-flight download work stops touching shared browser-wide
     *  state (the click, and any further wait) instead of running to completion in the
     *  background and clobbering a LATER call's download-behavior configuration. */
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const page = tab.page;

    switch (params.actionType) {
      case 'navigate': {
        if (!params.url) throw new Error('Navigate action requires url parameter');
        await tab.navigate(params.url);
        return { url: tab.url, title: tab.title };
      }

      case 'click': {
        if (!params.selector) throw new Error('Click action requires a selector parameter');
        if (page) {
          await this.withModifiers(page, params.modifiers, () =>
            this.verifiedClick(page, params.selector!, params.button ?? 'left', params.offset),
          );
        } else {
          // No selector-capable page path (e.g. a mock/no-Chrome tab) — fall back to the
          // tab's own action dispatch, but honor its result instead of discarding it; a
          // no-live-page tab now reports success:false there rather than faking success.
          const fallback = await tab.executeAction({ type: 'click', targetSelector: params.selector });
          if (!fallback.success) throw new Error(fallback.error ?? 'click failed');
        }
        return { clickedSelector: params.selector, button: params.button ?? 'left', modifiers: params.modifiers };
      }

      case 'click_by_text': {
        if (!params.text) throw new Error('ClickByText action requires text parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute click_by_text.`);
        // `contains(text(), ...)` only matches an element's DIRECT text-node children — it
        // structurally cannot match a phrase split across sibling elements, e.g. a search
        // results UI wrapping matched query words in <mark> (extremely common on the modern
        // web: "artificial intelligence in healthcare" landing as ["...of ", <mark>artificial
        // </mark>, <mark>intelligence</mark>, " in ", <mark>healthcare</mark>, "..."] — no
        // single node's own text() ever contains the full phrase, even though it reads as one
        // continuous phrase and correctly appears in `snapshot`'s own pageText). `contains(.,
        // ...)` matches concatenated descendant text instead (like `.textContent`), but on its
        // own over-matches every ancestor up to <html> too, since ancestors always contain
        // all descendant text. The `not(.//*[contains(., ...)])` clause excludes any element
        // that has a descendant which ALSO contains the full phrase, leaving only the deepest/
        // most specific match — the standard XPath idiom for this. Found live via a real
        // Frontiers.org search-results page (Milestone 95, 2026-08-18).
        const xpath = `xpath///*[contains(., "${params.text}") and not(.//*[contains(., "${params.text}")])]`;
        const element = await this.resolveElement(page, xpath, { timeoutMs: 5000 });
        if (!element) throw new Error(`No element found containing text: ${params.text}`);
        // Routed through the same occlusion-safe, delivery-verified path click/click_by_role
        // use (PROB-012, logged in .ai/known-problems.md) — this used to call element.click()
        // directly, which neither checked whether another element was actually topmost at the
        // click point nor confirmed a real click event was delivered before reporting success.
        await this.assertNotStale(element, xpath);
        await this.verifiedClickOnHandle(element, xpath);
        return { clickedText: params.text };
      }

      case 'click_by_role': {
        if (!params.role) throw new Error('ClickByRole action requires role parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute click_by_role.`);
        // Puppeteer's built-in `aria/` selector engine queries the browser's own computed
        // accessibility tree — unlike a plain `[role="X"]` CSS selector (the previous
        // implementation), it correctly matches IMPLICIT roles too (a plain <button> has role
        // "button" without ever declaring role="button" in its markup — the vast majority of
        // real-world interactive elements rely on implicit roles, not explicit ones). The name
        // segment, when given, is also matched against the real computed accessible name, not
        // just left unused — `name` was accepted and documented as narrowing the match but
        // silently ignored before this fix.
        const ariaSelector = `aria/${params.name ?? ''}[role="${params.role}"]`;
        const handle = await this.resolveElement(page, ariaSelector, { visible: true, timeoutMs: 5000 });
        if (!handle) {
          throw new Error(
            `No visible element found with role "${params.role}"` +
              (params.name ? ` and accessible name "${params.name}"` : ''),
          );
        }
        await this.assertNotStale(handle, ariaSelector);
        await this.verifiedClickOnHandle(handle, ariaSelector);
        return { role: params.role, name: params.name };
      }

      case 'type': {
        if (!params.value) throw new Error('Type action requires value parameter');
        if (!params.selector) throw new Error('Type action requires a selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute type.`);
        const handle = await this.resolveElement(page, toPuppeteerQuery(params.selector), {
          timeoutMs: 5000,
        });
        if (!handle) throw new Error(await this.describeMissingElement(page, params.selector));
        await this.assertNotStale(handle, params.selector);
        await this.runHandleOp('type', () => this.clearAndType(handle, params.value!));
        return { typedValue: params.value };
      }

      case 'type_by_label': {
        if (!params.label || !params.value) throw new Error('TypeByLabel requires label and value');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute type_by_label.`);
        const selector = `input[aria-label="${params.label}"], input[placeholder="${params.label}"]`;
        const handle = await this.resolveElement(page, `pierce/${selector}`, { timeoutMs: 5000 });
        if (!handle) throw new Error(`No input found matching label: ${params.label}`);
        await this.runHandleOp('type_by_label', () => this.clearAndType(handle, params.value!));
        return { label: params.label, value: params.value };
      }

      case 'press_key': {
        if (!params.key) throw new Error('PressKey requires key parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute press_key.`);
        await this.withModifiers(page, params.modifiers, () => page.keyboard.press(params.key as KeyInput));
        return { key: params.key, modifiers: params.modifiers };
      }

      case 'scroll': {
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute scroll.`);
        const amount = params.amount ?? 500;
        const direction = params.direction ?? 'down';

        // Opt-in: scroll a SPECIFIC element's own scroll container instead of the window.
        // Without this, `scroll` could only ever move `window.scrollY` — a real, common gap:
        // a data grid's virtualized rows, a chat pane, a modal's scrollable body, or a code
        // block each have their OWN independent scroll container, and window.scrollBy does
        // nothing to them at all (found live testing a real MUI Data Grid: window-scrolling
        // the page left the grid's own rendered rows completely unchanged — confirmed by
        // reading the grid's real row content before/after, not just trusting scroll's own
        // success report).
        if (params.selector) {
          const handle = await this.resolveElement(page, toPuppeteerQuery(params.selector), { timeoutMs: 5000 });
          if (!handle) throw new Error(await this.describeMissingElement(page, params.selector));
          await this.assertNotStale(handle, params.selector);

          const before = await handle.evaluate((el) => el.scrollTop);
          // 'top'/'bottom' jump to the actual scroll boundary (scrollTop 0, or scrollHeight -
          // clientHeight) — NOT a relative move by `amount`. Previously 'top'/'bottom' fell
          // through to the same branch as 'up' (anything !== 'down'), so 'bottom' silently
          // scrolled UP by `amount` instead of jumping to the end — found live testing a real
          // infinite-scroll page (`scroll bottom` reported success but scrollTop never moved
          // off 0, because scrolling "up" from position 0 is a no-op that the boundary check
          // then misread as "already at the top", masking the wrong-direction bug entirely).
          await handle.evaluate(
            (el, amt, dir) => {
              if (dir === 'top') el.scrollTop = 0;
              else if (dir === 'bottom') el.scrollTop = el.scrollHeight;
              else el.scrollBy(0, dir === 'down' ? amt : -amt);
            },
            amount,
            direction,
          );
          const after = await handle.evaluate((el) => el.scrollTop);
          const maxScrollTop = await handle.evaluate((el) => Math.max(0, el.scrollHeight - el.clientHeight));
          const atBoundary =
            direction === 'down' || direction === 'bottom' ? before >= maxScrollTop - 1 : before <= 1;
          if (before === after && !atBoundary) {
            throw new Error(
              `scroll had no effect on "${params.selector}" — its scrollTop stayed at ${before} after ` +
                `attempting to scroll ${direction} by ${amount}px, and it doesn't appear to already be at ` +
                'that scroll boundary. The element may not actually be its own scroll container (no ' +
                'overflow:auto/scroll), or something is intercepting/resetting the scroll.',
            );
          }
          return { direction: params.direction ?? 'down', selector: params.selector, scrolledFrom: before, scrolledTo: after };
        }

        // Read back scrollY before/after — `scrollBy()` not moving anything (a fixed/non-scrolling
        // page, or an intercepted scroll) previously reported success identically to a real
        // scroll. Legitimate no-op at a scroll boundary (already at the top/bottom) is not an
        // error — only report failure when the page appears genuinely scrollable in that
        // direction but nothing moved.
        const before = await page.evaluate(() => window.scrollY);
        // Same 'top'/'bottom' fix as the element-targeted branch above — jump to the real
        // boundary rather than a relative move by `amount`.
        await page.evaluate(
          (amt, dir) => {
            if (dir === 'top') window.scrollTo(0, 0);
            else if (dir === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
            else window.scrollBy(0, dir === 'down' ? amt : -amt);
          },
          amount,
          direction,
        );
        const after = await page.evaluate(() => window.scrollY);
        const maxScrollY = await page.evaluate(
          () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
        );
        const atBoundary =
          direction === 'down' || direction === 'bottom' ? before >= maxScrollY - 1 : before <= 1;
        if (before === after && !atBoundary) {
          throw new Error(
            `scroll had no effect — scrollY stayed at ${before} after attempting to scroll ${direction} by ` +
              `${amount}px, and the page doesn't appear to already be at that scroll boundary. The page may ` +
              'not be scrollable at this point, or something is intercepting/resetting the scroll.',
          );
        }
        return { direction: params.direction ?? 'down', scrolledFrom: before, scrolledTo: after };
      }

      case 'wait': {
        const ms = params.milliseconds ?? 1000;
        await new Promise((r) => setTimeout(r, ms));
        return { waitedMs: ms };
      }

      case 'wait_for_selector': {
        if (!params.selector) throw new Error('WaitForSelector requires selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute wait_for_selector.`);
        const state: WaitForSelectorState = params.state ?? 'visible';
        if (state !== 'visible' && state !== 'attached' && state !== 'hidden') {
          throw new Error(
            `Invalid wait_for_selector state "${state}" — expected one of: visible, attached, hidden.`,
          );
        }
        const fullSelector = toPuppeteerQuery(params.selector);

        // GAP-011: `timeoutMs <= 0` means "check once, don't wait" — a single immediate
        // evaluation of the requested state, with NO timer/race involved at all (the old
        // behavior clamped to a 1ms Puppeteer `waitForSelector` call, which still raced a real
        // timer and could lose even when the element was already in the requested state).
        if (params.timeoutMs !== undefined && params.timeoutMs <= 0) {
          return this.checkWaitForSelectorOnce(page, params.selector, fullSelector, state);
        }
        // GAP-032: re-clamp here too (idempotent with the same check `executeActionSerialized`
        // already ran before dispatching) — that earlier check guarantees `params.timeoutMs` is
        // either `undefined` or finite by this point, but NOT that it's small enough for
        // `Date.now() + waitMs` and the `setTimeout` calls below to stay inside Node's own
        // `setTimeout` ceiling, so an overly large-but-finite value still needs clamping down
        // to {@link MAX_TIMEOUT_MS} before it drives either poll loop's deadline.
        const waitMs = BrowserActionEngine.sanitizeTimeoutMs(params.timeoutMs) ?? 10000;

        if (state === 'hidden') {
          // `resolveElement` can't express `hidden` — Puppeteer's own `waitForSelector({hidden:
          // true})` resolves to `null` on SUCCESS (the element genuinely went away), and
          // `resolveElement` already maps every rejection to `null` too, so the two "null"
          // outcomes would be indistinguishable through that helper (FR2-01 spec note).
          const matchedAtStart = await this.probeSelectorMatchExists(page, fullSelector);
          let hiddenVerdict: FrameSetHiddenVerdict;
          try {
            hiddenVerdict = await this.waitForHiddenInAllFrames(page, fullSelector, waitMs);
          } catch (err) {
            // GAP-015: a genuinely invalid selector (parser/SyntaxError) must fail fast with
            // that real error, not be swallowed into "still visible" after the full timeout.
            // GAP-134 (FR2-01 audit-6): this is a HARD failure (the check itself didn't run to
            // completion — including GAP-132's tab-closed-mid-wait case), never a confirmed
            // timeout outcome — it must always start with `WAIT_HIDDEN_HARD_FAILURE_PREFIX` so
            // the MCP layer's hint-matching can tell it apart from the two real timeout messages
            // below, no matter what text the wrapped underlying error happens to contain.
            throw new Error(`${WAIT_HIDDEN_HARD_FAILURE_PREFIX} ${(err as Error)?.message ?? String(err)}`);
          }
          if (hiddenVerdict !== 'hidden') {
            // GAP-082 (Orchestrator decision, decisions.md audit-4 entry): an 'unknown' timeout
            // (a busy neighbor frame that never answered, no frame ever confirming visible) is a
            // GENUINELY DIFFERENT failure from a 'visible' timeout (some frame explicitly
            // confirmed the element is still there) — the two must never share the same message,
            // or a caller can't tell "we don't know" from "we know it's still there".
            const detail =
              hiddenVerdict === 'unknown'
                ? WAIT_HIDDEN_COULD_NOT_VERIFY_FRAGMENT
                : `an element matching "${params.selector}" ${WAIT_HIDDEN_CONFIRMED_VISIBLE_FRAGMENT}`;
            throw new Error(`wait_for_selector timed out after ${waitMs}ms waiting for state=hidden: ${detail}.`);
          }
          // GAP-016: hidden can succeed on the FIRST match while a LATER match (in some frame)
          // is still visible — best-effort, bounded diagnostic so a caller can spot that.
          // GAP-085: `countOtherVisibleMatches` now reports its own uncertainty (a busy frame
          // that never answered) instead of silently returning 0 as if it had confirmed zero.
          const otherVisible = await this.countOtherVisibleMatches(page, fullSelector).catch(() => ({
            count: 0,
            unconfirmed: true,
          }));
          const out: Record<string, unknown> = { foundSelector: params.selector, state: 'hidden', matchedAtStart };
          if (otherVisible.count > 0) out.otherVisibleMatches = otherVisible.count;
          if (otherVisible.unconfirmed) out.otherVisibleMatchesUnknown = true;
          return out;
        }

        if (state === 'visible') {
          // GAP-008: interval polling (not Puppeteer's own `visible:true`, which forces
          // requestAnimationFrame polling and can stall for ~500ms/frame on a non-foreground
          // tab) — see {@link waitForVisibleWithPolling}.
          const handle = await this.waitForVisibleWithPolling(page, fullSelector, waitMs);
          if (!handle) {
            throw new Error(
              await this.describeWaitForSelectorTimeout(page, params.selector, fullSelector, 'visible', waitMs),
            );
          }
          return { foundSelector: params.selector, state };
        }

        // state === 'attached' — still resolveElement-based (unlike hidden/visible), but GAP-033
        // (FR2-01 audit-2) adds a fast syntax-error pre-check first: `resolveElement` swallows
        // EVERY rejection (including a genuine selector-syntax error) into "no match" and keeps
        // re-probing every live frame for the FULL timeout before giving up with the generic
        // "No element found" message — GAP-015's fast-fail-on-syntax-error fix never covered
        // this path, only hidden/visible. `pierceFirstMatch` already has exactly this fast-fail
        // behavior (and is cheap/bounded via GAP-030's per-frame probe timeout), so run it once
        // against the main frame purely to surface a real syntax error immediately; any OTHER
        // outcome (a match, no match, or some other error) is intentionally ignored here and
        // left to `resolveElement`'s own unchanged matching logic below.
        try {
          await this.pierceFirstMatch(page.mainFrame(), fullSelector);
        } catch (err) {
          if (BrowserActionEngine.isSelectorSyntaxError(err)) throw err;
        }
        const handle = await this.resolveElement(page, fullSelector, { timeoutMs: waitMs });
        if (!handle) {
          throw new Error(
            await this.describeWaitForSelectorTimeout(page, params.selector, fullSelector, 'attached', waitMs),
          );
        }
        return { foundSelector: params.selector, state };
      }

      case 'select_option': {
        const values = params.values?.length ? params.values : params.value ? [params.value] : undefined;
        if (!params.selector || !values) {
          throw new Error("SelectOption requires selector and either 'value' or 'values'");
        }
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute select_option.`);
        const handle = await this.resolveElement(page, toPuppeteerQuery(params.selector), {
          timeoutMs: 5000,
        });
        if (!handle) throw new Error(await this.describeMissingElement(page, params.selector));
        await this.assertNotStale(handle, params.selector);
        await this.runHandleOp('select_option', () => handle.select(...values));
        // Read the real selected value(s) back rather than trusting Puppeteer's own select()
        // not throwing — the same "verify, don't assume" discipline as `type`'s read-back.
        // Catches e.g. a value that doesn't match any <option>, which select() can silently
        // no-op on for some custom/JS-driven <select>-like widgets.
        const landed = await handle.evaluate((el) => {
          const sel = el as HTMLSelectElement;
          return sel.multiple ? Array.from(sel.selectedOptions).map((o) => o.value) : [sel.value];
        });
        const landedSet = new Set(landed);
        const matches = values.every((v) => landedSet.has(v)) && landed.every((v) => values.includes(v));
        if (!matches) {
          throw new Error(
            `select_option did not land the expected value(s) — expected ${JSON.stringify(values)}, but the ` +
              `element's real selected value(s) read back as ${JSON.stringify(landed)}.`,
          );
        }
        return { selectedValues: values };
      }

      case 'hover': {
        if (!params.selector) throw new Error('Hover action requires a selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute hover.`);
        await this.verifiedHover(page, params.selector, params.offset);
        return { hoveredSelector: params.selector };
      }

      case 'focus': {
        if (!params.selector) throw new Error('Focus action requires a selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute focus.`);
        const handle = await this.resolveElement(page, toPuppeteerQuery(params.selector), {
          timeoutMs: 5000,
        });
        if (!handle) throw new Error(await this.describeMissingElement(page, params.selector));
        await this.assertNotStale(handle, params.selector);
        await this.runHandleOp('focus', () => handle.focus());
        return { focusedSelector: params.selector };
      }

      case 'take_screenshot': {
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute take_screenshot.`);
        const buf = await page.screenshot({ encoding: 'base64', fullPage: params.fullPage ?? true });
        return { screenshotBase64Length: String(buf).length };
      }

      case 'drag_and_drop': {
        if (!params.selector || !params.targetSelector) {
          throw new Error('DragAndDrop action requires selector (source) and targetSelector (destination) parameters');
        }
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute drag_and_drop.`);
        const source = await this.resolveElement(page, toPuppeteerQuery(params.selector), { timeoutMs: 5000 });
        if (!source) throw new Error(`No element found for source selector: ${params.selector}`);
        const target = await this.resolveElement(page, toPuppeteerQuery(params.targetSelector), { timeoutMs: 5000 });
        if (!target) throw new Error(`No element found for target selector: ${params.targetSelector}`);
        await this.assertNotStale(source, params.selector);
        await this.assertNotStale(target, params.targetSelector);
        // Delivery-marker check, same idea as verifiedClickOnHandle's: attach a listener BEFORE
        // dispatching, so we observe whether a real 'drop' event actually reached the target —
        // not just that drag()/drop() didn't throw. This is a genuine signal, not a rubber
        // stamp: the HTML5 DnD spec requires the target to call preventDefault() on 'dragover'
        // for 'drop' to fire at all, so a target with no (or broken) dragover handling — the
        // most common real-world drag-and-drop integration mistake — is exactly what this catches.
        await target.evaluate((el) => {
          (el as unknown as { __sdDropped?: boolean }).__sdDropped = false;
          el.addEventListener(
            'drop',
            () => {
              (el as unknown as { __sdDropped?: boolean }).__sdDropped = true;
            },
            { once: true, capture: true },
          );
        });
        await this.runHandleOp('drag_and_drop', async () => {
          await source.drag(target);
          await target.drop(source);
        });
        const delivered = await target.evaluate(
          (el) => (el as unknown as { __sdDropped?: boolean }).__sdDropped === true,
        );
        if (!delivered) {
          throw new Error(
            `drag_and_drop dispatched the drag/drop sequence, but no 'drop' event was observed on the ` +
              `target — it may not have been delivered. The most common cause: the target has no ` +
              "'dragover' handler calling preventDefault(), which the HTML5 drag-and-drop spec requires " +
              "before a 'drop' event will fire at all.",
          );
        }
        return { sourceSelector: params.selector, targetSelector: params.targetSelector };
      }

      case 'touch_tap': {
        if (!params.selector) throw new Error('TouchTap action requires selector parameter');
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute touch_tap.`);
        const handle = await this.resolveElement(page, toPuppeteerQuery(params.selector), {
          visible: true,
          timeoutMs: 5000,
        });
        if (!handle) throw new Error(`No visible element found for selector: ${params.selector}`);
        await this.assertNotStale(handle, params.selector);
        await this.runHandleOp('touch_tap', () => handle.tap());
        return { tappedSelector: params.selector };
      }

      case 'download_file': {
        if (!params.selector) {
          throw new Error("DownloadFile action requires a selector (of the element that triggers the download)");
        }
        if (!page) {
          throw new Error(`No live browser page for tab ${tab.id} — cannot execute download_file.`);
        }

        const downloadDir = await this.resolveDownloadDir(params.downloadDir);

        // FR2-05 fix-2 (GAP-301/GAP-302): fail FAST if another `download_file` call is already
        // in flight against this SAME browser instance — same-process OR cross-process (see
        // {@link ./download-lock.ts}). fix-1's in-process WeakMap queue gave zero protection
        // across processes and let a caller wait, unbounded in practice, behind an abandoned
        // dispatch; this rejects immediately instead, with a clear error, matching the fix-2
        // binding decision's smaller-scope alternative to a true cross-process wait-lock.
        const browser = page.browser();
        const lock = await acquireDownloadLock(browser.wsEndpoint());
        try {
          return await this.runDownloadFileLocked(page, params, downloadDir, signal);
        } finally {
          await lock.release();
        }
      }

      case 'upload_file': {
        if (!params.selector || !params.filePath) {
          throw new Error('UploadFile action requires selector and filePath parameters');
        }
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute upload_file.`);
        await this.assertUploadPathAllowed(params.filePath);
        const handle = await this.resolveElement(page, toPuppeteerQuery(params.selector), {
          timeoutMs: 5000,
        });
        if (!handle) {
          throw new Error(`No file input found for selector: ${params.selector}`);
        }
        await this.runHandleOp('upload_file', () => (handle as ElementHandle<HTMLInputElement>).uploadFile(params.filePath!));
        // Read the input's real .files list back — uploadFile() not throwing only means the CDP
        // call succeeded, not that the browser actually attached the file (e.g. a non-file
        // <input>, or one a page script resets after the fact).
        const expectedFileName = path.basename(params.filePath);
        const landedFileName = await handle.evaluate(
          (el) => (el as HTMLInputElement).files?.[0]?.name ?? null,
        );
        if (landedFileName !== expectedFileName) {
          throw new Error(
            `upload_file did not land the expected file — expected "${expectedFileName}" in the input's ` +
              `files list, but it reads back as ${JSON.stringify(landedFileName)}.`,
          );
        }
        return { uploadedFilePath: params.filePath, uploadedFileName: landedFileName };
      }

      default:
        throw new Error(`Unsupported action type ${params.actionType}`);
    }
  }

  /**
   * Returns (creating if necessary) the ONE long-lived CDP session this engine uses to manage
   * `browser`'s download behavior, and never detaches it — see {@link downloadSessions}'s doc
   * comment for why (FR2-05 fix-2, GAP-301 cause 1).
   */
  private async getDownloadSession(browser: Browser): Promise<CDPSession> {
    const existing = this.downloadSessions.get(browser);
    if (existing) return existing;
    // Downloads must be configured on a *browser*-level CDP session, not a page-level one —
    // `Page.setDownloadBehavior`/`Page.downloadWillBegin`/`Page.downloadProgress` are
    // deprecated and don't fire in Chrome's current ("new") headless mode; the replacement
    // `Browser.*` equivalents only exist on the browser target's own session.
    const created = browser.target().createCDPSession();
    this.downloadSessions.set(browser, created);
    created.catch(() => {
      // Creation failed — don't leave a permanently-rejected promise cached for this browser.
      if (this.downloadSessions.get(browser) === created) this.downloadSessions.delete(browser);
    });
    return created;
  }

  /**
   * The actual `download_file` CDP work (browser-wide `setDownloadBehavior`, click, wait for
   * completion, containment re-check, and cleanup) — split out of {@link dispatchAction}'s main
   * switch so it can be gated by the cross-process fail-fast lock (FR2-05 fix-2, GAP-301/302;
   * see `./download-lock.ts`). Only one call for a given real browser instance holds the lock
   * — and therefore runs this — at a time, whether that other caller is in this same process
   * or a separate one.
   */
  private async runDownloadFileLocked(
    page: Page,
    params: ActionParams,
    downloadDir: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (signal?.aborted) {
      throw new Error('download_file abandoned before it started (outer retry/timeout already gave up on it)');
    }

    const client = await this.getDownloadSession(page.browser());
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
      eventsEnabled: true,
    });

    const downloadTimeoutMs = params.timeoutMs ?? 30000;
    let cleanup = (): void => {};
    // Tracks the guid of the FIRST download this call's click triggered so a later
    // `Browser.downloadProgress` event for a DIFFERENT download (another tab/page in the
    // same browser completing a download concurrently) is ignored rather than resolving
    // this call with someone else's file (FR2-05 B6).
    let beganGuid: string | undefined;
    const downloadPromise = new Promise<{ filename: string; path: string }>((resolve, reject) => {
      let suggestedFilename: string | undefined;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Download did not complete within ${downloadTimeoutMs}ms`));
      }, downloadTimeoutMs);

      const onWillBegin = (evt: { guid: string; suggestedFilename: string }): void => {
        if (beganGuid === undefined) beganGuid = evt.guid;
        if (evt.guid !== beganGuid) return;
        suggestedFilename = evt.suggestedFilename;
      };
      const onProgress = (evt: { state: string; guid: string; filePath?: string }): void => {
        if (beganGuid !== undefined && evt.guid !== beganGuid) return;
        if (evt.state === 'completed') {
          cleanup();
          // Prefer CDP's own `filePath` (the actual on-disk destination, which may differ
          // from `suggestedFilename` if Chrome uniquified the name on a conflict) over
          // reconstructing it from the suggested name — FR2-05 B6.
          const name = path.basename(suggestedFilename ?? evt.guid);
          const full = evt.filePath ? path.resolve(evt.filePath) : path.join(downloadDir, name);
          resolve({ filename: path.basename(full), path: full });
        } else if (evt.state === 'canceled') {
          cleanup();
          reject(new Error('Download was canceled'));
        }
      };
      client.on('Browser.downloadWillBegin', onWillBegin);
      client.on('Browser.downloadProgress', onProgress);
      cleanup = () => {
        clearTimeout(timer);
        client.off('Browser.downloadWillBegin', onWillBegin);
        client.off('Browser.downloadProgress', onProgress);
      };
    });
    // If verifiedClick throws below (e.g. the trigger element isn't found), this promise
    // is never awaited — without a handler attached now, its eventual timeout rejection
    // (up to `downloadTimeoutMs` later) would surface as an unhandled promise rejection
    // and crash the process. This no-op catch only suppresses that Node-level warning; it
    // doesn't affect the real `await downloadPromise` below, which still observes the
    // rejection normally.
    downloadPromise.catch(() => {});

    // FR2-05 fix-2 (GAP-301 cause 3): if the OUTER retry loop already gave up on THIS dispatch
    // (its bounded grace period elapsed with this call still unsettled) before the click or the
    // download itself completes, stop here rather than letting the click/wait run to completion
    // in the background — an abandoned call must not still be the one holding the lock and
    // driving `Browser.setDownloadBehavior` by the time a later call wants to start. Racing an
    // abort promise alongside the real work (rather than trying to cancel the underlying CDP
    // calls, which Puppeteer doesn't expose a cancellation path for) means the `finally` below
    // still runs immediately, releasing the lock and resetting the download behavior.
    const abortError = new Error(
      'download_file abandoned by the outer retry/timeout — this attempt is no longer awaited',
    );
    const racedWork = async (): Promise<{ filename: string; path: string }> => {
      await this.verifiedClick(page, params.selector!, 'left');
      return downloadPromise;
    };
    let onAbort: (() => void) | undefined;
    try {
      const downloaded = signal
        ? await new Promise<{ filename: string; path: string }>((resolve, reject) => {
            racedWork().then(resolve, reject);
            if (signal.aborted) {
              reject(abortError);
              return;
            }
            onAbort = () => reject(abortError);
            signal.addEventListener('abort', onAbort, { once: true });
          })
        : await racedWork();
      const reportedPath = path.resolve(downloaded.path);
      // Defense in depth: even a `filePath` CDP reports should land inside `downloadDir`.
      // A mismatch here means Chrome/CDP put the file somewhere this call didn't ask for —
      // fail rather than hand back a path outside the sandbox this action promised.
      if (!isPathWithinRoot(reportedPath, path.resolve(downloadDir)) && !(await findContainingRoot(reportedPath, [downloadDir]))) {
        throw new Error(
          `Download reported a file outside the download directory "${downloadDir}": ${reportedPath}`,
        );
      }
      return { downloadedFilename: downloaded.filename, downloadedPath: reportedPath, downloadDir };
    } catch (err) {
      cleanup();
      throw err;
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      // Reset Chrome's browser-wide download target so a destination granted for this one
      // action doesn't keep receiving later, page-initiated downloads (FR2-05 B7).
      //
      // FR2-05 audit-1 GAP-296 / audit-2 GAP-301: resetting to `behavior:'default'` was a
      // regression (fail-open, to Chrome's own platform default location). fix-1 reset to
      // `'deny'` instead, but that reset did NOT actually stick live: `client.detach()`,
      // called right after, made Chrome silently revert the setting to platform-default
      // anyway (confirmed 3/3: a later, unrelated click still landed a file in the real OS
      // Downloads folder). This session is now the ONE long-lived, never-detached session for
      // this browser (see {@link getDownloadSession}), so there is no detach here to trigger
      // that reversion — the `'deny'` reset below actually holds. Combined with the
      // cross-process fail-fast lock in {@link dispatchAction}'s `download_file` case, no other
      // `download_file` call (same- or cross-process) can be mid-flight on this browser while
      // this reset runs, so there's also no other in-flight call's `setDownloadBehavior('allow',
      // ...)` for this reset to race against.
      await client.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
    }
  }

  /**
   * True for Puppeteer/CDP's "execution context destroyed" family of errors — thrown when the
   * frame a handle belonged to navigates away mid-operation. `verifiedClick` already treats
   * this specially for clicks (it's often evidence the click's own submit/link navigation
   * fired); this catches the same underlying condition for every other handle-based action so
   * a navigation racing a `type`/`select_option`/`focus`/`drag_and_drop`/`touch_tap`/
   * `upload_file` produces a clear diagnosis instead of Puppeteer's raw, easy-to-miss message.
   */
  private isContextDestroyedError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return (
      message.includes('Execution context was destroyed') ||
      message.includes('detached Frame') ||
      message.includes('Cannot find context with specified id')
    );
  }

  /**
   * GAP-132 (FR2-01 audit-6): `isContextDestroyedError` cannot distinguish, BY TEXT ALONE, an
   * ordinary in-page navigation destroying one frame's JS context (recoverable — this frame just
   * has no answer for this pass) from the TAB ITSELF having closed mid-check (a real failure —
   * "Execution context was destroyed" is thrown for both). `Page.isClosed()` is Puppeteer's own
   * synchronous, definitive answer to "did the tab close" — checking it AT THE MOMENT OF THE
   * CATCH (not on the next poll pass, the way `liveFramesOf`'s existing `page.isClosed()` guard
   * already does one level up) settles this deterministically instead of inferring it from error
   * text. Without this, a `hidden` wait racing a tab close reads the close's context-destroyed
   * error as "confirmed not visible", and every live frame agreeing on that reports a false
   * SUCCESS for an element that was still genuinely visible right up to the close — live-verified
   * 1/30, then 3/60 trials via MCP, 1/80 via the engine directly (audit-6 `probe-a6.mjs`,
   * `diag-tabclose.mjs`). This is the SAME user-visible bug as GAP-031/GAP-081, one classification
   * branch neither of those rounds examined.
   */
  /** Frame-level form of {@link isTabClosed}; tolerates a frame without `page()`. */
  private isFrameTabClosed(frame: Frame): boolean {
    return typeof frame.page === "function" && this.isTabClosed(frame.page());
  }

  private isTabClosed(page: Page): boolean {
    return typeof page.isClosed === 'function' && page.isClosed();
  }

  /** Runs a handle-based operation, rethrowing a context-destroyed failure with a clear
   *  "page navigated away mid-action" diagnosis instead of Puppeteer's raw error text. */
  private async runHandleOp<T>(actionType: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (this.isContextDestroyedError(err)) {
        throw new Error(
          `Page navigated away mid-action while executing '${actionType}' — the action may ` +
            `have already taken effect before the navigation (original error: ${(err as Error).message})`,
        );
      }
      throw err;
    }
  }

  /**
   * Read back an input/textarea/contenteditable's real current content — never trust an action's
   * own "didn't throw" as evidence the value actually landed. Handles the three shapes a typeable
   * element can take: `<input>`/`<textarea>` (`.value`), and `contenteditable` (`.textContent`,
   * since `.value` doesn't exist on a plain element).
   */
  private async readElementValue(handle: ElementHandle<Element>): Promise<string> {
    return handle.evaluate((el) => {
      if ('value' in el && typeof (el as HTMLInputElement | HTMLTextAreaElement).value === 'string') {
        return (el as HTMLInputElement | HTMLTextAreaElement).value;
      }
      return el.textContent ?? '';
    });
  }

  /**
   * Fallback fill path for React/Vue-style controlled components, where a real user's keystrokes
   * (what `handle.type()` simulates) update the DOM's `value` attribute but the framework's own
   * change handler — which owns the value the framework will actually render — sometimes misses
   * the synthetic event ordering `clearAndType`'s click+Backspace+type sequence produces under
   * load, leaving `value` reset back to empty by the framework's own re-render (this is the
   * mechanism behind the intermittent empty-field race found live in Phase 1 of the field-report
   * remediation, and independently in a real WebBench run this project already fixed once for
   * the append-not-clear variant of this same class of bug).
   *
   * Sets the value through the native property setter (bypassing any framework-patched setter on
   * the instance) and dispatches real `input`/`change` events — the same signal a framework's own
   * controlled-component binding listens for from genuine user input.
   */
  private async nativeSetterFill(handle: ElementHandle<Element>, value: string): Promise<void> {
    await handle.evaluate((el, val) => {
      const isTextArea = el.tagName === 'TEXTAREA';
      const proto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter && 'value' in el) {
        setter.call(el, val);
      } else {
        // contenteditable — no `.value` property exists at all.
        el.textContent = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }

  /**
   * Clears an input/textarea/contenteditable's existing content before typing — triple-click
   * selects whatever text is already there (works the same way a real user clearing a field
   * would, and unlike a Ctrl+A/Cmd+A shortcut isn't platform-dependent), Backspace deletes the
   * selection, then the new value is typed. Puppeteer's bare `ElementHandle.type()` only
   * appends; found live (aliexpress.us's search box silently concatenated a second search term
   * onto the first instead of replacing it) that nothing upstream of this call was clearing the
   * field first, despite `browser.type`'s own documented contract promising it.
   *
   * Read-back verified: `type()`'s own "didn't throw" was never evidence the value actually
   * landed — the field-report remediation's Phase 0 measured this directly (2 of 5 identical
   * runs left the field empty while `type()` reported success every time). After the normal
   * type sequence, the real DOM value is read back; on mismatch, {@link nativeSetterFill} is
   * tried as a repair for the controlled-component case; if the value still doesn't match after
   * that, this throws instead of silently returning a false "succeeded".
   *
   * The comparison ignores inserted punctuation/whitespace: real-world fields with live input
   * masking auto-insert formatting characters as you type — Stripe Elements' card-number field
   * groups digits with spaces ("4242424242424242" lands as "4242 4242 4242 4242"), its expiry
   * field inserts a slash ("1230" lands as "12 / 30"), phone fields insert dashes/parens, etc. A
   * raw equality check treated these genuine successes as failures (found live against Stripe's
   * own payments demo — first the card-number spacing, then the expiry slash). Comparing only
   * the alphanumeric characters (stripping everything else from both sides) tolerates exactly
   * that class of formatting while still catching a real failure: truncation, wrong digits, or
   * reordering still changes the alphanumeric sequence and is still caught.
   *
   * A masked field's live formatting is also a signal of a second, subtler bug class: found live
   * against Stripe Elements' expiry field (`MM / YY`) — typing "1230" read back correctly as
   * "12 / 30" immediately afterward (masking detected, verification passed), stayed correct for
   * 15+ seconds in isolation, but the *instant* focus moved to the next field (e.g. the CVC
   * field getting typed into next, the ordinary next step in any real checkout flow) it silently
   * dropped its last digit to "12 / 3". Root cause: on blur, Stripe canonicalizes the displayed
   * value from its own internal parsed state rather than the DOM, and that internal state lags
   * behind Puppeteer's fast synthetic keystroke dispatch — the DOM briefly shows the fully-typed
   * value, but the field doesn't actually "know" about the last keystroke yet, and blur is what
   * exposes the gap. A time-based wait cannot catch this (confirmed live: the value was still
   * fully correct at t+15s with no blur) — the trigger is the blur event itself, not elapsed
   * time. Whenever masking is detected, force a real blur (then restore focus, since a caller
   * filling this field didn't ask for focus to move) and re-check against that — the same
   * post-condition a real subsequent field-to-field tab would produce.
   */
  private async clearAndType(handle: ElementHandle<Element>, value: string): Promise<void> {
    await handle.click({ count: 3 });
    await handle.press('Backspace');
    await handle.type(value);

    const normalize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '');
    const expected = normalize(value);

    let landed = await this.readElementValue(handle);
    if (normalize(landed) === expected) {
      if (landed === value) return; // exact match — no masking involved, nothing to recheck.
      // Masking detected (formatting characters were inserted) — confirm it survives a real
      // blur, since some masked fields only canonicalize (and can silently truncate) on blur.
      await handle.evaluate((el) => (el as HTMLElement).blur());
      const afterBlur = await this.readElementValue(handle);
      await handle.evaluate((el) => (el as HTMLElement).focus());
      if (normalize(afterBlur) === expected) return;
      landed = afterBlur;
    }

    await this.nativeSetterFill(handle, value);
    landed = await this.readElementValue(handle);
    if (normalize(landed) === expected) return;

    throw new Error(
      `type did not land the expected value — expected ${JSON.stringify(value)}, but the ` +
        `element's real content reads ${JSON.stringify(landed)} even after a native-setter ` +
        'repair attempt. The page may be intercepting/resetting input in a way neither path ' +
        'could overcome.',
    );
  }

  /**
   * Holds `modifiers` down for the duration of `op` (Ctrl+click, Shift+click, Ctrl+A, etc.),
   * releasing them afterward in reverse order even if `op` throws — a stuck-down modifier key
   * would silently corrupt every subsequent action on the page.
   */
  private async withModifiers<T>(
    page: Page,
    modifiers: readonly string[] | undefined,
    op: () => Promise<T>,
  ): Promise<T> {
    if (!modifiers || modifiers.length === 0) return op();
    for (const key of modifiers) {
      await page.keyboard.down(key as KeyInput);
    }
    try {
      return await op();
    } finally {
      for (const key of [...modifiers].reverse()) {
        await page.keyboard.up(key as KeyInput).catch(() => {});
      }
    }
  }

  /**
   * Locate an element by `fullSelector` (any Puppeteer-understood selector syntax — a plain
   * CSS selector, a `pierce/`-prefixed one that also crosses open shadow roots, or an
   * `xpath/` one) across every frame on the page, not just the main one. Iframes are genuinely
   * separate documents/execution contexts — unlike shadow DOM, no selector prefix can cross
   * that boundary, so every frame must be searched independently. Single-frame pages (the
   * common case) skip the overhead of racing across frames entirely.
   *
   * Returns `null` (never throws) if nothing matches within `timeoutMs` in any frame, so
   * callers can produce their own clear "not found" error with the original, unprefixed
   * selector in the message.
   */
  private async resolveElement(
    page: Page,
    fullSelector: string,
    options: { visible?: boolean; timeoutMs?: number } = {},
  ): Promise<ElementHandle<Element> | null> {
    const timeoutMs = options.timeoutMs ?? 5000;
    const live = page.frames().filter((f) => !f.isDetached());
    // `page.frames()` always includes the main frame, so `live` is empty only in
    // pathological/mocked scenarios — fall back to the main frame defensively.
    const targets = live.length > 0 ? live : [page.mainFrame()];

    if (targets.length === 1) {
      const only = targets[0]!;
      return only
        .waitForSelector(fullSelector, { visible: options.visible, timeout: timeoutMs })
        .catch(() => null);
    }

    // Give the main frame a head start before racing every frame. A generic selector (e.g.
    // `[role="button"]`, used by click_by_role) can just as easily match inside a third-party
    // ad/tracking iframe as in the page the caller actually meant — a plain `Promise.any`
    // race would resolve to whichever frame's `waitForSelector` happens to settle first,
    // which can silently target the wrong frame. The main frame is checked with a short
    // timeout first; only if it doesn't have the element do the other frames get raced.
    const mainFrame = page.mainFrame();
    const mainFrameTimeoutMs = Math.min(timeoutMs, 1000);
    const mainFrameMatch = await mainFrame
      .waitForSelector(fullSelector, { visible: options.visible, timeout: mainFrameTimeoutMs })
      .catch(() => null);
    if (mainFrameMatch) return mainFrameMatch;

    const remainingTimeoutMs = Math.max(timeoutMs - mainFrameTimeoutMs, 0);
    if (remainingTimeoutMs === 0) return null;

    // Re-include the main frame in this second race (not just "otherFrames"): the first phase
    // only proves the element wasn't there within the first `mainFrameTimeoutMs` — it says
    // nothing about whether the element appears in the main frame later (e.g. content that
    // loads/renders asynchronously). Excluding it here would silently never find a main-frame
    // element that shows up after the head-start window on any page that also has iframes.
    // Do not race long-lived waitForSelector calls across frames. Promise.any returns as soon as
    // one frame matches but leaves every losing Puppeteer WaitTask alive in the background. On
    // pages that recreate an iframe during init (TinyMCE does this in normal operation), a loser
    // later rejects with "frame got detached" after the action has already moved on. Trying to
    // AbortSignal-cancel the losers is not safe either: Puppeteer 25.5 can surface the resulting
    // AbortError as the same process-killing unhandled rejection (both variants reproduced live
    // while investigating PROB-015). Poll current live frames sequentially with short, fully-
    // awaited probes instead: there is never an abandoned selector task, and refreshing
    // page.frames() each pass naturally follows an iframe that was destroyed and recreated.
    const deadline = Date.now() + remainingTimeoutMs;
    const probeTimeoutMs = 150;
    while (Date.now() < deadline) {
      const currentMain = page.mainFrame();
      const currentFrames = page.frames().filter((f) => !f.isDetached());
      const ordered = [currentMain, ...currentFrames.filter((f) => f !== currentMain)];

      for (const frame of ordered) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;
        const match = await frame
          .waitForSelector(fullSelector, {
            visible: options.visible,
            timeout: Math.min(probeTimeoutMs, remaining),
          })
          .catch(() => null);
        if (match) return match;
      }
    }
    return null;
  }

  /**
   * `wait_for_selector`'s `state: 'hidden'` helper — resolves once the selector's first match is
   * absent or not visible **in every live frame**, the exact negation of `visible` (which
   * accepts the FIRST frame whose first match is visible). `resolveElement` can't be reused
   * here: Puppeteer's `waitForSelector({hidden: true})` resolves to `null` on success (the
   * element genuinely disappeared/hid), and `resolveElement` already maps every rejection to
   * `null` too, so the two very different outcomes would collapse into the same return value.
   *
   * Deliberately no `Promise.any` across frames, for the same PROB-015 reason documented on
   * {@link resolveElement}: every probe is fully awaited before the next one starts, so no
   * losing wait is ever abandoned mid-flight to reject later after a frame detach. `pollMs`
   * defaults to 100ms — see the GAP-034 tradeoff note on {@link waitForVisibleWithPolling}.
   */
  /**
   * GAP-082 (FR2-01 audit-4/fix-4): previously returned a plain `boolean`, so once the deadline
   * was reached, an `'unknown'` last-pass verdict (a busy neighbor frame that never answered) and
   * a `'visible'` last-pass verdict (some frame explicitly confirmed the element is still there)
   * both collapsed to the same `false` — indistinguishable to the caller, and indistinguishable
   * in the resulting error message. That's a real, disclosed tradeoff (decisions.md, audit-4
   * entry): correctness over liveness is the right default (an honest timeout beats a false
   * "hidden"), but the message for the two cases must say different, honest things. Returning
   * the full {@link FrameSetHiddenVerdict} lets the caller do that.
   */
  private async waitForHiddenInAllFrames(
    page: Page,
    fullSelector: string,
    waitMs: number,
    pollMs = 100,
  ): Promise<FrameSetHiddenVerdict> {
    const deadline = Date.now() + waitMs;
    let lastVerdict: FrameSetHiddenVerdict = 'unknown';
    for (;;) {
      // Re-read live frames every pass (mirroring resolveElement) so a frame that gets destroyed
      // and recreated mid-wait (e.g. TinyMCE re-initializing its iframe) is naturally picked up
      // rather than probed against a stale reference. Frames within one pass are now probed in
      // parallel (GAP-059) rather than sequentially, but the pass-to-pass polling here is
      // unchanged: no Promise.any across PASSES either, for the same PROB-015 reason documented
      // on {@link resolveElement}.
      //
      // GAP-057: only a definitive 'hidden' verdict satisfies the wait. 'unknown' (a busy frame
      // that didn't answer this pass) falls through to "keep polling" exactly like 'visible'
      // does — it must never be treated as satisfied.
      lastVerdict = await this.isHiddenInEveryFrame(page, fullSelector);
      if (lastVerdict === 'hidden') return 'hidden';
      const remaining = deadline - Date.now();
      // GAP-082: return the REAL last verdict ('visible' or 'unknown'), not a flattened `false`
      // — the caller now distinguishes a confirmed-still-visible timeout from a genuinely
      // unconfirmed one instead of reporting both identically.
      if (remaining <= 0) return lastVerdict;
      await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
    }
  }

  /**
   * GAP-008 core primitive: resolves `fullSelector`'s first match in `frame` with Puppeteer's
   * own pierce-aware query handler (`frame.$`) — reusing Puppeteer's own `pierce/` resolution
   * here, rather than reimplementing shadow-piercing `querySelector` inside a page-context
   * function, keeps exactly one place in this codebase that has to agree with Puppeteer's
   * `pierce/` semantics (the one `resolveElement`/`click_by_role` already rely on). Propagates a
   * genuine selector-syntax error (GAP-015) instead of treating it as "no match" — a caller
   * that DOES want "no match" for an unresolvable selector (nothing in this file does) would
   * need to catch it explicitly.
   *
   * GAP-030: the actual `frame.$` call is bounded to {@link FRAME_PROBE_TIMEOUT_MS} per call —
   * see {@link raceFrameProbe} — so one busy/unresponsive frame can't stall this pass past that
   * bound; a timed-out probe is simply "no match this pass" and gets retried the next pass by
   * whichever poll loop is calling this.
   *
   * GAP-031: a "the check itself failed to run" error — the tab/session/target genuinely
   * closing mid-check, detected by {@link isFatalFrameCheckError} — is also rethrown rather
   * than swallowed to `null`. Swallowing it (the previous behavior) made `isHiddenInEveryFrame`
   * conclude every frame was "hidden" whenever the whole check failed to even run, which made a
   * `hidden` wait falsely report SUCCESS when the tab closed mid-wait instead of surfacing a
   * real failure. A single frame's own context being destroyed by an in-page navigation (NOT
   * the tab closing) is deliberately still swallowed to `null` — recoverable, and already
   * exercised by pages that destroy/recreate an iframe mid-wait (e.g. TinyMCE).
   */
  private async pierceFirstMatch(frame: Frame, fullSelector: string): Promise<FrameProbeVerdict> {
    try {
      return await this.raceFrameProbe(frame, fullSelector);
    } catch (err) {
      if (BrowserActionEngine.isSelectorSyntaxError(err)) throw err;
      if (BrowserActionEngine.isFatalFrameCheckError(err)) throw err;
      if (this.isContextDestroyedError(err)) {
        // GAP-132 (FR2-01 audit-6): a tab closing mid-probe throws this SAME error text as an
        // ordinary in-page navigation — `isFatalFrameCheckError` above never catches it, because
        // a closed TAB (as opposed to a closed browser/session) doesn't throw a "Session
        // closed"/"Target closed"-style error at all. Check `frame.page().isClosed()`
        // synchronously, right here, rather than inferring tab-closure from error text: if the
        // tab is genuinely gone, this is a real failure, not a recoverable per-frame hiccup, and
        // must never be read as "no match" (which is exactly what lets a `hidden` wait falsely
        // report SUCCESS the instant the tab closes).
        if (this.isTabClosed(frame.page())) {
          throw new Error(TAB_CLOSED_MID_WAIT_MESSAGE);
        }
        // A single frame's own context being destroyed by an ordinary in-page navigation (NOT
        // the tab/session closing — that's `isFatalFrameCheckError` above, or the tab-closed
        // check just above) is a recoverable, per-frame hiccup: this frame definitively has no
        // answer for THIS pass, and will be re-probed fresh (via `page.frames()`) on the next
        // one. That's 'no-match' for this pass, not 'unknown' — unlike a timeout, there's no
        // live probe still in flight that might resolve differently.
        return { kind: 'no-match' };
      }
      // GAP-081 (FR2-01 audit-4/fix-4): any OTHER, unrecognized error was previously ALSO mapped
      // to 'no-match' here — silently treating an error this code has no classification for as
      // a confirmed negative. Audit-4's explicit instruction: "Error handling should default to
      // unknown, not no-match." Only the two positively-classified cases above (a real selector
      // syntax error, which rethrows; a recoverable in-page-navigation hiccup, which is
      // 'no-match') get a definite answer — everything else defaults to 'unknown' so a caller
      // can't mistake "this code doesn't recognize the error" for "this frame confirms absent".
      return { kind: 'unknown' };
    }
  }

  /**
   * GAP-030: races a single frame's `frame.$(fullSelector)` against {@link FRAME_PROBE_TIMEOUT_MS}
   * so a busy/unresponsive frame's CDP round-trip can't stall the whole multi-frame pass. The
   * `setTimeout` race can't actually CANCEL an in-flight CDP call — there is no such primitive
   * here — so on a timeout the real probe is simply abandoned: its eventual settlement (a real
   * handle we'll never use, a `null`, or a rejection) is caught and discarded so it can never
   * surface as a Node unhandled-rejection well after this pass has already moved on. This is the
   * one place in this file that deliberately reintroduces the "abandoned promise" shape the
   * {@link resolveElement} PROB-015 comment avoids — accepted here because the abandoned probe
   * is scoped to a single frame for a bounded ~250ms, not a long-lived cross-frame race.
   */
  private async raceFrameProbe(frame: Frame, fullSelector: string): Promise<FrameProbeVerdict> {
    const real = frame.$(fullSelector);
    // Assigned synchronously by the Promise constructor's executor, which runs immediately —
    // the `!` reflects that, not an actual possibly-unset timer at the `finally` below.
    let timer!: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<typeof FRAME_PROBE_TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(FRAME_PROBE_TIMED_OUT), FRAME_PROBE_TIMEOUT_MS);
    });
    try {
      const winner = await Promise.race([real, timedOut]);
      if (winner === FRAME_PROBE_TIMED_OUT) {
        // GAP-059 (FR2-01 audit-3): the real probe LOST the race and is now abandoned — there's
        // no primitive to cancel it, same as the PROB-015 note on {@link resolveElement} — so it
        // keeps running in the background and will settle on its own later, well after this
        // call has already returned 'unknown'. If it settles with a genuine element handle, that
        // handle is a real CDP resource (a remote-object reference held open in the renderer)
        // that nothing else will ever see or dispose again unless it's disposed right here —
        // found by code reading during audit-3, not measured live, but real: every timed-out
        // probe against a frame that's merely busy (not permanently gone) leaks one handle per
        // pass if left unhandled.
        real
          .then((handle) => {
            if (handle && typeof handle.dispose === 'function') void handle.dispose().catch(() => {});
          })
          .catch(() => {});
        return { kind: 'unknown' };
      }
      return winner ? { kind: 'match', handle: winner } : { kind: 'no-match' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * GAP-083/GAP-085/GAP-086 (FR2-01 fix-4): general-purpose counterpart of {@link raceFrameProbe}
   * for a probe that doesn't produce a disposable `ElementHandle` — a plain boolean visibility
   * check ({@link isHandleVisible}), a `$$eval` result array ({@link diagnoseSelectorVisibility},
   * {@link countOtherVisibleMatches}). Resolves to {@link BOUNDED_TIMED_OUT} if `promise` doesn't
   * settle within `timeoutMs`; a rejection from `promise` itself still propagates as a rejection
   * (callers decide how to classify it), matching `raceFrameProbe`'s own contract. Like
   * `raceFrameProbe`, the loser of the race (a timed-out `promise`) is not and cannot be
   * cancelled — it's simply not awaited further by this call.
   */
  private async raceBounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof BOUNDED_TIMED_OUT> {
    let timer!: ReturnType<typeof setTimeout>;
    const timedOut = new Promise<typeof BOUNDED_TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(BOUNDED_TIMED_OUT), timeoutMs);
    });
    try {
      return await Promise.race([promise, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  private static isSelectorSyntaxError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /is not a valid selector|SyntaxError|Failed to execute 'querySelector'/i.test(msg);
  }

  /**
   * GAP-031: true for the family of errors that mean "the check itself never really ran" —
   * the browser tab, its CDP session, or its target genuinely closed — as opposed to a single
   * frame's execution context being destroyed by an ordinary in-page navigation (handled
   * separately, and deliberately still treated as "no match, retry next pass"; see
   * {@link isContextDestroyedError}). These must never be swallowed into "no match": doing so
   * is exactly what made `isHiddenInEveryFrame` conclude every frame was hidden when the tab
   * closed mid-wait, reporting a false SUCCESS for a `hidden` wait on an element that never
   * actually hid (audit-2 `probe-audit2.mjs n4`).
   */
  private static isFatalFrameCheckError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /Session closed|Target closed|Connection closed|has been closed|Protocol error/i.test(msg);
  }

  /**
   * Puppeteer's own `checkVisibility` rule, applied to a single already-resolved handle:
   * computed `visibility` not `hidden`/`collapse` AND a non-empty bounding box. `opacity` is
   * deliberately ignored, matching Puppeteer.
   *
   * GAP-081/GAP-086 (FR2-01 audit-4/fix-4): previously this caught EVERY rejection (including a
   * tab-closed/session-closed error) and returned a plain `false` ("not visible") with no time
   * bound of its own at all — GAP-031's exact bug (a failed check silently read as a confirmed
   * negative) surviving inside the very function fix-3 rewrote to fix it one level up. Now:
   *  - the `.evaluate()` call itself is bounded by {@link FRAME_PROBE_TIMEOUT_MS} via
   *    {@link raceBounded} (GAP-086) — a busy renderer can't stall the whole poll pass;
   *  - a fatal check failure (session/target/connection closed) reports `'unknown'`, never a
   *    confirmed negative (GAP-081);
   *  - the handle's own frame being destroyed by an ordinary in-page navigation reports
   *    `'not-visible'` — the node this handle referred to is genuinely gone, the same
   *    per-frame-hiccup precedent {@link pierceFirstMatch} already applies;
   *  - any OTHER, unrecognized error defaults to `'unknown'` (audit-4's explicit instruction),
   *    not a confirmed negative.
   */
  private async isHandleVisible(handle: ElementHandle<Element>): Promise<HandleVisibilityVerdict> {
    try {
      const outcome = await this.raceBounded(
        handle.evaluate((el) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return !['hidden', 'collapse'].includes(s.visibility) && r.width > 0 && r.height > 0;
        }),
        FRAME_PROBE_TIMEOUT_MS,
      );
      if (outcome === BOUNDED_TIMED_OUT) return 'unknown';
      return outcome ? 'visible' : 'not-visible';
    } catch (err) {
      if (BrowserActionEngine.isFatalFrameCheckError(err)) return 'unknown';
      if (this.isContextDestroyedError(err)) {
        // GAP-132 (FR2-01 audit-6): the same tab-closed-vs-in-page-navigation ambiguity as
        // `pierceFirstMatch` above, one level down — `handle.evaluate` throws this identical
        // error text whether the handle's frame merely navigated (recoverable: the node this
        // handle referred to is genuinely gone, 'not-visible' is correct) or the whole TAB
        // closed out from under it (a real failure that must never be read as a confirmed
        // negative — that's exactly what let a `hidden` wait falsely succeed on tab close).
        // `handle.frame.page().isClosed()` settles this deterministically, the same way
        // `pierceFirstMatch` now does.
        if (this.isTabClosed(handle.frame.page())) {
          throw new Error(TAB_CLOSED_MID_WAIT_MESSAGE);
        }
        return 'not-visible';
      }
      return 'unknown';
    }
  }

  /**
   * GAP-031 (found finishing the fix for it, via a live repro that still false-succeeded): a
   * REAL Puppeteer `Page` always includes at least its main frame in `page.frames()`, so an
   * empty `live` list here only ever means the tab itself has genuinely closed — NOT the
   * "pathological/mocked scenario" the old fallback assumed. Falling back to `page.mainFrame()`
   * in that case hands every caller a DETACHED frame; `frame.$` on it fails with a
   * "detached Frame"-style error, which `pierceFirstMatch` deliberately treats as a per-frame,
   * RECOVERABLE hiccup (e.g. an iframe mid-navigation) rather than a real failure — which is
   * exactly how `isHiddenInEveryFrame` still concluded "hidden" (false SUCCESS) when the tab
   * closed mid-wait, even after `pierceFirstMatch` started rethrowing "Session closed"/"Target
   * closed"-style errors: a closed TAB (as opposed to a closed BROWSER/session) never actually
   * throws one of those — it just leaves `page.frames()` empty. `page.isClosed()` asks the page
   * itself, which knows definitively, instead of trying to infer tab-closure from a frame-level
   * error message. A page/mock that doesn't implement `isClosed` (nothing in this codebase's
   * own tests does) keeps the original defensive fallback.
   */
  private liveFramesOf(page: Page): Frame[] {
    const live = page.frames().filter((f) => !f.isDetached());
    if (live.length > 0) return live;
    if (this.isTabClosed(page)) {
      throw new Error(TAB_CLOSED_MID_WAIT_MESSAGE);
    }
    return [page.mainFrame()];
  }

  /**
   * "Any frame" first-match-visible check (mirrors `resolveElement`'s `visible:true`
   * acceptance rule: the FIRST frame whose FIRST match is visible wins) — the single-instant
   * primitive both {@link waitForVisibleWithPolling} (GAP-008) and the `timeoutMs<=0` check-once
   * path (GAP-011) build on.
   *
   * GAP-084 (FR2-01 audit-4/fix-4): GAP-059's parallel-probing fix was only ever applied to the
   * `hidden` state's frame-probing ({@link isHiddenInEveryFrame}) — this function still probed
   * every live frame SEQUENTIALLY, reintroducing the exact GAP-059 symptom (pass latency scales
   * with the number of simultaneously busy frames) for the more common `visible`/`attached`
   * states. Every live frame's probe for a pass is now started together via `Promise.all`, same
   * as `isHiddenInEveryFrame` — each individual probe is still its own fully self-contained,
   * ~250ms-bounded call (`raceFrameProbe`), never abandoned to run indefinitely, so racing them
   * together is safe for the same reason it's safe there. The "first frame in order wins" rule is
   * preserved by iterating the settled verdicts in their original frame order; any OTHER matched
   * handle besides the winner is disposed here — previously the sequential loop never even
   * fetched a later frame's handle once an earlier one won, so there was nothing to dispose.
   */
  private async firstVisibleHandleAnyFrame(page: Page, fullSelector: string): Promise<ElementHandle<Element> | null> {
    const frames = this.liveFramesOf(page);
    const verdicts = await Promise.all(frames.map((frame) => this.pierceFirstMatch(frame, fullSelector)));
    let winner: ElementHandle<Element> | null = null;
    for (const verdict of verdicts) {
      // A 'no-match' and an 'unknown' (this frame's probe simply didn't answer within its
      // bound) both mean "this frame doesn't confirm visible THIS pass" — for the `visible`
      // state's any-frame-wins rule that's a safe, non-lossy conflation: neither outcome can
      // cause a false SUCCESS here (only an explicit visible match does), and the caller
      // (`waitForVisibleWithPolling`) re-probes every live frame again next pass, so a busy
      // frame that later becomes reachable still gets its chance to confirm visible.
      if (verdict.kind !== 'match') continue;
      if (winner) {
        if (typeof verdict.handle.dispose === 'function') await verdict.handle.dispose().catch(() => {});
        continue;
      }
      // GAP-081: `isHandleVisible` is now tri-state — only an explicit 'visible' verdict wins;
      // 'not-visible' and 'unknown' are both "doesn't confirm visible this pass", same
      // conflation as the frame-level verdict above and for the same reason.
      const visibility = await this.isHandleVisible(verdict.handle);
      if (visibility === 'visible') {
        winner = verdict.handle;
      } else if (typeof verdict.handle.dispose === 'function') {
        await verdict.handle.dispose().catch(() => {});
      }
    }
    return winner;
  }

  /**
   * "Any frame" first-match-EXISTS check (DOM presence only, visibility ignored) — used only by
   * the `timeoutMs<=0` check-once path for `state:'attached'` (GAP-011). The *waiting* attached
   * path is still `resolveElement`-based; see the `wait_for_selector` case's GAP-033 note for
   * its own fast syntax-error pre-check, which reuses {@link pierceFirstMatch} directly.
   *
   * GAP-084 (FR2-01 audit-4/fix-4): same parallelization as {@link firstVisibleHandleAnyFrame},
   * for the same reason — this used to probe frames sequentially too.
   */
  private async firstAnyHandleAnyFrame(page: Page, fullSelector: string): Promise<ElementHandle<Element> | null> {
    const frames = this.liveFramesOf(page);
    const verdicts = await Promise.all(frames.map((frame) => this.pierceFirstMatch(frame, fullSelector)));
    let winner: ElementHandle<Element> | null = null;
    for (const verdict of verdicts) {
      // Same reasoning as {@link firstVisibleHandleAnyFrame}: 'unknown' can't safely be treated
      // as a confirmed match, so it's conflated with 'no-match' here too — "this frame doesn't
      // confirm attached THIS pass", never "this frame confirms NOT attached".
      if (verdict.kind !== 'match') continue;
      if (!winner) {
        winner = verdict.handle;
      } else if (typeof verdict.handle.dispose === 'function') {
        await verdict.handle.dispose().catch(() => {});
      }
    }
    return winner;
  }

  /** True iff, in EVERY live frame, the first match is absent or not visible — the exact
   *  negation of {@link firstVisibleHandleAnyFrame}'s "any frame visible" rule. This is the
   *  `hidden` state's single-instant primitive, reused by both {@link waitForHiddenInAllFrames}'s
   *  polling loop and the `timeoutMs<=0` check-once path. */
  private async isHiddenInEveryFrame(page: Page, fullSelector: string): Promise<FrameSetHiddenVerdict> {
    // GAP-059 (FR2-01 audit-3): probe every live frame's bounded {@link FRAME_PROBE_TIMEOUT_MS}
    // check IN PARALLEL, not sequentially — sequential probing made this pass's latency scale
    // linearly with the number of simultaneously busy frames (measured live: 239ms/1 busy frame,
    // 658ms/4, 1687ms/8). Each probe is still independently bounded and safely self-contained
    // (see {@link raceFrameProbe}'s own abandon/dispose handling), so racing them together is
    // safe: this is not the PROB-015 "abandoned long-lived cross-frame race" shape — the loser
    // here is bounded to ~250ms, not "until the wait's whole timeout".
    const frames = this.liveFramesOf(page);
    const verdicts = await Promise.all(frames.map((frame) => this.pierceFirstMatch(frame, fullSelector)));

    // GAP-057 (FR2-01 audit-3): a frame whose probe timed out ('unknown') must NEVER be read as
    // "this frame confirms hidden/no-match" — that collapse is exactly what let a `hidden` wait
    // report false SUCCESS while a busy frame's element was still genuinely visible. It also
    // must not immediately fail the whole pass either (that would force an unnecessary failure
    // when the frame simply hasn't answered yet and may well turn out hidden). So: any frame that
    // explicitly confirms VISIBLE wins immediately (hidden requires EVERY frame to agree, so one
    // visible frame is a definitive answer) — but an 'unknown' only downgrades an otherwise-
    // 'hidden' verdict to 'unknown' (keep polling), never promotes it to 'hidden'.
    let sawUnknown = false;
    for (const verdict of verdicts) {
      if (verdict.kind === 'unknown') {
        sawUnknown = true;
        continue;
      }
      if (verdict.kind === 'no-match') continue;
      // GAP-081: `isHandleVisible` is now tri-state. An explicit 'visible' is still the one
      // definitive, immediately-returned answer (hidden requires EVERY frame to agree, so one
      // confirmed-visible frame settles the whole pass). 'unknown' here (the visibility check
      // itself couldn't tell — a bounded timeout, or a fatal/unrecognized error) must downgrade
      // this pass to 'unknown' too, exactly like a frame-probe-level 'unknown' does — it must
      // NEVER be silently read as "this frame confirms hidden", which is the GAP-081 bug one
      // level down from the original GAP-057. 'not-visible' behaves like 'no-match' — this
      // frame's match doesn't block a 'hidden' verdict.
      const visibility = await this.isHandleVisible(verdict.handle);
      if (typeof verdict.handle.dispose === 'function') await verdict.handle.dispose().catch(() => {});
      if (visibility === 'visible') return 'visible';
      if (visibility === 'unknown') sawUnknown = true;
    }
    return sawUnknown ? 'unknown' : 'hidden';
  }

  /**
   * `wait_for_selector`'s `state:'visible'` wait (GAP-008). Puppeteer's own
   * `waitForSelector({visible: true})` forces requestAnimationFrame-based polling
   * (`QueryHandler.ts`: `polling = visible || hidden ? RAF : options.polling`), and a
   * non-foreground/backgrounded tab gets roughly one animation frame per ~500ms — confirmed as a
   * real, live reproduction in audit-1 (`adv-gap003-singleframe.mjs`,
   * `adv-gap003-sdk-falsefail.mjs`), not a theoretical risk. Plain interval polling (`setTimeout`)
   * is not throttled that way. This keeps the exact same multi-frame "any frame" semantics
   * `resolveElement`'s `visible:true` path had. `state:'attached'` and `click_by_role`'s own
   * `visible:true` `resolveElement` call are UNCHANGED and out of scope — see decisions.md for
   * the same rAF-throttling exposure noted there for `click_by_role`. (`state:'attached'` did
   * gain a fast syntax-error pre-check for GAP-033 — see the `wait_for_selector` case — but its
   * underlying wait is still `resolveElement`, not a poll loop like this one.)
   *
   * GAP-034 (FR2-01 audit-2, documented tradeoff): `pollMs` defaults to 100ms, not the ~16ms
   * the OLD (buggy, rAF-adjacent) mechanism happened to achieve on a foreground tab. This is a
   * deliberate, known latency tradeoff, not an oversight: 100ms keeps every poll a plain
   * `setTimeout` (immune to the ~500ms/frame rAF throttling GAP-008 exists to avoid on a
   * backgrounded tab) while still being fast enough for ordinary async UI (AJAX responses,
   * toasts, animations settling). It CAN miss a state that's true for less than ~100ms — a
   * visibility "flicker" (confirmed live, `audit-2/probe-flicker.mjs`: a ~30-60ms on-window is
   * unreliably caught; ~150ms+ is reliably caught) — and it adds up to ~100ms of latency to
   * every `visible`/`hidden` wait that would otherwise return in single-digit ms. Tightening
   * this further trades detection latency for CDP call volume on every wait in the codebase;
   * 100ms was kept as the safer default rather than re-tuned without a broader benchmark.
   */
  private async waitForVisibleWithPolling(
    page: Page,
    fullSelector: string,
    waitMs: number,
    pollMs = 100,
  ): Promise<ElementHandle<Element> | null> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const handle = await this.firstVisibleHandleAnyFrame(page, fullSelector);
      if (handle) return handle;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
    }
  }

  /**
   * GAP-011: `timeoutMs <= 0` means "check once, don't wait" — a single immediate evaluation of
   * the requested state with no timer/race of any kind (unlike the old behavior, which clamped
   * to a 1ms Puppeteer `waitForSelector` call that still raced a real 1ms timer and could lose
   * even when the element was already in the requested state).
   */
  private async checkWaitForSelectorOnce(
    page: Page,
    selector: string,
    fullSelector: string,
    state: WaitForSelectorState,
  ): Promise<Record<string, unknown>> {
    if (state === 'attached') {
      const handle = await this.firstAnyHandleAnyFrame(page, fullSelector);
      if (!handle) {
        throw new Error(await this.describeWaitForSelectorTimeout(page, selector, fullSelector, 'attached', 0));
      }
      return { foundSelector: selector, state };
    }
    if (state === 'visible') {
      const handle = await this.firstVisibleHandleAnyFrame(page, fullSelector);
      if (!handle) {
        throw new Error(await this.describeWaitForSelectorTimeout(page, selector, fullSelector, 'visible', 0));
      }
      return { foundSelector: selector, state };
    }
    // hidden
    const matchedAtStart = await this.probeSelectorMatchExists(page, fullSelector);
    let hiddenVerdict: FrameSetHiddenVerdict;
    try {
      // GAP-057: a single check-once pass can also come back 'unknown' (a busy frame that
      // didn't answer within its bound) — with no retry loop to fall back on here, 'unknown'
      // is treated as "not confirmed hidden" (same as 'visible'), never as a false success.
      hiddenVerdict = await this.isHiddenInEveryFrame(page, fullSelector);
    } catch (err) {
      // GAP-134 (FR2-01 audit-6): same hard-failure prefix as the polling path above — never a
      // confirmed timeout outcome, so the MCP layer must never read it as one.
      throw new Error(`${WAIT_HIDDEN_HARD_FAILURE_PREFIX} ${(err as Error)?.message ?? String(err)}`);
    }
    if (hiddenVerdict !== 'hidden') {
      // GAP-082 (9th site — this check-once path collapsed 'unknown' into the SAME "still
      // visible" message as a confirmed-visible verdict, exactly like `waitForHiddenInAllFrames`
      // did before this fix round, one call path over. Same fix, same reasoning: an honest
      // "couldn't verify" must never read the same as a confirmed negative.
      const detail =
        hiddenVerdict === 'unknown'
          ? WAIT_HIDDEN_COULD_NOT_VERIFY_FRAGMENT
          : `an element matching "${selector}" ${WAIT_HIDDEN_CONFIRMED_VISIBLE_FRAGMENT}`;
      throw new Error(`wait_for_selector timed out after 0ms waiting for state=hidden: ${detail}.`);
    }
    const otherVisible = await this.countOtherVisibleMatches(page, fullSelector).catch(() => ({
      count: 0,
      unconfirmed: true,
    }));
    const out: Record<string, unknown> = { foundSelector: selector, state: 'hidden', matchedAtStart };
    if (otherVisible.count > 0) out.otherVisibleMatches = otherVisible.count;
    if (otherVisible.unconfirmed) out.otherVisibleMatchesUnknown = true;
    return out;
  }

  /**
   * GAP-016: best-effort count of matches AFTER each live frame's first match that are
   * themselves visible — the `hidden` state's counterpart to the `visible` path's "later
   * match(es) are [visible]" diagnosis. A `hidden` wait succeeds as soon as every frame's FIRST
   * match is gone/hidden; this surfaces the case where some LATER match (e.g. a second
   * `#banner` node) is still visible, which would otherwise succeed silently.
   *
   * GAP-085 (FR2-01 audit-4/fix-4): previously wrapped the WHOLE per-frame loop in one flat
   * 500ms `Promise.race` and silently resolved to `0` on timeout — indistinguishable from "every
   * frame confirmed zero other visible matches", so the GAP-016 advisory warning could disappear
   * with no trace it was ever computed. Now every live frame's `$$eval` is bounded and run in
   * PARALLEL (same `raceBounded`/{@link FRAME_PROBE_TIMEOUT_MS} primitive as the rest of this
   * file's frame probes), and the result reports whether any frame's probe timed out
   * (`unconfirmed: true`) alongside whatever count the frames that DID answer contributed — the
   * caller surfaces that uncertainty instead of a silently-wrong zero.
   */
  private async countOtherVisibleMatches(
    page: Page,
    fullSelector: string,
  ): Promise<{ count: number; unconfirmed: boolean }> {
    const frames = this.liveFramesOf(page);
    let unconfirmed = false;
    const perFrame = await Promise.all(
      frames.map(async (frame) => {
        if (typeof frame.$$eval !== 'function') return 0; // no $$eval support at all — skip
        try {
          const outcome = await this.raceBounded(
            frame.$$eval(fullSelector, (els) =>
              els.map((el) => {
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return !['hidden', 'collapse'].includes(s.visibility) && r.width > 0 && r.height > 0;
              }),
            ),
            FRAME_PROBE_TIMEOUT_MS,
          );
          if (outcome === BOUNDED_TIMED_OUT) {
            unconfirmed = true;
            return 0;
          }
          return outcome.slice(1).filter(Boolean).length;
        } catch (err) {
          // GAP-113 (FR2-01 audit-5/fix-5): a genuine per-frame THROWN error (as opposed to the
          // TIMEOUT case above, which fix-4 already handled) previously fell through a
          // `.catch(() => null)` INSIDE the `$$eval` chain and read as a confirmed zero
          // (`unconfirmed` staying `false`) — silently dropping the `otherVisibleMatches`
          // advisory with false confidence (live-reproduced, audit-5 probe A3). A single
          // frame's own execution context being destroyed by an ordinary in-page navigation is
          // still a recoverable per-frame hiccup (same precedent as `pierceFirstMatch`'s
          // `isContextDestroyedError` handling) — that frame genuinely has nothing to
          // contribute this pass, so it's excluded without flipping `unconfirmed`. Any OTHER,
          // unrecognized error defaults to unconfirmed, not a confirmed zero.
          // GAP-217: a closed TAB also surfaces as context-destroyed; that is not a recoverable
          // per-frame hiccup, so it must not read as a confirmed zero.
          if (this.isContextDestroyedError(err) && !this.isFrameTabClosed(frame)) return 0;
          unconfirmed = true;
          return 0;
        }
      }),
    );
    return { count: perFrame.reduce((a, b) => a + b, 0), unconfirmed };
  }

  /**
   * Best-effort check of whether ANY live frame currently has a match for `fullSelector`, used
   * to populate `state:'hidden'`'s `matchedAtStart` — a `hidden` wait "succeeds" immediately on a
   * typo'd selector that never matched anything, so this gives a caller a way to tell that apart
   * from a genuine disappearance.
   *
   * GAP-057 (FR2-01 audit-3): this used to run a single whole-probe 500ms race and report
   * `false` — "never matched" — whenever that race timed out, exactly the same
   * timeout-collapsed-into-a-negative-answer bug as {@link isHiddenInEveryFrame}, just for a
   * different consumer. A busy frame could make a selector that DOES match look like a typo.
   * Now each live frame gets its own independently-bounded {@link raceFrameProbe} probe (the
   * same {@link FRAME_PROBE_TIMEOUT_MS} primitive `isHiddenInEveryFrame` uses), run in parallel,
   * and the tri-state result is preserved all the way to the return value: `true` (some frame
   * confirmed a match), `false` (every frame confirmed no match), or `undefined` (at least one
   * frame's probe timed out and no OTHER frame confirmed a match — genuinely unknown, not "no").
   * `undefined` is a deliberate part of `matchedAtStart`'s public shape (`boolean | undefined`),
   * not an omission.
   */
  private async probeSelectorMatchExists(page: Page, fullSelector: string): Promise<boolean | undefined> {
    const live = page.frames().filter((f) => !f.isDetached());
    const targets = live.length > 0 ? live : [page.mainFrame()];
    const verdicts = await Promise.all(
      targets.map((frame) =>
        this.raceFrameProbe(frame, fullSelector).catch((): FrameProbeVerdict => ({ kind: 'unknown' })),
      ),
    );
    let sawUnknown = false;
    for (const verdict of verdicts) {
      if (verdict.kind === 'match') {
        if (typeof verdict.handle.dispose === 'function') void verdict.handle.dispose().catch(() => {});
        return true;
      }
      if (verdict.kind === 'unknown') sawUnknown = true;
    }
    return sawUnknown ? undefined : false;
  }

  /**
   * Best-effort per-frame visibility diagnosis for a `state:'visible'`/`state:'attached'`
   * `wait_for_selector` timeout — mirrors Puppeteer's own `checkVisibility` rule exactly
   * (computed `visibility` not `hidden`/`collapse`, AND a non-empty bounding box; `opacity` is
   * deliberately ignored, same as Puppeteer) so the count/verdict it reports is consistent with
   * what `resolveElement` itself just checked.
   *
   * GAP-083 (FR2-01 audit-4/fix-4): previously ran every frame's `$$eval` sequentially with NO
   * per-frame time limit of its own — only the CALLER ({@link describeWaitForSelectorTimeout})
   * wrapped the whole loop in a single 1000ms race, so a busy neighbor frame's `$$eval` call
   * could eat that entire budget and make this function return `null` — which its caller then
   * read as "nothing to diagnose" and fell through to the "No element found for selector"
   * message, even when the element WAS genuinely attached and this diagnosis simply never got to
   * confirm it. Every frame's `$$eval` is now individually bounded (the same
   * `raceBounded`/{@link FRAME_PROBE_TIMEOUT_MS} primitive the rest of this file's frame probes
   * use) and run in PARALLEL, so one slow frame can no longer starve every other frame's
   * diagnosis. `unconfirmedFrames`/`framesProbed` are reported alongside `total`/`visibleFlags`
   * so a caller can tell "confirmed nothing anywhere" apart from "some frames never answered" —
   * `null` is now returned ONLY when there is truly nothing to report either way (zero visible
   * flags collected AND zero frames timed out/errored — i.e. every live frame either had no
   * live probe to run, or had its own execution context destroyed by an ordinary in-page
   * navigation, a recoverable per-frame hiccup).
   *
   * GAP-112 (FR2-01 audit-5/fix-5): a genuine per-frame THROWN error (e.g. `getComputedStyle`
   * itself throwing for a real element) previously fell through a `.catch(() => null)` INSIDE
   * the `$$eval` chain and was treated identically to "this frame has no live `$$eval` support"
   * — silently contributing to NEITHER `flags` NOR `unconfirmedFrames`, so a diagnosis with a
   * present-and-visible element in one frame and an erroring frame elsewhere could still return
   * `null` overall, and the caller then rendered the false "No element found for selector"
   * (live-reproduced, audit-5 probe A2 — the element genuinely exists). This is the exact same
   * "an unrecognized error must default to unknown, not a confirmed negative" rule fix-4
   * applied to `pierceFirstMatch`/`isHandleVisible`, now applied here too: an unrecognized
   * per-frame error is folded into `unconfirmedFrames` (treated the same as a timeout,
   * `BOUNDED_TIMED_OUT`), and only a genuinely recoverable context-destroyed hiccup (an ordinary
   * in-page navigation, same precedent as `pierceFirstMatch`'s `isContextDestroyedError`
   * handling) is still skipped as "nothing to report from this frame" — and so is a frame that
   * genuinely has no `$$eval` support at all (checked BEFORE calling it, so that legitimate
   * "this frame/selector dialect doesn't support this query" case, which never throws a
   * classifiable runtime error, isn't conflated with GAP-112's actual bug: a real error
   * thrown WHILE evaluating a query the frame DOES support (e.g. `getComputedStyle` itself
   * erroring for a genuinely-present element).
   */
  private async diagnoseSelectorVisibility(
    page: Page,
    fullSelector: string,
  ): Promise<{ total: number; visibleFlags: boolean[]; unconfirmedFrames: number; framesProbed: number } | null> {
    const targets = this.liveFramesOf(page);
    let unconfirmedFrames = 0;
    const perFrame = await Promise.all(
      targets.map(async (frame) => {
        if (typeof frame.$$eval !== 'function') return null; // no $$eval support at all — skip
        try {
          return await this.raceBounded(
            frame.$$eval(fullSelector, (els) =>
              els.map((el) => {
                const s = getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return !['hidden', 'collapse'].includes(s.visibility) && r.width > 0 && r.height > 0;
              }),
            ),
            FRAME_PROBE_TIMEOUT_MS,
          );
        } catch (err) {
          // GAP-217: same tab-closed check as pierceFirstMatch/isHandleVisible — a closed tab's
          // context-destroyed error must abort the diagnosis, not be skipped as "nothing here".
          if (this.isFrameTabClosed(frame)) throw new Error(TAB_CLOSED_MID_WAIT_MESSAGE);
          if (this.isContextDestroyedError(err)) return null;
          return BOUNDED_TIMED_OUT;
        }
      }),
    );
    let flags: boolean[] = [];
    for (const outcome of perFrame) {
      if (outcome === BOUNDED_TIMED_OUT) {
        unconfirmedFrames++;
        continue;
      }
      if (outcome === null) continue;
      flags = flags.concat(outcome);
    }
    if (flags.length === 0 && unconfirmedFrames === 0) return null;
    return { total: flags.length, visibleFlags: flags, unconfirmedFrames, framesProbed: targets.length };
  }

  /**
   * Produces the state-naming timeout message for a `wait_for_selector` `state: 'visible'` or
   * `state: 'attached'` timeout. Wrapped in an overall ~1000ms bound (it fits inside
   * WAIT_FOR_SELECTOR_OUTER_GRACE_MS) so a slow/failing diagnosis can never itself cause the
   * generic, undiagnostic outer-race message to win instead.
   */
  private async describeWaitForSelectorTimeout(
    page: Page,
    selector: string,
    fullSelector: string,
    state: 'visible' | 'attached',
    waitMs: number,
  ): Promise<string> {
    const prefix = `wait_for_selector timed out after ${waitMs}ms waiting for state=${state}: `;
    // GAP-009: this must NEVER fall through to the generic "No element found" message when a
    // match genuinely exists — that includes `state:'attached'` (which used to skip diagnosis
    // entirely) AND the race where `state:'visible'`'s first match IS visible by the time this
    // diagnosis runs (the element became visible right at the end, after the wait itself gave
    // up). `describeMissingElement` is reserved for the case with truly zero live matches.
    const DIAGNOSIS_TIMED_OUT = Symbol('diagnosis-timed-out');
    try {
      const raced = await Promise.race([
        this.diagnoseSelectorVisibility(page, fullSelector),
        new Promise<typeof DIAGNOSIS_TIMED_OUT>((resolve) => setTimeout(() => resolve(DIAGNOSIS_TIMED_OUT), 1000)),
      ]);
      // The overall bound expiring means "could not determine", never "confirmed absent".
      if (raced === DIAGNOSIS_TIMED_OUT) {
        return (
          prefix +
          'the element could not be diagnosed within the time bound (a frame may be busy). This does NOT ' +
          'confirm the element is absent; try a larger timeoutMs.'
        );
      }
      const diagnosis = raced;
      // GAP-083 (FR2-01 audit-4/fix-4): when the diagnosis has NO confirmed-positive evidence
      // (`total === 0`) but some frame(s) never answered within their own bound
      // (`unconfirmedFrames > 0`), that is NOT the same thing as "confirmed zero matches
      // anywhere" — falling through to the generic "No element found" message below would
      // assert a confirmed negative this diagnosis never actually established. This must be
      // checked before the `total > 0` branch is skipped, and must never itself fall through to
      // that generic message.
      if (diagnosis && diagnosis.total === 0 && diagnosis.unconfirmedFrames > 0) {
        return (
          prefix +
          `visibility could not be determined for ${diagnosis.unconfirmedFrames} of ` +
          `${diagnosis.framesProbed} frame(s) — they did not respond within the diagnostic's ` +
          'time bound. This does NOT confirm the element is absent; try a larger timeoutMs.'
        );
      }
      if (diagnosis && diagnosis.total > 0) {
        if (state === 'attached') {
          return (
            prefix +
            `${diagnosis.total} element(s) already match "${selector}". The wait still timed out — ` +
            'this is likely a race where the DOM-presence check did not observe them settle in time; ' +
            'try a larger timeoutMs.'
          );
        }
        // GAP-133 (FR2-01 audit-6) / GAP-218: the `total === 0` branch above already refuses to
        // say "confirmed absent" when a frame never answered — this is the same guard for the
        // PARTIAL case, where at least one frame DID answer (so `total > 0`) but at least one
        // OTHER frame never got to. It must run BEFORE every branch below that makes a claim
        // about "the first match": with a frame unanswered, the answered frames' first match is
        // not necessarily the first match in document order (live: C2c, 2/2 wait + 2/2 check-once).
        if (diagnosis.unconfirmedFrames > 0) {
          return (
            prefix +
            `${diagnosis.total} element(s) match "${selector}" and are attached to the DOM, but visibility ` +
            `could not be fully determined — ${diagnosis.unconfirmedFrames} of ${diagnosis.framesProbed} ` +
            "frame(s) did not respond within the diagnostic's time bound. This does NOT confirm none of " +
            'them is visible; try a larger timeoutMs.'
          );
        }
        if (diagnosis.visibleFlags[0]) {
          return (
            prefix +
            `${diagnosis.total} element(s) match "${selector}" and the first is visible now; it became ` +
            'visible after the wait gave up. This is likely a race at the very end of the timeout; try a ' +
            'larger timeoutMs.'
          );
        }
        const laterVisibleCount = diagnosis.visibleFlags.slice(1).filter(Boolean).length;
        if (laterVisibleCount > 0) {
          return (
            prefix +
            `the first match is not visible, but ${laterVisibleCount} later match(es) are. Visibility is ` +
            'checked on the first match in document order; use a more specific selector.'
          );
        }
        return (
          prefix +
          `${diagnosis.total} element(s) match "${selector}" and are attached to the DOM, but none is ` +
          'visible (display:none, visibility:hidden, or zero width/height). Pass state "attached" if DOM ' +
          'presence is enough.'
        );
      }
    } catch {
      // GAP-217: a failed diagnosis is "unknown", never "no element found". Report a closed tab
      // as such; any other failure as undetermined.
      if (this.isTabClosed(page)) return prefix + TAB_CLOSED_MID_WAIT_MESSAGE;
      return prefix + 'the element could not be diagnosed. This does NOT confirm it is absent.';
    }
    if (this.isTabClosed(page)) return prefix + TAB_CLOSED_MID_WAIT_MESSAGE;
    return prefix + (await this.describeMissingElement(page, selector));
  }

  /**
   * Waits for `handle`'s bounding box to stop changing across two consecutive animation frames
   * before returning — best-effort and bounded, so a genuinely continuously-moving element (a
   * marquee, a live chart) just falls through once `timeoutMs` is spent rather than blocking
   * forever. Without this, a button revealed mid-CSS-transition (a slide-in panel, a modal
   * fading in) is technically visible and unoccluded the instant it's added to the DOM, well
   * before it finishes animating to its final position — nothing else in the click path would
   * catch that, since the click still lands on a real element at a real point, just prematurely.
   */
  private async waitForStableBoundingBox(handle: ElementHandle<Element>, timeoutMs = 1200): Promise<void> {
    await handle.evaluate((el, timeout) => {
      return new Promise<void>((resolve) => {
        const start = performance.now();
        let last: DOMRect | null = null;
        let stableFrames = 0;
        const tick = () => {
          const rect = el.getBoundingClientRect();
          if (last && rect.x === last.x && rect.y === last.y && rect.width === last.width && rect.height === last.height) {
            stableFrames++;
          } else {
            stableFrames = 0;
          }
          last = rect;
          if (stableFrames >= 2 || performance.now() - start > timeout) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, timeoutMs);
  }

  /**
   * Opt-in post-action settle wait (see {@link ActionParams.settle}) — waits for the page to
   * stop actively changing after an action, on the theory (INSIGHTS.md Insight 2) that most
   * real-world flakiness is a race at the STATE TRANSITION after an action fires, not the
   * action itself: a click that fires before a menu finishes rendering its items, a form
   * submit whose success toast hasn't appeared yet when the next action reads the page.
   *
   * Runs two independent checks in parallel, both bounded by `spec.timeoutMs` overall:
   *  - DOM-mutation-quiet: a `MutationObserver` on `document.body` (subtree, all mutation
   *    types) resolves once `spec.mutationQuietMs` passes with zero observed mutations.
   *  - Network-idle: Puppeteer's own `page.waitForNetworkIdle`, which tracks real in-flight
   *    requests via CDP — not reimplemented here since Puppeteer already does this correctly.
   *
   * Neither check throws on timeout — a page with continuous background chatter (an ad
   * refreshing, a polling widget, a live ticker) will never go fully quiet on its own, and that
   * is not a bug in the page or in this wait; it just means the bound was reached. Best-effort,
   * same philosophy as {@link waitForStableBoundingBox}.
   */
  private async waitForSettle(page: Page, spec: Required<SettleSpec>): Promise<void> {
    const domQuiet = page
      .evaluate((quietMs, boundMs) => {
        return new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const done = () => {
            observer.disconnect();
            clearTimeout(timer);
            resolve();
          };
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(done, quietMs);
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          // Start the quiet timer immediately too — a page that never mutates at all should
          // resolve after `quietMs`, not wait for a mutation that's never coming.
          timer = setTimeout(done, quietMs);
          // Absolute upper bound regardless of ongoing mutations.
          setTimeout(done, boundMs);
        });
      }, spec.mutationQuietMs, spec.timeoutMs)
      .catch(() => {}); // a page mid-navigation when this evaluates is not a settle failure

    const networkIdle = page
      .waitForNetworkIdle({ idleTime: spec.networkIdleMs, timeout: spec.timeoutMs })
      .catch(() => {}); // timeout here just means "still busy after the bound" — not an error

    await Promise.all([domQuiet, networkIdle]);
  }

  /**
   * Click `selector`, but first verify the element is actually the topmost node at its
   * own click point, and afterward verify the click event was actually delivered to it.
   *
   * Two independent failure modes can make Puppeteer's plain `page.click()` report success
   * on a click that never really landed:
   *  1. Occlusion — if another element (an overlay, a sticky header, a duplicate node
   *     matching the same selector) is topmost at the element's bounding-box center, the
   *     real click event goes to that element instead while `page.click()` still resolves
   *     cleanly.
   *  2. A reproduced upstream Puppeteer/CDP defect where `ElementHandle.click()`'s
   *     `Input.dispatchMouseEvent`-based click can silently fail to deliver the click event
   *     to the page at all — observed specifically on a tab that previously underwent a
   *     click-triggered navigation — while still resolving without throwing. A plain
   *     JS-level `element.click()` reliably delivers the event even in that state, so it's
   *     used as an automatic fallback when delivery isn't observed.
   *
   * Operates entirely through the resolved `ElementHandle` (never re-querying by selector)
   * so it works uniformly whether the element lives in the main frame, a nested iframe, or an
   * open shadow root — `elementFromPoint` is called against the element's own root node
   * (its shadow root, if any, otherwise its document), since `document.elementFromPoint`
   * alone would miss elements inside a shadow tree.
   */
  private async verifiedClick(
    page: Page,
    selector: string,
    button: 'left' | 'right' | 'middle' = 'left',
    offset?: { x: number; y: number },
  ): Promise<void> {
    const handle = await this.resolveElement(page, toPuppeteerQuery(selector), {
      visible: true,
      timeoutMs: 5000,
    });
    if (!handle) {
      // describeMissingElement's message starts with "No element found..." — click's own
      // convention says "No visible element found..." (it requires visibility, unlike most
      // other actions), so that distinction is prepended rather than lost.
      const generic = await this.describeMissingElement(page, selector);
      throw new Error(generic.replace('No element found', 'No visible element found'));
    }
    await this.assertNotStale(handle, selector);
    await this.verifiedClickOnHandle(handle, selector, button, offset);
  }

  /**
   * The actual occlusion-check-then-click logic, operating on an already-resolved handle
   * instead of a selector — split out so callers that need a resolution strategy
   * {@link resolveElement}'s `pierce/` prefix can't express (e.g. `click_by_role`'s `aria/`
   * selector, which must reach `resolveElement` unprefixed) can still get the same
   * occlusion/stability/delivery verification as a normal selector-driven click.
   * `selector` here is used only for error messages.
   */
  private async verifiedClickOnHandle(
    handle: ElementHandle<Element>,
    selector: string,
    button: 'left' | 'right' | 'middle' = 'left',
    offset?: { x: number; y: number },
  ): Promise<void> {
    // Bring the element into the viewport BEFORE checking what's on top of it. Without this,
    // any element below the fold (a real, common case — e.g. a button revealed by scrolling a
    // cart/checkout page) has its click point outside the visible viewport, so
    // `elementFromPoint` returns null there and the occlusion check below wrongly reports the
    // element as "occluded" even though nothing is actually covering it.
    await handle.scrollIntoView().catch(() => {});

    // A button revealed mid-CSS-transition (e.g. a slide-in panel) is technically visible and
    // occlusion-free the instant it's added to the DOM, well before it's finished animating to
    // its final position — clicking immediately lands on a real element at a real point, so
    // nothing here would otherwise catch it, yet the interaction is semantically premature.
    // Wait for its bounding box to stop changing across consecutive animation frames (bounded,
    // best-effort — a genuinely continuously-moving element just falls through once the budget
    // is spent, rather than blocking forever).
    await this.waitForStableBoundingBox(handle).catch(() => {});

    const isHit = await handle.evaluate((el, off) => {
      const rect = el.getBoundingClientRect();
      const cx = off ? rect.x + off.x : rect.x + rect.width / 2;
      const cy = off ? rect.y + off.y : rect.y + rect.height / 2;
      const root = el.getRootNode() as Document | ShadowRoot;
      const topEl =
        typeof (root as ShadowRoot & { elementFromPoint?: unknown }).elementFromPoint === 'function'
          ? (root as unknown as { elementFromPoint(x: number, y: number): Element | null }).elementFromPoint(cx, cy)
          : document.elementFromPoint(cx, cy);
      return !!topEl && (topEl === el || el.contains(topEl) || topEl.contains(el));
    }, offset ?? null);
    if (!isHit) {
      throw new Error(
        `Element matching "${selector}" is occluded by another element at its click point — a click would not reach the intended target`,
      );
    }

    // A right-click's real signal is a 'contextmenu' event, and a middle-click's real signal is
    // 'auxclick' (per spec — 'click' is reserved for the primary/left button) — a left click is
    // the only one that fires 'click'. Listening for the wrong one would always read as "not
    // delivered" and wrongly trigger the JS-click fallback below, which can only ever simulate a
    // *left* click — found live: a real middle-click on a `target="_blank"` link genuinely opened
    // one new tab (confirmed via a real 'auxclick' event), but because the delivery check only
    // distinguished 'right' from everything else, it (mis)judged the middle-click undelivered and
    // fired the left-click fallback too, opening a SECOND, duplicate tab. So the marker/fallback
    // logic must be button-aware for all three values, not just left-vs-right.
    const deliveryEvent = button === 'right' ? 'contextmenu' : button === 'middle' ? 'auxclick' : 'click';

    await handle.evaluate((el, evtName) => {
      const target = el as HTMLElement & { __ptClicked?: boolean };
      target.__ptClicked = false;
      target.addEventListener(evtName, () => { target.__ptClicked = true; }, { once: true, capture: true });
    }, deliveryEvent);

    // A click whose synchronous onclick handler opens a native dialog (alert/confirm/prompt)
    // blocks Chrome's own click dispatch until the dialog is dismissed — CDP's input dispatch
    // waits for in-page synchronous handlers to finish running. Race it against a short
    // timeout instead of silently waiting out BrowserTab's dialog auto-dismiss window, so a
    // dialog-triggering click still returns promptly and the caller gets a real chance to see
    // and handle the dialog (via getPendingDialog/handleDialog) before it's auto-dismissed.
    // The original click promise is left to settle in the background either way — swallowing
    // its eventual outcome so a late rejection can't surface as an unhandled rejection.
    await Promise.race([
      handle.click({ button, offset }).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);

    // If the click itself triggered a navigation, the handle evaluating this check may already
    // be mid-teardown ("Execution context was destroyed") — that's strong evidence the click
    // WAS delivered (you can't navigate without the click/submit handler firing), so treat
    // that specific failure as "delivered" rather than triggering the fallback click below.
    //
    // If the click instead triggered a native dialog (alert/confirm/prompt), the page's
    // renderer is now synchronously blocked and this evaluate call won't resolve until the
    // dialog is handled (by the caller via handleDialog, or by BrowserTab's own auto-dismiss
    // safety net) — race it against a short timeout rather than silently waiting out that
    // entire window, so a dialog-triggering click still returns promptly and the caller gets
    // a real chance to see and handle the dialog before it's auto-dismissed.
    const delivered = await Promise.race([
      handle
        .evaluate((el) => !!(el as HTMLElement & { __ptClicked?: boolean }).__ptClicked)
        .catch(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1500)),
    ]);

    if (!delivered) {
      if (button === 'right') {
        // There's no `element.click()`-equivalent single call for a right-click; dispatch a
        // synthetic contextmenu event directly instead.
        await handle.evaluate((el) => {
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
        });
      } else if (button === 'middle') {
        // Same reasoning as the right-click branch — `element.click()` can only ever simulate a
        // *left* click, so a middle-click's fallback must dispatch a real 'auxclick' instead.
        await handle.evaluate((el) => {
          el.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
        });
      } else {
        await handle.evaluate((el) => (el as HTMLElement).click());
      }
    }
  }

  /** Same occlusion check as {@link verifiedClick}, applied before hovering. */
  private async verifiedHover(page: Page, selector: string, offset?: { x: number; y: number }): Promise<void> {
    const handle = await this.resolveElement(page, toPuppeteerQuery(selector), {
      visible: true,
      timeoutMs: 5000,
    });
    if (!handle) {
      throw new Error(`No visible element found for selector: ${selector}`);
    }
    await this.assertNotStale(handle, selector);

    // Bring the element into the viewport BEFORE checking what's on top of it. Without this,
    // any element below the fold (a real, common case — e.g. a button revealed by scrolling a
    // cart/checkout page) has its click point outside the visible viewport, so
    // `elementFromPoint` returns null there and the occlusion check below wrongly reports the
    // element as "occluded" even though nothing is actually covering it.
    await handle.scrollIntoView().catch(() => {});

    // A button revealed mid-CSS-transition (e.g. a slide-in panel) is technically visible and
    // occlusion-free the instant it's added to the DOM, well before it's finished animating to
    // its final position — clicking immediately lands on a real element at a real point, so
    // nothing here would otherwise catch it, yet the interaction is semantically premature.
    // Wait for its bounding box to stop changing across consecutive animation frames (bounded,
    // best-effort — a genuinely continuously-moving element just falls through once the budget
    // is spent, rather than blocking forever).
    await this.waitForStableBoundingBox(handle).catch(() => {});

    const point = await handle.evaluate((el, off) => {
      const rect = el.getBoundingClientRect();
      const cx = off ? rect.x + off.x : rect.x + rect.width / 2;
      const cy = off ? rect.y + off.y : rect.y + rect.height / 2;
      const root = el.getRootNode() as Document | ShadowRoot;
      const topEl =
        typeof (root as ShadowRoot & { elementFromPoint?: unknown }).elementFromPoint === 'function'
          ? (root as unknown as { elementFromPoint(x: number, y: number): Element | null }).elementFromPoint(cx, cy)
          : document.elementFromPoint(cx, cy);
      const isHit = !!topEl && (topEl === el || el.contains(topEl) || topEl.contains(el));
      return { cx, cy, isHit };
    }, offset ?? null);
    if (!point.isHit) {
      throw new Error(
        `Element matching "${selector}" is occluded by another element at its hover point — a hover would not reach the intended target`,
      );
    }
    // ElementHandle.hover() always targets the element's center with no offset option — moving
    // the mouse to the exact (possibly offset) point directly is what actually supports hovering
    // a specific pixel within canvas-rendered UI, same as the offset-aware click above.
    if (offset) {
      await page.mouse.move(point.cx, point.cy);
    } else {
      await handle.hover();
    }
  }

  /**
   * Reject a target that comes from an older `browser.snapshot` than the page's current one.
   * Node ids are re-stamped fresh on every snapshot (along with a generation marker); if the
   * page has been re-snapshotted since a given id was handed out, blindly acting on it can hit
   * a different element than the caller intended. No-ops for a plain CSS selector the caller
   * wrote by hand (it won't carry a generation stamp at all).
   *
   * Reads `el.ownerDocument`, which resolves correctly to the element's own document whether
   * it's in the main frame, a nested iframe, or an open shadow root (shadow trees don't get
   * their own `Document` — they share the page's, unlike iframes).
   */
  /**
   * Produce a clear, actionable "element not found" message for a selector that failed to
   * resolve — distinguishing the two real causes an agent can't tell apart from the old generic
   * message alone (found as GLM field-report A5): a snapshot node id from BEFORE a navigation
   * (the whole document, and its `data-sd-current-gen` marker, is gone — `assertNotStale` never
   * even gets a handle to check, since resolution failed before it would run), versus a node id
   * that's simply wrong/never existed in the CURRENT snapshot generation. A hand-written CSS
   * selector (not a `data-sd-node-id` snapshot id) gets the original generic message unchanged —
   * there's no generation concept for it to diagnose.
   */
  private async describeMissingElement(page: Page, selector: string): Promise<string> {
    const nodeIdMatch = selector.match(/data-sd-node-id="(\d+)"/);
    if (!nodeIdMatch) {
      return `No element found for selector: ${selector}`;
    }
    const nodeId = nodeIdMatch[1];
    const currentGen = await page
      .evaluate((attr) => document.documentElement.getAttribute(attr), SD_CURRENT_GENERATION_ATTR)
      .catch(() => null);
    if (!currentGen) {
      return (
        `No element found for selector: ${selector} — the page navigated since the last ` +
        'snapshot (or none has been taken yet this document). Call browser.snapshot again and ' +
        'use a fresh node id.'
      );
    }
    return (
      `No element found for selector: ${selector} — node id ${nodeId} is not present in the ` +
      'current snapshot generation. Call browser.snapshot again and use a fresh node id.'
    );
  }

  private async assertNotStale(handle: ElementHandle<Element>, selector: string): Promise<void> {
    // Single evaluate() call checking two independent staleness signals, kept as one round trip
    // (not two) so this stays a drop-in call-count match for every existing test mock's
    // evaluate() sequence.
    //
    // 1. Generation mismatch: a NEW snapshot has been taken since this element was stamped —
    //    the classic case.
    // 2. Fingerprint mismatch: the element's live text no longer matches its snapshot-time text,
    //    even though its generation is unchanged. Catches a virtualized/windowed list
    //    (react-window, MUI DataGrid, etc.) recycling the SAME DOM node for a different logical
    //    row via scroll, with no new snapshot involved — the recycled node's id/generation
    //    attributes never change, only its content does. Found live: a node id captured for one
    //    row silently and confidently clicked a completely different row after a scroll (see
    //    PROB-036). Elements with no stamped fingerprint (an older snapshot generation predating
    //    this check) are skipped, not false-flagged.
    const reason = await handle.evaluate(
      (el, genAttr, currentGenAttr, fpAttr) => {
        const elGen = el.getAttribute(genAttr);
        const currentGen = el.ownerDocument.documentElement.getAttribute(currentGenAttr);
        if (!!elGen && !!currentGen && elGen !== currentGen) return 'generation';

        const storedFp = el.getAttribute(fpAttr);
        if (storedFp) {
          const inputEl = el as HTMLInputElement;
          const liveText = (
            el.getAttribute('aria-label') ||
            (el as HTMLElement).innerText?.slice(0, 100) ||
            inputEl.placeholder ||
            inputEl.value ||
            ''
          )
            .trim()
            .slice(0, 60);
          if (liveText !== storedFp) return 'fingerprint';
        }
        return null;
      },
      SD_GENERATION_ATTR,
      SD_CURRENT_GENERATION_ATTR,
      SD_FINGERPRINT_ATTR,
    );
    if (reason === 'generation') {
      throw new Error(
        `Element matching "${selector}" is from a stale snapshot (the page has been re-snapshotted since) — call browser.snapshot again and use a fresh node id.`,
      );
    }
    if (reason === 'fingerprint') {
      // Deliberately a WARNING, not a thrown error — unlike the generation check above, a
      // fingerprint mismatch is genuinely ambiguous, not a reliable staleness signal on its
      // own. Live-tested both directions: (1) a virtualized-list row genuinely recycled to a
      // different logical row produces this exact signal (the original PROB-036 case), but (2)
      // so does completely ordinary, correct usage — a "Buy at $X" button whose price ticks up
      // via a timer, a relative timestamp ("2 minutes ago"), a live view/like counter — where
      // the SAME row's own content legitimately changed and clicking it is exactly the right
      // thing to do. A first attempt at this fix threw here unconditionally and was caught by
      // testing case (2) live: it hard-blocked (and kept blocking across all retries) a
      // completely legitimate click on a page with nothing virtualized at all — a worse
      // regression than the bug it fixed, since live-updating content is far more common than
      // list-recycling. Logging (discoverable via `get_console_logs`/action history) instead of
      // throwing keeps PROB-036's case non-silent without breaking the common case.
      this.logger.warn(
        `[BrowserActionEngine] Element matching "${selector}" shows different content than when it was ` +
          `snapshotted — proceeding, but if this element is inside a virtualized/windowed list this may be ` +
          `acting on a recycled node's new row rather than the originally-intended one. Re-snapshot to confirm ` +
          `if the target's identity matters here.`,
      );
    }
  }
}
