/**
 * @file apps/server/tests/integration/liveBrowserIntegration.spec.ts
 * @description Integration test suite for backend /api/v1/browser/* REST API endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DependencyContainer } from '../../src/runtime/dependency-container.js';

describe('apps/server REST API /api/v1/browser Gateway', () => {
  let container: DependencyContainer;

  beforeEach(() => {
    container = new DependencyContainer();
  });

  afterEach(async () => {
    await container.sessionManager.closeAllSessions();
  });

  it('1. should handle /api/v1/browser/launch and return active session ID', async () => {
    const res = await container.serverApp.router.dispatch('POST', '/api/v1/browser/launch', {
      body: { sessionId: 'sess_live_1', initialUrl: 'https://github.com' },
    });
    expect(res.statusCode).toBe(200);

    const data = res.body as { sessionId: string; status: string };
    expect(data.sessionId).toBeDefined();
    expect(data.status).toBe('running');
  });

  it('2. should handle /api/v1/browser/navigate and navigate live session', async () => {
    await container.sessionManager.createSession({ initialUrl: 'https://github.com' });
    const sessions = container.sessionManager.getAllSessions();
    const sessionId = sessions[0]!.id;

    const res = await container.serverApp.router.dispatch('POST', '/api/v1/browser/navigate', {
      body: { sessionId, url: 'https://google.com' },
    });
    expect(res.statusCode).toBe(200);

    const data = res.body as { tabId: string; url: string; title: string };
    expect(data.url).toContain('google.com');
  });

  it('3. should handle /api/v1/browser/screenshot and return screenshot payload', async () => {
    const session = await container.sessionManager.createSession({
      initialUrl: 'https://github.com',
    });

    const res = await container.serverApp.router.dispatch('POST', '/api/v1/browser/screenshot', {
      body: { sessionId: session.id },
    });
    expect(res.statusCode).toBe(200);

    const data = res.body as { screenshotData: string };
    expect(data.screenshotData).toContain('data:image/png;base64,');
  });

  it('4. should handle /api/v1/browser/eval and execute JS evaluation', async () => {
    const session = await container.sessionManager.createSession({
      initialUrl: 'https://github.com',
    });

    const res = await container.serverApp.router.dispatch('POST', '/api/v1/browser/eval', {
      body: { sessionId: session.id, code: 'document.title' },
    });
    expect(res.statusCode).toBe(200);

    const data = res.body as { success: boolean };
    expect(data.success).toBe(true);
  });
});
