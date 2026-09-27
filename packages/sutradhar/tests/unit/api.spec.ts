/**
 * @file packages/sutradhar/tests/unit/api.spec.ts
 * @description Unit tests for the sutradhar SDK's public API surface — shape and contracts,
 * no real browser. The real-Chrome flow lives in scripts/smoke.mjs.
 */

import { launch, Browser, Page, SutradharRuntime, SUTRADHAR_VERSION } from '../../src/index.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

// FR2-12: pngjs is a dependency of @sutradhar/capability-runtime, not of this package — reached
// via createRequire against that package's own package.json (T18's technique), rather than
// adding a new devDependency here just to build a tiny test PNG.
const capabilityRuntimeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'capability-runtime');
const require_ = createRequire(path.join(capabilityRuntimeDir, 'package.json'));
const { PNG } = require_('pngjs');

function makePngBase64(w: number, h: number): string {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = 1;
    png.data[i * 4 + 1] = 2;
    png.data[i * 4 + 2] = 3;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

describe('sutradhar SDK public API', () => {
  it('exports its package version', () => {
    expect(SUTRADHAR_VERSION).toBe('0.4.3');
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

  describe('Page.waitForSelector (FR2-01)', () => {
    it('S1: forwards to runtime.waitForSelector with undefined timeout/state when no options are given', async () => {
      const stub = { waitForSelector: vi.fn().mockResolvedValue({ success: true }) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await page.waitForSelector('#t');

      expect(stub.waitForSelector).toHaveBeenCalledWith('sess-1', '#t', undefined, 'tab-1', undefined);
    });

    it('S2: forwards options.state and options.timeout', async () => {
      const stub = { waitForSelector: vi.fn().mockResolvedValue({ success: true }) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await page.waitForSelector('#t', { state: 'hidden', timeout: 2000 });

      expect(stub.waitForSelector).toHaveBeenCalledWith('sess-1', '#t', 2000, 'tab-1', 'hidden');
    });

    it('S3: rejects with the runtime\'s own error message on failure, instead of returning silently', async () => {
      const stub = {
        waitForSelector: vi.fn().mockResolvedValue({
          success: false,
          error: 'wait_for_selector timed out after 2000ms waiting for state=visible: no element found',
        }),
      };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await expect(page.waitForSelector('#t', { timeout: 2000 })).rejects.toThrow(
        'wait_for_selector timed out after 2000ms waiting for state=visible: no element found',
      );
    });

    it('S4: resolves to undefined on success', async () => {
      const stub = { waitForSelector: vi.fn().mockResolvedValue({ success: true }) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await expect(page.waitForSelector('#t')).resolves.toBeUndefined();
    });
  });

  describe('Page.audit (FR2-12)', () => {
    function fakeResult(overrides: Partial<any> = {}): any {
      return {
        url: 'http://127.0.0.1:1/audit',
        title: 'T',
        timestamp: '2026-01-01T00:00:00.000Z',
        screenshotBase64: makePngBase64(5, 4),
        consoleErrors: [],
        pageErrors: [],
        brokenRequests: [],
        accessibilityIssues: [],
        webVitals: { lcpMs: 10, cls: 0, fcpMs: 5, ttfbMs: 1 },
        requestedUrl: 'http://127.0.0.1:1/audit',
        observation: {
          mode: 'navigated',
          documentStartedAt: '2026-01-01T00:00:00.000Z',
          observingSince: '2026-01-01T00:00:00.000Z',
          coversWholeDocument: true,
          pageWasHidden: false,
        },
        baseline: null,
        ...overrides,
      };
    }

    it('P3: no options -> runtime.audit called with (sessionId, {tabId}); path null, base64 present, no baselineDiffBase64', async () => {
      const result = fakeResult();
      const stub = { audit: vi.fn().mockResolvedValue(result) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      const r = await page.audit();

      expect(stub.audit).toHaveBeenCalledWith('sess-1', { tabId: 'tab-1' });
      expect(r.report.screenshot.path).toBeNull();
      expect(r.screenshotBase64).toBe(result.screenshotBase64);
      expect('baselineDiffBase64' in r).toBe(false);
    });

    it('P4: url + baselineUrl are forwarded, and a successful baseline yields baselineDiffBase64', async () => {
      const diffB64 = makePngBase64(5, 4);
      const result = fakeResult({
        baseline: { url: 'http://y/', width: 5, height: 4, diffPixelCount: 1, totalPixels: 20, diffPercentage: 5, diffImageBase64: diffB64 },
      });
      const stub = { audit: vi.fn().mockResolvedValue(result) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      const r = await page.audit({ url: 'http://x/', baselineUrl: 'http://y/' });

      expect(stub.audit).toHaveBeenCalledWith('sess-1', { tabId: 'tab-1', url: 'http://x/', baselineUrl: 'http://y/' });
      expect(r.baselineDiffBase64).toBe(diffB64);
    });

    it('P5: outDir writes both files and reports absolute paths matching the decoded bytes', async () => {
      const result = fakeResult();
      const stub = { audit: vi.fn().mockResolvedValue(result) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');
      const tmp = path.join(os.tmpdir(), `fr212-sdk-p5-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const nested = path.join(tmp, 'a', 'b');

      try {
        const r = await page.audit({ outDir: nested });
        expect(path.isAbsolute(r.report.screenshot.path!)).toBe(true);
        expect(r.report.screenshot.path!.startsWith(path.resolve(nested))).toBe(true);
        const bytes = await fs.readFile(r.report.screenshot.path!);
        expect(bytes.equals(Buffer.from(result.screenshotBase64, 'base64'))).toBe(true);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('P6: outDir pointing at an existing file rejects, and runtime.audit is never called', async () => {
      const stub = { audit: vi.fn().mockResolvedValue(fakeResult()) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');
      const tmp = path.join(os.tmpdir(), `fr212-sdk-p6-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await fs.writeFile(tmp, 'not a directory');

      try {
        await expect(page.audit({ outDir: tmp })).rejects.toThrow(/Cannot create audit output directory/);
        expect(stub.audit).not.toHaveBeenCalled();
      } finally {
        await fs.rm(tmp, { force: true });
      }
    });

    it('P7: a runtime.audit rejection propagates with the same message', async () => {
      const stub = { audit: vi.fn().mockRejectedValue(new Error('no live browser page')) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await expect(page.audit()).rejects.toThrow('no live browser page');
    });
  });
});
