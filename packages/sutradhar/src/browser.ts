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
