/**
 * @file apps/server/src/routes/session-routes.ts
 * @description Thin HTTP route controller delegating exclusively to SessionApplicationService.
 */

import { createSessionId } from '@sutradhar/contracts';
import { SessionApplicationService } from '../application/session-app-service.js';
import { ApiRouter } from '../gateway/api-router.js';

export function registerSessionRoutes(router: ApiRouter, service: SessionApplicationService): void {
  router.post('/api/v1/sessions', async (req, res) => {
    const body = (req.body as { isIncognito?: boolean; initialUrl?: string; sessionId?: string }) ?? {};
    const dto = await service.createSession({
      isIncognito: body.isIncognito,
      initialUrl: body.initialUrl,
      // Caller-supplied id lets the UI bind its session to the backend
      // browser session (one session per UI session — no orphan browsers).
      ...(body.sessionId ? { sessionId: createSessionId(body.sessionId) } : {}),
    });
    res.status(201).json(dto);
  });

  router.get('/api/v1/sessions', async (_req, res) => {
    const sessions = await service.listSessions();
    res.status(200).json(sessions);
  });

  router.get('/api/v1/sessions/:id', async (req, res) => {
    const sessionId = createSessionId(req.params?.id ?? '');
    const dto = await service.getSession(sessionId);

    if (!dto) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }

    res.status(200).json(dto);
  });

  router.delete('/api/v1/sessions/:id', async (req, res) => {
    const sessionId = createSessionId(req.params?.id ?? '');
    await service.closeSession(sessionId);
    res.status(200).json({ success: true, sessionId });
  });
}
