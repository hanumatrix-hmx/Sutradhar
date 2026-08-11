/**
 * @file apps/server/src/routes/workflow-routes.ts
 * @description Thin HTTP route controller delegating exclusively to WorkflowApplicationService.
 */

import { WorkflowNodeDto } from '@pinchtab/workflow';
import { WorkflowApplicationService } from '../application/workflow-app-service.js';
import { ApiRouter } from '../gateway/api-router.js';

export function registerWorkflowRoutes(
  router: ApiRouter,
  service: WorkflowApplicationService,
): void {
  router.post('/api/v1/workflows/run', async (req, res) => {
    const body =
      (req.body as {
        name?: string;
        nodes?: readonly WorkflowNodeDto[];
        initialInputs?: Record<string, unknown>;
      }) ?? {};

    if (!body.nodes || body.nodes.length === 0) {
      res.status(400).json({ error: 'Missing required field: nodes' });
      return;
    }

    const result = await service.executeWorkflow({
      name: body.name,
      nodes: body.nodes,
      initialInputs: body.initialInputs,
    });

    res.status(200).json(result);
  });
}
