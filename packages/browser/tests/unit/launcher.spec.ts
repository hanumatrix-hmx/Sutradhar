/**
 * @file packages/browser/tests/unit/launcher.spec.ts
 * @description Unit tests for BrowserLauncher, launch args preparation, and browser lifecycle.
 */

import * as browserExports from '../../src/index.js';
import { BrowserLauncher, PuppeteerBrowserInstance, BROWSER_VERSION, DEFAULT_LAUNCH_ARGS } from '../../src/index.js';

// `import * as fs from 'node:fs'` gives an ES module namespace object, which is spec-frozen —
// vi.spyOn can never redefine a property on it (`vi.mock` intercepts at module resolution
// instead of mutating a live object, so it's the only thing that actually works here). Delegates
// to the REAL fs.existsSync by default so the other, unrelated tests in this file that launch a
// real Puppeteer browser aren't affected — only tests that explicitly reconfigure the mock see
// different behavior.
const { existsSyncMock, realExistsSyncRef } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  realExistsSyncRef: { current: undefined as unknown as (path: string) => boolean },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  realExistsSyncRef.current = actual.existsSync;
  existsSyncMock.mockImplementation(actual.existsSync);
  return { ...actual, default: { ...actual.default, existsSync: existsSyncMock }, existsSync: existsSyncMock };
});

describe('@sutradhar/browser BrowserLauncher', () => {
  it('should export correct package version constant', () => {
    expect(BROWSER_VERSION).toBe('0.1.0');
  });

  it('should unconditionally include --disable-blink-features=AutomationControlled in launch arguments (FR2-16: proves no behavior change after removing the dead enableStealth conditional, which was a provable no-op)', () => {
    const launcher = new BrowserLauncher();
    const args = launcher.prepareLaunchArgs();

    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-blink-features=AutomationControlled');
  });

  it('enableStealth (if a caller still passes it despite the type removal) has zero effect on prepareLaunchArgs output, in either direction (GAP-104 fix: this must be distinct from the previous test, not a duplicate of it — it compares BOTH enableStealth:true and enableStealth:false against the no-option baseline and asserts all three produce an identical arg set, which the previous "default flags present" test never checked)', () => {
    const launcher = new BrowserLauncher();
    const baseline = launcher.prepareLaunchArgs();
    const withTrue = launcher.prepareLaunchArgs({ enableStealth: true } as never);
    const withFalse = launcher.prepareLaunchArgs({ enableStealth: false } as never);

    expect([...withTrue].sort()).toEqual([...baseline].sort());
    expect([...withFalse].sort()).toEqual([...baseline].sort());
  });

  // GAP-104 fix: the previous version of this regression guard named IStealthEngine and
  // StealthOptions in its description as if they were being checked here, but both are
  // TypeScript interfaces with no runtime representation at all (even before removal, they
  // never appeared as a property on the compiled module's exports) — asserting
  // `browserExports.IStealthEngine === undefined` would be vacuously true regardless of whether
  // the removal happened, so it is not asserted here. GAP-121: `tsc` succeeding across every
  // consumer package (see fix-2 evidence) does NOT, by itself, prove these type-only interfaces
  // were removed — `tsc` would still pass if `IStealthEngine` alone were re-added without
  // re-exporting it from the package barrel. What this test DOES check directly, at runtime, is
  // that the barrel no longer re-exports the concrete `StealthEngine` class and its helper
  // functions below; re-adding `IStealthEngine`/`StealthOptions` without restoring those would
  // slip past both this test and `tsc`, which is a real (currently accepted) coverage gap, not
  // something either check actually closes. This test asserts only the REAL runtime exports that
  // used to exist. `getEvasionScripts` is also deliberately omitted below (unlike
  // fix-1's version): it was always an instance method on the (now-deleted) StealthEngine class,
  // never a top-level package export, so checking it here would be vacuous — it was never going
  // to be `!== undefined` even before this item started.
  it('regression guard (FR2-16): StealthEngine/DEFAULT_STEALTH_OPTIONS/getWebdriverOverrideScript/getChromeRuntimeScript/getWebglMaskScript/getHardwareConcurrencyScript must stay removed from the package\'s real runtime exports', () => {
    expect((browserExports as Record<string, unknown>).StealthEngine).toBeUndefined();
    expect((browserExports as Record<string, unknown>).DEFAULT_STEALTH_OPTIONS).toBeUndefined();
    expect((browserExports as Record<string, unknown>).getWebdriverOverrideScript).toBeUndefined();
    expect((browserExports as Record<string, unknown>).getChromeRuntimeScript).toBeUndefined();
    expect((browserExports as Record<string, unknown>).getWebglMaskScript).toBeUndefined();
    expect((browserExports as Record<string, unknown>).getHardwareConcurrencyScript).toBeUndefined();
  });

  it('should merge user-provided custom arguments without duplicates', () => {
    const launcher = new BrowserLauncher();
    const args = launcher.prepareLaunchArgs({
      args: ['--proxy-server=http://proxy.local', '--no-sandbox'],
    });

    expect(args).toContain('--proxy-server=http://proxy.local');
    expect(args.filter((a) => a === '--no-sandbox').length).toBe(1);
  });

  it('should launch and close browser instance', async () => {
    const launcher = new BrowserLauncher();
    const instance = await launcher.launch({ headless: true });

    expect(instance.isConnected).toBe(true);
    await instance.close();
    expect(instance.isConnected).toBe(false);
  });

  it('should create an isolated browser context when isIncognito is set, and route newPage() through it', async () => {
    const launcher = new BrowserLauncher();
    const instance = await launcher.launch({ headless: true, isIncognito: true });
    try {
      // A real incognito context was created in addition to the default one.
      expect(instance.puppeteerBrowser?.browserContexts().length).toBeGreaterThan(1);

      const page = await instance.newPage();
      expect(page).toBeDefined();
      // The page belongs to the isolated context, not the browser's default context.
      expect(page?.browserContext()).not.toBe(instance.puppeteerBrowser?.defaultBrowserContext());
      await page?.close();
    } finally {
      await instance.close();
    }
  });

  it('should apply a custom viewport to pages created after launch', async () => {
    const launcher = new BrowserLauncher();
    const instance = await launcher.launch({ headless: true, viewport: { width: 1024, height: 768 } });
    try {
      const page = await instance.newPage();
      expect(page?.viewport()).toEqual({ width: 1024, height: 768 });
      await page?.close();
    } finally {
      await instance.close();
    }
  });

  it('should add a --proxy-server arg when proxy.server is set', () => {
    const launcher = new BrowserLauncher();
    const args = launcher.prepareLaunchArgs({ proxy: { server: 'http://my-proxy.local:8080' } });

    expect(args).toContain('--proxy-server=http://my-proxy.local:8080');
  });

  it('should add a --user-agent arg only when userAgent is explicitly given (field-report remediation 4c)', () => {
    const launcher = new BrowserLauncher();
    const withUa = launcher.prepareLaunchArgs({ userAgent: 'MyBot/1.0' });
    expect(withUa).toContain('--user-agent=MyBot/1.0');
  });

  it('should NOT add a --user-agent arg by default, so Chrome\'s own real UA (including "Headless" when headless) is left alone — this must stay true; see CLAUDE.md\'s scope boundary on stealth/detection-evasion defaults', () => {
    const launcher = new BrowserLauncher();
    const defaultArgs = launcher.prepareLaunchArgs();
    expect(defaultArgs.some((a) => a.startsWith('--user-agent='))).toBe(false);
  });

  it('should call page.authenticate() on every new page when proxy credentials are set', async () => {
    const authenticate = vi.fn().mockResolvedValue(undefined);
    const fakeBrowser = { newPage: vi.fn().mockResolvedValue({ authenticate }) } as any;
    const instance = new PuppeteerBrowserInstance(fakeBrowser, undefined, {
      username: 'proxyuser',
      password: 'proxypass',
    });

    await instance.newPage();

    expect(authenticate).toHaveBeenCalledWith({ username: 'proxyuser', password: 'proxypass' });
  });

  it('should not call page.authenticate() when no proxy credentials are set', async () => {
    const authenticate = vi.fn().mockResolvedValue(undefined);
    const fakeBrowser = { newPage: vi.fn().mockResolvedValue({ authenticate }) } as any;
    const instance = new PuppeteerBrowserInstance(fakeBrowser);

    await instance.newPage();

    expect(authenticate).not.toHaveBeenCalled();
  });

  describe('findExecutablePath', () => {
    afterEach(() => {
      // Reset to delegating to the real fs.existsSync so later tests (and other describe
      // blocks, if execution order ever changes) aren't left with a stale fake implementation.
      existsSyncMock.mockImplementation(realExistsSyncRef.current);
    });

    it('finds Raspberry Pi OS (Bullseye+) Chromium at /usr/bin/chromium', () => {
      existsSyncMock.mockImplementation((p: string) => p === '/usr/bin/chromium');
      const launcher = new BrowserLauncher();

      expect(launcher.findExecutablePath()).toBe('/usr/bin/chromium');
    });

    it('finds snap-installed Chromium (common on ARM/Ubuntu) at /snap/bin/chromium', () => {
      existsSyncMock.mockImplementation((p: string) => p === '/snap/bin/chromium');
      const launcher = new BrowserLauncher();

      expect(launcher.findExecutablePath()).toBe('/snap/bin/chromium');
    });

    it('prefers /usr/bin/chromium over the older /usr/bin/chromium-browser name when both exist', () => {
      existsSyncMock.mockImplementation((p: string) => p === '/usr/bin/chromium' || p === '/usr/bin/chromium-browser');
      const launcher = new BrowserLauncher();

      expect(launcher.findExecutablePath()).toBe('/usr/bin/chromium');
    });

    it('returns undefined when nothing on the candidate list exists', () => {
      existsSyncMock.mockReturnValue(false);
      const launcher = new BrowserLauncher();

      expect(launcher.findExecutablePath()).toBeUndefined();
    });

    it('a caller-supplied customPath still wins over every candidate when it exists', () => {
      existsSyncMock.mockImplementation((p: string) => p === '/opt/my-chrome/chrome');
      const launcher = new BrowserLauncher();

      expect(launcher.findExecutablePath('/opt/my-chrome/chrome')).toBe('/opt/my-chrome/chrome');
    });
  });
});
