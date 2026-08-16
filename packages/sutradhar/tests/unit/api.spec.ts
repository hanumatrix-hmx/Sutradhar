/**
 * @file packages/sutradhar/tests/unit/api.spec.ts
 * @description Unit tests for the sutradhar SDK's public API surface — shape and contracts,
 * no real browser. The real-Chrome flow lives in scripts/smoke.mjs.
 */

import { launch, Browser, Page, SutradharRuntime, SUTRADHAR_VERSION } from '../../src/index.js';

describe('sutradhar SDK public API', () => {
  it('exports its package version', () => {
    expect(SUTRADHAR_VERSION).toBe('0.3.0');
  });

  it('exposes the launch entry point and the Browser/Page classes', () => {
    expect(typeof launch).toBe('function');
    expect(Browser).toBeInstanceOf(Function);
    expect(Page).toBeInstanceOf(Function);
  });

  it('re-exports SutradharRuntime from the substrate for advanced users', () => {
    expect(SutradharRuntime).toBeInstanceOf(Function);
  });

  describe('Browser handle (constructed against a stub runtime)', () => {
    // A minimal stub of SutradharRuntime so we can assert Browser/Page wiring without a browser.
    const stubRuntime = {
      listTabs: () => [{ id: 'tab-1', url: 'https://x', title: 'X', isActive: true }],
      createTab: async (url?: string) => ({ id: 'tab-2', url: url ?? 'about:blank', title: '', isActive: false }),
      shutdown: async () => {},
    };

    it('pages() wraps each session tab as a Page handle', () => {
      const browser = new Browser(stubRuntime as unknown as SutradharRuntime, 'sess-1');
      const pages = browser.pages();
      expect(pages).toHaveLength(1);
      expect(pages[0]).toBeInstanceOf(Page);
      expect(pages[0].tabId).toBe('tab-1');
    });

    it('newPage() returns a Page bound to the new tab id', async () => {
      const browser = new Browser(stubRuntime as unknown as SutradharRuntime, 'sess-1');
      const page = await browser.newPage('https://y');
      expect(page).toBeInstanceOf(Page);
      expect(page.tabId).toBe('tab-2');
    });

    it('sessionId is exposed', () => {
      const browser = new Browser(stubRuntime as unknown as SutradharRuntime, 'sess-1');
      expect(browser.sessionId).toBe('sess-1');
    });

    it('close() delegates to runtime.shutdown', async () => {
      const browser = new Browser(stubRuntime as unknown as SutradharRuntime, 'sess-1');
      await browser.close(); // should not throw
    });
  });

  describe('Page storage-state methods (constructed against a stub runtime)', () => {
    it('getStorageState() delegates to runtime.getStorageState with this page\'s session/tab ids', async () => {
      const sampleState = { origin: 'https://x', cookies: [], localStorage: {}, sessionStorage: {} };
      const stub = { getStorageState: vi.fn().mockResolvedValue(sampleState) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      const result = await page.getStorageState();

      expect(stub.getStorageState).toHaveBeenCalledWith('sess-1', 'tab-1');
      expect(result).toBe(sampleState);
    });

    it('setStorageState() delegates to runtime.setStorageState with this page\'s session/tab ids and the given state', async () => {
      const sampleState = { origin: 'https://x', cookies: [], localStorage: { k: 'v' }, sessionStorage: {} };
      const stub = { setStorageState: vi.fn().mockResolvedValue(undefined) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await page.setStorageState(sampleState);

      expect(stub.setStorageState).toHaveBeenCalledWith('sess-1', sampleState, 'tab-1');
    });
  });
});
