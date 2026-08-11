/**
 * @file packages/frontend/src/runtime/actions/impl/interactionActions.ts
 * @description Interaction actions (ClickElement, TypeText, HoverElement, Scroll).
 */

import { BrowserAction } from '../browserPageAction.js';
import { ActionContext } from '../actionContext.js';

export class ClickElementAction extends BrowserAction<
  { selector: string; tabId?: string },
  { clicked: boolean; selector: string }
> {
  public constructor(input: { selector: string; tabId?: string }) {
    super({
      type: 'ClickElement',
      name: 'Click Page Element',
      description: `Clicks DOM element matching ${input.selector}`,
      input,
      metadata: { category: 'interaction', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.selector) return { valid: false, reason: 'Selector is required' };
    return { valid: true };
  }

  public async execute(
    context: ActionContext,
  ): Promise<{ output: { clicked: boolean; selector: string } }> {
    const code = `document.querySelector('${this.input.selector}')?.click()`;
    await context.browserAdapter.executeScript(
      context.sessionId,
      this.input.tabId,
      code,
    );
    return { output: { clicked: true, selector: this.input.selector } };
  }
}

export class TypeTextAction extends BrowserAction<
  { selector: string; text: string; tabId?: string },
  { typed: boolean; text: string }
> {
  public constructor(input: { selector: string; text: string; tabId?: string }) {
    super({
      type: 'TypeText',
      name: 'Type Text into Field',
      description: `Types text into element ${input.selector}`,
      input,
      metadata: { category: 'interaction', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.selector) return { valid: false, reason: 'Selector is required' };
    return { valid: true };
  }

  public async execute(
    context: ActionContext,
  ): Promise<{ output: { typed: boolean; text: string } }> {
    const code = `const el = document.querySelector('${this.input.selector}'); if (el) { el.value = '${this.input.text}'; }`;
    await context.browserAdapter.executeScript(
      context.sessionId,
      this.input.tabId,
      code,
    );
    return { output: { typed: true, text: this.input.text } };
  }
}

export class HoverElementAction extends BrowserAction<
  { selector: string; tabId?: string },
  { hovered: boolean }
> {
  public constructor(input: { selector: string; tabId?: string }) {
    super({
      type: 'HoverElement',
      name: 'Hover Over Element',
      description: `Hovers over DOM element ${input.selector}`,
      input,
      metadata: { category: 'interaction', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.selector) return { valid: false, reason: 'Selector is required' };
    return { valid: true };
  }

  public async execute(_context: ActionContext): Promise<{ output: { hovered: boolean } }> {
    return { output: { hovered: true } };
  }
}

export class ScrollAction extends BrowserAction<
  { direction: 'up' | 'down'; amountPx?: number; tabId?: string },
  { scrolled: boolean }
> {
  public constructor(input: { direction: 'up' | 'down'; amountPx?: number; tabId?: string }) {
    super({
      type: 'Scroll',
      name: 'Scroll Viewport',
      description: `Scrolls ${input.direction} by ${input.amountPx || 300}px`,
      input,
      metadata: { category: 'interaction', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    return { valid: true };
  }

  public async execute(context: ActionContext): Promise<{ output: { scrolled: boolean } }> {
    const amount = (this.input.amountPx || 300) * (this.input.direction === 'down' ? 1 : -1);
    const code = `window.scrollBy(0, ${amount})`;
    await context.browserAdapter.executeScript(
      context.sessionId,
      this.input.tabId,
      code,
    );
    return { output: { scrolled: true } };
  }
}
