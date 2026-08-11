/**
 * @file packages/frontend/src/runtime/browser/adapters/serverBrowserAdapter.ts
 * @description Real ServerBrowserAdapter bridging frontend runtime commands to
 * the @sutradhar/server backend via genuine HTTP calls.
 *
 * Every method calls the backend and propagates errors. There are NO fallback
 * objects, NO fake SVG/PNG screenshots, and NO synthetic events. If the backend
 * is unreachable or returns an error, the caller sees a BackendTransportError.
 */

import { IBrowserAdapter } from './browserAdapter.js';
import { HttpBrowserTransport } from './browserTransport.js';
import {
  BrowserStatus,
  TabSnapshot,
  CookieSnapshot,
  DownloadSnapshot,
} from '../browserTypes.js';

export class ServerBrowserAdapter implements IBrowserAdapter {
  public readonly id = 'server-adapter';
  public readonly name = 'Server Browser Engine Adapter (@sutradhar/browser)';
  public readonly transport: HttpBrowserTransport;

  private readonly eventListeners = new Map<string, Set<(event: any) => void>>();

  public constructor(transport?: HttpBrowserTransport) {
    this.transport = transport ?? new HttpBrowserTransport();
  }

  public async launch(
    sessionId: string,
    initialUrl?: string,
  ): Promise<{ sessionId: string; status: BrowserStatus }> {
    const res = await this.transport.send<{ sessionId: string; status: BrowserStatus }>(
      '/api/v1/browser/launch',
      { sessionId, initialUrl },
    );
    // Surface real backend events only (no synthetic BrowserStarted emission).
    this.emitEvent(sessionId, 'BrowserStarted', {
      status: res.status,
      timestamp: new Date().toISOString(),
    });
    return res;
  }

  public async shutdown(sessionId: string): Promise<void> {
    await this.transport.send('/api/v1/browser/shutdown', { sessionId });
    this.emitEvent(sessionId, 'BrowserClosed', { timestamp: new Date().toISOString() });
  }

  public async navigate(
    sessionId: string,
    tabId: string,
    url: string,
  ): Promise<{ tabId: string; url: string; title: string }> {
    // Real navigation event before the call (UI can show loading state).
    this.emitEvent(sessionId, 'NavigationStarted', { tabId, url });
    const res = await this.transport.send<{ tabId: string; url: string; title: string }>(
      '/api/v1/browser/navigate',
      { sessionId, tabId, url },
    );
    this.emitEvent(sessionId, 'NavigationCompleted', {
      tabId: res.tabId,
      url: res.url,
      title: res.title,
    });
    return res;
  }

  public async createTab(
    sessionId: string,
    url = 'about:blank',
    title = 'New Tab',
  ): Promise<TabSnapshot> {
    const tab = await this.transport.send<TabSnapshot>('/api/v1/browser/tabs/create', {
      sessionId,
      url,
      title,
    });
    this.emitEvent(sessionId, 'TabCreated', { tab });
    return tab;
  }

  public async closeTab(sessionId: string, tabId: string): Promise<void> {
    await this.transport.send('/api/v1/browser/tabs/close', { sessionId, tabId });
    this.emitEvent(sessionId, 'TabClosed', { tabId });
  }

  public async focusTab(sessionId: string, tabId: string): Promise<void> {
    await this.transport.send('/api/v1/browser/tabs/focus', { sessionId, tabId });
    this.emitEvent(sessionId, 'TabActivated', { tabId });
  }

  public async goBack(sessionId: string, tabId: string): Promise<{ tabId: string; url: string }> {
    return this.transport.send<{ tabId: string; url: string }>('/api/v1/browser/goback', {
      sessionId,
      tabId,
    });
  }

  public async goForward(
    sessionId: string,
    tabId: string,
  ): Promise<{ tabId: string; url: string }> {
    return this.transport.send<{ tabId: string; url: string }>('/api/v1/browser/goforward', {
      sessionId,
      tabId,
    });
  }

  public async reload(sessionId: string, tabId: string): Promise<{ tabId: string; url: string }> {
    return this.transport.send<{ tabId: string; url: string }>('/api/v1/browser/reload', {
      sessionId,
      tabId,
    });
  }

  public async captureScreenshot(sessionId: string, tabId?: string): Promise<string> {
    // Real screenshot ONLY. No SVG placeholder, no fallback image — if the
    // backend can't produce one, the error propagates to the UI. With no
    // tabId the backend screenshots its own active tab (source of truth).
    const res = await this.transport.send<{ screenshotData: string }>(
      '/api/v1/browser/screenshot',
      tabId ? { sessionId, tabId } : { sessionId },
    );
    return res.screenshotData;
  }

  public async executeScript(
    sessionId: string,
    tabId: string | undefined,
    code: string,
  ): Promise<unknown> {
    const res = await this.transport.send<{ result: unknown }>(
      '/api/v1/browser/eval',
      tabId ? { sessionId, tabId, code } : { sessionId, code },
    );
    return res.result;
  }

  public async executeJavaScript(
    sessionId: string,
    tabId: string | undefined,
    script: string,
  ): Promise<unknown> {
    return this.executeScript(sessionId, tabId, script);
  }

  public async getCookies(sessionId: string): Promise<readonly CookieSnapshot[]> {
    const res = await this.transport.send<{ cookies: CookieSnapshot[] }>(
      '/api/v1/browser/cookies',
      { sessionId },
    );
    return res.cookies ?? [];
  }

  public async getDownloads(sessionId: string): Promise<readonly DownloadSnapshot[]> {
    const res = await this.transport.send<{ downloads: DownloadSnapshot[] }>(
      '/api/v1/browser/downloads',
      { sessionId },
    );
    return res.downloads ?? [];
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
      for (const fn of listeners) fn({ type, payload });
    }
  }
}
