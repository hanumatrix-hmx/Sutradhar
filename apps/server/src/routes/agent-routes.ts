/**
 * @file apps/server/src/routes/agent-routes.ts
 * @description Thin HTTP route controller delegating exclusively to AgentApplicationService.
 */

import { AgentApplicationService } from '../application/agent-app-service.js';
import { ApiRouter } from '../gateway/api-router.js';

export function registerAgentRoutes(router: ApiRouter, service: AgentApplicationService): void {
  router.post('/api/v1/agents/goals', async (req, res) => {
    const body = (req.body as { goal?: string; sessionId?: string }) ?? {};
    if (!body.goal) {
      res.status(400).json({ error: 'Missing required field: goal' });
      return;
    }

    try {
      const dto = await service.executeGoal({
        goal: body.goal,
        ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      });
      // runId = the server-assigned goal execution id, surfaced explicitly
      // so the client never invents its own identifiers.
      res.status(200).json({ ...dto, runId: dto.id });
    } catch (err) {
      // The real agent loop throws clearly when its dependencies (LLM, browser)
      // are missing or unreachable. Surface that as a 503 rather than crashing.
      res.status(503).json({
        error: 'Agent execution failed',
        message: (err as Error).message,
      });
    }
  });

  router.get('/api/v1/agents/status', async (_req, res) => {
    res.status(200).json(service.getStatus());
  });
}
