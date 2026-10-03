/**
 * @file packages/sutradhar/tests/unit/api.spec.ts
 * @description Unit tests for the sutradhar SDK's public API surface — shape and contracts,
 * no real browser. The real-Chrome flow lives in scripts/smoke.mjs.
 */

import {
  launch,
  Browser,
  Page,
  SutradharRuntime,
  SUTRADHAR_VERSION,
  ActionFailedError,
  ExpectationFailedError,
} from '../../src/index.js';
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
    expect(SUTRADHAR_VERSION).toBe('0.6.0');
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

  describe('Page.download / Page.uploadFile (FR2-05)', () => {
    it('SD1: download() forwards to runtime.downloadFile and returns the DownloadResult shape', async () => {
      const stub = {
        downloadFile: vi.fn().mockResolvedValue({
          success: true,
          actionType: 'download_file',
          executionTimeMs: 1,
          output: { downloadedFilename: 'a.txt', downloadedPath: '/x/a.txt', downloadDir: '/x' },
        }),
      };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      const result = await page.download('#dl', { downloadDir: '/x' });

      expect(stub.downloadFile).toHaveBeenCalledWith('sess-1', '#dl', '/x', 'tab-1');
      expect(result).toEqual({ filename: 'a.txt', path: '/x/a.txt', downloadDir: '/x' });
    });

    it('SD2: download() rejects with the runtime\'s error message on failure', async () => {
      const stub = {
        downloadFile: vi.fn().mockResolvedValue({ success: false, actionType: 'download_file', executionTimeMs: 1, error: 'E' }),
      };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await expect(page.download('#dl')).rejects.toThrow('E');
    });

    it('SD3: uploadFile() resolves filePath to an absolute path and forwards to runtime.uploadFile; rejects on failure', async () => {
      const stub = { uploadFile: vi.fn().mockResolvedValue({ success: true, actionType: 'upload_file', executionTimeMs: 1 }) };
      const page = new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

      await page.uploadFile('#f', 'rel.txt');
      expect(stub.uploadFile).toHaveBeenCalledWith('sess-1', '#f', path.resolve('rel.txt'), 'tab-1');

      const failing = { uploadFile: vi.fn().mockResolvedValue({ success: false, actionType: 'upload_file', executionTimeMs: 1, error: 'E' }) };
      const page2 = new Page(failing as unknown as SutradharRuntime, 'sess-1', 'tab-1');
      await expect(page2.uploadFile('#f', 'rel.txt')).rejects.toThrow('E');
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

describe('Page verification contract (FR2-07, constructed against a stub runtime)', () => {
  const verified = {
    verified: true, urlChanged: false, elementFound: true, confidence: 0.9, reason: 'ok',
    evidence: { tier: 'verified', checks: [] },
  };
  const expectFail = {
    verified: false, urlChanged: false, elementFound: false, confidence: 0.09, reason: 'Expected text "x" was not found',
    evidence: { tier: 'contradicted', checks: [{ check: 'expect.text', outcome: 'fail' }] },
  };
  const builtInBad = {
    verified: false, urlChanged: false, elementFound: false, confidence: 0.09, reason: 'value did not change',
    evidence: { tier: 'contradicted', checks: [{ check: 'press_key.effect', outcome: 'fail' }] },
  };
  const make = (stub: Record<string, unknown>) => new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

  it('S1: click() returns the runtime result and calls the runtime with exactly 6 args', async () => {
    const result = { success: true, actionType: 'click', executionTimeMs: 1, verification: verified };
    const stub = { click: vi.fn().mockResolvedValue(result) };
    const page = make(stub);
    expect(await page.click('7')).toBe(result);
    expect(stub.click.mock.calls[0]).toHaveLength(6);
    expect(page.lastResult).toBe(result);
  });

  it('S2: a success:false result throws ActionFailedError carrying the result (GAP-024: no more silent swallowing)', async () => {
    const stub = { click: vi.fn().mockResolvedValue({ success: false, actionType: 'click', executionTimeMs: 1, error: 'nope' }) };
    const page = make(stub);
    const err = await page.click('7').catch((e) => e);
    expect(err).toBeInstanceOf(ActionFailedError);
    expect(err.name).toBe('ActionFailedError');
    expect(err.message).toBe('nope');
    expect(err.result.error).toBe('nope');
    expect(page.lastResult).toBe(err.result);
    // and the other verbs that used to swallow it
    for (const [verb, call] of [
      ['type', () => make({ type: vi.fn().mockResolvedValue({ success: false, error: 'e' }) }).type('7', 'x')],
      ['press', () => make({ pressKey: vi.fn().mockResolvedValue({ success: false, error: 'e' }) }).press('Enter')],
      ['scroll', () => make({ scroll: vi.fn().mockResolvedValue({ success: false, error: 'e' }) }).scroll()],
    ] as const) {
      await expect(call(), verb).rejects.toBeInstanceOf(ActionFailedError);
    }
  });

  it('S3: a failed expectation throws ExpectationFailedError (success stays true on the result), called with 7 args', async () => {
    const result = { success: true, actionType: 'click', executionTimeMs: 1, verification: expectFail };
    const stub = { click: vi.fn().mockResolvedValue(result) };
    const page = make(stub);
    const err = await page.click('7', { expect: { text: 'x' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ExpectationFailedError);
    expect(err.name).toBe('ExpectationFailedError');
    expect(err.failed).toEqual(['text']);
    expect(err.result.success).toBe(true);
    expect(err.message).toBe('Expectation failed (text): Expected text "x" was not found');
    expect(stub.click.mock.calls[0]).toHaveLength(7);
    expect(stub.click.mock.calls[0]![6]).toEqual({ text: 'x' });
    // a PASSING expectation resolves
    const ok = make({ click: vi.fn().mockResolvedValue({ success: true, verification: { ...verified, evidence: { tier: 'verified', checks: [{ check: 'expect.text', outcome: 'pass' }] } } }) });
    await expect(ok.click('7', { expect: { text: 'x' } })).resolves.toMatchObject({ success: true });
  });

  it('S4: a built-in contradiction with NO expect resolves (the caller reads result.verification)', async () => {
    const result = { success: true, actionType: 'press_key', executionTimeMs: 1, verification: builtInBad };
    const stub = { pressKey: vi.fn().mockResolvedValue(result) };
    const page = make(stub);
    const r = await page.press('a');
    expect(r.verification?.evidence.tier).toBe('contradicted');
    expect(stub.pressKey.mock.calls[0]).toEqual(['sess-1', 'a', 'tab-1']); // arity unchanged without expect
  });

  it('S5: goto() still returns the Page; expect failure throws; lastResult holds the navigate result', async () => {
    const nav = { tabId: 'tab-1', url: 'https://a.test/login', title: 'L', verification: expectFail };
    const stub = { navigate: vi.fn().mockResolvedValue(nav) };
    const page = make(stub);
    expect(await page.goto('https://a.test/x')).toBe(page);
    expect(page.lastResult).toBe(nav);
    expect(stub.navigate.mock.calls[0]).toEqual(['sess-1', 'https://a.test/x', 'tab-1']);
    const err = await page.goto('https://a.test/x', { expect: { url: '/b' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ExpectationFailedError);
    expect(err.result.url).toBe('https://a.test/login');
    expect(stub.navigate.mock.calls[1]).toHaveLength(4);
  });

  it('S6: press/scroll forward expect at the right position; screenshot records lastResult and still returns base64', async () => {
    const ok = { success: true, actionType: 'x', executionTimeMs: 1, verification: verified };
    const stub = { pressKey: vi.fn().mockResolvedValue(ok), scroll: vi.fn().mockResolvedValue(ok), screenshot: vi.fn().mockResolvedValue({ base64: 'QQ==', verification: verified }) };
    const page = make(stub);
    await page.press('Enter', { expect: { urlChanged: true } });
    expect(stub.pressKey).toHaveBeenLastCalledWith('sess-1', 'Enter', 'tab-1', undefined, { urlChanged: true });
    await page.scroll('down', 200, { expect: { text: 'x' } });
    expect(stub.scroll).toHaveBeenLastCalledWith('sess-1', 'down', 200, 'tab-1', undefined, undefined, { text: 'x' });
    await page.scroll('up');
    expect(stub.scroll.mock.calls[1]).toEqual(['sess-1', 'up', 500, 'tab-1']);
    expect(await page.screenshot()).toBe('QQ==');
    expect((page.lastResult as any).verification.verified).toBe(true);
  });

  it('S7: waitForSelector keeps its FR2-01 contract (throws the runtime message, resolves undefined) and exposes the result via lastResult', async () => {
    const good = { success: true, actionType: 'wait_for_selector', executionTimeMs: 1, verification: verified };
    const page = make({ waitForSelector: vi.fn().mockResolvedValue(good) });
    await expect(page.waitForSelector('#t')).resolves.toBeUndefined();
    expect(page.lastResult).toBe(good);
    const bad = make({ waitForSelector: vi.fn().mockResolvedValue({ success: false, error: 'timed out' }) });
    await expect(bad.waitForSelector('#t')).rejects.toThrow('timed out');
    const exp = make({ waitForSelector: vi.fn().mockResolvedValue({ ...good, verification: expectFail }) });
    await expect(exp.waitForSelector('#t', { expect: { text: 'x' } })).rejects.toBeInstanceOf(ExpectationFailedError);
  });

  it('download()/uploadFile() keep their FR2-05 shapes, add verification/expect, and pass expect as the last arg only when given', async () => {
    const dl = { success: true, actionType: 'download_file', executionTimeMs: 1, output: { downloadedFilename: 'a', downloadedPath: '/x/a', downloadDir: '/x' }, verification: verified };
    const stub = { downloadFile: vi.fn().mockResolvedValue(dl), uploadFile: vi.fn().mockResolvedValue({ success: true, actionType: 'upload_file', executionTimeMs: 1, verification: verified }) };
    const page = make(stub);
    expect(await page.download('#d')).toEqual({ filename: 'a', path: '/x/a', downloadDir: '/x', verification: verified });
    expect(stub.downloadFile.mock.calls[0]).toHaveLength(4);
    await page.download('#d', { expect: { urlChanged: false } });
    expect(stub.downloadFile.mock.calls[1]).toHaveLength(5);
    await page.uploadFile('#f', 'a.txt');
    expect(stub.uploadFile.mock.calls[0]).toHaveLength(4);
    await page.uploadFile('#f', 'a.txt', { expect: { text: 'x' } }).catch(() => {});
    expect(stub.uploadFile.mock.calls[1]).toHaveLength(5);
  });

  it('the error classes and types are exported from the package entry', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.ActionFailedError).toBe(ActionFailedError);
    expect(mod.ExpectationFailedError).toBe(ExpectationFailedError);
    expect(new ActionFailedError({ success: false, actionType: 'click', executionTimeMs: 0 }).message).toBe('click failed');
  });
});

describe('FR2-08 Page.waitFor and settle on goto/press/scroll/download/uploadFile', () => {
  const ok = { success: true, actionType: 'wait_for', executionTimeMs: 3 };
  const mk = (stub: Record<string, unknown>) => new Page(stub as unknown as SutradharRuntime, 'sess-1', 'tab-1');

  it('S1: waitFor forwards the conditions, mapping timeout -> timeoutMs, with this page\'s session and tab', async () => {
    const stub = { waitFor: vi.fn().mockResolvedValue(ok) };
    const page = mk(stub);
    await page.waitFor({ text: 'x' });
    expect(stub.waitFor).toHaveBeenLastCalledWith('sess-1', { text: 'x' }, 'tab-1');
    await page.waitFor({ text: 'x', timeout: 500 });
    expect(stub.waitFor).toHaveBeenLastCalledWith('sess-1', { text: 'x', timeoutMs: 500 }, 'tab-1');
    await page.waitFor({ textGone: 'g', url: '/u', js: 'window.q', timeout: 0 });
    expect(stub.waitFor).toHaveBeenLastCalledWith('sess-1', { textGone: 'g', url: '/u', js: 'window.q', timeoutMs: 0 }, 'tab-1');
  });

  it('S2: a not-satisfied result rejects with ActionFailedError carrying the exact message and the result', async () => {
    const failed = { success: false, actionType: 'wait_for', executionTimeMs: 500, error: 'wait_for timed out after 500ms waiting for text="x": ...' };
    const page = mk({ waitFor: vi.fn().mockResolvedValue(failed) });
    const err = await page.waitFor({ text: 'x', timeout: 500 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActionFailedError);
    expect((err as ActionFailedError).message).toBe(failed.error);
    expect((err as ActionFailedError).result).toBe(failed);
    expect(page.lastResult).toBe(failed);
  });

  it('S3: a satisfied result resolves to that same object and is the page\'s lastResult', async () => {
    const page = mk({ waitFor: vi.fn().mockResolvedValue(ok) });
    expect(await page.waitFor({ url: '/x' })).toBe(ok);
    expect(page.lastResult).toBe(ok);
  });

  it('S3b: validation errors from the runtime propagate as TypeError (no browser contact); a fatal js throw rejects', async () => {
    const runtime = new SutradharRuntime();
    const page = new Page(runtime, 'nope', 'tab-1');
    await expect(page.waitFor({})).rejects.toThrow(TypeError);
    await expect(page.waitFor({})).rejects.toThrow(/at least one/);
    await expect(page.waitFor({ text: '' })).rejects.toThrow(/non-empty string/);
    await expect(page.waitFor({ text: 'X', textGone: 'X' })).rejects.toThrow(/can never be satisfied/);
    await expect(page.waitFor({ text: 'x', timeout: 300001 })).rejects.toThrow(/exceeds the maximum/);
    await expect(page.waitFor({ text: 'x', timeout: 'abc' as any })).rejects.toThrow(/timeoutMs must be a number/);
    await expect(page.waitFor({ selector: '#t' } as any)).rejects.toThrow(/wait_for_selector/);
    await expect(page.waitFor(undefined as any)).rejects.toThrow(/at least one/);
  });

  it('S6: the SDK spells it `timeout`: `timeoutMs` is rejected naming the allowed keys', async () => {
    const stub = { waitFor: vi.fn() };
    const page = mk(stub);
    await expect(page.waitFor({ text: 'x', timeoutMs: 5 } as any)).rejects.toThrow(/unknown key "timeoutMs" — allowed: text, textGone, url, js, timeout/);
    await expect(page.waitFor({ timeoutMs: 5 } as any)).rejects.toThrow(TypeError);
    expect(stub.waitFor).not.toHaveBeenCalled();
  });

  it('S4: goto forwards settle LAST; without options it keeps its pre-FR2-08 arity', async () => {
    const stub = { navigate: vi.fn().mockResolvedValue({ tabId: 't', url: 'u', title: 't' }) };
    const page = mk(stub);
    await page.goto('https://a.test/');
    expect(stub.navigate.mock.calls[0]).toEqual(['sess-1', 'https://a.test/', 'tab-1']);
    await page.goto('https://a.test/', { settle: true });
    expect(stub.navigate.mock.calls[1]).toEqual(['sess-1', 'https://a.test/', 'tab-1', undefined, true]);
    await page.goto('https://a.test/', { settle: { timeoutMs: 9 }, expect: { url: '/a' } }).catch(() => undefined);
    expect(stub.navigate.mock.calls[2]).toEqual(['sess-1', 'https://a.test/', 'tab-1', { url: '/a' }, { timeoutMs: 9 }]);
    await page.goto('https://a.test/', { expect: { url: '/a' } }).catch(() => undefined);
    expect(stub.navigate.mock.calls[3]).toHaveLength(4);
  });

  it('S5: press and scroll forward settle at the right position; without options the arity is unchanged', async () => {
    const stub = {
      pressKey: vi.fn().mockResolvedValue({ success: true, actionType: 'press_key', executionTimeMs: 1 }),
      scroll: vi.fn().mockResolvedValue({ success: true, actionType: 'scroll', executionTimeMs: 1 }),
    };
    const page = mk(stub);
    await page.press('Enter');
    expect(stub.pressKey.mock.calls[0]).toEqual(['sess-1', 'Enter', 'tab-1']);
    await page.press('Enter', { settle: true });
    expect(stub.pressKey.mock.calls[1]).toEqual(['sess-1', 'Enter', 'tab-1', undefined, undefined, true]);
    await page.press('Enter', { settle: true, expect: { text: 'x' } }).catch(() => undefined);
    expect(stub.pressKey.mock.calls[2]).toEqual(['sess-1', 'Enter', 'tab-1', undefined, { text: 'x' }, true]);

    await page.scroll('down', 300);
    expect(stub.scroll.mock.calls[0]).toEqual(['sess-1', 'down', 300, 'tab-1']);
    await page.scroll('down', 300, { settle: true });
    expect(stub.scroll.mock.calls[1]).toEqual(['sess-1', 'down', 300, 'tab-1', undefined, true]);
    await page.scroll('down', 300, { settle: true, expect: { text: 'x' } }).catch(() => undefined);
    expect(stub.scroll.mock.calls[2]).toEqual(['sess-1', 'down', 300, 'tab-1', undefined, true, { text: 'x' }]);
    await page.scroll('down', 300, { expect: { text: 'x' } }).catch(() => undefined);
    expect(stub.scroll.mock.calls[3]).toEqual(['sess-1', 'down', 300, 'tab-1', undefined, undefined, { text: 'x' }]);
  });

  it('S5b: download and uploadFile forward settle; without it their arity is unchanged', async () => {
    const dl = { success: true, actionType: 'download_file', executionTimeMs: 1, output: { downloadedFilename: 'f', downloadedPath: '/p', downloadDir: '/d' } };
    const stub = {
      downloadFile: vi.fn().mockResolvedValue(dl),
      uploadFile: vi.fn().mockResolvedValue({ success: true, actionType: 'upload_file', executionTimeMs: 1 }),
    };
    const page = mk(stub);
    await page.download('#a');
    expect(stub.downloadFile.mock.calls[0]).toEqual(['sess-1', '#a', undefined, 'tab-1']);
    await page.download('#a', { downloadDir: '/d', settle: true });
    expect(stub.downloadFile.mock.calls[1]).toEqual(['sess-1', '#a', '/d', 'tab-1', undefined, true]);
    await page.uploadFile('#f', '/tmp/x');
    expect(stub.uploadFile.mock.calls[0]).toHaveLength(4);
    await page.uploadFile('#f', '/tmp/x', { settle: true });
    expect(stub.uploadFile.mock.calls[1]![4]).toBeUndefined();
    expect(stub.uploadFile.mock.calls[1]![5]).toBe(true);
  });

  it('exports the new option types and the settle spec from the package entry', async () => {
    const mod = await import('../../src/index.js');
    expect(typeof mod.Page.prototype.waitFor).toBe('function');
  });
});
