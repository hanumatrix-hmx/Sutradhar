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
}

/**
 * A handle to a launched browser session. Use {@link newPage} to open tabs and {@link pages}
 * to enumerate them. Call {@link close} when done to release the browser process.
 *
 * Obtained from {@link launch} — do not construct directly.
 */
export class Browser {
  /** @internal */ public constructor(
    private readonly runtime: SutradharRuntime,
    /** The underlying Sutradhar session id. */
    public readonly sessionId: string,
  ) {}

  /** Open a new tab, optionally navigating to a URL, and return a {@link Page} for it. */
  public async newPage(url?: string): Promise<Page> {
    const tab = await this.runtime.createTab(this.sessionId, url);
    return new Page(this.runtime, this.sessionId, tab.id);
  }

  /** All tabs in this browser, as {@link Page} handles. */
  public pages(): Page[] {
    return this.runtime.listTabs(this.sessionId).map((t) => new Page(this.runtime, this.sessionId, t.id));
  }

  /** Close every tab and release the browser process. */
  public async close(): Promise<void> {
    await this.runtime.shutdown(this.sessionId);
  }
}
