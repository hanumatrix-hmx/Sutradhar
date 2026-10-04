/**
 * @file packages/sutradhar/src/page.ts
 * @description Puppeteer-style {@link Page} — a handle to a single browser tab. All verbs
 * delegate to the proven {@link SutradharRuntime} substrate, so behavior is identical to the
 * MCP server and the REST API.
 */

import path from 'node:path';
import type {
  SutradharRuntime,
  SnapshotResult,
  StorageState,
  SettleSpec,
  WaitForSelectorState,
  AuditReport,
  ActionExpectation,
  ActionResult,
  DownloadResult,
  NavigateResult,
  PageTextResult,
  ScreenshotResult,
  VerificationResultDto,
} from '@sutradhar/capability-runtime';
import {
  prepareAuditOutDir,
  writeAuditArtifacts,
  buildAuditReport,
  failedExpectations,
} from '@sutradhar/capability-runtime';
import { ActionFailedError, ExpectationFailedError } from './errors.js';

/**
 * FR2-07 arity rule: a trailing `expect` is appended to the runtime call ONLY when the caller gave
 * one so a call without it keeps
 * exactly the argument list it always had.
 */
function expectArg(expect: ActionExpectation | undefined): [ActionExpectation] | [] {
  return expect ? [expect] : [];
}

/**
 * FR2-08 arity rule: `(expect?, settle?)` are appended to a runtime call ONLY up to the last defined one, so a
 * call that gives neither keeps exactly the argument list it always had.
 */
function expectSettleArgs(
  expect: ActionExpectation | undefined,
  settle: boolean | SettleSpec | undefined,
): [ActionExpectation?, (boolean | SettleSpec)?] {
  if (settle !== undefined) return [expect, settle];
  return expect ? [expect] : [];
}

/** The result of the most recent action call on a page. */
export type LastResult = ActionResult | NavigateResult | ScreenshotResult;

/** Options every action accepts. */
export interface ActionOptions {
  /**
   * Assert the effect: `{text?, url?, urlChanged?}`, checked once right after the action (after
   * settle, if requested). A failed expectation throws {@link ExpectationFailedError}; the action
   * itself is NOT undone. `text` is RENDERED text: laid out, `visibility:visible`, not under `display:none` /
   * `content-visibility:hidden` / a closed `<details>`, and every enclosing `<iframe>` itself visible
   * (`opacity:0`, `aria-hidden`, off-screen and clipped text still count).
   */
  expect?: ActionExpectation;
}

/** FR2-08: options of every action that can wait for the page to finish reacting. */
export interface SettleActionOptions extends ActionOptions {
  /**
   * Opt-in: after the action, wait for the page to stop actively changing (no DOM mutations, no in-flight
   * network requests) before returning; `true` uses the defaults (300 ms DOM-quiet, 500 ms network-idle, 5 s
   * bound), an object overrides individual fields. It cannot see a timer the page scheduled for later:
   * use {@link Page.waitFor} to wait for a specific result. Off by default.
   */
  settle?: boolean | SettleSpec;
}

/** Options accepted by {@link Page.goto}. */
export interface GotoOptions extends SettleActionOptions {}

/** Options accepted by {@link Page.download}. */
export interface PageDownloadOptions extends SettleActionOptions {
  /** Destination directory. Must resolve inside an allowed download root (see `LaunchOptions`'s
   *  `allowedDownloadRoots`). Defaults to the first allowed root when omitted. */
  downloadDir?: string;
}

export type { WaitForSelectorState } from '@sutradhar/capability-runtime';

/** Options for {@link Page.audit}. */
export interface PageAuditOptions {
  /** Load this URL first (then wait for it to settle). Omit to audit the page as it is now. */
  url?: string;
  /** Write audit-screenshot.png (and audit-baseline-diff.png) here, creating it if needed;
   *  the report's paths are then absolute. Omit to get the images back as base64 instead. */
  outDir?: string;
  /** Also pixel-diff this URL against a fresh load of the audited page (reloads this tab). */
  baselineUrl?: string;
}

/** Return value of {@link Page.audit}. `report` is exactly the audit-report JSON Schema object
 *  (`packages/capability-runtime/schemas/audit-report.schema.json`, schemaVersion 1). */
export interface PageAuditResult {
  report: AuditReport;
  screenshotBase64: string;
  baselineDiffBase64?: string;
}

/** Options accepted by {@link Page.waitForSelector} (Playwright-style names). */
export interface WaitForSelectorOptions extends ActionOptions {
  /** 'visible' (default) | 'attached' | 'hidden'. */
  state?: WaitForSelectorState;
  /** Milliseconds; defaults to 10000. */
  timeout?: number;
}

/** Options accepted by {@link Page.click} / {@link Page.type}. */
export interface ElementOptions extends ActionOptions {
  /** Click delay in ms (ignored by type/click today; reserved for parity). */
  delay?: number;
  /**
   * Opt-in: after the action, wait for the page to stop actively changing (no DOM mutations,
   * no in-flight network requests) before returning — helps when the action triggers a menu/
   * modal/toast that takes a moment to finish rendering and the very next call needs to see
   * the settled result. `true` uses the defaults; pass an object to override individual
   * fields. Off by default — most actions don't need it and it adds real latency.
   */
  settle?: boolean | SettleSpec;
}

/**
 * Options for {@link Page.waitFor}: the conditions plus a Playwright-style `timeout` (NOT `timeoutMs`).
 * Every given condition must hold at the same moment.
 */
export interface WaitForOptions {
  /** RENDERED text that must appear (any frame, open shadow roots; case-sensitive substring). The same rule and
   *  the same limits as `expect.text` (best effort: text in never-painted SVG containers counts, text split
   *  across inline-block items or in a `<textarea>` can be missed). */
  text?: string;
  /** Rendered text that must be absent from every frame. Met at once if it was never there (see
   *  `lastResult.output.presentAtStart`); a frame that could not be inspected is never read as "gone". */
  textGone?: string;
  /** Substring of the tab URL (pushState/hash changes included). */
  url?: string;
  /** A JS EXPRESSION evaluated in the main frame; truthy = met. Side-effect free (it re-runs ~every 100 ms);
   *  a throw fails the wait at once, so guard it (`window.app?.ready === true`). */
  js?: string;
  /** Milliseconds; default 10000, max 300000, `<= 0` = check once. The real total: no hidden retries. */
  timeout?: number;
}

/** Options accepted by {@link Page.setViewport}. */
export interface SetViewportOptions {
  width: number;
  height: number;
  isMobile?: boolean;
  deviceScaleFactor?: number;
  hasTouch?: boolean;
}

/** Return value of {@link Page.getViewport}. */
export interface ViewportInfo {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
}

/** Options accepted by {@link Page.screenshot}. */
export interface ScreenshotOptions {
  /** Currently always full-page; reserved for parity with Puppeteer. */
  fullPage?: boolean;
  /** 'png' (default) or 'jpeg'. */
  type?: 'png' | 'jpeg';
}

/**
 * A handle to one tab in a {@link Browser}. Mirrors the Puppeteer/Playwright Page surface
 * so it feels native, but every call goes through {@link SutradharRuntime} (the same engine
 * the MCP server and REST API use).
 *
 * @example
 * const page = await browser.newPage();
 * await page.goto('https://example.com');
 * const snap = await page.snapshot();
 * await page.click('7');              // [#7] from the snapshot
 * const png = await page.screenshot();
 */
export class Page {
  private last: LastResult | undefined;

  /** @internal */ public constructor(
    private readonly runtime: SutradharRuntime,
    private readonly sessionId: string,
    /** This page's tab id within the session. */
    public readonly tabId: string,
  ) {}

  /**
   * FR2-07: the full result of this page's most recent action call (`click`, `type`, `press`,
   * `scroll`, `waitForSelector`, `download`, `uploadFile`, `goto`, `screenshot`). It is the uniform
   * way to read `verification` from the calls that return something else (`goto` returns the Page,
   * `screenshot` the base64 string, `waitForSelector` nothing). `undefined` before any action.
   */
  public get lastResult(): LastResult | undefined {
    return this.last;
  }

  /**
   * Records `result` as this page's last result, then applies the contract: `success:false` throws
   * {@link ActionFailedError} (FR2-07 closes GAP-024: click/type/press/scroll used to swallow it),
   * and a given `expect` that did not hold throws {@link ExpectationFailedError}. A built-in
   * contradiction with NO `expect` is NOT thrown: it is on `result.verification`.
   */
  private conclude<R extends ActionResult>(result: R, expect: ActionExpectation | undefined): R {
    this.last = result;
    if (!result.success) throw new ActionFailedError(result);
    if (expect) {
      const failed = failedExpectations(result.verification);
      if (failed.length > 0) throw new ExpectationFailedError(result, failed);
    }
    return result;
  }

  /**
   * Navigate this tab to a URL. Still returns the Page (chaining); the navigation's verification
   * (did a document really commit? HTTP status?) is on {@link Page.lastResult}. With
   * `options.expect`, throws {@link ExpectationFailedError} when the assertion does not hold.
   */
  public async goto(url: string, options?: GotoOptions): Promise<Page> {
    const result = await this.runtime.navigate(
      this.sessionId,
      url,
      this.tabId,
      ...expectSettleArgs(options?.expect, options?.settle),
    );
    this.last = result;
    if (options?.expect) {
      const failed = failedExpectations(result.verification as VerificationResultDto | undefined);
      if (failed.length > 0) throw new ExpectationFailedError(result, failed);
    }
    return this;
  }

  /**
   * Capture an LLM-optimized snapshot of the page. Returns the interactive-element listing
   * (every element stamped with a numeric [#id]) plus visible page text. Use the [#id] as
   * the selector for {@link Page.click} / {@link Page.type}.
   */
  public async snapshot(): Promise<SnapshotResult> {
    return this.runtime.snapshot(this.sessionId, this.tabId);
  }

  /**
   * Read one window of this page's visible text, with the totals, so a long page can be read in full:
   * `let off = 0; do { const r = await page.text({ offset: off }); use(r.text); off += r.returnedChars; } while (off < r.totalChars);`.
   * Defaults: `offset` 0, `maxChars` {@link DEFAULT_PAGE_TEXT_MAX_CHARS} (4000); `maxChars` is at most {@link MAX_PAGE_TEXT_CHARS}.
   *
   * `result.text` is the raw window and never contains the truncation marker; `truncated`, `totalChars`, `offset` and
   * `returnedChars` say what you got (render a marker with {@link formatPageTextMarker} if you want one). A window never
   * splits a UTF-16 surrogate pair, so `returnedChars` can be `maxChars + 1` and `offset` can be one less than requested.
   *
   * Rejects with {@link PageTextReadError} (`error.name === 'PageTextReadError'`) when the text cannot be read, including a
   * PDF whose text cannot be extracted (bundled builds, PROB-052); it never resolves with empty text for a failed read.
   * Invalid `offset`/`maxChars` reject with `TypeError` before the browser is touched.
   */
  public async text(options?: { offset?: number; maxChars?: number }): Promise<PageTextResult> {
    return this.runtime.readTextWindow(this.sessionId, this.tabId, options);
  }

  /**
   * Click an element. `selector` may be a CSS selector OR a numeric [#id] from
   * {@link Page.snapshot} (e.g. `"7"` resolves to `[data-sd-node-id="7"]`).
   */
  public async click(selector: string, options?: ElementOptions): Promise<ActionResult> {
    return this.conclude(
      await this.runtime.click(
        this.sessionId,
        selector,
        this.tabId,
        undefined,
        undefined,
        options?.settle,
        ...expectArg(options?.expect),
      ),
      options?.expect,
    );
  }

  /** Type text into an input targeted by selector or [#id]. */
  public async type(selector: string, text: string, options?: ElementOptions): Promise<ActionResult> {
    return this.conclude(
      await this.runtime.type(this.sessionId, selector, text, this.tabId, options?.settle, ...expectArg(options?.expect)),
      options?.expect,
    );
  }

  /**
   * Wait for `selector` (CSS or a snapshot [#id]) to reach `options.state` ('visible' by
   * default, or 'attached'/'hidden'). Throws on timeout, with a message naming the state it
   * waited for — unlike {@link Page.click}/{@link Page.type}, which swallow a failed result, a
   * wait that returned silently on timeout would be the same silent-wrongness bug class this
   * method exists to fix, so it throws instead (matching Puppeteer/Playwright's own behavior).
   *
   * **'visible'** means the element has a non-empty bounding box (width>0, height>0) AND its
   * computed `visibility` is not `hidden`/`collapse` — checked on the FIRST element the selector
   * matches, in document order. `opacity:0` and off-screen positioning still count as visible;
   * zero size, `display:none`, and `visibility:hidden` count as hidden. **'attached'** only
   * requires DOM presence, visibility ignored. **'hidden'** succeeds immediately if nothing
   * matches the selector at all — double-check the selector if that's not what you expect.
   * `options.timeout` applies to each internal attempt; retries can extend the real total wait
   * beyond it (open issue, tracked as GAP-001).
   */
  /**
   * Wait for `selector` to reach `options.state` — `'visible'` (default), `'attached'` (just in
   * the DOM, visibility ignored), or `'hidden'` (removed or not visible; succeeds immediately if
   * nothing matches). "Visible" means computed visibility not `hidden`/`collapse` AND a
   * non-empty bounding box (opacity is ignored), checked on the FIRST match.
   * `options.timeout` is per internal attempt; retries can extend the real total wait beyond it
   * (open issue) — EXCEPT for the case below. `options.timeout <= 0` checks the current state
   * once, immediately, with no waiting AND no retrying (this is the one case where the "retries
   * can extend the wait" caveat above does not apply — see GAP-058). Waiting states poll roughly
   * every 100ms, so a state that's only true for less than ~100ms (a fast visibility flicker)
   * may be missed. Throws on timeout, with a message naming the state it waited for.
   */
  public async waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void> {
    const r = await this.runtime.waitForSelector(
      this.sessionId,
      selector,
      options?.timeout,
      this.tabId,
      options?.state,
      ...expectArg(options?.expect),
    );
    this.last = r;
    // Still throws a plain Error naming the state waited for (FR2-01), not ActionFailedError: that
    // message is this method's documented contract. The verification is on `lastResult`.
    if (!r.success) throw new Error(r.error ?? `waitForSelector("${selector}") failed`);
    if (options?.expect) {
      const failed = failedExpectations(r.verification);
      if (failed.length > 0) throw new ExpectationFailedError(r, failed);
    }
  }

  /**
   * FR2-08: wait until EVERY given condition holds at the same moment (`text`, `textGone`, `url`, `js`), or
   * `timeout` (default 10000 ms) elapses. Use this instead of sleeping. It polls from Node every ~100 ms, so it
   * works in a background tab and on a strict-CSP page. Returns the result (also on {@link Page.lastResult});
   * THROWS {@link ActionFailedError} on a timeout or a fatal condition (the JS threw, a dialog blocks the page,
   * the tab closed), with the error naming which conditions were met and which were not. A `TypeError` is thrown
   * before any browser contact when the options are invalid (no condition, an empty string, `text` equal to
   * `textGone`, `timeout` not a number or above 300000, an unknown key such as `timeoutMs`).
   *
   * Limits: a dialog already open fails the wait in about 1 s; one that opens partway through a check can take
   * up to about 2.7 s after it opens. On a frozen page a failed wait can spend up to 1.5 s more reading the page
   * title, so the total is bounded but can exceed `timeout` by up to about 3 s. Text visible for less than one
   * poll interval (about 100 ms) can be missed; use it for states that persist.
   *
   * Differs from the neighbours: `settle` on an action only waits for DOM/network quiet and cannot see a timer
   * scheduled for later; `expect` on an action checks once and never waits; {@link Page.waitForSelector} waits on
   * one element's state.
   */
  public async waitFor(options: WaitForOptions): Promise<ActionResult> {
    const { timeout, ...condition } = (options ?? {}) as WaitForOptions;
    if ('timeoutMs' in condition) {
      throw new TypeError('wait_for: unknown key "timeoutMs" — allowed: text, textGone, url, js, timeout');
    }
    const r = await this.runtime.waitFor(
      this.sessionId,
      { ...condition, ...(timeout !== undefined ? { timeoutMs: timeout } : {}) },
      this.tabId,
    );
    this.last = r;
    if (!r.success) throw new ActionFailedError(r);
    return r;
  }

  /**
   * Click `selector` (the element that triggers a download) and wait for the file to finish
   * landing on disk. `options.downloadDir` must resolve inside an allowed download root — see
   * `LaunchOptions.allowedDownloadRoots` — or this throws.
   */
  public async download(selector: string, options?: PageDownloadOptions): Promise<DownloadResult> {
    const r = await this.runtime.downloadFile(
      this.sessionId,
      selector,
      options?.downloadDir,
      this.tabId,
      ...expectSettleArgs(options?.expect, options?.settle),
    );
    this.last = r;
    if (!r.success) throw new Error(r.error ?? `download("${selector}") failed`);
    if (options?.expect) {
      const failed = failedExpectations(r.verification);
      if (failed.length > 0) throw new ExpectationFailedError(r, failed);
    }
    const o = r.output as { downloadedFilename: unknown; downloadedPath: unknown; downloadDir: unknown };
    return {
      filename: String(o.downloadedFilename),
      path: String(o.downloadedPath),
      downloadDir: String(o.downloadDir),
      // FR2-07: an fs.stat-backed check that the file really is there and non-empty.
      ...(r.verification ? { verification: r.verification } : {}),
    };
  }

  /**
   * Upload a local file into a `<input type="file">` targeted by `selector`. `filePath` is
   * resolved to an absolute path. Unrestricted unless `LaunchOptions.allowedUploadRoots` was
   * set, in which case it must be under one of those directories, or this throws.
   */
  public async uploadFile(selector: string, filePath: string, options?: SettleActionOptions): Promise<ActionResult> {
    const r = await this.runtime.uploadFile(
      this.sessionId,
      selector,
      path.resolve(filePath),
      this.tabId,
      ...expectSettleArgs(options?.expect, options?.settle),
    );
    this.last = r;
    if (!r.success) throw new Error(r.error ?? `uploadFile("${selector}", "${filePath}") failed`);
    if (options?.expect) {
      const failed = failedExpectations(r.verification);
      if (failed.length > 0) throw new ExpectationFailedError(r, failed);
    }
    return r;
  }

  /** Press a keyboard key (e.g. `"Enter"`, `"Escape"`). */
  public async press(key: string, options?: SettleActionOptions): Promise<ActionResult> {
    const expect = options?.expect;
    const tail = expectSettleArgs(expect, options?.settle);
    return this.conclude(
      tail.length > 0
        ? await this.runtime.pressKey(this.sessionId, key, this.tabId, undefined, ...tail)
        : await this.runtime.pressKey(this.sessionId, key, this.tabId),
      expect,
    );
  }

  /** Scroll the page. */
  public async scroll(
    direction: 'up' | 'down' | 'top' | 'bottom' = 'down',
    amount = 500,
    options?: SettleActionOptions,
  ): Promise<ActionResult> {
    const expect = options?.expect;
    const settle = options?.settle;
    // runtime.scroll(sid, direction, amount, tabId, target, settle, expect): `settle` sits BEFORE `expect`
    return this.conclude(
      settle !== undefined || expect
        ? await this.runtime.scroll(this.sessionId, direction, amount, this.tabId, undefined, settle, ...(expect ? [expect] : []))
        : await this.runtime.scroll(this.sessionId, direction, amount, this.tabId),
      expect,
    );
  }

  /**
   * Capture a screenshot. Returns raw base64 (no data-URI prefix). A screenshot has no
   * post-condition, so its verification (on {@link Page.lastResult}) is `unverifiable` by design
   * unless the capture is not a valid PNG.
   */
  public async screenshot(_options?: ScreenshotOptions): Promise<string> {
    const result = await this.runtime.screenshot(this.sessionId, this.tabId);
    this.last = result;
    return result.base64;
  }

  /**
   * Audit this tab: console/page errors, broken requests, accessibility heuristics, Web Vitals
   * and a full-page screenshot, as a machine-readable report (schemaVersion 1 — see
   * `packages/capability-runtime/schemas/audit-report.schema.json`). Throws if the audit can't
   * run at all (no live page, a blocked URL, an open dialog). A failed `baselineUrl` comparison
   * is reported in `report.baseline.error`, not thrown — the audit itself still succeeded. Not
   * an action: it doesn't update `lastResult`/FR2-07's verification contract.
   */
  public async audit(options: PageAuditOptions = {}): Promise<PageAuditResult> {
    const dir = options.outDir !== undefined ? await prepareAuditOutDir(options.outDir) : undefined;
    const result = await this.runtime.audit(this.sessionId, {
      tabId: this.tabId,
      ...(options.url !== undefined ? { url: options.url } : {}),
      ...(options.baselineUrl !== undefined ? { baselineUrl: options.baselineUrl } : {}),
    });
    const report = dir
      ? await writeAuditArtifacts(result, dir)
      : buildAuditReport(result, { screenshotPath: null, diffPath: null });
    const diff = result.baseline && 'diffImageBase64' in result.baseline ? result.baseline.diffImageBase64 : undefined;
    return {
      report,
      screenshotBase64: result.screenshotBase64,
      ...(diff !== undefined ? { baselineDiffBase64: diff } : {}),
    };
  }

  /**
   * Evaluate arbitrary JavaScript. Runs in the top-level page's context by default; pass
   * `frameSelector` (a CSS selector or snapshot [#id] for an `<iframe>` element on this page)
   * to evaluate inside that frame instead — including a genuinely cross-origin one, which this
   * page's own JS could never read into itself (same-origin policy).
   */
  public async evaluate<T = unknown>(expression: string, frameSelector?: string): Promise<T> {
    return this.runtime.eval<T>(this.sessionId, expression, this.tabId, frameSelector);
  }

  /** Read cookies for this tab's URL. */
  public async cookies(): Promise<unknown[]> {
    return this.runtime.getCookies(this.sessionId, this.tabId);
  }

  /**
   * Export this tab's full auth/session-relevant state — cookies, localStorage, sessionStorage
   * — as one portable blob. Save it (e.g. to disk) and pass it to a LATER page's
   * {@link setStorageState} to restore login state without redoing a login flow — including on
   * a different machine. If launched under a named profile (`launch({profileName})`), this is
   * also what `browser.close()` persists automatically for next time; call this directly only
   * when you want the blob yourself (to save elsewhere) or want it captured at a specific point
   * mid-session rather than only at close.
   */
  public async getStorageState(): Promise<StorageState> {
    return this.runtime.getStorageState(this.sessionId, this.tabId);
  }

  /**
   * Restore a blob previously captured by {@link getStorageState}. Call this right after
   * navigating to the target origin (storage APIs are origin-scoped) and before anything else
   * that depends on being logged in.
   */
  public async setStorageState(state: StorageState): Promise<void> {
    await this.runtime.setStorageState(this.sessionId, state, this.tabId);
  }

  /**
   * Set this tab's viewport (CDP device-metrics override) — `window.innerWidth`/responsive CSS
   * see this size immediately. For a non-headless session, also best-effort resizes the real OS
   * window's content area to match (not pixel-perfect — Chrome's own title bar/toolbar chrome
   * still eats a few dozen px this doesn't account for). Was previously only reachable via the
   * internal runtime, not this SDK — found missing via an external field report (PROB-042).
   */
  public async setViewport(viewport: SetViewportOptions): Promise<void> {
    await this.runtime.setViewport(this.sessionId, viewport, this.tabId);
  }

  /** Read the viewport/device metrics actually in effect right now, or `null` if none has ever
   *  been set (Chrome's own default applies in that case). */
  public getViewport(): ViewportInfo | null {
    return this.runtime.getViewport(this.sessionId, this.tabId);
  }

  /** Bring this tab to the front (make it the active tab). */
  public async bringToFront(): Promise<void> {
    await this.runtime.focusTab(this.sessionId, this.tabId);
  }

  /** Close this tab. The owning {@link Browser} can still be used for other tabs. */
  public async close(): Promise<void> {
    await this.runtime.closeTab(this.sessionId, this.tabId);
  }
}
