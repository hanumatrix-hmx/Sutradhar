/**
 * @file packages/browser/tests/unit/browser-tab-observability.spec.ts
 * @description Unit tests for BrowserTab's dialog handling, console/page-error/network
 * capture, network route (block/mock) rules, and advisory multi-agent tab locking.
 */

import { BrowserTab, RouteRule } from '../../src/index.js';
import { createTabId, createSessionId } from '@sutradhar/contracts';
import { EventBus } from '@sutradhar/events';
import type { Page } from 'puppeteer-core';

/** A mock Puppeteer Page whose `.on(event, handler)` calls are captured so tests can fire
 *  them manually, simulating real page events without a real browser. */
function mockPage(overrides: Partial<Record<string, any>> = {}) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const page = {
    isClosed: () => false,
    url: () => 'https://example.com',
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return page;
    }),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { page: page as unknown as Page, handlers, raw: page };
}

describe('@sutradhar/browser BrowserTab dialog handling', () => {
  it('exposes a pending dialog and reports it via getPendingDialog', () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    expect(tab.getPendingDialog()).toBeUndefined();

    const dialog = {
      handled: false,
      type: () => 'confirm',
      message: () => 'Are you sure?',
      defaultValue: () => '',
      accept: vi.fn().mockResolvedValue(undefined),
      dismiss: vi.fn().mockResolvedValue(undefined),
    };
    handlers.get('dialog')!(dialog);

    expect(tab.getPendingDialog()).toEqual({
      dialogType: 'confirm',
      message: 'Are you sure?',
      defaultValue: undefined,
    });
  });

  it('accepts a pending dialog with prompt text via handleDialog', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    const dialog = {
      handled: false,
      type: () => 'prompt',
      message: () => 'Enter your name',
      defaultValue: () => '',
      accept: vi.fn().mockResolvedValue(undefined),
      dismiss: vi.fn().mockResolvedValue(undefined),
    };
    handlers.get('dialog')!(dialog);

    await tab.handleDialog('accept', 'Ada');

    expect(dialog.accept).toHaveBeenCalledWith('Ada');
    expect(tab.getPendingDialog()).toBeUndefined();
  });

  it('throws when handleDialog is called with no pending dialog', async () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    await expect(tab.handleDialog('dismiss')).rejects.toThrow('no pending dialog');
  });

  it('publishes a browser:dialog:opened event when a dialog appears', () => {
    const { page, handlers } = mockPage();
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.subscribe('browser:dialog:opened', (e) => events.push(e.payload));

    const tab = new BrowserTab(
      createTabId('tab_1'),
      'https://example.com',
      'Example',
      true,
      page,
      createSessionId('sess_1'),
      bus,
    );
    void tab; // constructed for its side effect of attaching listeners

    handlers.get('dialog')!({
      handled: false,
      type: () => 'alert',
      message: () => 'Hi',
      defaultValue: () => '',
      accept: vi.fn(),
      dismiss: vi.fn(),
    });

    expect(events).toEqual([
      expect.objectContaining({ dialogType: 'alert', message: 'Hi' }),
    ]);
  });
});

describe('@sutradhar/browser BrowserTab console/error/network capture', () => {
  it('captures console messages and returns them via getConsoleLogs', () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    handlers.get('console')!({ type: () => 'log', text: () => 'hello from the page' });
    handlers.get('console')!({ type: () => 'error', text: () => 'something broke' });

    const logs = tab.getConsoleLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ logType: 'log', text: 'hello from the page' });
    expect(logs[1]).toMatchObject({ logType: 'error', text: 'something broke' });
  });

  it('captures uncaught page errors and returns them via getPageErrors', () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    handlers.get('pageerror')!(new Error('boom'));

    const errors = tab.getPageErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('boom');
  });

  it('captures request and response activity and returns it via getNetworkLog', () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    handlers.get('request')!({
      url: () => 'https://example.com/api',
      method: () => 'GET',
      resourceType: () => 'xhr',
    });
    handlers.get('response')!({
      url: () => 'https://example.com/api',
      status: () => 200,
    });

    const log = tab.getNetworkLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ phase: 'request', url: 'https://example.com/api', method: 'GET' });
    expect(log[1]).toMatchObject({ phase: 'response', url: 'https://example.com/api', status: 200 });
  });

  it('bounds the console log buffer instead of growing unbounded', () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    for (let i = 0; i < 250; i++) {
      handlers.get('console')!({ type: () => 'log', text: () => `msg ${i}` });
    }

    expect(tab.getConsoleLogs().length).toBe(200);
    expect(tab.getConsoleLogs()[0]?.text).toBe('msg 50'); // oldest 50 were dropped
  });
});

describe('@sutradhar/browser BrowserTab network route rules', () => {
  it('enables request interception on the first addRoute call', async () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    const rule: RouteRule = { pattern: 'analytics', action: 'block' };
    await tab.addRoute(rule);

    expect((page as any).setRequestInterception).toHaveBeenCalledWith(true);
  });

  it('aborts a request matching a block rule', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);
    await tab.addRoute({ pattern: 'analytics', action: 'block' });

    const abort = vi.fn().mockResolvedValue(undefined);
    const continueFn = vi.fn().mockResolvedValue(undefined);
    handlers.get('request')!({
      url: () => 'https://track.analytics.com/pixel',
      method: () => 'GET',
      resourceType: () => 'image',
      abort,
      continue: continueFn,
    });

    expect(abort).toHaveBeenCalledTimes(1);
    expect(continueFn).not.toHaveBeenCalled();
  });

  it('responds with a mocked body for a request matching a mock rule', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);
    await tab.addRoute({
      pattern: '/api/config',
      action: 'mock',
      mockStatus: 200,
      mockContentType: 'application/json',
      mockBody: '{"flag":true}',
    });

    const respond = vi.fn().mockResolvedValue(undefined);
    handlers.get('request')!({
      url: () => 'https://example.com/api/config',
      method: () => 'GET',
      resourceType: () => 'fetch',
      respond,
      continue: vi.fn(),
      abort: vi.fn(),
    });

    expect(respond).toHaveBeenCalledWith({
      status: 200,
      contentType: 'application/json',
      body: '{"flag":true}',
    });
  });

  it('continues an unmatched request once interception is enabled', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);
    await tab.addRoute({ pattern: 'analytics', action: 'block' });

    const continueFn = vi.fn().mockResolvedValue(undefined);
    handlers.get('request')!({
      url: () => 'https://example.com/main.js',
      method: () => 'GET',
      resourceType: () => 'script',
      continue: continueFn,
      abort: vi.fn(),
    });

    expect(continueFn).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to resolve requests before interception is enabled', () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);
    void tab;

    const continueFn = vi.fn();
    const abort = vi.fn();
    handlers.get('request')!({
      url: () => 'https://example.com/main.js',
      method: () => 'GET',
      resourceType: () => 'script',
      continue: continueFn,
      abort,
    });

    // No addRoute() called -- interception was never enabled, so nothing should be resolved
    // (calling continue()/abort() without interception enabled would throw in real Puppeteer).
    expect(continueFn).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it('clearRoutes removes rules and disables interception', async () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);
    await tab.addRoute({ pattern: 'analytics', action: 'block' });

    await tab.clearRoutes();

    expect((page as any).setRequestInterception).toHaveBeenLastCalledWith(false);
  });
});

describe('@sutradhar/browser BrowserTab multi-agent tab locking (advisory)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is unlocked by default', () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);
    expect(tab.getLock()).toBeUndefined();
  });

  it('acquireLock succeeds when unlocked, and getLock reports the owner + expiry', () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    expect(tab.acquireLock('agent-a', 1000)).toBe(true);
    const lock = tab.getLock();
    expect(lock?.owner).toBe('agent-a');
  });

  it('acquireLock fails when a different owner already holds a valid lock', () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    tab.acquireLock('agent-a', 1000);
    expect(tab.acquireLock('agent-b', 1000)).toBe(false);
    expect(tab.getLock()?.owner).toBe('agent-a'); // untouched by the failed attempt
  });

  it('acquireLock succeeds and extends the TTL when the same owner re-acquires', () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    tab.acquireLock('agent-a', 1000);
    vi.advanceTimersByTime(900);
    expect(tab.acquireLock('agent-a', 1000)).toBe(true); // re-acquire before the old TTL would lapse
    vi.advanceTimersByTime(900); // total 1800ms since first acquire, past the ORIGINAL 1000ms TTL
    expect(tab.getLock()?.owner).toBe('agent-a'); // still locked - the re-acquire extended it
  });

  it('releaseLock succeeds only for the owner that holds the lock', () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    tab.acquireLock('agent-a', 1000);
    expect(tab.releaseLock('agent-b')).toBe(false);
    expect(tab.getLock()?.owner).toBe('agent-a'); // untouched by the wrong-owner attempt
    expect(tab.releaseLock('agent-a')).toBe(true);
    expect(tab.getLock()).toBeUndefined();
  });

  it('releaseLock on an already-unlocked tab is a no-op, not an error', () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);
    expect(tab.releaseLock('anyone')).toBe(false);
  });

  it('a lock past its TTL is reported as absent, and can be acquired by a new owner', () => {
    const { page } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);

    tab.acquireLock('agent-a', 100);
    vi.advanceTimersByTime(101);
    expect(tab.getLock()).toBeUndefined();
    expect(tab.acquireLock('agent-b', 1000)).toBe(true);
    expect(tab.getLock()?.owner).toBe('agent-b');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FR2-04: dialog policy (auto / report / accept / dismiss)
// ─────────────────────────────────────────────────────────────────────────

function mockDialog(type: string, message = 'msg', defaultValue = '') {
  return {
    handled: false,
    type: () => type,
    message: () => message,
    defaultValue: () => defaultValue,
    accept: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn().mockResolvedValue(undefined),
  };
}

describe('@sutradhar/browser BrowserTab dialog policy (FR2-04)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('T1: no policy argument (auto) — 30s dismiss for confirm, 3s accept for beforeunload — unchanged MCP/SDK behavior', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page);
    const confirm = mockDialog('confirm');
    handlers.get('dialog')!(confirm);
    vi.advanceTimersByTime(29_999);
    expect(confirm.dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(confirm.dismiss).toHaveBeenCalledTimes(1);

    const bu = mockDialog('beforeunload');
    handlers.get('dialog')!(bu);
    vi.advanceTimersByTime(2999);
    expect(bu.accept).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(bu.accept).toHaveBeenCalledTimes(1);
  });

  it('T2: {mode:"accept"} resolves a confirm immediately and records history', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page, undefined, undefined, {
      mode: 'accept',
    });
    const confirm = mockDialog('confirm', 'Are you sure?');
    handlers.get('dialog')!(confirm);
    await vi.advanceTimersByTimeAsync(0);
    expect(confirm.accept).toHaveBeenCalledTimes(1);
    expect(confirm.accept).toHaveBeenCalledWith(undefined);
    expect(vi.getTimerCount()).toBe(0);
    expect(tab.getPendingDialog()).toBeUndefined();
    const history = tab.getDialogHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ dialogType: 'confirm', action: 'accept', handledBy: 'policy' });
    expect(typeof history[0]!.handledAt).toBe('string');
  });

  it('T3: prompt accept-with-no-text uses the prompt default; an alert ignores a given promptText', async () => {
    const { page, handlers } = mockPage();
    const tabA = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'A', true, page, undefined, undefined, {
      mode: 'accept',
    });
    const promptNoText = mockDialog('prompt', 'q', 'fr2-default');
    handlers.get('dialog')!(promptNoText);
    await vi.advanceTimersByTimeAsync(0);
    expect(promptNoText.accept).toHaveBeenCalledWith('fr2-default');

    const { page: page2, handlers: h2 } = mockPage();
    const tabB = new BrowserTab(createTabId('tab_2'), 'https://example.com', 'B', true, page2, undefined, undefined, {
      mode: 'accept',
      promptText: 'zz',
    });
    const promptWithText = mockDialog('prompt', 'q', 'fr2-default');
    h2.get('dialog')!(promptWithText);
    await vi.advanceTimersByTimeAsync(0);
    expect(promptWithText.accept).toHaveBeenCalledWith('zz');

    const alertDialog = mockDialog('alert', 'hi');
    h2.get('dialog')!(alertDialog);
    await vi.advanceTimersByTimeAsync(0);
    expect(alertDialog.accept).toHaveBeenCalledWith(undefined);
    void tabA;
    void tabB;
  });

  it('T4: {mode:"dismiss"} on beforeunload dismisses at once, never accepts', async () => {
    const { page, handlers } = mockPage();
    new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page, undefined, undefined, {
      mode: 'dismiss',
    });
    const bu = mockDialog('beforeunload');
    handlers.get('dialog')!(bu);
    await vi.advanceTimersByTimeAsync(0);
    expect(bu.dismiss).toHaveBeenCalledTimes(1);
    expect(bu.accept).not.toHaveBeenCalled();
  });

  it('T5: {mode:"report"} never auto-resolves alert/confirm/prompt, but still 3s-accepts beforeunload', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page, undefined, undefined, {
      mode: 'report',
    });
    const confirm = mockDialog('confirm');
    handlers.get('dialog')!(confirm);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(confirm.accept).not.toHaveBeenCalled();
    expect(confirm.dismiss).not.toHaveBeenCalled();
    expect(tab.getPendingDialog()?.dialogType).toBe('confirm');

    const bu = mockDialog('beforeunload');
    handlers.get('dialog')!(bu);
    vi.advanceTimersByTime(2999);
    expect(bu.accept).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(bu.accept).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.getDialogHistory().find((h) => h.dialogType === 'beforeunload')?.handledBy).toBe('auto-timeout');
  });

  it('T6: setDialogPolicy affects only FUTURE dialogs, not one already pending', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page, undefined, undefined, {
      mode: 'report',
    });
    const confirm1 = mockDialog('confirm', 'first');
    handlers.get('dialog')!(confirm1);
    tab.setDialogPolicy({ mode: 'accept' });
    await vi.advanceTimersByTimeAsync(0);
    expect(confirm1.accept).not.toHaveBeenCalled();
    expect(tab.getPendingDialog()?.message).toBe('first');

    const confirm2 = mockDialog('confirm', 'second');
    handlers.get('dialog')!(confirm2);
    await vi.advanceTimersByTimeAsync(0);
    expect(confirm2.accept).toHaveBeenCalledTimes(1);
  });

  it('T7: a rejected policy accept ("No dialog is showing") never produces an unhandled rejection, and is recorded with .error', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page, undefined, undefined, {
      mode: 'accept',
    });
    const confirm = mockDialog('confirm');
    confirm.accept = vi.fn().mockRejectedValue(new Error('No dialog is showing'));
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      handlers.get('dialog')!(confirm);
      await vi.advanceTimersByTimeAsync(0);
      expect(onUnhandled).not.toHaveBeenCalled();
      const history = tab.getDialogHistory();
      expect(history[0]?.error).toContain('No dialog is showing');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('T8: handleDialog("accept","Ada") records handledBy:"caller"', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page, undefined, undefined, {
      mode: 'report',
    });
    const prompt = mockDialog('prompt', 'name?');
    handlers.get('dialog')!(prompt);
    await tab.handleDialog('accept', 'Ada');
    const history = tab.getDialogHistory();
    expect(history[0]).toMatchObject({ handledBy: 'caller', promptText: 'Ada', action: 'accept' });
  });

  it('T9: dialog history is bounded to MAX_DIALOG_HISTORY (50), dropping the oldest', async () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page, undefined, undefined, {
      mode: 'accept',
    });
    for (let i = 0; i < 60; i++) {
      const d = mockDialog('confirm', `m${i}`);
      handlers.get('dialog')!(d);
      await vi.advanceTimersByTimeAsync(0);
    }
    const history = tab.getDialogHistory();
    expect(history).toHaveLength(50);
    expect(history[0]?.message).toBe('m10');
  });

  it('T10: getPendingDialogDetail includes url/openedAt; getPendingDialog keeps its exact 3-key shape', () => {
    const { page, handlers } = mockPage();
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, page, undefined, undefined, {
      mode: 'report',
    });
    const confirm = mockDialog('confirm', 'hi', 'def');
    handlers.get('dialog')!(confirm);
    expect(tab.getPendingDialog()).toEqual({ dialogType: 'confirm', message: 'hi', defaultValue: 'def' });
    const detail = tab.getPendingDialogDetail();
    expect(detail).toMatchObject({ dialogType: 'confirm', message: 'hi', defaultValue: 'def', url: 'https://example.com' });
    expect(typeof detail?.openedAt).toBe('string');
  });
});
