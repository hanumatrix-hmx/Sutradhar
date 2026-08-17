/**
 * @file packages/sutradhar/src/browser.ts
 * @description Puppeteer-style {@link Browser} — a handle to one launched browser session
 * that owns one or more {@link Page} tabs.
 */

import type { SutradharRuntime } from '@sutradhar/capability-runtime';
import { Page } from './page.js';

/** Options for {@link launch}. */
export interface LaunchOptions {
  /** Open the first tab at this URL. */
  url?: string;
  /** Run headless (default true). */
  headless?: boolean;
  /** Incognito context. */
  isIncognito?: boolean;
  /**
   * Launch using a named, persistent profile (cookies/history/localStorage — and, if a prior
   * session under this name ever called `page.setStorageState`/closed cleanly with data to
   * save, sessionStorage too — survive across separate launches). Create one first via
   * `new ProfileManager().create(name)`. Throws if the name doesn't exist.
   */
  profileName?: string;
  /**
   * Override `navigator.userAgent` for this session. Unset by default — the real Chrome UA
   * (including "HeadlessChrome" when headless) is left as-is; this is plain configurability,
   * not a detection-evasion default.
   */
  userAgent?: string;
  /**
   * Restrict navigation (`page.goto`, the initial `url`, `browser.compare`, `newPage`'s `url`)
   * to these domains (and their subdomains) — anything else throws instead of navigating.
   * Unset by default (no restriction). Useful for handing an agent a logged-in internal
   * session safely, and as partial prompt-injection defense-in-depth for navigation
   * specifically — it does not intercept page-initiated navigation from a clicked link, which
   * the browser performs client-side without going through this check.
   */
  allowedDomains?: readonly string[];
  /**
   * Sets both the CDP device-metrics override (`window.innerWidth`/responsive CSS see this
   * size) and, for a non-headless session, Chrome's own `--window-size` launch flag (so the
   * visible OS window is reasonably sized instead of full-desktop with an empty margin around
   * a phone-sized page). Unset by default — Chrome's own default viewport is used. Not
   * pixel-perfect for the real OS window (Chrome's own title bar/tabs/toolbar chrome still eats
   * a few dozen px this doesn't account for, confirmed live at ~126px width / ~95px height) —
   * that's a real Chromium quirk, not something worth chasing further; the CDP override alone
   * already guarantees the functionally-correct page size. Found missing entirely from this SDK
   * via an external field report using the published npm package (PROB-042).
   */
  viewport?: { width: number; height: number };
}

/**
 * A handle to a launched browser session. Use {@link newPage} to open tabs and {@link pages}
 * to enumerate them. Call {@link close} when done to release the browser process.
 *
 * Obtained from {@link launch} — do not construct directly.
 */
export class Browser {
  /** Count of {@link Browser} instances from this process's `launch()` calls that haven't had
   *  {@link close} called yet — each one is a live, separate Chrome process. Used by `launch()`
   *  to warn when a caller launches again without closing the previous one (PROB-042: found via
   *  an external field report of a long-running process silently accumulating Chrome instances,
   *  each ~150-300MB, with no warning at all). */
  private static openCount = 0;

  /** @internal */ static get openSessionCount(): number {
    return Browser.openCount;
  }

  /** @internal */ public constructor(
    private readonly runtime: SutradharRuntime,
    /** The underlying Sutradhar session id. */
    public readonly sessionId: string,
  ) {
    Browser.openCount++;
  }

  /** Open a new tab, optionally navigating to a URL, and return a {@link Page} for it. */
  public async newPage(url?: string): Promise<Page> {
    const tab = await this.runtime.createTab(this.sessionId, url);
    return new Page(this.runtime, this.sessionId, tab.id);
  }

  /**
   * All tabs in this browser, as {@link Page} handles. Async (breaking change from a prior
   * synchronous signature) because each tab's title is now read live from the page rather than
   * from a cache that never gets a real value for a CLI-adopted tab — see PROB-035.
   */
  public async pages(): Promise<Page[]> {
    const tabs = await this.runtime.listTabs(this.sessionId);
    return tabs.map((t) => new Page(this.runtime, this.sessionId, t.id));
  }

  /**
   * The CDP WebSocket endpoint of this session's underlying Chrome process, or `undefined` if
   * it has no real browser backing it. Lets a SEPARATE later process `puppeteer.connect()` or
   * `SutradharRuntime.attach({endpoint})` to the same running browser instead of launching a new
   * one — this SDK's own `launch()` doesn't itself expose a reconnect path, so a caller that
   * needs cross-process continuity (e.g. a long-lived browser handed off between two scripts)
   * needs this. Was previously unreachable from this SDK, only from the internal runtime, found
   * via an external field report (PROB-042).
   */
  public getWsEndpoint(): string | undefined {
    return this.runtime.getSessionWsEndpoint(this.sessionId);
  }

  private closed = false;

  /** Close every tab and release the browser process. */
  public async close(): Promise<void> {
    await this.runtime.shutdown(this.sessionId);
    if (!this.closed) {
      this.closed = true;
      Browser.openCount--;
    }
  }
}
