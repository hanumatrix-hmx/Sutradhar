/**
 * @file apps/server/tests/unit/gateway.spec.ts
 * @description Unit tests for ApiRouter matching, path parameter extraction, and ServerApp health check endpoint.
 */

import { ServerApp, ApiRouter, MockApiResponse, SERVER_VERSION } from '../../src/index.js';

describe('@sutradhar/server REST API Gateway & Server Shell', () => {
  it('should export correct package version constant', () => {
    expect(SERVER_VERSION).toBe('0.1.0');
  });

  it('should register routes and match path parameters in ApiRouter', async () => {
    const router = new ApiRouter();

    router.get('/api/v1/sessions/:id', async (req, res) => {
      res.status(200).json({ sessionId: req.params?.id });
    });

    const res = await router.dispatch('GET', '/api/v1/sessions/sess_999');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sessionId: 'sess_999' });
  });

  it('should start ServerApp and handle system health check endpoint', async () => {
    const app = new ServerApp({ port: 9090 });
    await app.start();
    expect(app.isServerRunning).toBe(true);

    const res = await app.handleRequest('GET', '/health');
    expect(res.statusCode).toBe(200);

    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.service).toBe('@sutradhar/server');

    await app.stop();
    expect(app.isServerRunning).toBe(false);
  });
});
