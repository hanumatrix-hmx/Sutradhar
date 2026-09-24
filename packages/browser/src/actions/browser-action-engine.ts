/**
 * @file packages/browser/src/actions/browser-action-engine.ts
 * @description Core BrowserActionEngine executing 19 browser actions with retries, timeout, and event emission.
 *
 * Every selector-targeted action resolves its target across the page's frames (iframes, at
 * any nesting depth) and through open shadow roots within each frame — see {@link resolveElement}.
 */

import os from 'node:os';
import path from 'node:path';
import { realpath, access } from 'node:fs/promises';
import { EventBus } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';
import { SessionId } from '@sutradhar/contracts';
import { ElementHandle, KeyInput, Page } from 'puppeteer-core';
import { IBrowserTab } from '../session/browser-tab.js';
import { ExecutionVerifier } from '../verifier/execution-verifier.js';
import { SD_GENERATION_ATTR, SD_CURRENT_GENERATION_ATTR, SD_FINGERPRINT_ATTR } from '../dom/dom-semantic-engine.js';
import { ActionParams, ActionResultDto, SettleSpec } from './action-types.js';

export interface IBrowserActionEngine {
  executeAction(tab: IBrowserTab, params: ActionParams): Promise<ActionResultDto>;
}

/**
 * True if `candidate` is `root` itself or nested under it. Windows' filesystem is
 * case-insensitive (NTFS preserves case but doesn't distinguish it), but `fs.realpath` only
 * normalizes a path to its on-disk case when the target actually **exists** — a not-yet-created
 * subdirectory falls back to whatever case the caller happened to pass in. Found live: requesting
 * a new subdirectory under an allowed root whose case differs from the root's own on-disk case
 * (e.g. the root resolves to `C:\WINDOWS\TEMP` but the caller's literal string starts
 * `C:\Windows\Temp\...`) made this comparison — plain `===`/`startsWith` on the two strings —
 * false-reject a request that was genuinely inside the allowed root. Comparing case-insensitively
 * on Windows only (POSIX filesystems are case-sensitive by default, and a case-insensitive check
 * there could wrongly ALLOW a path that is actually a different, disallowed file) fixes it without
 * weakening the containment check itself.
 */
function isPathWithinRoot(candidate: string, root: string): boolean {
  const [c, r] = process.platform === 'win32' ? [candidate.toLowerCase(), root.toLowerCase()] : [candidate, root];
  return c === r || c.startsWith(r + path.sep);
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
    this.allowedDownloadRoots = (allowedDownloadRoots ?? [path.join(os.tmpdir(), 'sutradhar-downloads')]).map(
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

    const canonical = await realpath(resolved).catch(() => resolved);
    for (const root of this.allowedUploadRoots) {
      const canonicalRoot = await realpath(root).catch(() => root);
      if (isPathWithinRoot(canonical, canonicalRoot)) return;
    }
    throw new Error(
      `Upload file "${filePath}" is outside the allowed upload directories ` +
        `(${this.allowedUploadRoots.join(', ')}).`,
    );
  }

  /**
   * Resolve the requested download directory (defaulting to the first allowed root when none
   * is given) and reject it outright if it doesn't fall under one of {@link allowedDownloadRoots}
   * — prevents an MCP caller from directing a real CDP download to an arbitrary filesystem
   * location.
   *
   * Containment is checked against the REAL (symlink-resolved) path of both the requested
   * directory and each allowed root, not just the literal string — a plain prefix check on
   * the un-resolved paths can be defeated by a symlink/junction sitting inside (or standing
   * in for) an allowed root that actually points somewhere else entirely (e.g. a shared temp
   * dir containing a junction to a sensitive location). `fs.realpath` requires the target to
   * exist; a directory that doesn't exist yet can't meaningfully be symlink-checked, so it
   * falls back to the literal resolved path — a nonexistent target fails loudly downstream
   * (CDP/fs) instead of silently bypassing this check either way.
   */
  private async resolveDownloadDir(requested: string | undefined): Promise<string> {
    const resolved = requested ? path.resolve(requested) : this.allowedDownloadRoots[0]!;
    const canonical = await realpath(resolved).catch(() => resolved);

    for (const root of this.allowedDownloadRoots) {
      const canonicalRoot = await realpath(root).catch(() => root);
      if (isPathWithinRoot(canonical, canonicalRoot)) {
        return resolved;
      }
    }

    throw new Error(
      `downloadDir "${requested}" is outside the allowed download directories ` +
        `(${this.allowedDownloadRoots.join(', ')}). Pass a path under one of these, or configure ` +
        'additional allowed roots when constructing the runtime.',
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
    const duplicateError = this.checkDuplicateAction(tab.id, params);
    if (duplicateError) {
      return duplicateError;
    }

    const startTime = Date.now();
    const timeoutMs = params.timeoutMs ?? 15000;
    const maxRetries = params.maxRetries ?? 2;
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
      try {
        const dispatchPromise = this.dispatchAction(tab, params);
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
          let graceTimer: ReturnType<typeof setTimeout>;
          await Promise.race([
            inFlightDispatch.catch(() => {}),
            new Promise((r) => { graceTimer = setTimeout(r, TIMEOUT_SETTLEMENT_GRACE_MS); }),
          ]);
          clearTimeout(graceTimer!);
        }

        this.logger.warn(
          `[BrowserActionEngine] Action ${params.actionType} failed (attempt ${attempt}/${maxRetries + 1}): ${lastError.message}`,
        );
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
        const buf = await tab.page.screenshot({ encoding: 'base64' });
        failureScreenshot = String(buf);
      } catch {
        // best-effort — leave undefined
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
   *
   * The timeout's own `setTimeout` is cleared as soon as either side of the race settles. Left
   * running, a won-by-dispatch race (the common case) would leave a referenced timer alive for
   * up to the full `timeoutMs` — keeping Node's event loop open that whole time and delaying
   * process exit in one-shot callers like the CLI (found live: `sutradhar wait` took ~3s to
   * actually exit after printing its result, because this dangling timer kept the loop alive
   * past the CDP disconnect until the CLI's own force-exit fallback fired).
   */
  private async raceWithTimeout<T>(dispatchPromise: Promise<T>, actionType: string, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(this.timeoutMessage(actionType, timeoutMs))), timeoutMs);
    });
    try {
      return await Promise.race([dispatchPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private timeoutMessage(actionType: string, timeoutMs: number): string {
    return `Action ${actionType} timed out after ${timeoutMs}ms`;
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
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
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
          const handle = await this.resolveElement(page, `pierce/${params.selector}`, { timeoutMs: 5000 });
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
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
          timeoutMs: params.timeoutMs ?? 10000,
        });
        if (!handle) throw new Error(await this.describeMissingElement(page, params.selector));
        return { foundSelector: params.selector };
      }

      case 'select_option': {
        const values = params.values?.length ? params.values : params.value ? [params.value] : undefined;
        if (!params.selector || !values) {
          throw new Error("SelectOption requires selector and either 'value' or 'values'");
        }
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute select_option.`);
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
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
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
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
        const source = await this.resolveElement(page, `pierce/${params.selector}`, { timeoutMs: 5000 });
        if (!source) throw new Error(`No element found for source selector: ${params.selector}`);
        const target = await this.resolveElement(page, `pierce/${params.targetSelector}`, { timeoutMs: 5000 });
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
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
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
        // Downloads must be configured on a *browser*-level CDP session, not a page-level one —
        // `Page.setDownloadBehavior`/`Page.downloadWillBegin`/`Page.downloadProgress` are
        // deprecated and don't fire in Chrome's current ("new") headless mode; the replacement
        // `Browser.*` equivalents only exist on the browser target's own session.
        const client = await page.browser().target().createCDPSession();
        await client.send('Browser.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: downloadDir,
          eventsEnabled: true,
        });

        const downloadTimeoutMs = params.timeoutMs ?? 30000;
        let cleanup = (): void => {};
        const downloadPromise = new Promise<{ filename: string; path: string }>((resolve, reject) => {
          let suggestedFilename: string | undefined;
          const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Download did not complete within ${downloadTimeoutMs}ms`));
          }, downloadTimeoutMs);

          const onWillBegin = (evt: { suggestedFilename: string }): void => {
            suggestedFilename = evt.suggestedFilename;
          };
          const onProgress = (evt: { state: string; guid: string }): void => {
            if (evt.state === 'completed') {
              cleanup();
              const filename = suggestedFilename ?? evt.guid;
              resolve({ filename, path: path.join(downloadDir, filename) });
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

        try {
          await this.verifiedClick(page, params.selector, 'left');
          const downloaded = await downloadPromise;
          return { downloadedFilename: downloaded.filename, downloadedPath: downloaded.path, downloadDir };
        } catch (err) {
          cleanup();
          throw err;
        } finally {
          await client.detach().catch(() => {});
        }
      }

      case 'upload_file': {
        if (!params.selector || !params.filePath) {
          throw new Error('UploadFile action requires selector and filePath parameters');
        }
        if (!page) throw new Error(`No live browser page for tab ${tab.id} — cannot execute upload_file.`);
        await this.assertUploadPathAllowed(params.filePath);
        const handle = await this.resolveElement(page, `pierce/${params.selector}`, {
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
    const handle = await this.resolveElement(page, `pierce/${selector}`, {
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
    {
      let clickRaceTimer: ReturnType<typeof setTimeout>;
      await Promise.race([
        handle.click({ button, offset }).catch(() => {}),
        new Promise<void>((resolve) => { clickRaceTimer = setTimeout(resolve, 1500); }),
      ]);
      clearTimeout(clickRaceTimer!);
    }

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
    let deliveredRaceTimer: ReturnType<typeof setTimeout>;
    const delivered = await Promise.race([
      handle
        .evaluate((el) => !!(el as HTMLElement & { __ptClicked?: boolean }).__ptClicked)
        .catch(() => true),
      new Promise<boolean>((resolve) => { deliveredRaceTimer = setTimeout(() => resolve(true), 1500); }),
    ]);
    clearTimeout(deliveredRaceTimer!);

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
    const handle = await this.resolveElement(page, `pierce/${selector}`, {
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
