/**
 * @file packages/frontend/src/runtime/browser/browserManager.ts
 * @description Central controller managing BrowserSession instances and pluggable adapters.
 */

import { BrowserSession } from './browserSession.js';
import { IBrowserAdapter } from './adapters/browserAdapter.js';
import { ServerBrowserAdapter } from './adapters/serverBrowserAdapter.js';

export class BrowserManager {
  private static instance: BrowserManager;
  private readonly sessions = new Map<string, BrowserSession>();
  private defaultAdapterFactory: () => IBrowserAdapter = () => new ServerBrowserAdapter();

  private constructor() {}

  public static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  public setDefaultAdapterFactory(factory: () => IBrowserAdapter): void {
    this.defaultAdapterFactory = factory;
  }

  public getOrCreateBrowser(
    sessionId: string,
    initialUrl?: string,
    adapter?: IBrowserAdapter,
  ): BrowserSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      const activeAdapter = adapter || this.defaultAdapterFactory();
      session = new BrowserSession(sessionId, initialUrl, activeAdapter);
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  public getBrowser(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  public destroyBrowser(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.runtime.shutdown();
      this.sessions.delete(sessionId);
    }
  }

  public restoreBrowser(
    sessionId: string,
    serializedSnapshot: string,
    adapter?: IBrowserAdapter,
  ): BrowserSession {
    const session = this.getOrCreateBrowser(sessionId, undefined, adapter);
    session.deserialize(serializedSnapshot);
    return session;
  }

  public listBrowsers(): readonly BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  public healthCheck(): { activeBrowsers: number; healthy: boolean } {
    return {
      activeBrowsers: this.sessions.size,
      healthy: true,
    };
  }
}
