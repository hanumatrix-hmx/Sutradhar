/**
 * @file apps/server/src/routes/memory-routes.ts
 * @description Thin HTTP route controller delegating exclusively to MemoryApplicationService.
 */

import { MemoryRecordDto, MemorySearchQueryDto } from '@pinchtab/contracts';
import { MemoryApplicationService } from '../application/memory-app-service.js';
import { ApiRouter } from '../gateway/api-router.js';

export function registerMemoryRoutes(router: ApiRouter, service: MemoryApplicationService): void {
  router.post('/api/v1/memory/records', async (req, res) => {
    const record = req.body as MemoryRecordDto;
    if (!record || !record.id || !record.content) {
      res.status(400).json({ error: 'Missing required record payload' });
      return;
    }

    const id = await service.storeRecord(record);
    res.status(201).json({ success: true, id });
  });

  router.post('/api/v1/memory/search', async (req, res) => {
    const query = req.body as MemorySearchQueryDto;
    if (!query || !query.query) {
      res.status(400).json({ error: 'Missing required search query' });
      return;
    }

    const results = await service.search(query);
    res.status(200).json(results);
  });
}
