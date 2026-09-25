/**
 * @file packages/capability-runtime/tests/unit/runtime.spec.ts
 * @description Unit tests for SutradharRuntime lifecycle, target normalization, and the
 * error-contract that integration surfaces (MCP/SDK) rely on.
 *
 * Fast, no-browser tests. The end-to-end real-Chrome flow lives in scripts/smoke-headless.mjs
 * (opt-in, run manually) — these tests guard the logic that doesn't need a browser.
 */

import {
  SutradharRuntime,
  normalizeTarget,
  BrowserNotAvailableError,
  CAPABILITY_RUNTIME_VERSION,
} from '../../src/index.js';
import { RateLimiter } from '@sutradhar/utils';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserLauncher, PuppeteerBrowserInstance } from '@sutradhar/browser';
import { createSessionId } from '@sutradhar/contracts';

describe('@sutradhar/capability-runtime SutradharRuntime (logic, no browser)', () => {
  it('exports its package version', () => {
    expect(CAPABILITY_RUNTIME_VERSION).toBe('0.1.0');
  });

  describe('normalizeTarget', () => {
    it('treats a pure-numeric string as a sd-node-id from a snapshot', () => {
      expect(normalizeTarget('7')).toBe('[data-sd-node-id="7"]');
    });

    it('passes a CSS selector through unchanged', () => {
      expect(normalizeTarget('#search')).toBe('#search');
      expect(normalizeTarget('.btn.primary')).toBe('.btn.primary');
    });

    it('normalizes whitespace around a numeric id', () => {
      expect(normalizeTarget('  42  ')).toBe('[data-sd-node-id="42"]');
    });

    it('treats an attribute selector as a selector, not an id', () => {
      expect(normalizeTarget('[data-sd-node-id="7"]')).toBe('[data-sd-node-id="7"]');
    });
  });

  describe('session/tab resolution errors', () => {
    it('throws BrowserNotAvailableError when acting on an unknown session', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.navigate('nope', 'https://example.com')).rejects.toThrow(
        BrowserNotAvailableError,
      );
      await expect(runtime.navigate('nope', 'https://example.com')).rejects.toThrow(
        /No browser session/,
      );
    });

    it('listTabs on an unknown session throws', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.listTabs('nope')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('shutdown on an unknown session throws', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.shutdown('nope')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('shutdownAll is safe on an empty runtime', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.shutdownAll()).resolves.toBeUndefined();
    });
  });

  describe('restrictNavigationToLocal', () => {
    it('is off by default — navigate to a real-internet URL is not blocked by this check (fails later on unknown session instead)', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.navigate('nope', 'https://example.com')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('blocks navigate() to a real-internet host when enabled', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true });
      await expect(runtime.navigate('nope', 'https://example.com')).rejects.toThrow(
        /restrictNavigationToLocal is enabled/,
      );
    });

    it('blocks launch()\'s initialUrl to a real-internet host when enabled', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true });
      await expect(runtime.launch({ initialUrl: 'https://example.com' })).rejects.toThrow(
        /restrictNavigationToLocal is enabled/,
      );
    });

    it('allows localhost, 127.0.0.1, and private-IP targets when enabled', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true });
      // All three fail with the unrelated "unknown session" error — proving the local-only
      // check itself passed and let them through to the next stage.
      await expect(runtime.navigate('nope', 'http://localhost:3000')).rejects.toThrow(
        BrowserNotAvailableError,
      );
      await expect(runtime.navigate('nope', 'http://127.0.0.1:8080')).rejects.toThrow(
        BrowserNotAvailableError,
      );
      await expect(runtime.navigate('nope', 'http://192.168.1.50')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('allows file:/about:/data: URLs when enabled, since they never touch the real network', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true });
      await expect(runtime.navigate('nope', 'file:///C:/tmp/page.html')).rejects.toThrow(
        BrowserNotAvailableError,
      );
      await expect(runtime.navigate('nope', 'about:blank')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('does not block createTab()\'s url only when enabled AND the target is non-local', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true });
      await expect(runtime.createTab('nope', 'https://example.com')).rejects.toThrow(
        /restrictNavigationToLocal is enabled/,
      );
    });
  });

  describe('allowedDomains', () => {
    it('is off by default — navigate to any host is not blocked by this check', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.navigate('nope', 'https://anything.example.com')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('blocks navigate() to a host not on the allowlist', async () => {
      const runtime = new SutradharRuntime({ allowedDomains: ['example.com'] });
      await expect(runtime.navigate('nope', 'https://evil.net')).rejects.toThrow(/allowedDomains is configured/);
    });

    it('allows the exact allowlisted domain', async () => {
      const runtime = new SutradharRuntime({ allowedDomains: ['example.com'] });
      await expect(runtime.navigate('nope', 'https://example.com')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('allows a subdomain of an allowlisted domain', async () => {
      const runtime = new SutradharRuntime({ allowedDomains: ['example.com'] });
      await expect(runtime.navigate('nope', 'https://app.example.com')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('does NOT treat "evilexample.com" as a match for allowlisted "example.com" (no naive substring/suffix check)', async () => {
      const runtime = new SutradharRuntime({ allowedDomains: ['example.com'] });
      await expect(runtime.navigate('nope', 'https://evilexample.com')).rejects.toThrow(
        /allowedDomains is configured/,
      );
    });

    it('composes with restrictNavigationToLocal — a local target still needs to be on the allowlist too', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true, allowedDomains: ['example.com'] });
      await expect(runtime.navigate('nope', 'http://localhost:3000')).rejects.toThrow(
        /allowedDomains is configured/,
      );
    });

    it('allows file:/about:/data: URLs regardless of the allowlist', async () => {
      const runtime = new SutradharRuntime({ allowedDomains: ['example.com'] });
      await expect(runtime.navigate('nope', 'file:///C:/tmp/page.html')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('blocks BOTH compareUrls() targets against the allowlist', async () => {
      const runtime = new SutradharRuntime({ allowedDomains: ['example.com'] });
      await expect(runtime.compareUrls('nope', 'https://evil.net', 'https://example.com')).rejects.toThrow(
        /allowedDomains is configured/,
      );
      await expect(runtime.compareUrls('nope', 'https://example.com', 'https://evil.net')).rejects.toThrow(
        /allowedDomains is configured/,
      );
    });
  });

  describe('named profiles (launch profileName / getProfileManager)', () => {
    let profilesBaseDir: string;

    beforeEach(async () => {
      profilesBaseDir = await mkdtemp(path.join(os.tmpdir(), 'sutradhar-runtime-profile-test-'));
    });

    afterEach(async () => {
      await rm(profilesBaseDir, { recursive: true, force: true });
    });

    it('getProfileManager() creates/lists profiles scoped to profilesBaseDir', async () => {
      const runtime = new SutradharRuntime({ profilesBaseDir });
      await runtime.getProfileManager().create('work');

      const list = await runtime.getProfileManager().list();
      expect(list.map((p) => p.name)).toEqual(['work']);
    });

    it('launch({ profileName }) throws a clear error for a profile that was never created — before touching the browser layer', async () => {
      const runtime = new SutradharRuntime({ profilesBaseDir });
      await expect(runtime.launch({ profileName: 'nonexistent' })).rejects.toThrow(
        /No profile named "nonexistent"/,
      );
    });

    it('two separate SutradharRuntime instances pointed at the same profilesBaseDir see the same profiles', async () => {
      const runtimeA = new SutradharRuntime({ profilesBaseDir });
      await runtimeA.getProfileManager().create('shared');

      const runtimeB = new SutradharRuntime({ profilesBaseDir });
      const info = await runtimeB.getProfileManager().get('shared');
      expect(info?.name).toBe('shared');
    });
  });

  describe('audit', () => {
    it('throws BrowserNotAvailableError when auditing an unknown session', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.audit('nope')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('respects restrictNavigationToLocal for the audit url, before touching the browser layer', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true });
      await expect(runtime.audit('nope', { url: 'https://example.com' })).rejects.toThrow(
        /restrictNavigationToLocal is enabled/,
      );
    });
  });

  describe('compareUrls', () => {
    it('throws BrowserNotAvailableError for an unknown session', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.compareUrls('nope', 'https://a.example.com', 'https://b.example.com')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('respects restrictNavigationToLocal for BOTH urls, before touching the browser layer', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true });
      await expect(runtime.compareUrls('nope', 'https://a.example.com', 'http://localhost:3000')).rejects.toThrow(
        /restrictNavigationToLocal is enabled/,
      );
      // Second url checked too, not just the first.
      await expect(runtime.compareUrls('nope', 'http://localhost:3000', 'https://b.example.com')).rejects.toThrow(
        /restrictNavigationToLocal is enabled/,
      );
    });
  });

  describe('axSnapshot', () => {
    it('throws BrowserNotAvailableError for an unknown session', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.axSnapshot('nope')).rejects.toThrow(BrowserNotAvailableError);
    });
  });

  describe('newly-exposed action wrapper methods share the same unknown-session error contract', () => {
    it('waitForSelector on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.waitForSelector('nope', '#foo')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('clickByText on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.clickByText('nope', 'Submit')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('clickByRole on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.clickByRole('nope', 'button')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('typeByLabel on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.typeByLabel('nope', 'Username', 'tomsmith')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('uploadFile on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.uploadFile('nope', '#file', '/tmp/x.txt')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });
  });

  describe('Wave 5: cookies/storage/geolocation wrapper methods share the same unknown-session error contract', () => {
    it('setCookie on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.setCookie('nope', { name: 'a', value: 'b' })).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('deleteCookie on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.deleteCookie('nope', 'a')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('getLocalStorage on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.getLocalStorage('nope')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('setLocalStorageItem on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.setLocalStorageItem('nope', 'k', 'v')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('getSessionStorage on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.getSessionStorage('nope')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('setGeolocation on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(
        runtime.setGeolocation('nope', { latitude: 1, longitude: 2 }),
      ).rejects.toThrow(BrowserNotAvailableError);
    });

    it('grantPermissions on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(
        runtime.grantPermissions('nope', 'https://example.com', ['geolocation']),
      ).rejects.toThrow(BrowserNotAvailableError);
    });
  });

  describe('Wave 12: viewport/emulation/clipboard/file-chooser wrapper methods share the same unknown-session error contract', () => {
    it('setViewport on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.setViewport('nope', { width: 800, height: 600 })).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('emulateSettings on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.emulateSettings('nope', { timezone: 'UTC' })).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('getClipboard on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.getClipboard('nope')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('setClipboard on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.setClipboard('nope', 'hello')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('uploadFileViaTrigger on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.uploadFileViaTrigger('nope', '#browse', '/tmp/x.txt')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('selectOptions on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.selectOptions('nope', '#colors', ['red', 'blue'])).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });
  });

  describe('Wave 6: download/drag/touch/pdf/extract wrapper methods share the same unknown-session error contract', () => {
    it('clickWithButton on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.clickWithButton('nope', '#foo', 'right')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('dragAndDrop on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.dragAndDrop('nope', '#src', '#dst')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('touchTap on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.touchTap('nope', '#foo')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('downloadFile on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.downloadFile('nope', '#foo')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('exportPdf on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.exportPdf('nope')).rejects.toThrow(BrowserNotAvailableError);
    });

    it('extractData on an unknown session throws BrowserNotAvailableError', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.extractData('nope', { title: { selector: 'h1' } })).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('extractData with a frameSelector on an unknown session still throws BrowserNotAvailableError (frame resolution never gets a chance to run)', async () => {
      const runtime = new SutradharRuntime();
      await expect(
        runtime.extractData('nope', { title: { selector: 'h1' } }, undefined, '#some-iframe'),
      ).rejects.toThrow(BrowserNotAvailableError);
    });

    it('getActionHistory on an unknown session throws BrowserNotAvailableError', () => {
      const runtime = new SutradharRuntime();
      expect(() => runtime.getActionHistory('nope')).toThrow(BrowserNotAvailableError);
    });
  });

  describe('eval/extractData frameSelector — cross-frame reads (fixes the gap found in the extreme-scenarios comparison: eval() previously could never reach a genuinely cross-origin iframe, unlike click/type)', () => {
    it('eval on an unknown session throws BrowserNotAvailableError even with frameSelector set', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.eval('nope', '1 + 1', undefined, '#some-iframe')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('resolveFrame throws a clear error when frameSelector matches no element on the top-level page', async () => {
      const runtime = new SutradharRuntime();
      const fakePage = { $: vi.fn().mockResolvedValue(null) };
      // @ts-expect-error — reaching into a private method to test resolveFrame's own error
      // contract directly, without needing a real launched browser (this file's stated scope).
      await expect(runtime.resolveFrame(fakePage, '#missing-iframe')).rejects.toThrow(
        /No element matched frameSelector "#missing-iframe"/,
      );
    });

    it('resolveFrame throws a clear error when the matched element is not an <iframe> (no content frame)', async () => {
      const runtime = new SutradharRuntime();
      const fakeHandle = { contentFrame: vi.fn().mockResolvedValue(null) };
      const fakePage = { $: vi.fn().mockResolvedValue(fakeHandle) };
      // @ts-expect-error — same private-method testing approach as above.
      await expect(runtime.resolveFrame(fakePage, '.not-an-iframe')).rejects.toThrow(
        /is not an <iframe>/,
      );
    });

    it('resolveFrame returns the real Frame from a matched iframe element\'s contentFrame()', async () => {
      const runtime = new SutradharRuntime();
      const fakeFrame = { evaluate: vi.fn() };
      const fakeHandle = { contentFrame: vi.fn().mockResolvedValue(fakeFrame) };
      const fakePage = { $: vi.fn().mockResolvedValue(fakeHandle) };
      // @ts-expect-error — same private-method testing approach as above.
      const frame = await runtime.resolveFrame(fakePage, '#cross-origin-frame');
      expect(frame).toBe(fakeFrame);
      expect(fakePage.$).toHaveBeenCalledWith('#cross-origin-frame');
    });

    it('resolveFrame normalizes a numeric snapshot id the same way click/type do', async () => {
      const runtime = new SutradharRuntime();
      const fakeFrame = { evaluate: vi.fn() };
      const fakeHandle = { contentFrame: vi.fn().mockResolvedValue(fakeFrame) };
      const fakePage = { $: vi.fn().mockResolvedValue(fakeHandle) };
      // @ts-expect-error — same private-method testing approach as above.
      await runtime.resolveFrame(fakePage, '12');
      expect(fakePage.$).toHaveBeenCalledWith('[data-sd-node-id="12"]');
    });
  });

  describe('rate limiting', () => {
    it('consumes a token from the configured rate limiter before navigating', async () => {
      const rateLimiter = new RateLimiter({ tokensPerInterval: 5, intervalMs: 1000 });
      const spy = vi.spyOn(rateLimiter, 'removeToken');
      const runtime = new SutradharRuntime({ rateLimiter });

      await runtime.navigate('nope', 'https://example.com').catch(() => {}); // fails on unknown session, but after the token check
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not rate-limit at all when rateLimiter: null is passed', async () => {
      const runtime = new SutradharRuntime({ rateLimiter: null });
      // Should fail immediately with BrowserNotAvailableError, not hang on any limiter.
      await expect(runtime.navigate('nope', 'https://example.com')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });

    it('defaults to a real RateLimiter when none is provided', async () => {
      const runtime = new SutradharRuntime();
      await expect(runtime.navigate('nope', 'https://example.com')).rejects.toThrow(
        BrowserNotAvailableError,
      );
    });
  });

  describe('getSessionManager', () => {
    it('exposes the underlying session manager for host wiring (AgentCore/MCP attach)', () => {
      const runtime = new SutradharRuntime();
      const mgr = runtime.getSessionManager();
      expect(mgr).toBeDefined();
      expect(typeof mgr.createSession).toBe('function');
    });
  });

  describe('waitForSelector state pass-through (FR2-01)', () => {
    it('R1: passes the given state straight through to the engine — the engine, not the runtime, owns the default', async () => {
      const runtime = new SutradharRuntime();
      const spy = vi
        .spyOn(runtime as any, 'runAction')
        .mockResolvedValue({ success: true, actionType: 'wait_for_selector', executionTimeMs: 1 });

      await runtime.waitForSelector('s', '7', 500, 't', 'hidden');

      expect(spy).toHaveBeenCalledWith(
        's',
        { actionType: 'wait_for_selector', selector: '[data-sd-node-id="7"]', timeoutMs: 500, state: 'hidden' },
        't',
      );
    });

    it('R2: called without a state, passes state:undefined through unchanged', async () => {
      const runtime = new SutradharRuntime();
      const spy = vi
        .spyOn(runtime as any, 'runAction')
        .mockResolvedValue({ success: true, actionType: 'wait_for_selector', executionTimeMs: 1 });

      await runtime.waitForSelector('s', '#t', 500, 't');

      expect(spy).toHaveBeenCalledWith(
        's',
        { actionType: 'wait_for_selector', selector: '#t', timeoutMs: 500, state: undefined },
        't',
      );
    });
  });
});

describe('extractData live values (FR2-02)', () => {
  const originalDocument = (globalThis as any).document;
  const originalGetComputedStyle = (globalThis as any).getComputedStyle;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    (globalThis as any).document = originalDocument;
    (globalThis as any).getComputedStyle = originalGetComputedStyle;
  });

  function stubDom(elementsBySelector: Record<string, any[]>) {
    vi.stubGlobal('document', {
      querySelectorAll: vi.fn((sel: string) => {
        const found = elementsBySelector[sel];
        if (found === undefined) return [];
        if (found instanceof Error) throw found;
        return found;
      }),
    });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
  }

  function withFakePage() {
    const fakePage = { evaluate: vi.fn((fn: any, arg: any) => fn(arg)) };
    vi.spyOn(SutradharRuntime.prototype as any, 'resolveTab').mockReturnValue({ tab: {} });
    vi.spyOn(SutradharRuntime.prototype as any, 'requirePage').mockReturnValue(fakePage);
    return fakePage;
  }

  it('R1: reads live values for both a plain selector and a normalized numeric selector', async () => {
    stubDom({
      '#i': [{ localName: 'input', value: 'typed', getAttribute: () => null }],
      '[data-sd-node-id="12"]': [{ localName: 'div', innerText: 'text' }],
    });
    const fakePage = withFakePage();
    const runtime = new SutradharRuntime();

    const result = await runtime.extractData('s', { v: { selector: '#i' }, t: { selector: '12' } });

    expect(result).toEqual({ v: ['typed'], t: ['text'] });
    const plan = fakePage.evaluate.mock.calls[0][1];
    expect(plan.find((p: any) => p.name === 't').selector).toBe('[data-sd-node-id="12"]');
  });

  it('R2: an invalid selector rejects with the Sutradhar-authored message, hint, and Error name', async () => {
    const parserError = new Error(
      "Failed to execute 'querySelectorAll' on 'Document': '.p[' is not a valid selector.",
    );
    stubDom({ '.p[': parserError });
    withFakePage();
    const runtime = new SutradharRuntime();

    await expect(runtime.extractData('s', { bad: { selector: '.p[' } })).rejects.toMatchObject({
      name: 'Error',
      message: expect.stringMatching(/^Invalid selector for field "bad"/),
    });
    await expect(runtime.extractData('s', { bad: { selector: '.p[' } })).rejects.toThrow(
      /is not a valid selector/,
    );
    await expect(runtime.extractData('s', { bad: { selector: '.p[' } })).rejects.toThrow(/Playwright-style/);
  });

  it('R3: an "attr:" attribute with no name rejects before evaluate is ever called', async () => {
    const fakePage = withFakePage();
    const runtime = new SutradharRuntime();

    await expect(runtime.extractData('s', { bad: { selector: '#a', attribute: 'attr:' } })).rejects.toThrow(
      /needs an attribute name/,
    );
    expect(fakePage.evaluate).not.toHaveBeenCalled();
  });

  it('R4: call-level visibleOnly applies to every field unless a field overrides it', async () => {
    stubDom({ '#a': [], '#b': [] });
    const fakePage = withFakePage();
    const runtime = new SutradharRuntime();

    await runtime.extractData(
      's',
      { a: { selector: '#a' }, b: { selector: '#b', visibleOnly: false } },
      undefined,
      undefined,
      { visibleOnly: true },
    );

    const plan = fakePage.evaluate.mock.calls[0][1];
    expect(plan.find((p: any) => p.name === 'a').visibleOnly).toBe(true);
    expect(plan.find((p: any) => p.name === 'b').visibleOnly).toBe(false);
  });

  it('R5: resolveFrame wraps a selector-syntax rejection from page.$ into a Sutradhar-authored error', async () => {
    const err = new Error("Failed to execute 'querySelector' on 'Document': 'iframe[' is not a valid selector.");
    const fakePage = { $: vi.fn().mockRejectedValue(err) };
    const runtime = new SutradharRuntime();

    // @ts-expect-error — reaching into the private method, same pattern as the existing
    // resolveFrame tests above.
    await expect(runtime.resolveFrame(fakePage, 'iframe[')).rejects.toMatchObject({
      message: expect.stringMatching(
        /^Invalid frameSelector "iframe\[" \(from the full chain "iframe\["\) — Failed to execute/,
      ),
    });
    // @ts-expect-error
    await expect(runtime.resolveFrame(fakePage, 'iframe[')).rejects.toThrow(/Playwright-style/);
    // @ts-expect-error
    const rejection = await runtime.resolveFrame(fakePage, 'iframe[').catch((e: Error) => e);
    expect(rejection.message).not.toContain('SyntaxError:');
  });

  it('R6: a non-syntax rejection from page.$ is rethrown as the exact same error object', async () => {
    const err = new Error('Execution context was destroyed');
    const fakePage = { $: vi.fn().mockRejectedValue(err) };
    const runtime = new SutradharRuntime();

    // @ts-expect-error
    await expect(runtime.resolveFrame(fakePage, '#a')).rejects.toBe(err);
  });

  it('R7: a syntax error on the second hop of a chain names that hop and the full chain', async () => {
    const err = new Error("Failed to execute 'querySelector' on 'Document': 'iframe[' is not a valid selector.");
    const goodFrame = { evaluate: vi.fn() };
    const goodHandle = { contentFrame: vi.fn().mockResolvedValue(goodFrame) };
    const fakePage = {
      $: vi.fn().mockResolvedValueOnce(goodHandle),
    };
    // The second hop's $ call happens on the resolved frame, not the top-level page.
    (goodFrame as any).$ = vi.fn().mockRejectedValue(err);
    const runtime = new SutradharRuntime();

    // @ts-expect-error
    await expect(runtime.resolveFrame(fakePage, 'iframe.a::iframe[')).rejects.toMatchObject({
      message: expect.stringContaining('Invalid frameSelector "iframe[" (from the full chain "iframe.a::iframe[")'),
    });
  });
});

describe('@sutradhar/capability-runtime SutradharRuntime.snapshot — FR2-09 skippedFrames', () => {
  it('FR2-09 R1: skippedFrames is present exactly when includeNodes is set, and absent otherwise (like nodes)', async () => {
    const runtime = new SutradharRuntime();
    const fakeTab = { id: 'tab_1', url: 'https://x.test', title: 'T' };
    const skipped = [
      { index: 1, url: 'https://ads.example', origin: 'https://ads.example', reason: 'timeout' as const, detail: '5000' },
    ];
    const graph = { nodes: [], url: 'https://x.test', title: 'T', skippedFrames: skipped };

    vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab: fakeTab });
    vi.spyOn(runtime as any, 'requirePage').mockReturnValue({});
    vi.spyOn((runtime as any).domEngine, 'buildGraph').mockResolvedValue(graph);
    vi.spyOn(runtime as any, 'readPageText').mockResolvedValue('');

    const withNodes = await runtime.snapshot('s1', undefined, undefined, { includeNodes: true });
    expect(withNodes.skippedFrames).toEqual(skipped);
    expect(withNodes.nodes).toEqual([]);

    const withoutNodes = await runtime.snapshot('s1', undefined, undefined, {});
    expect('skippedFrames' in withoutNodes).toBe(false);
    expect('nodes' in withoutNodes).toBe(false);
  });
});

describe('listSessions (FR2-10)', () => {
  function noBrowserRuntime() {
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'findExecutablePath').mockReturnValue(undefined);
    return new SutradharRuntime({ launcher, rateLimiter: null });
  }

  it('S1: a fresh runtime reports no sessions and no in-flight ops', () => {
    const runtime = noBrowserRuntime();
    expect(runtime.listSessions()).toEqual({ sessions: [], lifecycleOpsInFlight: 0 });
  });

  it('S2: launch() twice registers two launched, mock (no real browser) entries, sorted by createdAt then id', async () => {
    const runtime = noBrowserRuntime();
    const { sessionId: id1 } = await runtime.launch();
    const { sessionId: id2 } = await runtime.launch();

    const view = runtime.listSessions();
    expect(view.sessions.length).toBe(2);
    for (const s of view.sessions) {
      expect(s.origin).toBe('launched');
      expect(s.hasRealBrowser).toBe(false);
      expect(s.tabCount).toBe(1);
      expect(s.activeUrl).toBe('about:blank');
      expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    const ids = view.sessions.map((s) => s.sessionId);
    expect(new Set(ids)).toEqual(new Set([id1, id2]));
    const sorted = [...view.sessions].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.sessionId.localeCompare(b.sessionId),
    );
    expect(view.sessions).toEqual(sorted);
  });

  it('S3: attach() registers an "attached" entry', async () => {
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'findExecutablePath').mockReturnValue(undefined);
    vi.spyOn(launcher, 'connect').mockResolvedValue(new PuppeteerBrowserInstance());
    const runtime = new SutradharRuntime({ launcher, rateLimiter: null });

    const { sessionId } = await runtime.attach({ endpoint: 'ws://x' });

    const view = runtime.listSessions();
    expect(view.sessions).toHaveLength(1);
    expect(view.sessions[0]!.sessionId).toBe(sessionId);
    expect(view.sessions[0]!.origin).toBe('attached');
  });

  it('S4: lifecycleOpsInFlight is 1 while launch() is pending, 0 after it resolves, and 0 after it rejects or throws synchronously', async () => {
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'findExecutablePath').mockReturnValue(undefined);

    let resolveLaunch!: (v: PuppeteerBrowserInstance) => void;
    const deferred = new Promise<PuppeteerBrowserInstance>((res) => (resolveLaunch = res));
    const launchSpy = vi.spyOn(launcher, 'launch').mockReturnValue(deferred);
    const runtime = new SutradharRuntime({ launcher, rateLimiter: null });

    const pending = runtime.launch();
    // Give the microtask queue a turn so the async launch() body actually starts.
    await Promise.resolve();
    expect(runtime.listSessions().lifecycleOpsInFlight).toBe(1);
    expect(runtime.listSessions().sessions).toEqual([]);

    resolveLaunch(new PuppeteerBrowserInstance());
    await pending;
    expect(runtime.listSessions().lifecycleOpsInFlight).toBe(0);

    launchSpy.mockRejectedValueOnce(new Error('boom'));
    await expect(runtime.launch()).rejects.toThrow('boom');
    expect(runtime.listSessions().lifecycleOpsInFlight).toBe(0);

    const restricted = new SutradharRuntime({ launcher, rateLimiter: null, restrictNavigationToLocal: true });
    await expect(restricted.launch({ initialUrl: 'https://example.com' })).rejects.toThrow(
      /restrictNavigationToLocal is enabled/,
    );
    expect(restricted.listSessions().lifecycleOpsInFlight).toBe(0);
  });

  it('S5: shutdown() and shutdownAll() remove entries; shutdown of an unknown id still throws and leaves the counter at 0', async () => {
    const runtime = noBrowserRuntime();
    const { sessionId: id1 } = await runtime.launch();
    const { sessionId: id2 } = await runtime.launch();

    await runtime.shutdown(id1);
    expect(runtime.listSessions().sessions.map((s) => s.sessionId)).toEqual([id2]);

    await runtime.shutdownAll();
    expect(runtime.listSessions().sessions).toEqual([]);

    await expect(runtime.shutdown('nope')).rejects.toThrow(BrowserNotAvailableError);
    expect(runtime.listSessions().lifecycleOpsInFlight).toBe(0);
  });

  it('S6: a session created directly via the session manager (agent.runGoal-style, no launch()/attach()) is not listed', async () => {
    const runtime = noBrowserRuntime();
    await runtime.getSessionManager().createSession({});

    expect(runtime.getSessionManager().getSessionCount()).toBe(1);
    expect(runtime.listSessions().sessions).toEqual([]);
  });

  it('S7: a session removed behind the runtime\'s back (idle reap / crash) is pruned from listSessions', async () => {
    const runtime = noBrowserRuntime();
    const { sessionId } = await runtime.launch();
    expect(runtime.listSessions().sessions).toHaveLength(1);

    await runtime.getSessionManager().closeSession(createSessionId(sessionId));
    expect(runtime.listSessions().sessions).toEqual([]);

    // Re-launching under the SAME id proves the stale internal entry was actually pruned, not
    // just filtered on display: exactly one entry is listed, not a stale duplicate.
    await runtime.launch({ sessionId });
    expect(runtime.listSessions().sessions).toHaveLength(1);
  });

  it('S8: a reused id keeps its original origin (launch/launch, and attach then launch under the same id)', async () => {
    const runtime = noBrowserRuntime();
    await runtime.launch({ sessionId: 'fixed' });
    await runtime.launch({ sessionId: 'fixed' });
    expect(runtime.listSessions().sessions).toHaveLength(1);
    expect(runtime.listSessions().sessions[0]!.origin).toBe('launched');

    const launcher2 = new BrowserLauncher();
    vi.spyOn(launcher2, 'findExecutablePath').mockReturnValue(undefined);
    vi.spyOn(launcher2, 'connect').mockResolvedValue(new PuppeteerBrowserInstance());
    const runtime2 = new SutradharRuntime({ launcher: launcher2, rateLimiter: null });
    await runtime2.attach({ endpoint: 'ws://x', sessionId: 'fixed2' });
    await runtime2.launch({ sessionId: 'fixed2' });
    const entry = runtime2.listSessions().sessions.find((s) => s.sessionId === 'fixed2');
    expect(entry?.origin).toBe('attached');
  });
});
