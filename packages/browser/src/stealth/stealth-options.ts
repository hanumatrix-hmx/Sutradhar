/**
 * @file packages/browser/src/stealth/stealth-options.ts
 * @description Configuration options and defaults for stealth evasion scripts.
 */

export interface StealthOptions {
  readonly overrideWebdriver?: boolean;
  readonly mockChromeRuntime?: boolean;
  readonly maskWebgl?: boolean;
  readonly randomizeHardware?: boolean;
  readonly userAgent?: string;
  readonly platform?: string;
  readonly hardwareConcurrency?: number;
}

export const DEFAULT_STEALTH_OPTIONS: StealthOptions = {
  overrideWebdriver: true,
  mockChromeRuntime: true,
  maskWebgl: true,
  randomizeHardware: true,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  platform: 'Win32',
  hardwareConcurrency: 8,
};
