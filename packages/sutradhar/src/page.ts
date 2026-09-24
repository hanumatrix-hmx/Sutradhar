/**
 * @file packages/sutradhar/src/page.ts
 * @description Puppeteer-style {@link Page} — a handle to a single browser tab. All verbs
 * delegate to the proven {@link SutradharRuntime} substrate, so behavior is identical to the
 * MCP server and the REST API.
 */

import type {
  SutradharRuntime,
  SnapshotResult,
  StorageState,
  SettleSpec,
  WaitForSelectorState,
} from '@sutradhar/capability-runtime';

export type { WaitForSelectorState } from '@sutradhar/capability-runtime';

/** Options accepted by {@link Page.waitForSelector} (Playwright-style names). */
export interface WaitForSelectorOptions {
  /** 'visible' (default) | 'attached' | 'hidden'. */
  state?: WaitForSelectorState;
  /** Milliseconds; defaults to 10000. */
  timeout?: number;
}

/** Options accepted by {@link Page.click} / {@link Page.type}. */
export interface ElementOptions {
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
  /** @internal */ public constructor(
    private readonly runtime: SutradharRuntime,
    private readonly sessionId: string,
    /** This page's tab id within the session. */
    public readonly tabId: string,
  ) {}

  /** Navigate this tab to a URL. */
  public async goto(url: string): Promise<Page> {
    await this.runtime.navigate(this.sessionId, url, this.tabId);
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
   * Click an element. `selector` may be a CSS selector OR a numeric [#id] from
   * {@link Page.snapshot} (e.g. `"7"` resolves to `[data-sd-node-id="7"]`).
   */
  public async click(selector: string, options?: ElementOptions): Promise<void> {
    await this.runtime.click(this.sessionId, selector, this.tabId, undefined, undefined, options?.settle);
  }

  /** Type text into an input targeted by selector or [#id]. */
  public async type(selector: string, text: string, options?: ElementOptions): Promise<void> {
    await this.runtime.type(this.sessionId, selector, text, this.tabId, options?.settle);
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
  public async waitForSelector(selector: string, options?: WaitForSelectorOptions): Promise<void> {
    const r = await this.runtime.waitForSelector(this.sessionId, selector, options?.timeout, this.tabId, options?.state);
    if (!r.success) throw new Error(r.error ?? `waitForSelector("${selector}") failed`);
  }

  /** Press a keyboard key (e.g. `"Enter"`, `"Escape"`). */
  public async press(key: string): Promise<void> {
    await this.runtime.pressKey(this.sessionId, key, this.tabId);
  }

  /** Scroll the page. */
  public async scroll(
    direction: 'up' | 'down' | 'top' | 'bottom' = 'down',
    amount = 500,
  ): Promise<void> {
    await this.runtime.scroll(this.sessionId, direction, amount, this.tabId);
  }

  /** Capture a screenshot. Returns raw base64 (no data-URI prefix). */
  public async screenshot(_options?: ScreenshotOptions): Promise<string> {
    const result = await this.runtime.screenshot(this.sessionId, this.tabId);
    return result.base64;
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
