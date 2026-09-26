/**
 * @file packages/cli/src/profile-cleanup.ts
 * @description Guards and helpers for deleting a leaked throwaway Chrome profile directory —
 * the actual filesystem mutation surface of FR2-03's garbage collection. Every deletion in
 * `gc.ts` goes through `isOwnedTempProfileDir` first; nothing here ever touches a named profile
 * (`~/.sutradhar/profiles/*`) or anything outside the recognized temp-dir naming.
 */
import { rm } from 'node:fs/promises';
import { existsSync, lstatSync, realpathSync, renameSync } from 'node:fs';
import path from 'node:path';

/** A spawn's worst case (10s DevTools deadline + attach + writeState) is well under 30s — see
 *  FR2-03 spec §0.4 for the full "why 120s" reasoning. No environment knob: a test harness that
 *  needs a shorter grace backdates directory mtimes with `utimes` instead. */
export const GC_GRACE_MS = 120_000;

export const SUTRADHAR_TEMP_DIR_RE = /^sutradhar-cli-\d{10,}(?:-[A-Za-z0-9]{6})?$/;
export const PUPPETEER_TEMP_DIR_RE = /^puppeteer_dev_chrome_profile-[A-Za-z0-9]{6}$/;

/** Normalizes a path for identity comparison across a spawn and a later close/GC run: expands
 *  Windows 8.3 short names (`RUCHIK~1`) and macOS's `/var` -> `/private/var` symlink via
 *  `fs.realpathSync.native` when the path currently exists on disk, otherwise falls back to
 *  `path.resolve` (a dir that's already gone can still be compared, just less precisely).
 *  Strips trailing separators, and lower-cases on win32 only (case-insensitive filesystem). */
export function normalizePathForCompare(p: string, platform: NodeJS.Platform = process.platform): string {
  let resolved: string;
  try {
    resolved = existsSync(p) ? realpathSync.native(p) : path.resolve(p);
  } catch {
    resolved = path.resolve(p);
  }
  resolved = resolved.replace(/[/\\]+$/, '');
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * The single guard every deleter in this codebase must pass before removing a directory:
 * - it's a direct child of `tempRoot` (never nested, never the root itself)
 * - its basename matches the CLI or Puppeteer temp-dir naming (per `kind`)
 * - `lstat` says it's a real directory — not a symlink/junction, not a regular file
 */
export function isOwnedTempProfileDir(
  dir: string,
  tempRoot: string,
  kind: 'cli' | 'runtime' | 'any' = 'any',
): boolean {
  const normDir = normalizePathForCompare(dir);
  const normRoot = normalizePathForCompare(tempRoot);
  const parent = normalizePathForCompare(path.dirname(dir));
  if (parent !== normRoot) return false;
  if (normDir === normRoot) return false;

  const base = path.basename(dir);
  const isCliName = SUTRADHAR_TEMP_DIR_RE.test(base);
  const isPuppeteerName = PUPPETEER_TEMP_DIR_RE.test(base);
  if (kind === 'cli' && !isCliName) return false;
  if (kind === 'runtime' && !isPuppeteerName) return false;
  if (kind === 'any' && !isCliName && !isPuppeteerName) return false;

  let stat;
  try {
    stat = lstatSync(dir);
  } catch (err) {
    // A path that doesn't exist at all carries no symlink risk (the thing this lstat check
    // exists to catch) — so a not-yet-collected or already-gone dir still passes the
    // name/parent shape check. `removeDirWithRetry` reports it `absent` harmlessly either way.
    // Any OTHER stat failure (e.g. a permissions error) is treated conservatively as "don't
    // touch it".
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
  return stat.isDirectory() && !stat.isSymbolicLink();
}

export interface RemoveResult {
  status: 'deleted' | 'absent' | 'failed';
  attempts: number;
  code?: string;
  message?: string;
}

const RETRYABLE_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES', 'EMFILE', 'ENFILE']);
const RETRY_DELAYS_MS = [100, 200, 400, 800, 1000, 1000, 1000];

export interface RemoveDeps {
  rm?: (dir: string) => Promise<void>;
  exists?: (dir: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Removes a directory with retry on the transient error codes a just-killed Chrome's still-
 * releasing file handles produce, then VERIFIES the directory is actually gone before ever
 * reporting `deleted` — an `rm` that resolves without throwing is not proof on every platform.
 */
export async function removeDirWithRetry(
  dir: string,
  deps: RemoveDeps = {},
  attempts = 8,
): Promise<RemoveResult> {
  const doRm = deps.rm ?? ((d: string) => rm(d, { recursive: true, force: false }));
  const doExists = deps.exists ?? existsSync;
  const doSleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  if (!doExists(dir)) return { status: 'absent', attempts: 0 };

  let lastCode: string | undefined;
  let lastMessage: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await doRm(dir);
      if (!doExists(dir)) return { status: 'deleted', attempts: attempt };
      lastCode = 'STILL_EXISTS';
      lastMessage = 'rm resolved but the directory still exists';
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { status: 'absent', attempts: attempt };
      lastCode = code ?? 'UNKNOWN';
      lastMessage = (err as Error).message;
      if (!RETRYABLE_CODES.has(lastCode)) {
        return { status: 'failed', attempts: attempt, code: lastCode, message: lastMessage };
      }
    }
    if (attempt < attempts) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!;
      await doSleep(delay);
    }
  }
  return { status: 'failed', attempts, code: lastCode, message: lastMessage };
}

/** Degraded-mode-only lock probe (used when process enumeration is unavailable, so nothing was
 *  killed and the only remaining evidence is whether Chrome still holds the profile's lock).
 *  POSIX: reads the `SingletonLock` symlink target `host-<pid>`; free if that PID is dead or
 *  the link doesn't exist. Windows: tries to rename `<dir>/lockfile` onto itself; a running
 *  Chrome holds it open with an exclusive handle so the rename fails with EBUSY/EPERM — success
 *  (or ENOENT) means free. A self-rename is a pure probe: unlike a delete, it never removes the
 *  file even when the probe is right (a real bug found live: the previous implementation
 *  `unlinkSync`'d the lockfile to test it, which is a genuine disk mutation during what's
 *  supposed to be a read-only check, including under `--dry-run`). */
export async function probeLock(dir: string, platform: NodeJS.Platform = process.platform): Promise<'free' | 'in-use' | 'unknown'> {
  if (platform === 'win32') {
    const lockPath = path.join(dir, 'lockfile');
    try {
      renameSync(lockPath, lockPath);
      return 'free';
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return 'free';
      if (code === 'EBUSY' || code === 'EPERM') return 'in-use';
      return 'unknown';
    }
  }
  const { readlink } = await import('node:fs/promises');
  try {
    const target = await readlink(path.join(dir, 'SingletonLock'));
    const m = target.match(/-(\d+)$/);
    if (!m) return 'unknown';
    const pid = Number(m[1]);
    try {
      process.kill(pid, 0);
      return 'in-use';
    } catch (killErr) {
      return (killErr as NodeJS.ErrnoException).code === 'ESRCH' ? 'free' : 'unknown';
    }
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'free' : 'unknown';
  }
}
