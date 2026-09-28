/**
 * @file packages/browser/src/actions/download-lock.ts
 * @description Cross-process, fail-fast serialization for `download_file` against one real
 * browser instance — FR2-05 fix-2, GAP-301/GAP-302.
 *
 * `Browser.setDownloadBehavior` is a browser-WIDE CDP setting, not per-tab/per-session (see
 * {@link ../actions/browser-action-engine.ts}'s `runDownloadFileLocked` doc comment). fix-1
 * serialized concurrent `download_file` calls with an in-process `WeakMap<Browser, Promise>`
 * queue — audit-2 (GAP-301) confirmed that queue provides ZERO protection when two SEPARATE
 * processes (two `sutradhar-mcp` server instances, or two CLI invocations — every CLI verb is
 * its own process) attach to the same real Chrome instance: 2/10 trials escaped to the user's
 * real `~/Downloads`, 2/10 cross-wrote one process's downloaded file into the OTHER process's
 * configured root.
 *
 * This lock lives on disk, keyed by the browser's own CDP websocket endpoint (stable across
 * every process attached to that one Chrome instance, not just within one process), so it's
 * visible to and enforced against every process that might call `download_file` on that
 * browser — same-process AND cross-process.
 *
 * fix-1's queue also let a caller wait indefinitely for its turn, which (compounded by
 * GAP-301's other causes) meant a queued call could sit behind an abandoned, still-running
 * dispatch for the ENTIRE outer retry loop's budget (audit-2 GAP-302: 0/47 concurrent trials
 * succeeded, ~100s each). Per fix-2's binding decision (2b), this lock does the opposite:
 * a second `download_file` call on a browser that already has one in flight is rejected
 * OUTRIGHT and immediately (typically <20ms), rather than silently queued into a lock that
 * (per GAP-301) didn't actually protect anything anyway. Concurrent downloads on one browser
 * are documented as unsupported; callers needing more than one concurrent download must use
 * separate browser instances/tabs are still serialized, just explicitly and fast instead of
 * silently and slowly.
 */

import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { open, unlink, stat, readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';

/** A lock held longer than this is assumed to belong to a crashed/killed process rather than a
 *  genuinely slow download — `download_file`'s own inner timeout is 30s, and the outer engine
 *  retries at most twice, so anything alive should release well within this window. Set well
 *  above that combined budget so a live, merely-slow holder is never stolen from underneath it. */
const STALE_LOCK_MS = 5 * 60 * 1000;

function locksDir(): string {
  const dir = path.join(os.tmpdir(), 'sutradhar-download-locks');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // best effort; `open(..., 'wx')` below will surface any real problem.
  }
  return dir;
}

/** Stable across every process attached to the SAME real browser instance — the whole point of
 *  keying the lock file by this instead of any in-process object identity. */
function lockPathFor(wsEndpoint: string): string {
  const hash = crypto.createHash('sha256').update(wsEndpoint).digest('hex').slice(0, 32);
  return path.join(locksDir(), `download-${hash}.lock`);
}

export interface DownloadLockHandle {
  release(): Promise<void>;
}

export class DownloadInProgressError extends Error {
  public constructor(wsEndpoint: string) {
    super(
      'download_file is already in progress on this browser instance. Concurrent download_file ' +
        'calls against the SAME browser are not supported (Browser.setDownloadBehavior is a ' +
        'browser-wide CDP setting, not per-tab) — retry after the in-flight download finishes, ' +
        'or use a separate browser instance for a second concurrent download.',
    );
    this.name = 'DownloadInProgressError';
    void wsEndpoint;
  }
}

/**
 * Acquires the download lock for `wsEndpoint`, FAILING FAST (no waiting/queueing) if another
 * process — or this same one — already holds it. Throws {@link DownloadInProgressError} on
 * contention. A lock older than {@link STALE_LOCK_MS} is treated as abandoned (its holder
 * crashed without releasing it) and is stolen after one retry.
 */
export async function acquireDownloadLock(wsEndpoint: string): Promise<DownloadLockHandle> {
  const lockPath = lockPathFor(wsEndpoint);
  const payload = `${process.pid}:${Date.now()}`;

  const tryCreate = async (): Promise<boolean> => {
    try {
      const fh = await open(lockPath, 'wx');
      try {
        await fh.writeFile(payload);
      } finally {
        await fh.close();
      }
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  };

  if (await tryCreate()) {
    return makeHandle(lockPath, payload);
  }

  // Contended. Check staleness exactly once — a crashed holder must not wedge this browser's
  // downloads forever — then fail fast either way (never wait/poll/queue).
  let stale = false;
  try {
    const st = await stat(lockPath);
    stale = Date.now() - st.mtimeMs > STALE_LOCK_MS;
  } catch {
    // Lock file vanished between the failed create and this stat (the other holder released it
    // concurrently) — try once more below.
    stale = true;
  }
  if (stale) {
    await unlink(lockPath).catch(() => {});
    if (await tryCreate()) {
      return makeHandle(lockPath, payload);
    }
  }
  throw new DownloadInProgressError(wsEndpoint);
}

function makeHandle(lockPath: string, payload: string): DownloadLockHandle {
  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      // Only remove the lock file if it's still the one we created — defends against a narrow
      // window where a stale-lock steal raced with this release (best effort; a lock file is
      // only ever a serialization aid within one browser instance's lifetime, not a source of
      // truth for anything security-relevant on its own).
      try {
        const onDisk = await readFile(lockPath, 'utf8');
        if (onDisk === payload) await unlink(lockPath);
      } catch {
        // Already gone, or unreadable — nothing more to do.
      }
    },
  };
}
