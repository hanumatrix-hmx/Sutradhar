/**
 * @file packages/pinchtab/tests/unit/api.spec.ts
 * @description Unit tests for the pinchtab SDK's public API surface — shape and contracts,
 * no real browser. The real-Chrome flow lives in scripts/smoke.mjs.
 */

import { launch, Browser, Page, PinchTabRuntime, PINCHTAB_VERSION } from '../../src/index.js';

describe('pinchtab SDK public API', () => {
  it('exports its package version', () => {
    expect(PINCHTAB_VERSION).toBe('0.1.0');
  });

  it('exposes the launch entry point and the Browser/Page classes', () => {
    expect(typeof launch).toBe('function');
    expect(Browser).toBeInstanceOf(Function);
    expect(Page).toBeInstanceOf(Function);
  });

  it('re-exports PinchTabRuntime from the substrate for advanced users', () => {
    expect(PinchTabRuntime).toBeInstanceOf(Function);
  });

  describe('Browser handle (constructed against a stub runtime)', () => {
    // A minimal stub of PinchTabRuntime so we can assert Browser/Page wiring without a browser.
    const stubRuntime = {
      listTabs: () => [{ id: 'tab-1', url: 'https://x', title: 'X', isActive: true }],
      createTab: async (url?: string) => ({ id: 'tab-2', url: url ?? 'about:blank', title: '', isActive: false }),
      shutdown: async () => {},
    };

    it('pages() wraps each session tab as a Page handle', () => {
      const browser = new Browser(stubRuntime as unknown as PinchTabRuntime, 'sess-1');
      const pages = browser.pages();
      expect(pages).toHaveLength(1);
      expect(pages[0]).toBeInstanceOf(Page);
      expect(pages[0].tabId).toBe('tab-1');
    });

    it('newPage() returns a Page bound to the new tab id', async () => {
      const browser = new Browser(stubRuntime as unknown as PinchTabRuntime, 'sess-1');
      const page = await browser.newPage('https://y');
      expect(page).toBeInstanceOf(Page);
      expect(page.tabId).toBe('tab-2');
    });

    it('sessionId is exposed', () => {
      const browser = new Browser(stubRuntime as unknown as PinchTabRuntime, 'sess-1');
      expect(browser.sessionId).toBe('sess-1');
    });

    it('close() delegates to runtime.shutdown', async () => {
      const browser = new Browser(stubRuntime as unknown as PinchTabRuntime, 'sess-1');
      await browser.close(); // should not throw
    });
  });
});
