/**
 * @file packages/frontend/tests/unit/adapter.spec.ts
 * @description Contract test suite for Frontend Milestone 5 Browser Adapter Framework.
 */

import { describe, it, expect } from 'vitest';
import { MockBrowserAdapter } from '../_mocks/MockBrowserAdapter.js';
import { ServerBrowserAdapter } from '../../src/runtime/browser/adapters/serverBrowserAdapter.js';
import {
  DirectBrowserTransport,
  HttpBrowserTransport,
} from '../../src/runtime/browser/adapters/browserTransport.js';
import { BrowserRuntime } from '../../src/runtime/browser/browserRuntime.js';
import { BrowserSession } from '../../src/runtime/browser/browserSession.js';
import { isBackendReachable } from '../_helpers/live-stack.js';

describe('@sutradhar/frontend Milestone 5 — Browser Adapter Framework', () => {
  it('1. should satisfy IBrowserAdapter contract for MockBrowserAdapter', async () => {
    const mockAdapter = new MockBrowserAdapter();
    expect(mockAdapter.id).toBe('mock-adapter');
    expect(mockAdapter.name).toContain('Mock');

    const launchRes = await mockAdapter.launch('sess_mock_1', 'https://github.com');
    expect(launchRes.status).toBe('running');

    const navRes = await mockAdapter.navigate('sess_mock_1', 'tab_1', 'https://google.com');
    expect(navRes.url).toBe('https://google.com');
    expect(navRes.title).toBe('Google Search');

    const screenshot = await mockAdapter.captureScreenshot('sess_mock_1', 'tab_1');
    expect(screenshot).toContain('data:image/png');

    const evalResult = await mockAdapter.executeScript('sess_mock_1', 'tab_1', 'console.log(1)');
    expect(evalResult).toEqual({ success: true, result: 'mock_exec_result' });

    await mockAdapter.shutdown('sess_mock_1');
  });

  it('2. should satisfy IBrowserAdapter contract for ServerBrowserAdapter via IBrowserTransport', async () => {
    // Static contract checks always run.
    const transport = new HttpBrowserTransport('http://localhost:8081');
    const serverAdapter = new ServerBrowserAdapter(transport);
    expect(serverAdapter.id).toBe('server-adapter');
    expect(serverAdapter.name).toContain('@sutradhar/browser');

    // The live launch/navigate requires a real backend; skip when unreachable.
    if (!(await isBackendReachable('http://localhost:8081'))) return;

    const launchRes = await serverAdapter.launch('sess_server_1');
    expect(launchRes.status).toBe('running');

    const navRes = await serverAdapter.navigate('sess_server_1', 'tab_1', 'https://github.com');
    // Real browsers normalize URLs (e.g. add a trailing slash); compare loosely.
    expect(navRes.url.replace(/\/+$/, '')).toBe('https://github.com');

    await serverAdapter.shutdown('sess_server_1');
  });

  it('3. should inject IBrowserAdapter into BrowserRuntime and BrowserSession', async () => {
    const customMockAdapter = new MockBrowserAdapter();
    const runtime = new BrowserRuntime('sess_injected', customMockAdapter);

    expect(runtime.adapter).toBe(customMockAdapter);

    await runtime.launch();
    expect(runtime.status).toBe('running');

    const session = new BrowserSession(
      'sess_injected_session',
      'https://vitejs.dev',
      customMockAdapter,
    );
    expect(session.adapter).toBe(customMockAdapter);

    session.navigateTab(session.getActiveTab()!.id, 'https://react.dev');
    expect(session.getActiveTab()?.url).toBe('https://react.dev');

    await runtime.shutdown();
    expect(runtime.status).toBe('stopped');
  });

  it('4. should route transport events across IBrowserTransport implementations', async () => {
    const directTransport = new DirectBrowserTransport();
    let eventFired = false;

    directTransport.on('test_event', (payload) => {
      expect(payload.data).toBe('hello');
      eventFired = true;
    });

    directTransport.emit('test_event', { data: 'hello' });
    expect(eventFired).toBe(true);
  });
});
