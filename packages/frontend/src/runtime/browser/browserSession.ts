/**
 * @file packages/frontend/src/runtime/browser/browserSession.ts
 * @description BrowserSession managing tab state and Snapshot persistence via IBrowserAdapter.
 */

import {
  BrowserSnapshot,
  TabSnapshot,
  CookieSnapshot,
  StorageSnapshot,
  DownloadSnapshot,
} from './browserTypes.js';
import { BrowserRuntime } from './browserRuntime.js';
import { IBrowserAdapter } from './adapters/browserAdapter.js';

export class BrowserSession {
  public readonly runtime: BrowserRuntime;
  private tabs: TabSnapshot[] = [];
  private activeTabId: string | null = null;
  private cookies: CookieSnapshot[] = [];
  private downloads: DownloadSnapshot[] = [];
  private storage: StorageSnapshot = { localStorage: {}, sessionStorage: {} };

  public constructor(
    public readonly sessionId: string,
    initialUrl = 'https://github.com/sutradhar/sutradhar',
    adapter?: IBrowserAdapter,
  ) {
    this.runtime = new BrowserRuntime(sessionId, adapter);
    // Initialize default primary tab
    const initialTab: TabSnapshot = {
      id: `tab_${sessionId}_1`,
      url: initialUrl,
      title: 'Sutradhar Autonomous Browser Agent Platform',
      active: true,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      historyStack: [initialUrl],
      historyIndex: 0,
    };
    this.tabs.push(initialTab);
    this.activeTabId = initialTab.id;

    // NOTE: no auto-launch here. The session store owns backend lifecycle
    // (launchBackendFor) and binds it to this same sessionId — launching
    // here too raced the store and clobbered the shared backend session.
  }

  public get adapter(): IBrowserAdapter {
    return this.runtime.adapter;
  }

  public getTabs(): readonly TabSnapshot[] {
    return [...this.tabs];
  }

  public getActiveTab(): TabSnapshot | null {
    return this.tabs.find((t) => t.id === this.activeTabId) || this.tabs[0] || null;
  }

  public getDownloads(): readonly DownloadSnapshot[] {
    return [...this.downloads];
  }

  public getCookies(): readonly CookieSnapshot[] {
    return [...this.cookies];
  }

  public createTab(url = 'about:blank', title = 'New Tab'): TabSnapshot {
    const newTab: TabSnapshot = {
      id: `tab_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      url,
      title,
      active: true,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      historyStack: [url],
      historyIndex: 0,
    };

    this.tabs = this.tabs.map((t) => ({ ...t, active: false }));
    this.tabs.push(newTab);
    this.activeTabId = newTab.id;

    this.adapter.createTab(this.sessionId, url, title).catch(() => {});
    this.runtime.events.emit('TabCreated', { tab: newTab });
    this.runtime.events.emit('TabActivated', { tabId: newTab.id });

    return newTab;
  }

  public focusTab(tabId: string): void {
    const exists = this.tabs.some((t) => t.id === tabId);
    if (exists) {
      this.activeTabId = tabId;
      this.tabs = this.tabs.map((t) => ({ ...t, active: t.id === tabId }));
      this.adapter.focusTab(this.sessionId, tabId).catch(() => {});
      this.runtime.events.emit('TabActivated', { tabId });
    }
  }

  public closeTab(tabId: string): void {
    if (this.tabs.length <= 1) return;

    this.tabs = this.tabs.filter((t) => t.id !== tabId);
    if (this.activeTabId === tabId) {
      const nextActive = this.tabs[this.tabs.length - 1]!;
      this.activeTabId = nextActive.id;
      this.tabs = this.tabs.map((t) => ({ ...t, active: t.id === nextActive.id }));
    }

    this.adapter.closeTab(this.sessionId, tabId).catch(() => {});
    this.runtime.events.emit('TabClosed', { tabId });
  }

  public navigateTab(tabId: string, targetUrl: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    this.runtime.events.emit('NavigationStarted', { tabId, url: targetUrl });

    let title = targetUrl.replace(/^https?:\/\//, '').split('/')[0] || 'Web Page';
    if (targetUrl.includes('github')) title = 'GitHub Repository';
    if (targetUrl.includes('google')) title = 'Google Search';

    const newStack = tab.historyStack.slice(0, tab.historyIndex + 1);
    newStack.push(targetUrl);
    const newIndex = newStack.length - 1;

    const updatedTab: TabSnapshot = {
      ...tab,
      url: targetUrl,
      title,
      loading: false,
      canGoBack: newIndex > 0,
      canGoForward: false,
      historyStack: newStack,
      historyIndex: newIndex,
    };

    this.tabs = this.tabs.map((t) => (t.id === tabId ? updatedTab : t));
    this.adapter.navigate(this.sessionId, tabId, targetUrl).catch(() => {});
    this.runtime.events.emit('NavigationCompleted', { tabId, url: targetUrl, title });
  }

  public goBack(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || tab.historyIndex <= 0) return;

    const newIndex = tab.historyIndex - 1;
    const prevUrl = tab.historyStack[newIndex]!;

    const updatedTab: TabSnapshot = {
      ...tab,
      url: prevUrl,
      historyIndex: newIndex,
      canGoBack: newIndex > 0,
      canGoForward: true,
    };

    this.tabs = this.tabs.map((t) => (t.id === tabId ? updatedTab : t));
    this.adapter.goBack(this.sessionId, tabId).catch(() => {});
    this.runtime.events.emit('NavigationCompleted', {
      tabId,
      url: prevUrl,
      title: updatedTab.title,
    });
  }

  public goForward(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || tab.historyIndex >= tab.historyStack.length - 1) return;

    const newIndex = tab.historyIndex + 1;
    const nextUrl = tab.historyStack[newIndex]!;

    const updatedTab: TabSnapshot = {
      ...tab,
      url: nextUrl,
      historyIndex: newIndex,
      canGoBack: true,
      canGoForward: newIndex < tab.historyStack.length - 1,
    };

    this.tabs = this.tabs.map((t) => (t.id === tabId ? updatedTab : t));
    this.adapter.goForward(this.sessionId, tabId).catch(() => {});
    this.runtime.events.emit('NavigationCompleted', {
      tabId,
      url: nextUrl,
      title: updatedTab.title,
    });
  }

  public reloadTab(tabId: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    this.adapter.reload(this.sessionId, tabId).catch(() => {});
    this.runtime.events.emit('NavigationCompleted', {
      tabId,
      url: tab.url,
      title: tab.title,
    });
  }

  /**
   * Overwrite the local tab mirror with the backend's real session state.
   * The backend browser is the source of truth — the local mirror only exists
   * for instant first paint before the first sync lands.
   */
  public syncFromServer(dto: {
    activeTabId?: string;
    tabs: readonly {
      id: string;
      url: string;
      title: string;
      isActive?: boolean;
      active?: boolean;
      loading?: boolean;
      canGoBack?: boolean;
      canGoForward?: boolean;
      historyStack?: readonly string[];
      historyIndex?: number;
    }[];
  }): void {
    if (!dto.tabs || dto.tabs.length === 0) return;
    this.tabs = dto.tabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.isActive ?? t.active ?? false,
      loading: t.loading ?? false,
      canGoBack: t.canGoBack ?? false,
      canGoForward: t.canGoForward ?? false,
      historyStack: t.historyStack && t.historyStack.length > 0 ? [...t.historyStack] : [t.url],
      historyIndex: t.historyIndex ?? 0,
    }));
    const active = this.tabs.find((t) => t.id === dto.activeTabId) || this.tabs.find((t) => t.active);
    this.activeTabId = (active ?? this.tabs[0]!).id;
  }

  public createSnapshot(): BrowserSnapshot {
    return {
      version: '1.0.0',
      status: this.tabs.length > 0 ? 'running' : 'stopped',
      activeTabId: this.activeTabId,
      windows: [
        { id: 'win_1', width: 1280, height: 800, focused: true, tabs: this.tabs },
      ],
      cookies: this.cookies,
      storage: this.storage,
      downloads: [],
      timestamp: new Date().toISOString(),
    };
  }

  public serialize(): string {
    return JSON.stringify(this.createSnapshot());
  }

  public deserialize(serialized: string): void {
    try {
      const snap = JSON.parse(serialized) as BrowserSnapshot;
      const win = snap.windows?.[0];
      if (win?.tabs && win.tabs.length > 0) {
        this.tabs = win.tabs;
        this.activeTabId = snap.activeTabId || win.tabs[0]!.id;
      }
      if (snap.cookies) this.cookies = snap.cookies;
      if (snap.storage) this.storage = snap.storage;
    } catch {
      // Ignore corrupt snapshots
    }
  }
}
