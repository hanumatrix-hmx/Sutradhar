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

import os from 'node:os';
import path from 'node:path';
import {
  SutradharRuntime,
  resolveFsRoots,
  resolveAllowedDomains,
  resolveIdleTimeoutMs,
  resolveRuntimeDialogPolicy,
  resolveViewport,
  loadProjectConfig,
  expandHome,
} from '@sutradhar/capability-runtime';
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
  if (options.configFile !== undefined && options.discoverConfig) {
    throw new TypeError('launch(): pass either configFile or discoverConfig, not both');
  }
  // Fails fast (before any config I/O or runtime) on a policy the SDK cannot honor.
  resolveRuntimeDialogPolicy({ option: options.dialogPolicy, surface: 'sdk' });
  if (Browser.openSessionCount > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sutradhar] launch() called with ${Browser.openSessionCount} previous session(s) from ` +
        'this process not yet close()d — each launch() spawns a separate Chrome process; call ' +
        'browser.close() when done or Chrome processes will leak.',
    );
  }
  // FR2-14: the project config is OPT-IN for the SDK (a library must not change its sandbox from
  // ambient files or env vars). Precedence for every setting: option > config file > default.
  let explicitPath: string | undefined;
  if (options.configFile !== undefined) {
    const expanded = expandHome(options.configFile, os.homedir());
    if (expanded === undefined) throw new TypeError(`launch(): configFile "${options.configFile}": ~user is not supported`);
    explicitPath = path.resolve(process.cwd(), expanded);
  }
  const discovery = await loadProjectConfig({
    cwd: process.cwd(),
    discover: options.discoverConfig === true,
    explicitPath,
    explicitOrigin: 'option',
  });
  const cfg = discovery.status === 'loaded' ? discovery.config : undefined;
  for (const w of cfg?.warnings ?? []) console.warn(`[sutradhar] ${w}`);
  const dialog = resolveRuntimeDialogPolicy({ option: options.dialogPolicy, config: cfg, surface: 'sdk' });
  for (const w of dialog.warnings) console.warn(`[sutradhar] ${w}`);
  const fsRoots = resolveFsRoots({
    options: { allowedDownloadRoots: options.allowedDownloadRoots, allowedUploadRoots: options.allowedUploadRoots },
    config: cfg && { ...cfg.resolved, baseDir: cfg.baseDir },
  });
  const viewport = resolveViewport({ option: options.viewport, config: cfg }).value;
  const runtime = new SutradharRuntime({
    allowedDomains: resolveAllowedDomains({ option: options.allowedDomains, config: cfg }).value,
    allowedDownloadRoots: fsRoots.allowedDownloadRoots,
    allowedUploadRoots: fsRoots.allowedUploadRoots,
    idleTimeoutMs: resolveIdleTimeoutMs({ option: options.idleTimeoutMs, config: cfg, fallback: undefined }).value,
    dialogPolicy: dialog.value,
  });
  const result = await runtime.launch({
    initialUrl: options.url,
    isIncognito: options.isIncognito,
    launch:
      options.headless !== undefined || options.userAgent !== undefined || viewport !== undefined
        ? { headless: options.headless, userAgent: options.userAgent, viewport }
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
export { ActionFailedError, ExpectationFailedError } from './errors.js';
export type { DialogPolicy, DialogPolicyMode, ProjectConfigFile } from '@sutradhar/capability-runtime';
export {
  Page,
  type ActionOptions,
  type GotoOptions,
  type LastResult,
  type ElementOptions,
  type SettleActionOptions,
  type WaitForOptions,
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
  type ActionExpectation,
  type ActionResult,
  type WaitForCondition,
  type SettleSpec,
  type VerificationResultDto,
  type VerificationEvidence,
} from '@sutradhar/capability-runtime';
