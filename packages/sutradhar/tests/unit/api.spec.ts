/**
 * @file packages/sutradhar/tests/unit/api.spec.ts
 * @description Unit tests for the sutradhar SDK's public API surface — shape and contracts,
 * no real browser. The real-Chrome flow lives in scripts/smoke.mjs.
 */

import { launch, Browser, Page, SutradharRuntime, SUTRADHAR_VERSION } from '../../src/index.js';

describe('sutradhar SDK public API', () => {
  it('exports its package version', () => {
    expect(SUTRADHAR_VERSION).toBe('0.4.1');
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

    it('pages() wraps each session tab as a Page handle', async () => {
      const browser = new Browser(stubRuntime as unknown as SutradharRuntime, 'sess-1');
      const pages = await browser.pages();
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

  describe('Page click/type settle pass-through (constructed against a stub runtime)', () => {
    it('click() forwards options.settle as runtime.click\'s 6th positional arg, undefined when not given', async () => {
      const stub = { click: vi.fn().mockResolvedValue({ success: true }) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await page.click('7');
      expect(stub.click).toHaveBeenCalledWith('sess-1', '7', 'tab-1', undefined, undefined, undefined);

      await page.click('7', { settle: true });
      expect(stub.click).toHaveBeenLastCalledWith('sess-1', '7', 'tab-1', undefined, undefined, true);

      await page.click('7', { settle: { mutationQuietMs: 100 } });
      expect(stub.click).toHaveBeenLastCalledWith('sess-1', '7', 'tab-1', undefined, undefined, { mutationQuietMs: 100 });
    });

    it('type() forwards options.settle as runtime.type\'s 5th positional arg, undefined when not given', async () => {
      const stub = { type: vi.fn().mockResolvedValue({ success: true }) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await page.type('7', 'hello');
      expect(stub.type).toHaveBeenCalledWith('sess-1', '7', 'hello', 'tab-1', undefined);

      await page.type('7', 'hello', { settle: true });
      expect(stub.type).toHaveBeenLastCalledWith('sess-1', '7', 'hello', 'tab-1', true);
    });
  });
});
