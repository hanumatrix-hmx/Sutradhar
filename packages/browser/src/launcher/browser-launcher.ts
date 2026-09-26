/**
 * @file packages/browser/src/launcher/browser-launcher.ts
 * @description Browser launcher wrapper engine managing Puppeteer launch flags and real Chrome initialization.
 */

import puppeteer, { Browser as PuppeteerBrowser, BrowserContext, Page } from 'puppeteer-core';
import * as fs from 'node:fs';
import { StructuredLogger } from '@sutradhar/observability';
import { BrowserLaunchOptions, DEFAULT_LAUNCH_ARGS } from './browser-options.js';
import { buildMarkerArgs, processStartMs, writeOwnerFile } from './launch-marker.js';

export interface IBrowserInstance {
  readonly isConnected: boolean;
  readonly puppeteerBrowser?: PuppeteerBrowser;
  /** Proxy credentials to apply (via `page.authenticate`) to every page this instance creates. */
  readonly proxyAuth?: { username: string; password: string };
  /**
   * Create a new page. Delegates to the isolated incognito-style {@link BrowserContext}
   * when one was requested at launch, so incognito sessions actually get isolated
   * cookies/storage instead of silently sharing the default context.
   */
  newPage(): Promise<Page | undefined>;
  close(): Promise<void>;
  /**
   * Register a callback fired when the underlying Chrome process disconnects/crashes
   * outside of a normal `close()` (killed externally, OOM, etc.). A no-op mock instance
   * (no real `puppeteerBrowser`) never fires this — there's nothing to disconnect from.
   */
  onDisconnected(callback: () => void): void;
}

export class PuppeteerBrowserInstance implements IBrowserInstance {
  public constructor(
    public readonly puppeteerBrowser?: PuppeteerBrowser,
    private readonly browserContext?: BrowserContext,
    public readonly proxyAuth?: { username: string; password: string },
  ) {}

  public get isConnected(): boolean {
    return this.puppeteerBrowser ? this.puppeteerBrowser.connected : true;
  }

  public async newPage(): Promise<Page | undefined> {
    const page = this.browserContext
      ? await this.browserContext.newPage()
      : await this.puppeteerBrowser?.newPage();
    if (page && this.proxyAuth) {
      await page.authenticate(this.proxyAuth);
    }
    return page;
  }

  public async close(): Promise<void> {
    if (this.puppeteerBrowser) {
      await this.puppeteerBrowser.close();
    }
  }

  public onDisconnected(callback: () => void): void {
    this.puppeteerBrowser?.on('disconnected', callback);
  }
}

export interface IBrowserLauncher {
  launch(options?: BrowserLaunchOptions): Promise<IBrowserInstance>;
  connect(wsEndpoint: string): Promise<IBrowserInstance>;
}

export class BrowserLauncher implements IBrowserLauncher {
  private readonly logger: StructuredLogger;

  public constructor(logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  /**
   * Resolves Chrome executable path on local system.
   */
  public findExecutablePath(customPath?: string): string | undefined {
    if (customPath && fs.existsSync(customPath)) {
      return customPath;
    }
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }

    const candidatePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      // Raspberry Pi OS (Bullseye+) packages Chromium as `chromium`, not `chromium-browser` —
      // check it first since that's the current default on ARM Raspberry Pi installs.
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/lib/chromium-browser/chromium-browser',
      '/snap/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ];

    for (const candidate of candidatePaths) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  /**
   * Generates the launch arguments, merging the caller's args with DEFAULT_LAUNCH_ARGS, which
   * is always included unconditionally. Most of DEFAULT_LAUNCH_ARGS is sandboxing/rendering
   * configuration. The only launch argument here with detection-relevant behavior is
   * `--disable-blink-features=AutomationControlled`, which hides `navigator.webdriver` from
   * scripts that check for it -- measured directly: `navigator.webdriver` is `true` without
   * the flag and `false` with it. It does not defeat Cloudflare, CAPTCHA, or any other real
   * bot-detection service, and other simple signals -- the default headless user agent's
   * `HeadlessChrome` substring and `--enable-automation` still being present in the launch
   * command line -- remain unmasked (see browser-options.ts for the full disclosure).
   * Sutradhar does not attempt to evade bot-detection or solve CAPTCHAs, and Cloudflare
   * challenges, CAPTCHA walls, and IP-level blocks stop it exactly as they would stop any
   * other automation tool run the same way.
   */
  public prepareLaunchArgs(options: BrowserLaunchOptions = {}): string[] {
    const userArgs = options.args ?? [];
    const mergedArgs = new Set([...DEFAULT_LAUNCH_ARGS, ...userArgs]);

    if (options.proxy?.server) {
      mergedArgs.add(`--proxy-server=${options.proxy.server}`);
    }

    if (options.userAgent) {
      mergedArgs.add(`--user-agent=${options.userAgent}`);
    }

    return Array.from(mergedArgs);
  }

  /**
   * Orchestrates browser launching with options validation.
   */
  public async launch(options: BrowserLaunchOptions = {}): Promise<IBrowserInstance> {
    const launchArgs = this.prepareLaunchArgs(options);
    const executablePath = this.findExecutablePath(options.executablePath);

    this.logger.info('[BrowserLauncher] Launching browser instance', {
      executablePath: executablePath ?? 'mock',
      headless: options.headless ?? true,
      argsCount: launchArgs.length,
    });

    if (executablePath) {
      try {
        // Marks every runtime-launched Chrome (SDK launch(), MCP browser.launch, apps/server)
        // with harmless command-line switches so a leaked/orphaned process can later be proven
        // to be Sutradhar's — see launch-marker.ts's doc comment and FR2-03 spec §0.1/D1. Added
        // here (not in prepareLaunchArgs, which stays marker-free so its existing tests are
        // unchanged) because the marker needs this process's own PID/start time, not just the
        // caller's options.
        const marker = buildMarkerArgs({ kind: 'runtime', ownerPid: process.pid, ownerStartMs: processStartMs() });
        const browser = await puppeteer.launch({
          executablePath,
          headless: options.headless ?? true,
          args: [...launchArgs, ...marker],
          // null = size the viewport to the actual window (matches --window-size) instead of
          // Puppeteer's small 800x600 default when the caller hasn't asked for a specific size.
          defaultViewport: options.viewport ?? null,
          userDataDir: options.userDataDir,
        });
        // Only when Puppeteer itself chose the temp profile dir (options.userDataDir was
        // undefined) — never write into a caller-supplied or named-profile dir. Every
        // Puppeteer user on the machine shares the `puppeteer_dev_chrome_profile-*` naming, so
        // this owner file is the only way GC can later attribute such a dir to Sutradhar.
        if (options.userDataDir === undefined) {
          const spawnArgs = browser.process()?.spawnargs ?? [];
          const uddArg = spawnArgs.find((a) => a.startsWith('--user-data-dir='));
          const udd = uddArg?.slice('--user-data-dir='.length);
          if (udd) {
            await writeOwnerFile(udd, {
              kind: 'runtime',
              ownerPid: process.pid,
              ownerStartMs: processStartMs(),
              chromePid: browser.process()?.pid,
              createdAt: new Date().toISOString(),
            }).catch((err) => {
              this.logger.warn('[BrowserLauncher] owner file not written', { error: (err as Error).message });
            });
          }
        }
        const browserContext = options.isIncognito
          ? await browser.createBrowserContext()
          : undefined;
        const proxyAuth =
          options.proxy?.username && options.proxy?.password
            ? { username: options.proxy.username, password: options.proxy.password }
            : undefined;
        return new PuppeteerBrowserInstance(browser, browserContext, proxyAuth);
      } catch (err) {
        this.logger.warn('[BrowserLauncher] Failed to launch real Chrome browser, falling back to mock instance', {
          error: (err as Error).message,
        });
      }
    }

    return new PuppeteerBrowserInstance();
  }

  /**
   * Connect to an external browser over the Chrome DevTools Protocol.
   *
   * Accepts either:
   *   - a raw CDP WebSocket URL: `ws://host:port/devtools/browser/<id>`
   *   - an http discovery endpoint: `http://host:port` or `http://host:port/json/version`
   *     (resolved to its `webSocketDebuggerUrl`).
   *
   * Throws on failure rather than silently returning a mock instance, so callers (the
   * session manager, the extension path) can distinguish a real attach from a no-op.
   */
  public async connect(endpoint: string): Promise<IBrowserInstance> {
    this.logger.info('[BrowserLauncher] Connecting to remote browser endpoint', {
      endpoint,
    });
    const wsEndpoint = await resolveWsEndpoint(endpoint);
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
    return new PuppeteerBrowserInstance(browser);
  }
}

/**
 * Resolve a CDP endpoint to a raw browser WebSocket URL. If given an http(s) URL, queries the
 * `/json/version` discovery endpoint for `webSocketDebuggerUrl`. ws:// URLs pass through.
 */
async function resolveWsEndpoint(endpoint: string): Promise<string> {
  if (endpoint.startsWith('ws://') || endpoint.startsWith('wss://')) return endpoint;
  // http discovery endpoint — normalize to /json/version and read webSocketDebuggerUrl.
  const base = endpoint.replace(/\/+$/, '');
  const versionUrl = base.endsWith('/json/version') ? base : `${base}/json/version`;
  const res = await fetch(versionUrl);
  if (!res.ok) {
    throw new Error(`CDP discovery at ${versionUrl} returned HTTP ${res.status}`);
  }
  const version = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) {
    throw new Error(`CDP discovery at ${versionUrl} did not return a webSocketDebuggerUrl`);
  }
  return version.webSocketDebuggerUrl;
}
