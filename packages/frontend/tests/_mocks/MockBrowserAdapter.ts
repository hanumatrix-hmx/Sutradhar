/**
 * @file packages/frontend/tests/_mocks/MockBrowserAdapter.ts
 * @description TEST-ONLY fixture: an in-memory IBrowserAdapter for deterministic
 * unit tests that exercise runtime wiring WITHOUT a real backend.
 *
 * This is intentionally NOT shipped in the production bundle (it lives under
 * tests/, not src/). Real UI code uses ServerBrowserAdapter against the live
 * backend exclusively — per the "no mocks in production" rule.
 */

import { IBrowserAdapter } from '../../src/runtime/browser/adapters/browserAdapter.js';
import { DirectBrowserTransport } from '../../src/runtime/browser/adapters/browserTransport.js';
import {
  BrowserStatus,
  TabSnapshot,
  CookieSnapshot,
  DownloadSnapshot,
} from '../../src/runtime/browser/browserTypes.js';

export class MockBrowserAdapter implements IBrowserAdapter {
  public readonly id = 'mock-adapter';
  public readonly name = 'Mock Browser Adapter';
  public readonly transport: DirectBrowserTransport;

  private readonly sessionTabs = new Map<string, TabSnapshot[]>();
  private readonly eventListeners = new Map<string, Set<(event: any) => void>>();

  public constructor(transport?: DirectBrowserTransport) {
    this.transport = transport || new DirectBrowserTransport();
  }

  public async launch(
    sessionId: string,
    initialUrl = 'https://github.com/pinchtab/pinchtab',
  ): Promise<{ sessionId: string; status: BrowserStatus }> {
    const initialTab: TabSnapshot = {
      id: `tab_${sessionId}_1`,
      url: initialUrl,
      title: 'PinchTab Autonomous Browser Agent Platform',
      active: true,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      historyStack: [initialUrl],
      historyIndex: 0,
    };
    this.sessionTabs.set(sessionId, [initialTab]);
    this.emitEvent(sessionId, 'BrowserStarted', {
      status: 'running',
      timestamp: new Date().toISOString(),
    });
    return { sessionId, status: 'running' };
  }

  public async shutdown(sessionId: string): Promise<void> {
    this.sessionTabs.delete(sessionId);
    this.emitEvent(sessionId, 'BrowserClosed', { timestamp: new Date().toISOString() });
  }

  public async navigate(
    sessionId: string,
    tabId: string,
    targetUrl: string,
  ): Promise<{ tabId: string; url: string; title: string }> {
    const tabs = this.sessionTabs.get(sessionId) || [];
    const tab = tabs.find((t) => t.id === tabId);
    let title = targetUrl.replace(/^https?:\/\//, '').split('/')[0] || 'Web Page';
    if (targetUrl.includes('github')) title = 'GitHub Repository';
    if (targetUrl.includes('google')) title = 'Google Search';

    if (tab) {
      tab.url = targetUrl;
      tab.title = title;
      tab.historyStack.push(targetUrl);
      tab.historyIndex = tab.historyStack.length - 1;
      tab.canGoBack = tab.historyIndex > 0;
    }

    this.emitEvent(sessionId, 'NavigationStarted', { tabId, url: targetUrl });
    this.emitEvent(sessionId, 'NavigationCompleted', { tabId, url: targetUrl, title });
    return { tabId, url: targetUrl, title };
  }

  public async createTab(
    sessionId: string,
    url = 'about:blank',
    title = 'New Tab',
  ): Promise<TabSnapshot> {
    const tabs = this.sessionTabs.get(sessionId) || [];
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

    tabs.forEach((t) => (t.active = false));
    tabs.push(newTab);
    this.sessionTabs.set(sessionId, tabs);

    this.emitEvent(sessionId, 'TabCreated', { tab: newTab });
    return newTab;
  }

  public async closeTab(sessionId: string, tabId: string): Promise<void> {
    const tabs = this.sessionTabs.get(sessionId) || [];
    const updated = tabs.filter((t) => t.id !== tabId);
    if (updated.length > 0 && !updated.some((t) => t.active)) {
      updated[updated.length - 1]!.active = true;
    }
    this.sessionTabs.set(sessionId, updated);
    this.emitEvent(sessionId, 'TabClosed', { tabId });
  }

  public async focusTab(sessionId: string, tabId: string): Promise<void> {
    const tabs = this.sessionTabs.get(sessionId) || [];
    tabs.forEach((t) => (t.active = t.id === tabId));
    this.emitEvent(sessionId, 'TabActivated', { tabId });
  }

  public async goBack(sessionId: string, tabId: string): Promise<{ tabId: string; url: string }> {
    const tabs = this.sessionTabs.get(sessionId) || [];
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.historyIndex > 0) {
      tab.historyIndex--;
      tab.url = tab.historyStack[tab.historyIndex]!;
      tab.canGoBack = tab.historyIndex > 0;
      tab.canGoForward = true;
    }
    return { tabId, url: tab?.url || 'about:blank' };
  }

  public async goForward(
    sessionId: string,
    tabId: string,
  ): Promise<{ tabId: string; url: string }> {
    const tabs = this.sessionTabs.get(sessionId) || [];
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.historyIndex < tab.historyStack.length - 1) {
      tab.historyIndex++;
      tab.url = tab.historyStack[tab.historyIndex]!;
      tab.canGoBack = true;
      tab.canGoForward = tab.historyIndex < tab.historyStack.length - 1;
    }
    return { tabId, url: tab?.url || 'about:blank' };
  }

  public async reload(sessionId: string, tabId: string): Promise<{ tabId: string; url: string }> {
    const tabs = this.sessionTabs.get(sessionId) || [];
    const tab = tabs.find((t) => t.id === tabId);
    return { tabId, url: tab?.url || 'about:blank' };
  }

  public async captureScreenshot(_sessionId: string, _tabId: string): Promise<string> {
    // A minimal but genuinely valid 1x1 PNG data URI. Real screenshots from a
    // Chromium page are PNGs, so the mock matches that contract (the previous
    // SVG placeholder caused the "real screenshot" tests to fail).
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  }

  public async executeScript(_sessionId: string, _tabId: string, _code: string): Promise<unknown> {
    return { success: true, result: 'mock_exec_result' };
  }

  public async executeJavaScript(_sessionId: string, _tabId: string, _script: string): Promise<unknown> {
    return { success: true };
  }

  public async getCookies(_sessionId: string): Promise<readonly CookieSnapshot[]> {
    return [{ name: 'pt_session', value: 'mock_cookie_val', domain: 'localhost', path: '/' }];
  }

  public async getDownloads(_sessionId: string): Promise<readonly DownloadSnapshot[]> {
    return [];
  }

  public subscribeEvents(
    sessionId: string,
    onEvent: (event: { type: string; payload: any }) => void,
  ): () => void {
    if (!this.eventListeners.has(sessionId)) {
      this.eventListeners.set(sessionId, new Set());
    }
    this.eventListeners.get(sessionId)!.add(onEvent);
    return () => {
      this.eventListeners.get(sessionId)?.delete(onEvent);
    };
  }

  private emitEvent(sessionId: string, type: string, payload: any): void {
    const listeners = this.eventListeners.get(sessionId);
    if (listeners) {
      for (const fn of listeners) {
        fn({ type, payload });
      }
    }
  }
}
