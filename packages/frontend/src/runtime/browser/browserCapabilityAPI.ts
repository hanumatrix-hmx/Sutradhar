/**
 * @file packages/frontend/src/runtime/browser/browserCapabilityAPI.ts
 * @description High-level Browser Capability API used strictly by the UI layer.
 */

import { BrowserSession } from './browserSession.js';
import { TabSnapshot, DownloadSnapshot, CookieSnapshot } from './browserTypes.js';

export class BrowserCapabilityAPI {
  public constructor(private readonly browserSession: BrowserSession) {}

  public async openURL(url: string, tabId?: string): Promise<void> {
    const targetTabId = tabId || this.browserSession.getActiveTab()?.id;
    if (targetTabId) {
      this.browserSession.navigateTab(targetTabId, url);
    } else {
      this.browserSession.createTab(url);
    }
  }

  public async goBack(tabId?: string): Promise<void> {
    const targetTabId = tabId || this.browserSession.getActiveTab()?.id;
    if (targetTabId) {
      this.browserSession.goBack(targetTabId);
    }
  }

  public async goForward(tabId?: string): Promise<void> {
    const targetTabId = tabId || this.browserSession.getActiveTab()?.id;
    if (targetTabId) {
      this.browserSession.goForward(targetTabId);
    }
  }

  public async reload(tabId?: string): Promise<void> {
    const active = this.browserSession.getActiveTab();
    const targetTabId = tabId || active?.id;
    if (targetTabId && active) {
      this.browserSession.navigateTab(targetTabId, active.url);
    }
  }

  public getTabs(): readonly TabSnapshot[] {
    return this.browserSession.getTabs();
  }

  public focusTab(tabId: string): void {
    this.browserSession.focusTab(tabId);
  }

  public closeTab(tabId: string): void {
    this.browserSession.closeTab(tabId);
  }

  public createTab(url?: string): TabSnapshot {
    return this.browserSession.createTab(url);
  }

  public downloads(): readonly DownloadSnapshot[] {
    return this.browserSession.getDownloads();
  }

  public cookies(): readonly CookieSnapshot[] {
    return this.browserSession.getCookies();
  }

  /**
   * No tabId by default: the frontend's local tab mirror can be stale when
   * the agent acts server-side, so we omit the guess and let the backend
   * resolve its own active tab — the backend browser is the source of truth.
   */
  public async captureScreenshot(tabId?: string): Promise<string> {
    return this.browserSession.adapter.captureScreenshot(
      this.browserSession.sessionId,
      tabId,
    );
  }

  public async executeJavaScript(script: string, tabId?: string): Promise<unknown> {
    return this.browserSession.adapter.executeJavaScript(
      this.browserSession.sessionId,
      tabId,
      script,
    );
  }

  public async clickCoordinate(x: number, y: number, tabId?: string): Promise<void> {
    const script = `
      (function() {
        const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
        if (el) {
          el.focus();
          if (typeof el.click === 'function') el.click();
          return el.tagName + (el.id ? '#' + el.id : '');
        }
        return null;
      })();
    `;
    await this.executeJavaScript(script, tabId);
  }

  public async typeText(text: string, tabId?: string): Promise<void> {
    const safeText = JSON.stringify(text);
    const script = `
      (function() {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
          if ('value' in active) {
            active.value = (active.value || '') + ${safeText};
          } else {
            active.textContent = (active.textContent || '') + ${safeText};
          }
          active.dispatchEvent(new Event('input', { bubbles: true }));
          active.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      })();
    `;
    await this.executeJavaScript(script, tabId);
  }
}
