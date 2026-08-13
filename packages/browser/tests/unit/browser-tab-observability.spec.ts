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
