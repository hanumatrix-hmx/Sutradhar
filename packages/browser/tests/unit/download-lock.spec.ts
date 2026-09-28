/**
 * @file packages/browser/tests/unit/download-lock.spec.ts
 * @description Unit tests for the FR2-05 fix-2 (GAP-301/GAP-302) cross-process, fail-fast
 * download lock. The lock lives on disk keyed by the browser's wsEndpoint, so two `acquire`
 * calls with the same endpoint from THIS process already exercise the identical code path a
 * second, separate OS process would hit — the lock file has no notion of process identity
 * beyond the informational PID it writes, which is why this is a real cross-process guarantee,
 * not merely an in-process one (see `browser-action-engine.spec.ts`'s own live, real-second-
 * process cross-process test for the end-to-end confirmation).
 */

import crypto from 'node:crypto';
import { acquireDownloadLock, DownloadInProgressError } from '../../src/actions/download-lock.js';

function uniqueEndpoint(): string {
  return `ws://mock/${crypto.randomBytes(8).toString('hex')}`;
}

describe('@sutradhar/browser download-lock', () => {
  it('DL1: a second acquire on the same wsEndpoint fails fast (no waiting) while the first is held', async () => {
    const ep = uniqueEndpoint();
    const first = await acquireDownloadLock(ep);
    const start = Date.now();
    await expect(acquireDownloadLock(ep)).rejects.toBeInstanceOf(DownloadInProgressError);
    // "Fails fast" — must not have waited anywhere close to a retry/backoff window.
    expect(Date.now() - start).toBeLessThan(500);
    await first.release();
  });

  it('DL2: after release, a new acquire on the same endpoint succeeds', async () => {
    const ep = uniqueEndpoint();
    const first = await acquireDownloadLock(ep);
    await first.release();
    const second = await acquireDownloadLock(ep);
    await second.release();
  });

  it('DL3: different wsEndpoints never contend with each other', async () => {
    const a = await acquireDownloadLock(uniqueEndpoint());
    const b = await acquireDownloadLock(uniqueEndpoint());
    await a.release();
    await b.release();
  });

  it('DL4: release is idempotent and safe to call more than once', async () => {
    const ep = uniqueEndpoint();
    const lock = await acquireDownloadLock(ep);
    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
  });

  it('DL5: two concurrent acquire attempts on the same endpoint — exactly one wins, the other fails fast', async () => {
    const ep = uniqueEndpoint();
    const results = await Promise.allSettled([acquireDownloadLock(ep), acquireDownloadLock(ep)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DownloadInProgressError);
    await (fulfilled[0] as PromiseFulfilledResult<{ release(): Promise<void> }>).value.release();
  });

  it('DL6: DownloadInProgressError has a clear, actionable message', async () => {
    const ep = uniqueEndpoint();
    const first = await acquireDownloadLock(ep);
    try {
      await acquireDownloadLock(ep);
      throw new Error('expected acquireDownloadLock to reject');
    } catch (err) {
      expect((err as Error).message).toContain('already in progress');
      expect((err as Error).message).toContain('not supported');
    } finally {
      await first.release();
    }
  });
});
