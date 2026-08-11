/**
 * @file packages/browser/tests/unit/stealth.spec.ts
 * @description Unit tests for StealthEngine, script generators, and options compilation.
 */

import {
  StealthEngine,
  getWebdriverOverrideScript,
  getChromeRuntimeScript,
  getWebglMaskScript,
  getHardwareConcurrencyScript,
} from '../../src/index.js';

describe('@pinchtab/browser Stealth Engine', () => {
  it('should generate webdriver override script string', () => {
    const script = getWebdriverOverrideScript();
    expect(script).toContain('navigator');
    expect(script).toContain('webdriver');
    expect(script).toContain('undefined');
  });

  it('should generate window.chrome runtime mock script string', () => {
    const script = getChromeRuntimeScript();
    expect(script).toContain('window.chrome');
    expect(script).toContain('loadTimes');
  });

  it('should generate WebGL vendor and renderer masking script', () => {
    const script = getWebglMaskScript('NVIDIA', 'GeForce RTX 3080');
    expect(script).toContain('WebGLRenderingContext');
    expect(script).toContain('NVIDIA');
    expect(script).toContain('GeForce RTX 3080');
  });

  it('should generate hardware concurrency and platform script', () => {
    const script = getHardwareConcurrencyScript(16, 'Linux x86_64');
    expect(script).toContain('hardwareConcurrency');
    expect(script).toContain('16');
    expect(script).toContain('Linux x86_64');
  });

  it('should compile enabled stealth scripts via StealthEngine', () => {
    const engine = new StealthEngine();
    const scripts = engine.getEvasionScripts({
      overrideWebdriver: true,
      mockChromeRuntime: true,
      maskWebgl: true,
      randomizeHardware: true,
    });

    expect(scripts.length).toBe(4);
    expect(scripts[0]).toContain('webdriver');
    expect(scripts[1]).toContain('window.chrome');
  });
});
