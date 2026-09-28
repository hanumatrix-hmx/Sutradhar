/**
 * @file packages/sutradhar/src/index.ts
 * @description Sutradhar — embeddable AI browser automation SDK.
 *
 * Drive a real Chrome/Edge with a Puppeteer-style API, with semantic DOM snapshots built
 * for AI agents. The single entry point is {@link launch}; everything else flows from the
 * returned {@link Browser}.
 *
 * @example
 * import { launch } from 'sutradhar';
 *
 * const browser = await launch();                  // launches headless Chrome
 * const page = await browser.newPage();
 * await page.goto('https://example.com');
 *
 * const snap = await page.snapshot();              // LLM-optimized interactive-element listing
 * await page.click('7');                           // [#7] from the snapshot
 * await page.type('#search', 'hello world');
 * const png = await page.screenshot();
 *
 * await browser.close();
 */

import { SutradharRuntime, resolveFsRoots } from '@sutradhar/capability-runtime';
import { Browser, type LaunchOptions } from './browser.js';

export const SUTRADHAR_VERSION = '0.5.0';

/**
 * Launch a browser and return a {@link Browser} handle. Resolves once the browser process
 * is up and the first tab is ready.
 *
 * @example
 * const browser = await launch({ url: 'https://example.com' });
 */
export async function launch(options: LaunchOptions = {}): Promise<Browser> {
  if (Browser.openSessionCount > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sutradhar] launch() called with ${Browser.openSessionCount} previous session(s) from ` +
        'this process not yet close()d — each launch() spawns a separate Chrome process; call ' +
        'browser.close() when done or Chrome processes will leak.',
    );
  }
  const fsRoots = resolveFsRoots({
    options: { allowedDownloadRoots: options.allowedDownloadRoots, allowedUploadRoots: options.allowedUploadRoots },
  });
  const runtime = new SutradharRuntime({
    allowedDomains: options.allowedDomains,
    allowedDownloadRoots: fsRoots.allowedDownloadRoots,
    allowedUploadRoots: fsRoots.allowedUploadRoots,
  });
  const result = await runtime.launch({
    initialUrl: options.url,
    isIncognito: options.isIncognito,
    launch:
      options.headless !== undefined || options.userAgent !== undefined || options.viewport !== undefined
        ? { headless: options.headless, userAgent: options.userAgent, viewport: options.viewport }
        : undefined,
    profileName: options.profileName,
  });
  if (!result.hasRealBrowser) {
    // Clean up the useless session before throwing so we don't leak a browser process.
    await runtime.shutdown(result.sessionId).catch(() => {});
    throw new Error(
      'Sutradhar launched but no real browser page is available. Ensure Chrome/Edge is ' +
        'installed, or set CHROME_PATH to the executable.',
    );
  }
  return new Browser(runtime, result.sessionId);
}

export { Browser, type LaunchOptions } from './browser.js';
export {
  Page,
  type ElementOptions,
  type ScreenshotOptions,
  type SetViewportOptions,
  type ViewportInfo,
  type WaitForSelectorOptions,
  type WaitForSelectorState,
  type PageAuditOptions,
  type PageAuditResult,
  type PageDownloadOptions,
} from './page.js';
export {
  SutradharRuntime,
  type SnapshotResult,
  ProfileManager,
  type ProfileInfo,
  type StorageState,
  type AuditReport,
  type DownloadResult,
} from '@sutradhar/capability-runtime';
