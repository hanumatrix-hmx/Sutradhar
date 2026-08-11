/**
 * @file packages/frontend/src/runtime/actions/impl/navigationActions.ts
 * @description Navigation actions (Navigate, CreateTab, CloseTab, FocusTab, Reload, Back, Forward).
 */

import { BrowserAction } from '../browserPageAction.js';
import { ActionContext } from '../actionContext.js';
import { TabSnapshot } from '../../browser/browserTypes.js';

export class NavigateAction extends BrowserAction<
  { url: string; tabId?: string },
  { url: string; title: string }
> {
  public constructor(input: { url: string; tabId?: string }) {
    super({
      type: 'Navigate',
      name: 'Navigate to URL',
      description: `Navigates to URL ${input.url}`,
      input,
      metadata: { category: 'navigation', requiresBrowserRunning: true },
    });
  }

  public async validate(context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.url) return { valid: false, reason: 'URL is required' };
    if (!context.browserRuntime || context.browserRuntime.status === 'stopped') {
      return { valid: false, reason: 'BrowserRuntime is not running' };
    }
    return { valid: true };
  }

  public async execute(
    context: ActionContext,
  ): Promise<{ output: { url: string; title: string } }> {
    const res = await context.browserAdapter.navigate(
      context.sessionId,
      this.input.tabId || 'active',
      this.input.url,
    );
    return { output: { url: res.url, title: res.title } };
  }
}

export class CreateTabAction extends BrowserAction<{ url?: string; title?: string }, TabSnapshot> {
  public constructor(input: { url?: string; title?: string } = {}) {
    super({
      type: 'CreateTab',
      name: 'Create New Browser Tab',
      description: 'Creates a new browser tab',
      input,
      metadata: { category: 'navigation', requiresBrowserRunning: true },
    });
  }

  public async validate(context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!context.browserRuntime || context.browserRuntime.status === 'stopped') {
      return { valid: false, reason: 'BrowserRuntime is not running' };
    }
    return { valid: true };
  }

  public async execute(context: ActionContext): Promise<{ output: TabSnapshot }> {
    const tab = await context.browserAdapter.createTab(
      context.sessionId,
      this.input.url,
      this.input.title,
    );
    return { output: tab };
  }
}

export class CloseTabAction extends BrowserAction<{ tabId: string }, { closedTabId: string }> {
  public constructor(input: { tabId: string }) {
    super({
      type: 'CloseTab',
      name: 'Close Browser Tab',
      description: `Closes tab ${input.tabId}`,
      input,
      metadata: { category: 'navigation', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.tabId) return { valid: false, reason: 'Tab ID is required' };
    return { valid: true };
  }

  public async execute(context: ActionContext): Promise<{ output: { closedTabId: string } }> {
    await context.browserAdapter.closeTab(context.sessionId, this.input.tabId);
    return { output: { closedTabId: this.input.tabId } };
  }
}

export class FocusTabAction extends BrowserAction<{ tabId: string }, { focusedTabId: string }> {
  public constructor(input: { tabId: string }) {
    super({
      type: 'FocusTab',
      name: 'Focus Tab',
      description: `Focuses tab ${input.tabId}`,
      input,
      metadata: { category: 'navigation', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    if (!this.input.tabId) return { valid: false, reason: 'Tab ID is required' };
    return { valid: true };
  }

  public async execute(context: ActionContext): Promise<{ output: { focusedTabId: string } }> {
    await context.browserAdapter.focusTab(context.sessionId, this.input.tabId);
    return { output: { focusedTabId: this.input.tabId } };
  }
}

export class ReloadAction extends BrowserAction<{ tabId?: string }, { url: string }> {
  public constructor(input: { tabId?: string } = {}) {
    super({
      type: 'Reload',
      name: 'Reload Active Page',
      description: 'Reloads current browser tab',
      input,
      metadata: { category: 'navigation', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    return { valid: true };
  }

  public async execute(context: ActionContext): Promise<{ output: { url: string } }> {
    const res = await context.browserAdapter.reload(
      context.sessionId,
      this.input.tabId || 'active',
    );
    return { output: { url: res.url } };
  }
}

export class BackAction extends BrowserAction<{ tabId?: string }, { url: string }> {
  public constructor(input: { tabId?: string } = {}) {
    super({
      type: 'Back',
      name: 'Go Back in History',
      description: 'Navigates back in history stack',
      input,
      metadata: { category: 'navigation', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    return { valid: true };
  }

  public async execute(context: ActionContext): Promise<{ output: { url: string } }> {
    const res = await context.browserAdapter.goBack(
      context.sessionId,
      this.input.tabId || 'active',
    );
    return { output: { url: res.url } };
  }
}

export class ForwardAction extends BrowserAction<{ tabId?: string }, { url: string }> {
  public constructor(input: { tabId?: string } = {}) {
    super({
      type: 'Forward',
      name: 'Go Forward in History',
      description: 'Navigates forward in history stack',
      input,
      metadata: { category: 'navigation', requiresBrowserRunning: true },
    });
  }

  public async validate(_context: ActionContext): Promise<{ valid: boolean; reason?: string }> {
    return { valid: true };
  }

  public async execute(context: ActionContext): Promise<{ output: { url: string } }> {
    const res = await context.browserAdapter.goForward(
      context.sessionId,
      this.input.tabId || 'active',
    );
    return { output: { url: res.url } };
  }
}
