/**
 * @file apps/server/src/routes/run-routes.ts
 * @description Thin HTTP route controller for async agent runs (Phase 4 + 5).
 *
 * Endpoints:
 *   POST   /api/v1/runs                 → start a run; returns { runId } immediately
 *   GET    /api/v1/runs                 → history list (?sessionId=&status=&from=&to=)
 *   GET    /api/v1/runs/:runId          → run record (live or persisted)
 *   DELETE /api/v1/runs/:runId          → explicit deletion (UI confirms first)
 *   POST   /api/v1/runs/:runId/cancel   → cancel a running run end-to-end
 *   GET    /api/v1/runs/:runId/events   → SSE stream of real run frames
 */

import { RunManager, RunFrame } from '../application/run-manager.js';
import { ApiRouter } from '../gateway/api-router.js';

export function registerRunRoutes(router: ApiRouter, manager: RunManager): void {
  router.post('/api/v1/runs', async (req, res) => {
    const body = (req.body as { goal?: string; sessionId?: string }) ?? {};
    if (!body.goal) {
      res.status(400).json({ error: 'Missing required field: goal' });
      return;
    }

    // Server-assigned runId — the client never invents identifiers.
    const runId = manager.startRun({
      goal: body.goal,
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    });
    res.status(201).json({ runId });
  });

  // History listing — storage-backed, survives restarts (Phase 5).
  router.get('/api/v1/runs', async (req, res) => {
    const q = req.query ?? {};
    const runs = await manager.listRuns({
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
    res.status(200).json({ runs });
  });

  router.get('/api/v1/runs/:runId', async (req, res) => {
    const record = await manager.getRunRecord(req.params?.runId ?? '');
    if (!record) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.status(200).json(record);
  });

  router.delete('/api/v1/runs/:runId', async (req, res) => {
    const runId = req.params?.runId ?? '';
    const outcome = await manager.deleteRun(runId);
    if (outcome === 'not-found') {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (outcome === 'running') {
      // Honesty doctrine: a live run is cancelled, never deleted out from
      // under the loop. The UI offers Cancel for that case.
      res.status(409).json({ error: 'Run is still executing — cancel it first' });
      return;
    }
    res.status(200).json({ runId, deleted: true });
  });

  router.post('/api/v1/runs/:runId/cancel', async (req, res) => {
    const runId = req.params?.runId ?? '';
    const run = manager.getRun(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const accepted = manager.cancelRun(runId);
    // Idempotent: cancelling a finished run is a no-op, not an error.
    res.status(200).json({ runId, cancelled: accepted, status: run.status });
  });

  router.get('/api/v1/runs/:runId/events', async (req, res) => {
    const runId = req.params?.runId ?? '';
    const run = manager.getRun(runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (!res.stream || !res.writeChunk || !res.endStream) {
      // Mock/test transport without streaming support — honest fallback.
      res.status(501).json({ error: 'SSE streaming not supported by this transport' });
      return;
    }

    res.status(200);
    res.stream({ contentType: 'text/event-stream', headers: { 'X-Accel-Buffering': 'no' } });

    let closed = false;
    // eslint-disable-next-line prefer-const -- synchronous subscribe replay can call cleanup before the unsubscribe function is returned.
    let unsubscribe: (() => void) | undefined;
    // eslint-disable-next-line prefer-const -- cleanup must be callable before the heartbeat starts.
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const send = (frame: RunFrame): void => {
      res.writeChunk!(`id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
    };

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      res.endStream!();
    };

    // Replay happens synchronously inside subscribe; then live frames follow.
    unsubscribe = manager.subscribe(runId, (frame) => {
      send(frame);
      // The terminal frame is the last thing a client needs — close the
      // stream so nothing lingers on the server side.
      if (frame.event === 'result') {
        cleanup();
      }
    });
    if (!unsubscribe) {
      cleanup();
      return;
    }
    // Run finished before the client connected: the replay above already
    // delivered the terminal 'result' frame and closed the stream.
    if (closed) {
      unsubscribe();
      return;
    }

    // Heartbeat keeps proxies/sockets honest during long LLM turns.
    heartbeat = setInterval(() => {
      res.writeChunk!(': hb\n\n');
    }, 15000);

    res.onClose?.(cleanup);
  });
}
