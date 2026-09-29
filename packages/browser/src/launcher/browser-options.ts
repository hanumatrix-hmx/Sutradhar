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
  readonly proxy?: ProxyConfig;
  /**
   * Override `navigator.userAgent` via Chrome's own `--user-agent` launch flag. Unset by
   * default — the real Chrome UA (including "HeadlessChrome" when running headless) is left
   * as-is. This is plain configurability (every HTTP client and browser automation tool
   * exposes a UA override for legitimate uses like testing UA-conditional rendering); nothing
   * in this codebase sets it automatically. Sutradhar does not attempt to evade bot-detection
   * or solve CAPTCHAs, and Cloudflare challenges, CAPTCHA walls, and IP-level blocks stop it
   * exactly as they would stop any other automation tool run the same way. See CLAUDE.md's
   * scope boundary on stealth/bot-detection evasion.
   */
  readonly userAgent?: string;
}

// Sutradhar does not attempt to evade bot-detection or solve CAPTCHAs, and Cloudflare
// challenges, CAPTCHA walls, and IP-level blocks stop it exactly as they would stop any other
// automation tool run the same way.
//
// The only launch argument here with detection-relevant behavior is
// `--disable-blink-features=AutomationControlled`, which hides `navigator.webdriver` from
// scripts that check for it -- measured directly: `navigator.webdriver` is `true` without the
// flag and `false` with it. It does not defeat Cloudflare, CAPTCHA, or any other real
// bot-detection service, and other simple signals -- the default headless user agent's
// `HeadlessChrome` substring and `--enable-automation` still being present in the launch
// command line -- remain unmasked.
//
// Chromium's own source (`bad_flags_prompt.cc`) classifies `--disable-blink-features` as
// unsupported, developer-only -- the opposite of a Chrome recommendation -- and a live headed
// launch with this flag present still shows Chrome's own "Chrome is being controlled by
// automated test software" banner. It quiets nothing, and it is kept unconditionally: it is
// not, and must not become, gated behind any opt-in. `--disable-infobars` below has the same
// history elsewhere (hiding that same automation banner), but a live headed launch with
// current flags still shows the banner on Chrome 153, so no separate claim about it is made
// here.
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
