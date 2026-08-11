/**
 * @file apps/server/src/routes/storage-routes.ts
 * @description Thin HTTP route controller delegating exclusively to StorageApplicationService.
 */

import { StorageApplicationService } from '../application/storage-app-service.js';
import { ApiRouter } from '../gateway/api-router.js';

export function registerStorageRoutes(router: ApiRouter, service: StorageApplicationService): void {
  router.post('/api/v1/storage/files', async (req, res) => {
    const body = (req.body as { key?: string; content?: string }) ?? {};
    if (!body.key || !body.content) {
      res.status(400).json({ error: 'Missing required fields: key, content' });
      return;
    }

    const result = await service.storeFile({ key: body.key, content: body.content });
    res.status(201).json({ success: true, ...result });
  });

  router.get('/api/v1/storage/files', async (_req, res) => {
    const files = await service.listFiles();
    res.status(200).json({ files });
  });

  // GET by key (Phase 5 ask). Keys may contain '/' — clients encode them
  // (encodeURIComponent), so the whole key arrives as one path segment.
  router.get('/api/v1/storage/files/:key', async (req, res) => {
    let key = req.params?.key ?? '';
    try {
      key = decodeURIComponent(key);
    } catch {
      // Malformed encoding — use the raw value.
    }
    if (!key) {
      res.status(400).json({ error: 'Missing storage key' });
      return;
    }
    const content = await service.getFile(key);
    if (content === undefined) {
      res.status(404).json({ error: `File '${key}' not found` });
      return;
    }
    res.status(200).json({ key, content });
  });
}
