/**
 * @file packages/frontend/src/runtime/browser/browserEvents.ts
 * @description Observable event emitter for Browser Runtime events.
 */

import { TabSnapshot, DownloadSnapshot, CookieSnapshot, BrowserStatus } from './browserTypes.js';

export type BrowserEventType =
  | 'BrowserStarted'
  | 'BrowserClosed'
  | 'BrowserCrashed'
  | 'WindowCreated'
  | 'WindowClosed'
  | 'TabCreated'
  | 'TabClosed'
  | 'TabActivated'
  | 'NavigationStarted'
  | 'NavigationCompleted'
  | 'DownloadStarted'
  | 'DownloadCompleted'
  | 'CookieUpdated'
  | 'StorageUpdated';

export interface BrowserEventMap {
  BrowserStarted: { status: BrowserStatus; timestamp: string };
  BrowserClosed: { timestamp: string };
  BrowserCrashed: { error: string; timestamp: string };
  WindowCreated: { windowId: string };
  WindowClosed: { windowId: string };
  TabCreated: { tab: TabSnapshot };
  TabClosed: { tabId: string };
  TabActivated: { tabId: string };
  NavigationStarted: { tabId: string; url: string };
  NavigationCompleted: { tabId: string; url: string; title: string };
  DownloadStarted: { download: DownloadSnapshot };
  DownloadCompleted: { download: DownloadSnapshot };
  CookieUpdated: { cookie: CookieSnapshot };
  StorageUpdated: { key: string; value: string };
}

export type BrowserEventListener<K extends BrowserEventType> = (
  payload: BrowserEventMap[K],
) => void;

export class BrowserEventEmitter {
  private readonly listeners = new Map<BrowserEventType, Set<Function>>();

  public on<K extends BrowserEventType>(event: K, listener: BrowserEventListener<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => this.off(event, listener);
  }

  public off<K extends BrowserEventType>(event: K, listener: BrowserEventListener<K>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  public emit<K extends BrowserEventType>(event: K, payload: BrowserEventMap[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(payload);
        } catch {
          // Ignore listener errors to keep event dispatching safe
        }
      }
    }
  }

  public removeAllListeners(): void {
    this.listeners.clear();
  }
}
