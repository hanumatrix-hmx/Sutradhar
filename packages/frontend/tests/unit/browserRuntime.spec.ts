/**
 * @file packages/frontend/tests/unit/browserRuntime.spec.ts
 * @description Unit test suite for Frontend Milestone 4 Browser Runtime, Manager, Session & Capability API.
 */

import { describe, it, expect } from 'vitest';
import { BrowserRuntime } from '../../src/runtime/browser/browserRuntime.js';
import { BrowserSession } from '../../src/runtime/browser/browserSession.js';
import { BrowserManager } from '../../src/runtime/browser/browserManager.js';
import { BrowserCapabilityAPI } from '../../src/runtime/browser/browserCapabilityAPI.js';
import { MockBrowserAdapter } from '../_mocks/MockBrowserAdapter.js';
import { isBackendReachable } from '../_helpers/live-stack.js';

describe('@sutradhar/frontend Milestone 4 — Browser Runtime Engine & Manager', () => {
  it('1. should launch, report status, and shutdown BrowserRuntime', async () => {
    const runtime = new BrowserRuntime('test_sess_1');
    expect(runtime.status).toBe('stopped');

    // launch/shutdown drive the REAL backend (ServerBrowserAdapter). Skip the
    // live portion when no backend is running; the static status check above
    // still validates the initial contract.
    if (!(await isBackendReachable('http://localhost:8081'))) return;

    await runtime.launch();
    expect(runtime.status).toBe('running');

    await runtime.shutdown();
    expect(runtime.status).toBe('stopped');
  });

  it('2. should manage tabs, navigation history, and focus in BrowserSession', () => {
    const session = new BrowserSession('test_sess_2', 'https://github.com');
    expect(session.getTabs().length).toBe(1);

    const initialTab = session.getActiveTab();
    expect(initialTab?.url).toBe('https://github.com');

    // Create new tab
    const newTab = session.createTab('https://google.com', 'Google');
    expect(session.getTabs().length).toBe(2);
    expect(session.getActiveTab()?.id).toBe(newTab.id);

    // Focus tab
    session.focusTab(initialTab!.id);
    expect(session.getActiveTab()?.id).toBe(initialTab!.id);

    // Navigate tab
    session.navigateTab(initialTab!.id, 'https://news.ycombinator.com');
    expect(session.getActiveTab()?.url).toBe('https://news.ycombinator.com');

    // Close tab
    session.closeTab(newTab.id);
    expect(session.getTabs().length).toBe(1);
  });

  it('3. should create, serialize, and deserialize BrowserSnapshot', () => {
    const session = new BrowserSession('test_sess_3', 'https://github.com');
    session.createTab('https://vitejs.dev', 'Vite');

    const snap = session.createSnapshot();
    expect(snap.version).toBe('1.0.0');
    expect(snap.windows[0]?.tabs.length).toBe(2);

    const serialized = session.serialize();
    expect(typeof serialized).toBe('string');

    const restoredSession = new BrowserSession('test_sess_3_restored');
    restoredSession.deserialize(serialized);
    expect(restoredSession.getTabs().length).toBe(2);
  });

  it('4. should manage central registry via BrowserManager', () => {
    const manager = BrowserManager.getInstance();
    const bs1 = manager.getOrCreateBrowser('sess_mgr_1');
    expect(bs1).toBeDefined();

    const bs2 = manager.getOrCreateBrowser('sess_mgr_1');
    expect(bs2).toBe(bs1);

    const health = manager.healthCheck();
    expect(health.healthy).toBe(true);

    manager.destroyBrowser('sess_mgr_1');
    expect(manager.getBrowser('sess_mgr_1')).toBeUndefined();
  });

  it('5. should execute high-level BrowserCapabilityAPI operations', async () => {
    const session = new BrowserSession('test_sess_cap', 'https://github.com', new MockBrowserAdapter());
    const api = new BrowserCapabilityAPI(session);

    expect(api.getTabs().length).toBe(1);

    await api.openURL('https://news.ycombinator.com');
    expect(session.getActiveTab()?.url).toBe('https://news.ycombinator.com');

    const screenshot = await api.captureScreenshot();
    expect(screenshot).toContain('data:image/png');

    const evalResult = await api.executeJavaScript('console.log("hello")');
    expect(evalResult).toEqual({ success: true });
  });
});
