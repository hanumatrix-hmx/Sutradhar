/**
 * @file packages/browser/src/stealth/stealth-engine.ts
 * @description StealthEngine orchestrating script generation and anti-detection rules.
 */

import { StructuredLogger } from '@pinchtab/observability';
import { StealthOptions, DEFAULT_STEALTH_OPTIONS } from './stealth-options.js';
import {
  getWebdriverOverrideScript,
  getChromeRuntimeScript,
  getWebglMaskScript,
  getHardwareConcurrencyScript,
} from './stealth-scripts.js';

export interface IStealthEngine {
  getEvasionScripts(options?: StealthOptions): readonly string[];
}

export class StealthEngine implements IStealthEngine {
  private readonly logger: StructuredLogger;

  public constructor(logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  /**
   * Compiles enabled stealth evasion scripts into array of JS snippets for page evaluateOnNewDocument.
   */
  public getEvasionScripts(options: StealthOptions = {}): readonly string[] {
    const opts = { ...DEFAULT_STEALTH_OPTIONS, ...options };
    const scripts: string[] = [];

    if (opts.overrideWebdriver) {
      scripts.push(getWebdriverOverrideScript());
    }

    if (opts.mockChromeRuntime) {
      scripts.push(getChromeRuntimeScript());
    }

    if (opts.maskWebgl) {
      scripts.push(getWebglMaskScript());
    }

    if (opts.randomizeHardware) {
      scripts.push(getHardwareConcurrencyScript(opts.hardwareConcurrency, opts.platform));
    }

    this.logger.debug(`[StealthEngine] Compiled ${scripts.length} stealth evasion scripts`);
    return scripts;
  }
}
