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

    it('listTabs on an unknown session throws', () => {
      const runtime = new SutradharRuntime();
      expect(() => runtime.listTabs('nope')).toThrow(BrowserNotAvailableError);
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
});
