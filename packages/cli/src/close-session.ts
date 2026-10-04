/**
 * @file packages/cli/src/close-session.ts
 * @description The order of `close` (and of session self-heal) for a Chrome this CLI spawned:
 *
 *   1. kill the Chrome process tree (awaited; the same blind `killChromeTree` as 0.6.0),
 *   2. CLEAR the recorded session state (so no `chromePid` is persisted from here on),
 *   3. only then run the bounded temp-profile cleanup (GAP-315, up to ~15 s).
 *
 * Why this order: the cleanup can be slow (Windows file locks) or interrupted (Ctrl-C). If the
 * state still recorded `chromePid` while it ran, a later `close` or self-heal would `taskkill /T /F`
 * whatever process had meanwhile been given that PID. With the state cleared first, an interrupted
 * cleanup leaves at worst a leaked temp dir (retried by the next session start's sweep), never a
 * stale PID. This module changes ORDER only: the kill function, its arguments and the exit codes
 * are exactly as in 0.6.0 (the callers decide exit codes; this function never throws).
 */
import type { CliState } from './state.js';
import { CLOSE_CLEANUP_DEADLINE_MS } from './temp-profile.js';

/** Hard cap handed to the kill (it resolves when `taskkill` exits, or at this cap). */
export const KILL_CAP_MS = 10_000;

export interface StopDeps {
  /** `cli.ts` passes `killChromeTree` itself, by reference: the same function and semantics as 0.6.0. */
  kill(pid: number, timeoutMs: number): Promise<void>;
  clearState(): Promise<void>;
  /** The bounded profile cleanup. `chromePid` is used only for its read-only exit wait. */
  cleanup(target: { userDataDir?: string; tempProfile?: boolean }, chromePid: number | undefined, deadlineAt: number): Promise<void>;
  /** Monotonic clock. MUST be `performance.now()`-based: every temp-profile deadline is a
   *  `performance.now()` value (with `Date.now` the deadline would land ~1.7e12 ms away). */
  now?(): number;
  /** One diagnostics line (already prefixed `[cleanup] `); `cli.ts` prints it only under SUTRADHAR_CLI_DEBUG_CLEANUP=1. */
  debug?(line: string): void;
  warn?(message: string): void;
}

const msg = (err: unknown): string => (err as Error)?.message ?? String(err);

/** Never throws. See the file comment for the order and why. */
export async function stopSpawnedChrome(state: CliState, deps: StopDeps): Promise<void> {
  const now = deps.now ?? (() => performance.now());
  const debug = deps.debug ?? (() => {});
  const warn = deps.warn ?? ((m: string) => console.error(m));
  // A hand-corrupted state.json can hold anything: only a positive integer PID is ever killed.
  const rawPid: unknown = state.chromePid;
  const pid = typeof rawPid === 'number' && Number.isInteger(rawPid) && rawPid > 0 ? rawPid : undefined;

  if (pid !== undefined) {
    const t0 = now();
    try {
      await deps.kill(pid, KILL_CAP_MS);
    } catch (err) {
      debug(`[cleanup] kill-error message=${JSON.stringify(msg(err))}`);
    }
    debug(`[cleanup] phase kill ms=${Math.round(now() - t0)}`);
  } else if (rawPid !== undefined) {
    debug('[cleanup] skip-kill reason=invalid-chromePid'); // malformed PID: never passed to taskkill
  }

  try {
    await deps.clearState();
    debug('[cleanup] state-cleared');
  } catch (err) {
    warn(`Warning: could not clear the session state (${msg(err)}); run "sutradhar close" again if the next command misbehaves.`);
  }

  const dir: unknown = state.userDataDir;
  if (typeof dir === 'string' && state.tempProfile === true) {
    try {
      await deps.cleanup({ userDataDir: dir, tempProfile: true }, pid, now() + CLOSE_CLEANUP_DEADLINE_MS);
    } catch (err) {
      warn(`Warning: temp profile cleanup failed (${msg(err)}); a CLI session started 10 or more minutes from now will retry it.`);
    }
  }
}
