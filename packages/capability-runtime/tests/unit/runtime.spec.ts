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
  InvalidSelectorError,
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

    it('FR2-06 R1: throws InvalidSelectorError synchronously for Playwright-style syntax', () => {
      for (const bad of ['text=Submit', 'role=button', 'button >> text=OK', ':has-text("x")', "getByRole('x')", 'internal:role=button', '//a', '#12', '"x"']) {
        expect(() => normalizeTarget(bad)).toThrow(InvalidSelectorError);
      }
    });

    it('FR2-06 R1: still maps a whitespace-padded numeric id', () => {
      expect(normalizeTarget('12')).toBe('[data-sd-node-id="12"]');
      expect(normalizeTarget(' 7 ')).toBe('[data-sd-node-id="7"]');
    });

    it('FR2-06 R1: Puppeteer-native slash prefixes pass through unchanged', () => {
      expect(normalizeTarget('pierce/#x')).toBe('pierce/#x');
      expect(normalizeTarget('xpath///a')).toBe('xpath///a');
      expect(normalizeTarget('aria/X')).toBe('aria/X');
      expect(normalizeTarget('text/Y')).toBe('text/Y');
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

  describe('audit (FR2-12)', () => {
    const TIME_ORIGIN = Date.parse('2026-01-01T00:00:10.000Z');
    const URL_ = 'http://127.0.0.1:1/audit';

    function fakePage(overrides: Partial<any> = {}) {
      return {
        isClosed: () => false,
        url: () => URL_,
        title: async () => 'T',
        screenshot: vi.fn(async () => 'AAAA'),
        evaluate: vi.fn(async () => ({ issues: [], webVitals: { lcpMs: 10, cls: 0, fcpMs: 5, ttfbMs: 1 }, timeOrigin: TIME_ORIGIN, pageWasHidden: false })),
        evaluateOnNewDocument: vi.fn(),
        removeScriptToEvaluateOnNewDocument: vi.fn(),
        // GAP-262/GAP-266/GAP-267: `audit()` conditionally opens a dedicated CDPSession (via
        // `page.createCDPSession()`) to capture the new document's real cross-document commit
        // time. Most fakes here don't care and never provide `createCDPSession`, which `audit()`
        // must tolerate (falls back to scoping by `documentStartedAt` alone) — RA4b/c/d/e below
        // are the cases that actually exercise it.
        ...overrides,
      };
    }

    function fakeTab(overrides: Partial<any> = {}) {
      return {
        id: 't',
        url: URL_,
        observingSince: new Date(TIME_ORIGIN - 60000).toISOString(),
        getConsoleLogs: () => [],
        getPageErrors: () => [],
        getNetworkLog: () => [],
        getPendingDialog: () => undefined,
        ...overrides,
      };
    }

    it('RA1: a blocked baselineUrl rejects with the allowlist message, not BrowserNotAvailableError (D14 ordering)', async () => {
      const runtime = new SutradharRuntime({ restrictNavigationToLocal: true });
      await expect(runtime.audit('nope', { baselineUrl: 'https://example.com' })).rejects.toThrow(
        /restrictNavigationToLocal is enabled/,
      );
    });

    it('RA2: an open dialog fails fast, before any screenshot/evaluate call', async () => {
      const page = fakePage();
      const tab = fakeTab({ getPendingDialog: () => ({ dialogType: 'alert', message: 'hi' }) });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);

      await expect(runtime.audit('s')).rejects.toThrow(/a alert dialog is open \("hi"\)/);
      expect(page.screenshot).not.toHaveBeenCalled();
      expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('RA3: current-page mode scopes console errors and broken requests to since observingSince/timeOrigin', async () => {
      const page = fakePage();
      const tab = fakeTab({
        observingSince: '2026-01-01T00:00:20.000Z',
        getConsoleLogs: () => [
          { logType: 'error', text: 'old', timestamp: '2026-01-01T00:00:05.000Z' },
          { logType: 'error', text: 'new', timestamp: '2026-01-01T00:00:11.000Z' },
        ],
        getNetworkLog: () => [
          { phase: 'response', url: 'http://x/404', status: 404, timestamp: '2026-01-01T00:00:05.000Z' },
          { phase: 'response', url: 'http://x/500', status: 500, timestamp: '2026-01-01T00:00:11.000Z' },
        ],
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);

      const result = await runtime.audit('s');

      expect(result.consoleErrors).toEqual([{ text: 'new', timestamp: '2026-01-01T00:00:11.000Z' }]);
      expect(result.brokenRequests).toEqual([{ url: 'http://x/500', status: 500 }]);
      expect(result.observation.mode).toBe('current-page');
      expect(result.observation.coversWholeDocument).toBe(false);
      expect(result.requestedUrl).toBeNull();
      expect(result.baseline).toBeNull();
    });

    it('RA3b (GAP-278 escalation-1 kill): current-page mode scopes by the tab\'s own tracked main-frame COMMIT time, not performance.timeOrigin, when the tab exposes getLastMainFrameCommitAt', async () => {
      // The exact GAP-278 shape: a previous page's own console error/broken-request, timestamped
      // by Node AFTER the new document's `performance.timeOrigin` (navigation START) but BEFORE
      // its real commit -- e.g. because the CDP message carrying it was delayed in flight. A
      // regression to `documentStartedAt`-only scoping in current-page mode would wrongly keep
      // this (it's >= timeOrigin), exactly like B1/GAP-262 did for navigated mode before fix-1.
      const page = fakePage(); // timeOrigin: TIME_ORIGIN = 2026-01-01T00:00:10.000Z
      const realCommitAt = '2026-01-01T00:00:12.000Z'; // after timeOrigin, the real commit instant
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getLastMainFrameCommitAt: () => realCommitAt,
        getConsoleLogs: () => [
          // Timestamped after timeOrigin but before the real commit -- must be EXCLUDED now.
          { logType: 'error', text: 'old-page-in-contamination-window', timestamp: '2026-01-01T00:00:11.000Z' },
          { logType: 'error', text: 'new-page-after-commit', timestamp: '2026-01-01T00:00:13.000Z' },
        ],
        getNetworkLog: () => [
          { phase: 'response', url: 'http://x/old-404', status: 404, timestamp: '2026-01-01T00:00:11.500Z' },
          { phase: 'response', url: 'http://x/new-500', status: 500, timestamp: '2026-01-01T00:00:13.500Z' },
        ],
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);

      const result = await runtime.audit('s');

      expect(result.consoleErrors.map((e) => e.text)).toEqual(['new-page-after-commit']);
      expect(result.brokenRequests).toEqual([{ url: 'http://x/new-500', status: 500 }]);
      expect(result.observation.mode).toBe('current-page');
      // Real commit is after observingSince, so this document's activity is fully covered.
      expect(result.observation.coversWholeDocument).toBe(true);
    });

    it('RA3c (GAP-278): current-page mode falls back to documentStartedAt when the tab has no getLastMainFrameCommitAt at all (mock-compatibility / older BrowserTab)', async () => {
      const page = fakePage();
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getConsoleLogs: () => [
          { logType: 'error', text: 'before-timeorigin', timestamp: '2026-01-01T00:00:09.000Z' },
          { logType: 'error', text: 'after-timeorigin', timestamp: '2026-01-01T00:00:11.000Z' },
        ],
      });
      delete (tab as any).getLastMainFrameCommitAt;
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);

      const result = await runtime.audit('s');

      expect(result.consoleErrors.map((e) => e.text)).toEqual(['after-timeorigin']);
    });

    it('RA3d (GAP-278): current-page mode falls back to documentStartedAt when getLastMainFrameCommitAt exists but returns null (tracking not wired up in time)', async () => {
      const page = fakePage();
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getLastMainFrameCommitAt: () => null,
        getConsoleLogs: () => [
          { logType: 'error', text: 'before-timeorigin', timestamp: '2026-01-01T00:00:09.000Z' },
          { logType: 'error', text: 'after-timeorigin', timestamp: '2026-01-01T00:00:11.000Z' },
        ],
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);

      const result = await runtime.audit('s');

      expect(result.consoleErrors.map((e) => e.text)).toEqual(['after-timeorigin']);
    });

    it('RA3e (GAP-278): current-page mode never reads getLastMainFrameCommitAt/getLastMainDocumentResponse in NAVIGATED mode -- those stay the tab-level source exclusively for current-page mode', async () => {
      const cdp = { send: vi.fn(async () => undefined), on: vi.fn(), detach: vi.fn(async () => undefined) };
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tabLevelCommitAt = vi.fn(() => '2099-01-01T00:00:00.000Z'); // absurd value -- must NOT be used
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getLastMainFrameCommitAt: tabLevelCommitAt,
        getConsoleLogs: () => [{ logType: 'error', text: 'e', timestamp: '2026-01-01T00:00:10.500Z' }],
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);

      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });

      // If navigated mode wrongly consulted the tab-level getter, `since` would jump to
      // 2099-01-01 and drop the console error above; navigated mode's own per-call
      // `navCommittedAt` (null here, no CDP events fired) means it falls back to
      // documentStartedAt (TIME_ORIGIN) instead, which keeps it.
      expect(result.consoleErrors.map((e) => e.text)).toEqual(['e']);
      expect(tabLevelCommitAt).not.toHaveBeenCalled();
    });

    it('RA4: navigated mode only keeps entries at/after the navigated document\'s own start, coversWholeDocument true', async () => {
      const page = fakePage();
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getConsoleLogs: () => [
          { logType: 'error', text: 'before-nav', timestamp: '2020-06-01T00:00:00.000Z' },
          { logType: 'error', text: 'after-nav', timestamp: '2027-01-01T00:00:00.000Z' },
        ],
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);
      // Simulate the navigated document's timeOrigin as being AFTER 'before-nav' but before
      // 'after-nav', so only 'after-nav' should survive scoping. (This fake page has no
      // `on`/`off`, so `navCommittedAt` stays null and scoping falls back to documentStartedAt
      // alone — see RA4b below for the case that actually exercises the commit-time listener.)
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-06-01T00:00:00.000Z'), pageWasHidden: false });

      const result = await runtime.audit('s', { url: URL_ });

      expect(result.consoleErrors.map((e) => e.text)).toEqual(['after-nav']);
      expect(result.observation.coversWholeDocument).toBe(true);
      expect(result.requestedUrl).toBe(URL_);
    });

    /** fix-2 (GAP-266/267): a fake CDPSession -- `send`/`on`/`detach` -- standing in for
     *  `page.createCDPSession()`. `fireMainFrameNavigated`/`fireWithinDocument` let a test raise
     *  the two CDP events fix-2's listener actually distinguishes: `Page.frameNavigated` (real,
     *  cross-document commit -- only counts with no `frame.parentId`) and
     *  `Page.navigatedWithinDocument` (same-document; deliberately never subscribed to, so firing
     *  it here is a no-op unless a regression adds a listener for it). */
    function fakeCdpSession() {
      const listeners = new Map<string, ((event: unknown) => void)[]>();
      const session = {
        send: vi.fn(async () => undefined),
        on: vi.fn((event: string, cb: (event: unknown) => void) => {
          const arr = listeners.get(event) ?? [];
          arr.push(cb);
          listeners.set(event, arr);
        }),
        detach: vi.fn(async () => undefined),
        fireMainFrameNavigated(): void {
          for (const cb of listeners.get('Page.frameNavigated') ?? []) cb({ frame: { id: 'main' } });
        },
        fireSubFrameNavigated(): void {
          for (const cb of listeners.get('Page.frameNavigated') ?? []) cb({ frame: { id: 'child', parentId: 'main' } });
        },
        fireWithinDocument(): void {
          for (const cb of listeners.get('Page.navigatedWithinDocument') ?? []) cb({ frameId: 'main', url: URL_ });
        },
        /** fix-3 (GAP-273): raises CDP's own `Network.responseReceived` event, the live signal
         *  the fix now keys the main document's own response off of — frameId + `type:'Document'`,
         *  never a post-hoc `page.url()` comparison. */
        fireDocumentResponse(frameId: string, respUrl: string, status: number): void {
          for (const cb of listeners.get('Network.responseReceived') ?? []) {
            cb({ frameId, type: 'Document', response: { url: respUrl, status } });
          }
        },
        fireNonDocumentResponse(frameId: string, respUrl: string, status: number): void {
          for (const cb of listeners.get('Network.responseReceived') ?? []) {
            cb({ frameId, type: 'Image', response: { url: respUrl, status } });
          }
        },
      };
      return session;
    }

    it("RA4b (GAP-262/GAP-264): scopes to the new page's main-frame COMMIT time, not the earlier navigate()-call time -- catches a regression to call-time scoping", async () => {
      vi.useFakeTimers();
      try {
        // "Now" at the instant navigate() is about to be called.
        vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
        const cdp = fakeCdpSession();
        const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
        const tab = fakeTab({
          observingSince: '2020-01-01T00:00:00.000Z',
          getConsoleLogs: () => [
            // Logged by the OLD page, in the exact GAP-262 contamination window: AFTER
            // navigate() is called but BEFORE the new document's frame actually commits. Must
            // be EXCLUDED now that scoping uses commit time instead of call time -- under the
            // old (reverted) call-time scoping this timestamp is >= call time and would wrongly
            // survive.
            { logType: 'error', text: 'old-page-during-transition', timestamp: '2026-03-01T00:00:00.250Z' },
            { logType: 'error', text: 'new-page-after-commit', timestamp: '2026-03-01T00:00:01.000Z' },
          ],
        });
        const runtime = new SutradharRuntime();
        vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
        vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
        vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
          // Simulate real Chrome: an unrelated sub-frame commits first (must be ignored), THEN
          // the main frame commits 500ms into navigate()'s own await -- well after the old
          // page's console error above, and well after call time.
          vi.setSystemTime(new Date('2026-03-01T00:00:00.300Z'));
          cdp.fireSubFrameNavigated();
          vi.setSystemTime(new Date('2026-03-01T00:00:00.500Z'));
          cdp.fireMainFrameNavigated();
          return { tabId: 't', url: URL_, title: 'T' } as any;
        });
        // documentStartedAt just after the real commit time, as it would be for real.
        page.evaluate.mockResolvedValue({
          issues: [],
          webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 },
          timeOrigin: Date.parse('2026-03-01T00:00:00.600Z'),
          pageWasHidden: false,
        });

        // settleMs:0 still schedules a 0ms setTimeout inside audit() -- with fake timers active
        // that never fires on its own, so drive it forward explicitly instead of awaiting the
        // promise directly (which would hang for the test's whole timeout and leave fake timers
        // stuck on for every test that runs after it).
        const resultPromise = runtime.audit('s', { url: URL_, settleMs: 0 });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.consoleErrors.map((e) => e.text)).toEqual(['new-page-after-commit']);
        expect(page.createCDPSession).toHaveBeenCalled();
        expect(cdp.send).toHaveBeenCalledWith('Page.enable');
        expect(cdp.on).toHaveBeenCalledWith('Page.frameNavigated', expect.any(Function));
        // GAP-269 M3 kill: a regression that drops the main-frame filter would let the sub-frame
        // event above win instead, moving `since` to 00:00:00.300Z -- still excludes nothing new
        // here, so this alone wouldn't catch M3; RA4d below (which has real activity IN that
        // window) is the actual M3 kill.
        expect(cdp.detach).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('RA4c (GAP-266): a same-document navigation (history.replaceState/pushState/hash change) during the page\'s own load does NOT move `since` -- kills a regression that listens to Page.navigatedWithinDocument or drops the main-frame filter', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
        const cdp = fakeCdpSession();
        const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
        const tab = fakeTab({
          observingSince: '2020-01-01T00:00:00.000Z',
          getConsoleLogs: () => [
            // Real error from BEFORE the same-document nav -- must survive (GAP-266's exact
            // failure mode: fix-1 dropped this).
            { logType: 'error', text: 'error-before-samedoc-nav', timestamp: '2026-04-01T00:00:00.550Z' },
            // Real error from AFTER the same-document nav -- must also survive.
            { logType: 'error', text: 'error-after-samedoc-nav', timestamp: '2026-04-01T00:00:00.700Z' },
          ],
        });
        const runtime = new SutradharRuntime();
        vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
        vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
        vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
          vi.setSystemTime(new Date('2026-04-01T00:00:00.500Z'));
          cdp.fireMainFrameNavigated(); // the real cross-document commit
          vi.setSystemTime(new Date('2026-04-01T00:00:00.650Z'));
          cdp.fireWithinDocument(); // e.g. a hydration framework's router calling history.replaceState
          return { tabId: 't', url: URL_, title: 'T' } as any;
        });
        page.evaluate.mockResolvedValue({
          issues: [],
          webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 },
          timeOrigin: Date.parse('2026-04-01T00:00:00.500Z'),
          pageWasHidden: false,
        });

        const resultPromise = runtime.audit('s', { url: URL_, settleMs: 0 });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.consoleErrors.map((e) => e.text).sort()).toEqual(
          ['error-after-samedoc-nav', 'error-before-samedoc-nav'].sort(),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('RA4d (GAP-269 M3 kill): ignores a sub-frame Page.frameNavigated event even when it is the LAST one -- kills a mutation that removes the main-frame (`!frame.parentId`) filter', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
        const cdp = fakeCdpSession();
        const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
        const tab = fakeTab({
          observingSince: '2020-01-01T00:00:00.000Z',
          getConsoleLogs: () => [
            // Real, on the actual page, logged between the main-frame commit and the LATER
            // sub-frame (e.g. an ad iframe) commit. A mutant with no main-frame filter would move
            // `since` to the sub-frame's later commit time and wrongly drop this.
            { logType: 'error', text: 'main-page-error', timestamp: '2026-05-01T00:00:00.550Z' },
          ],
        });
        const runtime = new SutradharRuntime();
        vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
        vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
        vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
          vi.setSystemTime(new Date('2026-05-01T00:00:00.500Z'));
          cdp.fireMainFrameNavigated();
          vi.setSystemTime(new Date('2026-05-01T00:00:00.900Z'));
          cdp.fireSubFrameNavigated(); // an iframe loading later -- must not move `since`
          return { tabId: 't', url: URL_, title: 'T' } as any;
        });
        page.evaluate.mockResolvedValue({
          issues: [],
          webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 },
          timeOrigin: Date.parse('2026-05-01T00:00:00.500Z'),
          pageWasHidden: false,
        });

        const resultPromise = runtime.audit('s', { url: URL_, settleMs: 0 });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.consoleErrors.map((e) => e.text)).toEqual(['main-page-error']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('RA4e (GAP-269 M4 kill): keeps the LAST main-frame commit, not the first -- kills a mutation that keeps the first framenavigated/commit event (breaks multi-hop JS redirect chains)', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
        const cdp = fakeCdpSession();
        const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
        const tab = fakeTab({
          observingSince: '2020-01-01T00:00:00.000Z',
          getConsoleLogs: () => [
            // Logged by the FIRST hop of a JS redirect chain -- must be excluded once the chain
            // resolves to its final page. A "keep the first" mutant would wrongly keep this.
            { logType: 'error', text: 'first-hop-error', timestamp: '2026-06-01T00:00:00.300Z' },
            // Logged by the FINAL page after the chain settles -- must survive.
            { logType: 'error', text: 'final-hop-error', timestamp: '2026-06-01T00:00:00.900Z' },
          ],
        });
        const runtime = new SutradharRuntime();
        vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
        vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
        vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
          // Two real cross-document commits, simulating a JS redirect chain (hop 1 -> hop 2).
          vi.setSystemTime(new Date('2026-06-01T00:00:00.200Z'));
          cdp.fireMainFrameNavigated();
          vi.setSystemTime(new Date('2026-06-01T00:00:00.800Z'));
          cdp.fireMainFrameNavigated();
          return { tabId: 't', url: URL_, title: 'T' } as any;
        });
        page.evaluate.mockResolvedValue({
          issues: [],
          webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 },
          timeOrigin: Date.parse('2026-06-01T00:00:00.800Z'),
          pageWasHidden: false,
        });

        const resultPromise = runtime.audit('s', { url: URL_, settleMs: 0 });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.consoleErrors.map((e) => e.text)).toEqual(['final-hop-error']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('RA5 (GAP-267): the audited page\'s own 404 response is always included in brokenRequests even when its timestamp falls just before `since`', async () => {
      const page = fakePage();
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getNetworkLog: () => [
          // The page's OWN document response, timestamped a moment before `since` (the fix-2
          // commit-time boundary) -- must be included anyway, per-request, not filtered by the
          // timing boundary at all.
          { phase: 'response', url: URL_, status: 404, resourceType: 'document', timestamp: '2026-01-01T00:00:09.900Z' },
        ],
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);

      const result = await runtime.audit('s'); // current-page mode; since = documentStartedAt = TIME_ORIGIN (…10.000Z)

      expect(result.brokenRequests).toEqual([{ url: URL_, status: 404 }]);
    });

    it('RA6 (GAP-267): a 302 chain ending in a 500 on the audited page itself is captured by matching the FINAL url, not an intermediate redirect hop', async () => {
      const page = fakePage();
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getNetworkLog: () => [
          { phase: 'response', url: 'http://127.0.0.1:1/before-redirect', status: 302, resourceType: 'document', timestamp: '2026-01-01T00:00:09.800Z' },
          { phase: 'response', url: URL_, status: 500, resourceType: 'document', timestamp: '2026-01-01T00:00:09.900Z' },
        ],
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);

      const result = await runtime.audit('s');

      expect(result.brokenRequests).toEqual([{ url: URL_, status: 500 }]);
    });

    it('RA10 (GAP-273): the main document\'s own error response is captured LIVE off the CDP session and survives a final page.url() that no longer equals the response url (history.replaceState/hash-change-after-load shape)', async () => {
      const cdp = fakeCdpSession();
      const page = fakePage({
        createCDPSession: vi.fn(async () => cdp),
        // Final page.url() has since moved on (replaceState/hash-change after the response
        // arrived, or Chrome's own chrome-error:// substitution) -- the OLD string-match
        // fallback would miss this entirely.
        url: () => `${URL_}#moved-on`,
      });
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        // Deliberately EMPTY -- the fallback (getNetworkLog url-match) would find nothing here,
        // so this only passes if the LIVE capture path (Network.responseReceived) is what's
        // actually feeding brokenRequests.
        getNetworkLog: () => [],
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
        cdp.fireMainFrameNavigated(); // sets mainFrameId = 'main'
        cdp.fireDocumentResponse('main', URL_, 404); // the real response, at the real URL
        return { tabId: 't', url: URL_, title: 'T' } as any;
      });
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(result.brokenRequests).toEqual([{ url: URL_, status: 404 }]);
    });

    it('RA11 (GAP-273 mutation kill): a sub-frame\'s own Document response (different frameId) is never attributed to the main document', async () => {
      const cdp = fakeCdpSession();
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tab = fakeTab({ observingSince: '2020-01-01T00:00:00.000Z', getNetworkLog: () => [] });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
        cdp.fireMainFrameNavigated(); // mainFrameId = 'main'
        cdp.fireDocumentResponse('an-iframe', 'http://127.0.0.1/iframe.html', 500); // a DIFFERENT frame's own error
        return { tabId: 't', url: URL_, title: 'T' } as any;
      });
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(result.brokenRequests).toEqual([]);
    });

    it('RA12 (GAP-273 mutation kill): a non-Document response type on the main frame is never attributed to the main document\'s own status', async () => {
      const cdp = fakeCdpSession();
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tab = fakeTab({ observingSince: '2020-01-01T00:00:00.000Z', getNetworkLog: () => [] });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
        cdp.fireMainFrameNavigated();
        cdp.fireNonDocumentResponse('main', `${URL_}/some.png`, 404); // a sub-resource 404, not the document itself
        return { tabId: 't', url: URL_, title: 'T' } as any;
      });
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(result.brokenRequests).toEqual([]);
    });

    it('RA13 (GAP-273 mutation kill, redirect chain): multiple live main-frame Document responses -- the LAST one wins, matching the "keep the last commit" policy', async () => {
      const cdp = fakeCdpSession();
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tab = fakeTab({ observingSince: '2020-01-01T00:00:00.000Z', getNetworkLog: () => [] });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
        cdp.fireMainFrameNavigated();
        cdp.fireDocumentResponse('main', 'http://127.0.0.1/before-redirect', 302);
        cdp.fireDocumentResponse('main', URL_, 500); // the final hop -- this is "this page"
        return { tabId: 't', url: URL_, title: 'T' } as any;
      });
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(result.brokenRequests).toEqual([{ url: URL_, status: 500 }]);
    });

    it('RA13b (GAP-279): when live CDP capture never fires (e.g. Network.enable took effect too late, such as a dialog open when audit({url}) starts), the response navigate()\'s own page.goto() returned is used instead of the URL-match ring-buffer fallback', async () => {
      const cdp = fakeCdpSession(); // fires no events at all -- simulates live capture never getting set up in time
      const page = fakePage({
        createCDPSession: vi.fn(async () => cdp),
        // Final page.url() has moved on, exactly the GAP-273 shape the URL-match fallback fails
        // on -- this test only passes if getLastGotoResponse (not the URL match) is what feeds
        // brokenRequests here.
        url: () => `${URL_}#moved-on`,
      });
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getNetworkLog: () => [], // deliberately empty -- the URL-match fallback finds nothing
        getLastGotoResponse: () => ({ url: URL_, status: 404 }),
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any); // no CDP events fired
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(result.brokenRequests).toEqual([{ url: URL_, status: 404 }]);
    });

    it('RA13c (GAP-279): the live CDP capture still wins over getLastGotoResponse when both are available', async () => {
      const cdp = fakeCdpSession();
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getNetworkLog: () => [],
        getLastGotoResponse: () => ({ url: URL_, status: 599 }), // must NOT be used
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockImplementation(async () => {
        cdp.fireMainFrameNavigated();
        cdp.fireDocumentResponse('main', URL_, 404); // the real live-captured response
        return { tabId: 't', url: URL_, title: 'T' } as any;
      });
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(result.brokenRequests).toEqual([{ url: URL_, status: 404 }]);
    });

    it('RA13d (GAP-279): getLastGotoResponse is never consulted in current-page mode', async () => {
      const page = fakePage();
      const tab = fakeTab({
        observingSince: '2020-01-01T00:00:00.000Z',
        getNetworkLog: () => [],
        getLastGotoResponse: () => ({ url: URL_, status: 599 }), // must NOT be used -- no navigate() happened
      });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);

      const result = await runtime.audit('s');

      expect(result.brokenRequests).toEqual([]);
    });

    it('RA14 (GAP-274): a Page.enable that never resolves does not block audit() past the bounded setup window, and the session is still detached', async () => {
      const cdp = fakeCdpSession();
      let neverResolves: Promise<unknown> | null = null;
      cdp.send = vi.fn((method: string) => {
        if (method === 'Page.enable') {
          neverResolves = new Promise(() => {}); // simulates the GAP-274 hang
          return neverResolves;
        }
        return Promise.resolve(undefined);
      }) as any;
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tab = fakeTab({ observingSince: '2020-01-01T00:00:00.000Z', getNetworkLog: () => [] });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      const start = Date.now();
      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });
      const elapsedMs = Date.now() - start;

      // Bounded well under the old ~31s/180s+ hangs -- generous margin for CI slowness, but a
      // regression to an unbounded `await client.send('Page.enable')` would fail this outright
      // (the test's own timeout would trip long before this assertion could even run).
      expect(elapsedMs).toBeLessThan(5000);
      expect(result.url).toBe(URL_);
      expect(cdp.detach).toHaveBeenCalled();
    });

    it('RA15 (GAP-274 leak kill): the CDP session is detached even when Page.enable eventually REJECTS (not just hangs) -- kills a mutation that clears the session reference in the failure catch before detach runs', async () => {
      const cdp = fakeCdpSession();
      cdp.send = vi.fn((method: string) => (method === 'Page.enable' ? Promise.reject(new Error('protocol timeout')) : Promise.resolve(undefined))) as any;
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tab = fakeTab({ observingSince: '2020-01-01T00:00:00.000Z', getNetworkLog: () => [] });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(cdp.detach).toHaveBeenCalled();
    });

    it('RA16 (GAP-280 M7 kill): the CDP session is still detached when client.on() itself throws synchronously right after the session was created -- kills a mutation that clears cdpClient inside that catch before the finally block runs', async () => {
      // audit-4's own finding: RA15 rejects INSIDE boundedFireAndForget's swallowed inner catch,
      // which never reaches the outer `try { const client = await createCDPSession(); ... }
      // catch { ... }` block at all -- so a mutation that nulls `cdpClient` inside THAT outer
      // catch survives RA15 untouched. This forces that exact catch to run AFTER `cdpClient` has
      // already been assigned, by making `client.on()` throw synchronously (a plausible failure
      // mode -- a Puppeteer/CDP transport in a bad state).
      const cdp = fakeCdpSession();
      const originalOn = cdp.on;
      cdp.on = vi.fn((event: string, cb: (event: unknown) => void) => {
        if (event === 'Page.frameNavigated') {
          throw new Error('boom - client.on threw synchronously');
        }
        return originalOn(event, cb);
      }) as any;
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tab = fakeTab({ observingSince: '2020-01-01T00:00:00.000Z', getNetworkLog: () => [] });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      const result = await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(result.url).toBe(URL_);
      expect(cdp.detach).toHaveBeenCalled();
    });

    it('RA17 (GAP-280 M10 kill): Network.enable is sent during the per-call commit-tracking setup, not just Page.enable -- kills a mutation that removes it entirely (audit-4: live GAP-273 shapes go to 0/2 under this mutation)', async () => {
      const cdp = fakeCdpSession();
      const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
      const tab = fakeTab({ observingSince: '2020-01-01T00:00:00.000Z', getNetworkLog: () => [] });
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);
      page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

      await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(cdp.send).toHaveBeenCalledWith('Page.enable');
      expect(cdp.send).toHaveBeenCalledWith('Network.enable');
    });

    it('RA18 (GAP-280 M9 kill): client.send() throwing synchronously (bypassing every inline `.catch()` inside the setup IIFE, since the throw happens before `.catch` is even reached) never becomes an unhandled promise rejection', async () => {
      // audit-4's own live repro for M9 (probe-leak-paths.mjs's "send throws synchronously"
      // case) is what actually distinguishes this mutation: a LATE rejection of the
      // `client.send('Page.enable')` promise itself is already caught by that call's own inline
      // `.catch(() => {})` regardless of M9 -- that's a different, already-handled layer. M9's
      // mutation only matters for the IIFE's own aggregate `work` promise, which only ever
      // rejects when something throws BEFORE any `.catch()`/try-catch inside it can attach --
      // e.g. `client.send` itself throwing synchronously rather than returning a promise.
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const cdp = fakeCdpSession();
        cdp.send = vi.fn(() => {
          throw new Error('sync send throw');
        }) as any;
        const page = fakePage({ createCDPSession: vi.fn(async () => cdp) });
        const tab = fakeTab({ observingSince: '2020-01-01T00:00:00.000Z', getNetworkLog: () => [] });
        const runtime = new SutradharRuntime();
        vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
        vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
        vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);
        page.evaluate.mockResolvedValue({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.parse('2026-01-01T00:00:10.000Z'), pageWasHidden: false });

        const result = await runtime.audit('s', { url: URL_, settleMs: 0 });
        expect(result.url).toBe(URL_);

        // Give Node's unhandledRejection detection a chance to run (it's queued, not synchronous).
        await new Promise((r) => setTimeout(r, 50));

        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    }, 10000);

    it('RA5: a successful baseline is folded in with compareUrls called with (sessionId, baselineUrl, url, {tabId})', async () => {
      const page = fakePage();
      const tab = fakeTab();
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      const compareSpy = vi
        .spyOn(runtime, 'compareUrls')
        .mockResolvedValue({ width: 4, height: 3, diffPixelCount: 1, totalPixels: 12, diffPercentage: 8.33, diffImageBase64: 'x' });

      const result = await runtime.audit('s', { baselineUrl: 'http://127.0.0.1/b' });

      expect(compareSpy).toHaveBeenCalledWith('s', 'http://127.0.0.1/b', URL_, { tabId: undefined });
      expect(result.baseline).toMatchObject({ url: 'http://127.0.0.1/b', diffPercentage: 8.33 });
    });

    it('RA6: a rejected baseline resolves the audit with baseline.error instead of throwing', async () => {
      const page = fakePage();
      const tab = fakeTab();
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'compareUrls').mockRejectedValue(new Error('boom'));

      const result = await runtime.audit('s', { baselineUrl: 'http://127.0.0.1/b' });

      expect(result.baseline).toEqual({ url: 'http://127.0.0.1/b', error: 'boom' });
    });

    it('RA8: the dwell floor (settleMs) is honored in URL mode', async () => {
      const page = fakePage();
      const tab = fakeTab();
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);

      const start = Date.now();
      await runtime.audit('s', { url: URL_, settleMs: 60 });
      expect(Date.now() - start).toBeGreaterThanOrEqual(55);
    });

    it('RA9: no evaluateOnNewDocument/removeScriptToEvaluateOnNewDocument calls (Branch B — no injection)', async () => {
      const page = fakePage();
      const tab = fakeTab();
      const runtime = new SutradharRuntime();
      vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
      vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
      vi.spyOn(runtime, 'navigate').mockResolvedValue({ tabId: 't', url: URL_, title: 'T' } as any);

      await runtime.audit('s', { url: URL_, settleMs: 0 });

      expect(page.evaluateOnNewDocument).not.toHaveBeenCalled();
      expect(page.removeScriptToEvaluateOnNewDocument).not.toHaveBeenCalled();
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

describe('@sutradhar/capability-runtime SutradharRuntime FR2-06 selector dialect', () => {
  it('R2: a Playwright selector rejects with InvalidSelectorError and touches neither resolveTab nor the action engine', async () => {
    const runtime = new SutradharRuntime();
    const resolveTabSpy = vi.spyOn(runtime as any, 'resolveTab');
    const executeActionSpy = vi.spyOn((runtime as any).actionEngine, 'executeAction');

    const calls: Array<() => Promise<unknown>> = [
      () => runtime.click('s1', 'text=Submit'),
      () => runtime.clickWithButton('s1', 'text=Submit', 'right'),
      () => runtime.focus('s1', 'text=Submit'),
      () => runtime.type('s1', 'text=Submit', 'hi'),
      () => runtime.scroll('s1', 'down', 100, undefined, 'text=Submit'),
      () => runtime.hover('s1', 'text=Submit'),
      () => runtime.selectOption('s1', 'text=Submit', 'v'),
      () => runtime.selectOptions('s1', 'text=Submit', ['v']),
      () => runtime.waitForSelector('s1', 'text=Submit'),
      () => runtime.uploadFile('s1', 'text=Submit', '/tmp/x.txt'),
      () => runtime.dragAndDrop('s1', 'text=Submit', '#ok'),
      () => runtime.dragAndDrop('s1', '#ok', 'text=Submit'),
      () => runtime.touchTap('s1', 'text=Submit'),
      () => runtime.downloadFile('s1', 'text=Submit'),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow(InvalidSelectorError);
    }
    expect(resolveTabSpy).not.toHaveBeenCalled();
    expect(executeActionSpy).not.toHaveBeenCalled();
  });

  it('R3: fillForm reports the Playwright field as success:false with a hint, and still types the other field', async () => {
    const runtime = new SutradharRuntime();
    const runActionSpy = vi.spyOn(runtime as any, 'runAction').mockResolvedValue({
      success: true,
      actionType: 'type',
      executionTimeMs: 1,
    });

    const results = await runtime.fillForm('s1', { 'text=Name': 'x', '#ok': 'y' });

    expect(results['text=Name']!.success).toBe(false);
    expect(results['text=Name']!.error).toContain('Playwright-style');
    expect(results['#ok']!.success).toBe(true);
    expect(runActionSpy).toHaveBeenCalledTimes(1);
  });

  it('R4: free-text inputs to click_by_text/click_by_role/type_by_label are never treated as selectors', async () => {
    const runtime = new SutradharRuntime();
    const runActionSpy = vi.spyOn(runtime as any, 'runAction').mockResolvedValue({ success: true, actionType: 'click_by_text', executionTimeMs: 1 });

    for (const text of ['text=Submit', 'Next >> step', 'a=b', 'getByRole(x)']) {
      await runtime.clickByText('s1', text);
      expect(runActionSpy).toHaveBeenLastCalledWith('s1', { actionType: 'click_by_text', text }, undefined);
    }
    for (const name of ['Go >> now', 'role=x']) {
      await runtime.clickByRole('s1', 'button', name);
      expect(runActionSpy).toHaveBeenLastCalledWith('s1', { actionType: 'click_by_role', role: 'button', name }, undefined);
    }
    await runtime.typeByLabel('s1', 'Notes >> extra', 'v');
    expect(runActionSpy).toHaveBeenLastCalledWith('s1', { actionType: 'type_by_label', label: 'Notes >> extra', value: 'v' }, undefined);
  });

  it('R5: uploadFileViaTrigger rejects Playwright syntax before any fs check or page interaction', async () => {
    const runtime = new SutradharRuntime();
    const resolveTabSpy = vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({
      session: {} as any,
      tab: { page: { click: vi.fn(), waitForFileChooser: vi.fn() } } as any,
    });

    await expect(runtime.uploadFileViaTrigger('s1', 'text=Browse', '/definitely/does/not/exist.txt')).rejects.toThrow(
      InvalidSelectorError,
    );
    const rejection = await runtime
      .uploadFileViaTrigger('s1', 'text=Browse', '/definitely/does/not/exist.txt')
      .catch((e: Error) => e);
    expect((rejection as Error).message).not.toContain('does not exist');
    expect(resolveTabSpy).toHaveBeenCalled();
  });

  it('R6: uploadFileViaTrigger wraps a browser parser error, and passes any other error through as the same object', async () => {
    const parserErr = new Error(
      "SyntaxError: Failed to execute 'querySelector' on 'Document': 'div[' is not a valid selector.",
    );
    const page1 = { click: vi.fn().mockRejectedValue(parserErr), waitForFileChooser: vi.fn().mockResolvedValue({}) };
    const runtime1 = new SutradharRuntime();
    vi.spyOn(runtime1 as any, 'resolveTab').mockReturnValue({ session: {} as any, tab: { page: page1 } as any });
    vi.spyOn(runtime1 as any, 'assertUploadPathAllowed').mockResolvedValue(undefined);

    const rejection = await runtime1.uploadFileViaTrigger('s1', 'div[', '/tmp/x.txt').catch((e: Error) => e);
    expect(rejection.name).toBe('Error');
    expect(rejection.message).toMatch(/^Invalid selector "div\[" — Failed to execute/);
    expect(rejection.message).not.toMatch(/^SyntaxError/);
    expect(rejection.message).toContain('Playwright-style');

    const otherErr = new Error('No element found for selector: #x');
    const page2 = { click: vi.fn().mockRejectedValue(otherErr), waitForFileChooser: vi.fn().mockResolvedValue({}) };
    const runtime2 = new SutradharRuntime();
    vi.spyOn(runtime2 as any, 'resolveTab').mockReturnValue({ session: {} as any, tab: { page: page2 } as any });
    vi.spyOn(runtime2 as any, 'assertUploadPathAllowed').mockResolvedValue(undefined);
    await expect(runtime2.uploadFileViaTrigger('s1', '#x', '/tmp/x.txt')).rejects.toBe(otherErr);
  });

  it('R7: a Playwright-style SECOND hop is caught by the up-front validation pass, before the FIRST hop\'s own $ call ever runs (spec §2.4: "a bad second hop costs no first-hop round trip")', async () => {
    const innerDollarMock = vi.fn();
    const innerFrame = { $: innerDollarMock };
    const firstHopHandle = { contentFrame: vi.fn().mockResolvedValue(innerFrame) };
    const outerDollarMock = vi.fn().mockResolvedValue(firstHopHandle);
    const fakePage = { $: outerDollarMock };
    const runtime = new SutradharRuntime();

    // @ts-expect-error — private method, same pattern as the existing resolveFrame tests.
    await expect(runtime.resolveFrame(fakePage, 'iframe.a::role=frame')).rejects.toMatchObject({
      message: expect.stringMatching(
        /^Invalid frameSelector "role=frame" \(from the full chain "iframe\.a::role=frame"\) — "role="/,
      ),
    });
    // GAP-206 (audit-1): every hop's dialect syntax is validated UP FRONT, before any hop's
    // own $() call — so the bad SECOND hop is caught without ever resolving the (valid) first
    // hop. This was previously asserted the other way (outerDollarMock called once), which
    // encoded the bug (checking each hop inside the loop, one at a time) as expected behavior
    // rather than catching it.
    expect(outerDollarMock).not.toHaveBeenCalled();
    expect(innerDollarMock).not.toHaveBeenCalled();
  });

  it('R7b: a Playwright-style FIRST hop rejects before any page.$ call at all', async () => {
    const dollarMock = vi.fn();
    const fakePage = { $: dollarMock };
    const runtime = new SutradharRuntime();

    // @ts-expect-error — private method.
    await expect(runtime.resolveFrame(fakePage, 'role=frame')).rejects.toMatchObject({
      message: expect.stringMatching(/^Invalid frameSelector "role=frame" \(from the full chain "role=frame"\) — "role="/),
    });
    expect(dollarMock).not.toHaveBeenCalled();
  });

  it('R8: extractData names every Playwright-style field, with the hint exactly once, and never touches evaluate', async () => {
    const runtime = new SutradharRuntime();
    const evaluateMock = vi.fn();
    vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({
      session: {} as any,
      tab: { page: { evaluate: evaluateMock } } as any,
    });

    const rejection = await runtime
      .extractData('s1', { ok: { selector: 'h1' }, bad: { selector: 'text=Buy' }, bad2: { selector: 'button >> text=OK' } })
      .catch((e: Error) => e);

    expect(rejection.message).toMatch(/^Invalid selector for field "bad": "text=Buy" — "text="/);
    expect(rejection.message).toContain('bad2');
    const hintOccurrences = rejection.message.split('Playwright-style selectors').length - 1;
    expect(hintOccurrences).toBe(1);
    expect(evaluateMock).not.toHaveBeenCalled();
  });
});

describe('@sutradhar/capability-runtime dialog policy plumbing (FR2-04)', () => {
  function noBrowserRuntime(options: ConstructorParameters<typeof SutradharRuntime>[0] = {}) {
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'findExecutablePath').mockReturnValue(undefined);
    return new SutradharRuntime({ launcher, rateLimiter: null, ...options });
  }

  it('R1: launch() forwards a runtime-default dialogPolicy to createSession', async () => {
    const runtime = noBrowserRuntime({ dialogPolicy: { mode: 'accept' } });
    const spy = vi.spyOn((runtime as any).sessionManager, 'createSession');
    await runtime.launch();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ dialogPolicy: { mode: 'accept' } }));
  });

  it('R2: a per-call dialogPolicy on attach() overrides the runtime default', async () => {
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'findExecutablePath').mockReturnValue(undefined);
    vi.spyOn(launcher, 'connect').mockResolvedValue(new PuppeteerBrowserInstance());
    const runtime = new SutradharRuntime({ launcher, rateLimiter: null, dialogPolicy: { mode: 'accept' } });
    const spy = vi.spyOn((runtime as any).sessionManager, 'createSession');
    await runtime.attach({ endpoint: 'ws://x', dialogPolicy: { mode: 'dismiss' } });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ dialogPolicy: { mode: 'dismiss' } }));
  });

  it('R3: no dialogPolicy option anywhere -> createSession gets dialogPolicy undefined (tabs stay "auto") — the MCP/SDK guard', async () => {
    const runtime = noBrowserRuntime();
    const spy = vi.spyOn((runtime as any).sessionManager, 'createSession');
    await runtime.launch();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ dialogPolicy: undefined }));
  });

  it('R4: setDialogPolicy calls session.setDialogPolicy once; an unknown sessionId throws', async () => {
    const runtime = noBrowserRuntime();
    const { sessionId } = await runtime.launch();
    const session = runtime.getSessionManager().getSession(createSessionId(sessionId))!;
    const spy = vi.spyOn(session, 'setDialogPolicy');
    runtime.setDialogPolicy(sessionId, { mode: 'dismiss' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ mode: 'dismiss' });
    expect(() => runtime.setDialogPolicy('nope', { mode: 'dismiss' })).toThrow(/No browser session/);
  });

  it('R5: getPendingDialogs reports only tabs with a pending dialog, with the correct "active" shape', async () => {
    const runtime = noBrowserRuntime();
    const { sessionId } = await runtime.launch();
    const session = runtime.getSessionManager().getSession(createSessionId(sessionId))!;
    const tab2 = await session.createTab('https://example.com/2');
    vi.spyOn(tab2, 'getPendingDialogDetail' as any).mockReturnValue({
      dialogType: 'confirm',
      message: 'm',
      defaultValue: undefined,
      url: 'https://example.com/2',
      openedAt: '2026-01-01T00:00:00.000Z',
    });

    const pending = runtime.getPendingDialogs(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual({
      tabId: tab2.id,
      url: 'https://example.com/2',
      dialogType: 'confirm',
      message: 'm',
      defaultValue: undefined,
      openedAt: '2026-01-01T00:00:00.000Z',
      active: true,
    });
  });

  it('R6: getDialogHistory merges every tab in handledAt order, tagging each entry with its tabId', async () => {
    const runtime = noBrowserRuntime();
    const { sessionId, activeTabId } = await runtime.launch();
    const session = runtime.getSessionManager().getSession(createSessionId(sessionId))!;
    const tab1 = session.getTab(activeTabId! as any)!;
    const tab2 = await session.createTab('https://example.com/2');
    vi.spyOn(tab1, 'getDialogHistory' as any).mockReturnValue([
      { dialogType: 'confirm', message: 'a', url: 'u1', openedAt: 'o1', handledAt: '2026-01-01T00:00:02.000Z' },
    ]);
    vi.spyOn(tab2, 'getDialogHistory' as any).mockReturnValue([
      { dialogType: 'alert', message: 'b', url: 'u2', openedAt: 'o2', handledAt: '2026-01-01T00:00:01.000Z' },
    ]);

    const history = runtime.getDialogHistory(sessionId);
    expect(history).toEqual([
      { dialogType: 'alert', message: 'b', url: 'u2', openedAt: 'o2', handledAt: '2026-01-01T00:00:01.000Z', tabId: tab2.id },
      { dialogType: 'confirm', message: 'a', url: 'u1', openedAt: 'o1', handledAt: '2026-01-01T00:00:02.000Z', tabId: tab1.id },
    ]);

    const narrowed = runtime.getDialogHistory(sessionId, tab2.id);
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0]?.tabId).toBe(tab2.id);
  });
});

describe('@sutradhar/capability-runtime SutradharRuntime.assertUploadPathAllowed (FR2-05)', () => {
  function noBrowserRuntime(options: ConstructorParameters<typeof SutradharRuntime>[0] = {}) {
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'findExecutablePath').mockReturnValue(undefined);
    return new SutradharRuntime({ launcher, rateLimiter: null, ...options });
  }

  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'sutradhar-runtime-upload-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('RT1: rejects a path reached through a link escaping the allowed upload roots', async () => {
    const fs = await import('node:fs/promises');
    const root = path.join(tmp, 'root');
    const outside = path.join(tmp, 'outside');
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(root, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');
    await fs.writeFile(path.join(outside, 'secret.txt'), 'shh');

    const runtime = noBrowserRuntime({ allowedUploadRoots: [root] });
    await expect((runtime as any).assertUploadPathAllowed(path.join(root, 'jn', 'secret.txt'))).rejects.toThrow(
      /outside the allowed upload directories/,
    );
  });

  it('RT2: resolves for a path genuinely inside an allowed root', async () => {
    const fs = await import('node:fs/promises');
    const root = path.join(tmp, 'root2');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'ok.txt'), 'ok');

    const runtime = noBrowserRuntime({ allowedUploadRoots: [root] });
    await expect((runtime as any).assertUploadPathAllowed(path.join(root, 'ok.txt'))).resolves.toBeUndefined();
  });

  it('RT3 (win32 only): a root passed in a different case still accepts a file under it — B5 regression', async () => {
    if (process.platform !== 'win32') return;
    const fs = await import('node:fs/promises');
    const root = path.join(tmp, 'root3');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'ok.txt'), 'ok');

    const runtime = noBrowserRuntime({ allowedUploadRoots: [root.toUpperCase()] });
    await expect((runtime as any).assertUploadPathAllowed(path.join(root, 'ok.txt'))).resolves.toBeUndefined();
  });
});
