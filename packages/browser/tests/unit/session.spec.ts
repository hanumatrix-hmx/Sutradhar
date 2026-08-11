/**
 * @file packages/browser/tests/unit/session.spec.ts
 * @description Unit tests for BrowserTab, BrowserSession, and BrowserSessionManager.
 */

import { BrowserSessionManager, BrowserSession, BrowserTab, BrowserLauncher } from '../../src/index.js';
import { EventBus } from '@sutradhar/events';
import { createSessionId, createTabId } from '@sutradhar/contracts';
import type { Page } from 'puppeteer-core';

describe('@sutradhar/browser Session Management & Tab Lifecycle', () => {
  it('should create and navigate browser tabs', async () => {
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example');

    expect(tab.id).toBe('tab_1');
    expect(tab.url).toBe('https://example.com');
    expect(tab.isActive).toBe(true);

    const navResult = await tab.navigate('https://sutradhar.dev');
    expect(navResult.url).toBe('https://sutradhar.dev');

    // This tab has no live Puppeteer page (mock/no-Chrome bookkeeping-only tab) — every
    // action except 'navigate' must report failure rather than fabricating success.
    const actionResult = await tab.executeAction({
      type: 'click',
      targetElementId: 42,
    });
    expect(actionResult.success).toBe(false);
    expect(actionResult.error).toContain('No live browser page');

    await tab.close();
    const failedAction = await tab.executeAction({ type: 'click' });
    expect(failedAction.success).toBe(false);
  });

  it('should reflect the live page URL even when the page navigated without going through tab.navigate()', async () => {
    // Simulates a click-triggered form POST/redirect: the page's own URL changes, but
    // nothing calls tab.navigate() to tell the tab object about it.
    let livePageUrl = 'https://the-internet.herokuapp.com/login';
    const mockPage = {
      url: () => livePageUrl,
      isClosed: () => false,
      on: () => mockPage,
    } as unknown as Page;

    const tab = new BrowserTab(createTabId('tab_1'), livePageUrl, 'Login', true, mockPage);
    expect(tab.url).toBe('https://the-internet.herokuapp.com/login');

    livePageUrl = 'https://the-internet.herokuapp.com/secure';
    expect(tab.url).toBe('https://the-internet.herokuapp.com/secure');
  });

  it('should manage multi-tab lifecycle within BrowserSession', async () => {
    const bus = new EventBus();
    const events: string[] = [];

    bus.subscribe('browser:page:navigated', (e) => {
      events.push(e.payload.tabId);
    });

    const session = new BrowserSession(createSessionId('sess_123'), false, bus);

    const tab1 = await session.createTab('https://page1.com');
    const tab2 = await session.createTab('https://page2.com');

    expect(session.getTabs().length).toBe(2);
    expect(session.activeTabId).toBe(tab1.id);

    session.setActiveTab(tab2.id);
    expect(session.activeTabId).toBe(tab2.id);

    await session.closeTab(tab1.id);
    expect(session.getTabs().length).toBe(1);

    await session.close('Test cleanup');
    expect(session.getTabs().length).toBe(0);
    expect(events.length).toBe(2);
  });

  it('should manage sessions via BrowserSessionManager', async () => {
    const bus = new EventBus();
    const createdSessions: string[] = [];

    bus.subscribe('browser:session:created', (e) => {
      createdSessions.push(e.payload.sessionId);
    });

    const manager = new BrowserSessionManager(undefined, bus);
    const session = await manager.createSession({
      isIncognito: true,
      initialUrl: 'https://initial.com',
    });

    expect(manager.getSessionCount()).toBe(1);
    expect(session.isIncognito).toBe(true);
    expect(session.getTabs().length).toBe(1);
    expect(createdSessions.length).toBe(1);

    await manager.closeSession(session.id);
    expect(manager.getSessionCount()).toBe(0);
  });

  it('should forward launch options (headless/viewport/etc.) to the launcher, not just isIncognito', async () => {
    const launcher = new BrowserLauncher();
    const launchSpy = vi.spyOn(launcher, 'launch').mockResolvedValue({
      isConnected: true,
      newPage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      onDisconnected: vi.fn(),
    } as any);

    const manager = new BrowserSessionManager(launcher);
    await manager.createSession({
      isIncognito: true,
      launch: { headless: false, viewport: { width: 1024, height: 768 } },
    });

    expect(launchSpy).toHaveBeenCalledWith({
      headless: false,
      viewport: { width: 1024, height: 768 },
      isIncognito: true,
    });
  });

  it('should auto-adopt a target=_blank popup as a new, inactive tab', async () => {
    const bus = new EventBus();
    const popupEvents: unknown[] = [];
    bus.subscribe('browser:popup:opened', (e) => popupEvents.push(e.payload));

    // The main page's `.on('popup', handler)` call is captured so the test can fire it,
    // simulating a real target=_blank click without a real browser.
    let popupHandler: ((page: Page) => void) | undefined;
    const mainPage = {
      isClosed: () => false,
      url: () => 'https://example.com',
      on: vi.fn((event: string, handler: any) => {
        if (event === 'popup') popupHandler = handler;
        return mainPage;
      }),
    } as unknown as Page;

    const popupPage = {
      isClosed: () => false,
      url: () => 'https://example.com/popup',
      on: vi.fn().mockReturnThis(),
    } as unknown as Page;

    const browserInstance = {
      isConnected: true,
      newPage: vi.fn().mockResolvedValue(mainPage),
      close: vi.fn(),
      onDisconnected: vi.fn(),
    } as any;

    const session = new BrowserSession(createSessionId('sess_popup'), false, bus, undefined, browserInstance);
    const mainTab = await session.createTab('https://example.com');

    expect(popupHandler).toBeDefined();
    popupHandler!(popupPage);
    // Popup adoption is async (fire-and-forget from the event handler) -- flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    expect(session.getTabs().length).toBe(2);
    const popupTab = session.getTabs().find((t) => t.id !== mainTab.id);
    expect(popupTab?.isActive).toBe(false);
    expect(popupTab?.url).toBe('https://example.com/popup');
    expect(popupEvents).toEqual([
      expect.objectContaining({ url: 'https://example.com/popup' }),
    ]);
  });

  it('adoptExistingPage wraps an already-open page as the active tab, instead of opening a new blank one', async () => {
    // Regression coverage for the attach()-reuse gap: a separate process attaching to the same
    // long-lived browser (the CLI's cross-invocation persistence mechanism) needs to pick up a
    // page a PRIOR process already navigated, not open yet another blank tab on top of it.
    const existingPage = {
      isClosed: () => false,
      url: () => 'https://example.com/already-here',
      on: vi.fn().mockReturnThis(),
    } as unknown as Page;

    const browserInstance = {
      isConnected: true,
      newPage: vi.fn(),
      close: vi.fn(),
      onDisconnected: vi.fn(),
    } as any;

    const session = new BrowserSession(createSessionId('sess_attach'), false, undefined, undefined, browserInstance);
    expect(session.getTabs().length).toBe(0);

    const adopted = await session.adoptExistingPage(existingPage);

    expect(session.getTabs().length).toBe(1);
    expect(adopted.url).toBe('https://example.com/already-here');
    expect(adopted.isActive).toBe(true);
    expect(session.activeTabId).toBe(adopted.id);
    // newPage() (which would create a fresh blank tab) must never have been called.
    expect(browserInstance.newPage).not.toHaveBeenCalled();
  });

  it('marks the session closed, clears its tabs, and publishes browser:session:crashed when Chrome disconnects unexpectedly', async () => {
    const bus = new EventBus();
    const crashEvents: unknown[] = [];
    bus.subscribe('browser:session:crashed', (e) => crashEvents.push(e.payload));

    let disconnectedCallback: (() => void) | undefined;
    const browserInstance = {
      isConnected: true,
      newPage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      onDisconnected: vi.fn((cb: () => void) => {
        disconnectedCallback = cb;
      }),
    } as any;

    const session = new BrowserSession(createSessionId('sess_crash'), false, bus, undefined, browserInstance);
    await session.createTab();
    expect(session.getTabs().length).toBe(1);

    expect(disconnectedCallback).toBeDefined();
    disconnectedCallback!();
    await new Promise((r) => setTimeout(r, 0));

    expect(session.getTabs().length).toBe(0);
    expect(crashEvents).toEqual([
      expect.objectContaining({ sessionId: 'sess_crash' }),
    ]);
  });

  it('executeAction implements hover/pressKey/evaluate for real against a live page (no fabricated success)', async () => {
    const mockPage = {
      url: () => 'https://example.com',
      isClosed: () => false,
      on: () => mockPage,
      hover: vi.fn().mockResolvedValue(undefined),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      evaluate: vi.fn().mockResolvedValue('the-real-result'),
    } as unknown as Page;
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, mockPage);

    const hoverResult = await tab.executeAction({ type: 'hover', targetSelector: '#el' });
    expect(hoverResult.success).toBe(true);
    expect((mockPage as any).hover).toHaveBeenCalledWith('#el');

    const pressResult = await tab.executeAction({ type: 'pressKey', key: 'Enter' });
    expect(pressResult.success).toBe(true);
    expect((mockPage as any).keyboard.press).toHaveBeenCalledWith('Enter');

    const evalResult = await tab.executeAction({ type: 'evaluate', expression: '1+1' });
    expect(evalResult.success).toBe(true);
    expect(evalResult.data).toEqual({ result: 'the-real-result' });
  });

  it('executeAction fails loudly (not fabricated success) for an unrecognized action type, even with a live page', async () => {
    const mockPage = {
      url: () => 'https://example.com',
      isClosed: () => false,
      on: () => mockPage,
    } as unknown as Page;
    const tab = new BrowserTab(createTabId('tab_1'), 'https://example.com', 'Example', true, mockPage);

    const result = await tab.executeAction({ type: 'some_future_unhandled_type' as any });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported action type');
  });

  it('BrowserSessionManager drops a session once it reports crashed', async () => {
    const bus = new EventBus();
    let disconnectedCallback: (() => void) | undefined;
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'launch').mockResolvedValue({
      isConnected: true,
      newPage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      onDisconnected: vi.fn((cb: () => void) => {
        disconnectedCallback = cb;
      }),
    } as any);

    const manager = new BrowserSessionManager(launcher, bus);
    const session = await manager.createSession();
    expect(manager.getSession(session.id)).toBeDefined();

    disconnectedCallback!();
    await new Promise((r) => setTimeout(r, 0));

    expect(manager.getSession(session.id)).toBeUndefined();
  });

  it('idle reaper is disabled by default — a session with no activity is never auto-closed', async () => {
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'launch').mockResolvedValue({
      isConnected: true,
      newPage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      onDisconnected: vi.fn(),
    } as any);

    const manager = new BrowserSessionManager(launcher);
    const session = await manager.createSession();
    await new Promise((r) => setTimeout(r, 20));

    expect(manager.getSession(session.id)).toBeDefined();
    manager.stopIdleReaper();
  });

  it('reaps a session once it has been idle past idleTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const launcher = new BrowserLauncher();
      const closeMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(launcher, 'launch').mockResolvedValue({
        isConnected: true,
        newPage: vi.fn().mockResolvedValue(undefined),
        close: closeMock,
        onDisconnected: vi.fn(),
      } as any);

      const manager = new BrowserSessionManager(launcher, undefined, undefined, 1000);
      const session = await manager.createSession();
      expect(manager.getSession(session.id)).toBeDefined();

      // Advance past the idle timeout and let the reaper's interval fire.
      await vi.advanceTimersByTimeAsync(1500);

      expect(manager.getSession(session.id)).toBeUndefined();
      manager.stopIdleReaper();
    } finally {
      vi.useRealTimers();
    }
  });
});
