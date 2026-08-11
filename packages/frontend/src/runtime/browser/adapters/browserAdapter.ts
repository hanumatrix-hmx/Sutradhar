/**
 * @file packages/frontend/src/runtime/browser/adapters/browserAdapter.ts
 * @description Pluggable IBrowserAdapter interface contract.
 */

import { BrowserStatus, TabSnapshot, CookieSnapshot, DownloadSnapshot } from '../browserTypes.js';
import { IBrowserTransport } from './browserTransport.js';

export interface IBrowserAdapter {
  readonly id: string;
  readonly name: string;
  readonly transport?: IBrowserTransport;

  launch(
    sessionId: string,
    initialUrl?: string,
  ): Promise<{ sessionId: string; status: BrowserStatus }>;
  shutdown(sessionId: string): Promise<void>;
  navigate(
    sessionId: string,
    tabId: string,
    url: string,
  ): Promise<{ tabId: string; url: string; title: string }>;
  createTab(sessionId: string, url?: string, title?: string): Promise<TabSnapshot>;
  closeTab(sessionId: string, tabId: string): Promise<void>;
  focusTab(sessionId: string, tabId: string): Promise<void>;
  goBack(sessionId: string, tabId: string): Promise<{ tabId: string; url: string }>;
  goForward(sessionId: string, tabId: string): Promise<{ tabId: string; url: string }>;
  reload(sessionId: string, tabId: string): Promise<{ tabId: string; url: string }>;
  captureScreenshot(sessionId: string, tabId?: string, signal?: AbortSignal): Promise<string>;
  executeScript(sessionId: string, tabId: string | undefined, code: string): Promise<unknown>;
  executeJavaScript(sessionId: string, tabId: string | undefined, script: string): Promise<unknown>;
  getCookies(sessionId: string): Promise<readonly CookieSnapshot[]>;
  getDownloads(sessionId: string): Promise<readonly DownloadSnapshot[]>;
  subscribeEvents(
    sessionId: string,
    onEvent: (event: { type: string; payload: any }) => void,
  ): () => void;
}
