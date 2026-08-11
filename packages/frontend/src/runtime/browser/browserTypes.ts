/**
 * @file packages/frontend/src/runtime/browser/browserTypes.ts
 * @description Domain interfaces and snapshot models for Browser Runtime.
 */

export type BrowserStatus = 'stopped' | 'starting' | 'running' | 'crashed' | 'detached';

export interface TabSnapshot {
  id: string;
  url: string;
  title: string;
  active: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  historyStack: string[];
  historyIndex: number;
}

export interface WindowSnapshot {
  id: string;
  width: number;
  height: number;
  focused: boolean;
  tabs: TabSnapshot[];
}

export interface CookieSnapshot {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;
}

export interface StorageSnapshot {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export interface DownloadSnapshot {
  id: string;
  url: string;
  filename: string;
  size: string;
  timestamp: string;
  status: 'completed' | 'in_progress' | 'failed';
}

export interface BrowserSnapshot {
  version: string;
  timestamp: string;
  status: BrowserStatus;
  windows: WindowSnapshot[];
  activeTabId: string | null;
  cookies: CookieSnapshot[];
  storage: StorageSnapshot;
  downloads: DownloadSnapshot[];
}
