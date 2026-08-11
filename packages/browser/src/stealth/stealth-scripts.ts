/**
 * @file packages/browser/src/stealth/stealth-scripts.ts
 * @description Standalone JavaScript evasion scripts injected into browser pages before document load.
 */

export function getWebdriverOverrideScript(): string {
  return `
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  `;
}

export function getChromeRuntimeScript(): string {
  return `
    window.chrome = {
      runtime: {
        connect: () => {},
        sendMessage: () => {},
      },
      loadTimes: () => ({}),
      csi: () => ({}),
      app: {},
    };
  `;
}

export function getWebglMaskScript(
  vendor = 'Google Inc. (NVIDIA)',
  renderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)',
): string {
  return `
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return '${vendor}';
      if (parameter === 37446) return '${renderer}';
      return getParameter.apply(this, arguments);
    };
  `;
}

export function getHardwareConcurrencyScript(concurrency = 8, platform = 'Win32'): string {
  return `
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${concurrency} });
    Object.defineProperty(navigator, 'platform', { get: () => '${platform}' });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  `;
}
