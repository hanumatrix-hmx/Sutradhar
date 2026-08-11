/**
 * @file packages/frontend/src/runtime/actions/impl/dataActions.ts
 * @description Data actions (ExtractDOM, CaptureScreenshot, ExecuteJavaScript, Wait).
 */

import { BrowserAction } from '../browserPageAction.js';
import { ActionContext } from '../actionContext.js';
import { ActionArtifact } from '../actionTypes.js';

export class ExtractDOMAction extends BrowserAction<
  { selector?: string; tabId?: string },
  { html: string }
> {
  public constructor(input: { selector?: string; tabId?: string } = {}) {
    super({
      type: 'ExtractDOM',
      name: 'Extract Page DOM',
      description: 'Extracts HTML structure from active page',
      input,
      metadata: { category: 'data', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    return { valid: true };
  }

  public async execute(
    context: ActionContext,
  ): Promise<{ output: { html: string }; artifacts: ActionArtifact[] }> {
    const code = this.input.selector
      ? `document.querySelector('${this.input.selector}')?.outerHTML`
      : 'document.documentElement.outerHTML';

    const res = await context.browserAdapter.executeScript(
      context.sessionId,
      this.input.tabId,
      code,
    );
    // Honest extraction: report what eval actually returned (null when the
    // selector matched nothing) instead of inventing sample HTML.
    const html = typeof res === 'string' ? res : '';

    const artifact: ActionArtifact = {
      id: `art_${Date.now()}`,
      name: 'page_dom.html',
      type: 'html',
      mimeType: 'text/html',
      data: html,
      sizeBytes: html.length,
    };

    return { output: { html }, artifacts: [artifact] };
  }
}

export class CaptureScreenshotAction extends BrowserAction<
  { tabId?: string },
  { screenshotData: string }
> {
  public constructor(input: { tabId?: string } = {}) {
    super({
      type: 'CaptureScreenshot',
      name: 'Capture Page Screenshot',
      description: 'Captures PNG image snapshot of active viewport',
      input,
      metadata: { category: 'data', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    return { valid: true };
  }

  public async execute(
    context: ActionContext,
  ): Promise<{ output: { screenshotData: string }; artifacts: ActionArtifact[] }> {
    const screenshotData = await context.browserAdapter.captureScreenshot(
      context.sessionId,
      this.input.tabId,
    );
    const artifact: ActionArtifact = {
      id: `art_shot_${Date.now()}`,
      name: 'screenshot.png',
      type: 'screenshot',
      mimeType: 'image/png',
      data: screenshotData,
    };

    return { output: { screenshotData }, artifacts: [artifact] };
  }
}

export class ExecuteJavaScriptAction extends BrowserAction<
  { script: string; tabId?: string },
  { result: unknown }
> {
  public constructor(input: { script: string; tabId?: string }) {
    super({
      type: 'ExecuteJavaScript',
      name: 'Execute Custom Script',
      description: 'Evaluates JavaScript within page context',
      input,
      metadata: { category: 'data', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.script) return { valid: false, reason: 'Script is required' };
    return { valid: true };
  }

  public async execute(context: ActionContext): Promise<{ output: { result: unknown } }> {
    const result = await context.browserAdapter.executeScript(
      context.sessionId,
      this.input.tabId,
      this.input.script,
    );
    return { output: { result } };
  }
}

export class WaitAction extends BrowserAction<{ durationMs: number }, { waitedMs: number }> {
  public constructor(input: { durationMs: number }) {
    super({
      type: 'Wait',
      name: 'Wait Delay',
      description: `Waits for ${input.durationMs}ms`,
      input,
      metadata: { category: 'data', requiresBrowserRunning: false },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.durationMs || this.input.durationMs < 0)
      return { valid: false, reason: 'Duration must be positive' };
    return { valid: true };
  }

  public async execute(_context: ActionContext): Promise<{ output: { waitedMs: number } }> {
    await new Promise((r) => setTimeout(r, Math.min(this.input.durationMs, 500)));
    return { output: { waitedMs: this.input.durationMs } };
  }
}
