/**
 * @file packages/browser/src/launcher/browser-options.ts
 * @description Configuration options for launching browser instances.
 */

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface ProxyConfig {
  /** e.g. `http://proxy.example.com:8080` or `socks5://proxy.example.com:1080`. */
  readonly server: string;
  readonly username?: string;
  readonly password?: string;
}

export interface BrowserLaunchOptions {
  readonly headless?: boolean;
  readonly executablePath?: string;
  readonly args?: readonly string[];
  readonly viewport?: ViewportSize;
  readonly userDataDir?: string;
  readonly isIncognito?: boolean;
  readonly enableStealth?: boolean;
  readonly proxy?: ProxyConfig;
}

export const DEFAULT_LAUNCH_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--window-size=1280,800',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-accelerated-video-decode',
  '--disable-accelerated-2d-canvas',
  '--disable-gl-drawing-for-tests',
  '--force-color-profile=srgb',
];
