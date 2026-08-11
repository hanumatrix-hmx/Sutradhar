/**
 * @file packages/browser/src/session/browser-session.ts
 * @description Domain class and interface for managing browser sessions and multi-tab lifecycles.
 */

import { SessionId, TabId, createTabId, BrowserSessionDto } from '@pinchtab/contracts';
import { EventBus } from '@pinchtab/events';
import { StructuredLogger } from '@pinchtab/observability';
import { Browser as PuppeteerBrowser, Page } from 'puppeteer-core';
import { IBrowserInstance } from '../launcher/browser-launcher.js';
import { BrowserTab, IBrowserTab } from './browser-tab.js';

export interface IBrowserSession {
  readonly id: SessionId;
  readonly activeTabId?: TabId;
  readonly isIncognito: boolean;
  readonly createdAt: string;
  createTab(url?: string): Promise<IBrowserTab>;
  /** Wrap an existing, already-open Puppeteer `Page` as a tracked tab instead of opening a new
   *  blank one — see {@link BrowserSession.adoptExistingPage}. */
  adoptExistingPage(page: Page, makeActive?: boolean): Promise<IBrowserTab>;
  getTab(tabId: TabId): IBrowserTab | undefined;
  getTabs(): readonly IBrowserTab[];
  setActiveTab(tabId: TabId): void;
  closeTab(tabId: TabId): Promise<void>;
  close(reason?: string): Promise<void>;
  toDto(): BrowserSessionDto;
  /** The CDP WebSocket endpoint of this session's underlying browser process, if it has a real
   *  one — lets a separate process later `attach()` to the SAME running Chrome instead of
   *  launching a new one (used by the CLI to persist a session across separate invocations). */
  getWsEndpoint(): string | undefined;
  /** The underlying real Puppeteer `Browser`, if this session has one. */
  getPuppeteerBrowser(): PuppeteerBrowser | undefined;
}

export class BrowserSession implements IBrowserSession {
  public readonly id: SessionId;
  public readonly isIncognito: boolean;
  public readonly createdAt: string;
  private readonly tabsMap = new Map<TabId, BrowserTab>();
  private currentActiveTabId?: TabId;
  private isClosed = false;
  private readonly browserInstance?: IBrowserInstance;
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;
  private tabCounter = 0;

  public constructor(
    id: SessionId,
    isIncognito = false,
    eventBus?: EventBus,
    logger?: StructuredLogger,
    browserInstance?: IBrowserInstance,
  ) {
    this.id = id;
    this.isIncognito = isIncognito;
    this.createdAt = new Date().toISOString();
    this.eventBus = eventBus;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
    this.browserInstance = browserInstance;
    this.browserInstance?.onDisconnected(() => {
      void this.handleCrash();
    });
  }

  /**
   * The underlying Chrome process disconnected outside of a normal `close()` (killed
   * externally, OOM-killed, crashed). Mark the session dead and its tabs closed — without
   * this, every subsequent action against this session would hang until its own per-action
   * timeout instead of failing immediately with a clear reason — and let the owning
   * {@link BrowserSessionManager} know via the domain event so it stops holding a reference
   * to a session with nothing live behind it.
   */
  private async handleCrash(): Promise<void> {
    if (this.isClosed) return; // already closed via the normal path — not a crash
    this.isClosed = true;
    for (const tab of this.tabsMap.values()) {
      await tab.close().catch(() => {});
    }
    this.tabsMap.clear();
    this.currentActiveTabId = undefined;

    this.logger.warn(`[BrowserSession] Session ${this.id} crashed — Chrome disconnected unexpectedly`);

    if (this.eventBus) {
      await this.eventBus.publish(
        'browser:session:crashed',
        { sessionId: this.id, crashedAt: new Date().toISOString() },
        `corr_${this.id}`,
      );
    }
  }

  public get activeTabId(): TabId | undefined {
    return this.currentActiveTabId;
  }

  public async createTab(url = 'about:blank'): Promise<IBrowserTab> {
    if (this.isClosed) {
      throw new Error(`Cannot create tab in closed session ${this.id}`);
    }

    this.tabCounter++;
    const tabId = createTabId(`tab_${this.id}_${this.tabCounter}`);
    const isFirstTab = this.tabsMap.size === 0;

    if (isFirstTab) {
      this.currentActiveTabId = tabId;
    }

    let puppeteerPage;
    if (this.browserInstance) {
      try {
        puppeteerPage = await this.browserInstance.newPage();
      } catch (err) {
        this.logger.warn(`[BrowserSession] Failed to create Puppeteer page: ${(err as Error).message}`);
      }
    }

    const tab = new BrowserTab(tabId, url, 'New Tab', isFirstTab, puppeteerPage, this.id, this.eventBus);
    this.tabsMap.set(tabId, tab);
    if (puppeteerPage) {
      this.watchForPopups(puppeteerPage);
    }

    if (url && url !== 'about:blank') {
      await tab.navigate(url).catch(() => {});
    }

    this.logger.debug(`[BrowserSession] Created tab ${tabId} in session ${this.id}`, { url });

    if (this.eventBus) {
      await this.eventBus.publish(
        'browser:page:navigated',
        {
          sessionId: this.id,
          tabId,
          url: tab.url,
          title: tab.title,
        },
        `corr_${this.id}`,
      );
    }

    return tab;
  }

  /**
   * A `target=_blank` link or a `window.open()` call spawns a genuinely new Puppeteer `Page`
   * that nothing auto-registers — without this, that tab exists in the real browser but is
   * completely invisible to the session's tab list. Auto-adopt it as a new (inactive, so it
   * doesn't steal focus mid-flow) tracked tab; the caller discovers it via `getTabs()`/
   * `browser.list_tabs` and can `setActiveTab`/`browser.focus_tab` to it when ready.
   */
  private watchForPopups(page: Page): void {
    page.on('popup', (popup) => {
      if (!popup) return;
      void this.adoptPopupPage(popup);
    });
  }

  private async adoptPopupPage(page: Page): Promise<IBrowserTab> {
    // Popups bypass IBrowserInstance.newPage(), which is where proxy auth normally gets
    // applied — a proxy-authenticated session's popups need it repeated here explicitly.
    if (this.browserInstance?.proxyAuth) {
      await page.authenticate(this.browserInstance.proxyAuth).catch(() => {});
    }

    this.tabCounter++;
    const tabId = createTabId(`tab_${this.id}_${this.tabCounter}`);
    const tab = new BrowserTab(tabId, page.url() || 'about:blank', 'New Tab', false, page, this.id, this.eventBus);
    this.tabsMap.set(tabId, tab);
    this.watchForPopups(page); // a popup can itself open further popups

    this.logger.debug(`[BrowserSession] Adopted popup as tab ${tabId} in session ${this.id}`, {
      url: tab.url,
    });

    if (this.eventBus) {
      await this.eventBus.publish(
        'browser:popup:opened',
        { sessionId: this.id, tabId, url: tab.url },
        `corr_${this.id}`,
      );
    }

    return tab;
  }

  /**
   * Wrap an existing, already-open Puppeteer `Page` as a tracked tab — the general form of
   * {@link adoptPopupPage}, made public for callers outside this class. Used by `attach()` to
   * pick up a page that was already open on the external/persistent browser (e.g. the tab a
   * previous CLI invocation against the same `wsEndpoint` left navigated) instead of always
   * opening a new blank one, which is what made multi-step CLI usage impossible before this —
   * each separate CLI process previously got its own empty `BrowserSession` tab map with no way
   * to discover pages a prior process had already created on the same real browser.
   */
  public async adoptExistingPage(page: Page, makeActive = true): Promise<IBrowserTab> {
    if (this.browserInstance?.proxyAuth) {
      await page.authenticate(this.browserInstance.proxyAuth).catch(() => {});
    }

    this.tabCounter++;
    const tabId = createTabId(`tab_${this.id}_${this.tabCounter}`);
    const isFirstTab = this.tabsMap.size === 0;
    const tab = new BrowserTab(
      tabId,
      page.url() || 'about:blank',
      'Adopted Tab',
      makeActive || isFirstTab,
      page,
      this.id,
      this.eventBus,
    );
    this.tabsMap.set(tabId, tab);
    if (makeActive || isFirstTab) {
      this.currentActiveTabId = tabId;
    }
    this.watchForPopups(page);

    this.logger.debug(`[BrowserSession] Adopted existing page as tab ${tabId} in session ${this.id}`, {
      url: tab.url,
    });

    return tab;
  }

  public getTab(tabId: TabId): IBrowserTab | undefined {
    return this.tabsMap.get(tabId);
  }

  public getTabs(): readonly IBrowserTab[] {
    return Array.from(this.tabsMap.values());
  }

  public setActiveTab(tabId: TabId): void {
    const target = this.tabsMap.get(tabId);
    if (!target) {
      const firstTab = Array.from(this.tabsMap.values())[0];
      if (firstTab) {
        this.currentActiveTabId = firstTab.id;
        firstTab.setActive(true);
      }
      return;
    }

    for (const [id, tab] of this.tabsMap.entries()) {
      tab.setActive(id === tabId);
    }
    this.currentActiveTabId = tabId;
  }

  public async closeTab(tabId: TabId): Promise<void> {
    const tab = this.tabsMap.get(tabId);
    if (!tab) {
      return;
    }

    await tab.close();
    this.tabsMap.delete(tabId);

    if (this.currentActiveTabId === tabId) {
      const remaining = Array.from(this.tabsMap.keys());
      this.currentActiveTabId = remaining[remaining.length - 1];
      if (this.currentActiveTabId) {
        this.tabsMap.get(this.currentActiveTabId)?.setActive(true);
      }
    }
  }

  public async close(reason = 'User closed session'): Promise<void> {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;
    for (const tab of this.tabsMap.values()) {
      await tab.close();
    }
    this.tabsMap.clear();
    this.currentActiveTabId = undefined;

    if (this.browserInstance && typeof this.browserInstance.close === 'function') {
      await this.browserInstance.close().catch(() => {});
    }

    this.logger.info(`[BrowserSession] Closed session ${this.id}`, { reason });

    if (this.eventBus) {
      await this.eventBus.publish(
        'browser:session:closed',
        {
          sessionId: this.id,
          closedAt: new Date().toISOString(),
          reason,
        },
        `corr_${this.id}`,
      );
    }
  }

  public toDto(): BrowserSessionDto {
    return {
      id: this.id,
      activeTabId: this.currentActiveTabId,
      tabs: Array.from(this.tabsMap.values()).map((t) => t.toDto()),
      createdAt: this.createdAt,
      isIncognito: this.isIncognito,
    };
  }

  public getWsEndpoint(): string | undefined {
    return this.browserInstance?.puppeteerBrowser?.wsEndpoint();
  }

  /** The underlying real Puppeteer `Browser`, if this session has one — used by `attach()` to
   *  discover pages already open on it (see {@link adoptExistingPage}). */
  public getPuppeteerBrowser() {
    return this.browserInstance?.puppeteerBrowser;
  }
}
