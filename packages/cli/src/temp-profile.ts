/**
 * @file packages/cli/src/temp-profile.ts
 * @description GAP-315: cleanup of the throwaway Chrome user-data-dirs the CLI creates
 * (`<os.tmpdir()>/sutradhar-cli-<epochMs>[-<suffix>]`) when no `--profile` is given.
 *
 * Every CLI session used to leave one of these behind (each is 50-100+ MB once Chrome has run):
 * on 2026-10-01, 299 of them (16.9 GB) filled drive E: to 0 bytes. `close` now removes its own
 * session's dir once Chrome has exited, and every fresh spawn sweeps stale ones left by crashed
 * or killed sessions.
 *
 * Safety rules (all must hold before anything is deleted — see {@link decideRemoval}):
 *  1. The dir is an AUTO-CREATED temp profile: its basename matches the CLI's own naming
 *     pattern AND it sits directly in the temp root. Named `--profile` dirs never match (they
 *     live under the ProfileManager's own root, not the temp root, and have different names).
 *  2. The running-process scan SUCCEEDED and no process has the dir on its command line
 *     (Chrome's renderer/GPU/utility children carry `--user-data-dir=` too). A failed scan
 *     means "unknown", and unknown means keep.
 *  3. The dir's owning Chrome PID (from the marker file this module writes, or Chrome's own
 *     POSIX `SingletonLock`) is not alive.
 *  4. Stale sweeps only: the dir was last modified more than {@link STALE_MIN_AGE_MS} ago.
 *  5. At removal time on Windows, Chrome's own exclusive `lockfile` handle is probed first: if
 *     it can't be deleted, some process still holds the profile open and the dir is kept.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TEMP_PROFILE_PREFIX = 'sutradhar-cli-';
/** `sutradhar-cli-<epochMs>` (pre-GAP-315 builds) or `sutradhar-cli-<epochMs>-<mkdtemp suffix>`. */
const TEMP_PROFILE_NAME = /^sutradhar-cli-\d{10,}(?:-[A-Za-z0-9]{1,16})?$/;
export const OWNER_MARKER = '.sutradhar-owner.json';
/** A stale dir must be at least this old (mtime) before a sweep may touch it. Generous on
 *  purpose: a live session's dir is also protected by rules 2, 3 and 5; this only guards the
 *  window where another CLI process has created a dir but not yet spawned Chrome into it. */
export const STALE_MIN_AGE_MS = 10 * 60_000;

export interface OwnerMarker {
  chromePid: number;
  cliPid: number;
  createdAt: string;
}

/** Creates a fresh, uniquely named temp profile dir. `mkdtemp` adds a random suffix, so two
 *  sessions spawned in the same millisecond no longer share one dir. */
export async function createTempProfileDir(tmpRoot: string = os.tmpdir()): Promise<string> {
  return mkdtemp(path.join(tmpRoot, `${TEMP_PROFILE_PREFIX}${Date.now()}-`));
}

export async function writeOwnerMarker(dir: string, chromePid: number): Promise<void> {
  const marker: OwnerMarker = { chromePid, cliPid: process.pid, createdAt: new Date().toISOString() };
  await writeFile(path.join(dir, OWNER_MARKER), JSON.stringify(marker), 'utf-8').catch(() => {});
}

function norm(p: string): string {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** Rule 1. Pure. */
export function isAutoTempProfileDir(dir: string, tmpRoot: string): boolean {
  if (!TEMP_PROFILE_NAME.test(path.basename(dir))) return false;
  return norm(path.dirname(dir)) === norm(tmpRoot);
}

/** Rule 2 helper. Pure. True if any command line mentions the dir's basename as a whole token
 *  (so `sutradhar-cli-123` is not matched by a command line naming `sutradhar-cli-1234`).
 *  Matching the basename instead of the full path is deliberately over-inclusive: it survives
 *  8.3 short paths, slash direction and quoting differences in how the path was passed. */
export function commandLinesReference(dir: string, commandLines: readonly string[]): boolean {
  const base = path.basename(dir).toLowerCase();
  for (const raw of commandLines) {
    const line = raw.toLowerCase();
    let i = line.indexOf(base);
    while (i !== -1) {
      const next = line.charAt(i + base.length);
      if (!/[a-z0-9_-]/.test(next)) return true;
      i = line.indexOf(base, i + 1);
    }
  }
  return false;
}

export interface RemovalFacts {
  dir: string;
  tmpRoot: string;
  /** Command lines of running processes, or `null` if the scan failed (fail closed). */
  commandLines: readonly string[] | null;
  /** Owning Chrome PID, if one is recorded. */
  ownerPid?: number;
  ownerAlive: boolean;
  /** ms since last modification. */
  ageMs: number;
  /** 0 for `close` (we just stopped this dir's Chrome ourselves), {@link STALE_MIN_AGE_MS} for sweeps. */
  minAgeMs: number;
}

export type RemovalDecision =
  | { remove: true }
  | { remove: false; reason: 'not-auto-temp' | 'scan-unavailable' | 'in-use' | 'owner-alive' | 'too-young' };

/** Rules 1-4. Pure — the unit-tested core of every deletion. */
export function decideRemoval(f: RemovalFacts): RemovalDecision {
  if (!isAutoTempProfileDir(f.dir, f.tmpRoot)) return { remove: false, reason: 'not-auto-temp' };
  if (f.commandLines === null) return { remove: false, reason: 'scan-unavailable' };
  if (commandLinesReference(f.dir, f.commandLines)) return { remove: false, reason: 'in-use' };
  if (f.ownerAlive) return { remove: false, reason: 'owner-alive' };
  // minAgeMs 0 means "no threshold": a just-created dir's mtime can read slightly in the future.
  if (f.minAgeMs > 0 && f.ageMs < f.minAgeMs) return { remove: false, reason: 'too-young' };
  return { remove: true };
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: exists but belongs to someone else — alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Polls until `pid` is gone. Hard timeout; returns whether it actually exited. */
export async function waitForPidExit(pid: number, timeoutMs: number, alive = isPidAlive): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (alive(pid)) {
    if (performance.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

/** Command lines of every running process that mentions {@link TEMP_PROFILE_PREFIX}, or `null`
 *  if the scan failed or timed out (callers must then keep everything). */
export async function scanCommandLines(timeoutMs = 20_000): Promise<string[] | null> {
  const run = (file: string, args: string[]) =>
    new Promise<string | null>((resolve) => {
      execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
        resolve(err ? null : stdout),
      );
    });
  if (process.platform === 'win32') {
    const script =
      "$ErrorActionPreference='Stop'; " +
      `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%${TEMP_PROFILE_PREFIX}%'" | ` +
      "ForEach-Object { $_.CommandLine }";
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return out === null ? null : out.split(/\r?\n/).filter((l) => l.includes(TEMP_PROFILE_PREFIX));
  }
  const out = await run('ps', ['-A', '-o', 'args=']);
  return out === null ? null : out.split('\n').filter((l) => l.includes(TEMP_PROFILE_PREFIX));
}

/** Rule 3 input: the marker's chromePid, else (POSIX) the PID in Chrome's `SingletonLock`
 *  symlink (`<hostname>-<pid>`). */
export async function readOwnerPid(dir: string): Promise<number | undefined> {
  try {
    const m = JSON.parse(await readFile(path.join(dir, OWNER_MARKER), 'utf-8')) as Partial<OwnerMarker>;
    if (typeof m.chromePid === 'number') return m.chromePid;
  } catch {
    // no marker (pre-GAP-315 dir) — fall through
  }
  try {
    const target = await readlink(path.join(dir, 'SingletonLock'));
    const pid = Number(target.slice(target.lastIndexOf('-') + 1));
    if (Number.isInteger(pid) && pid > 0) return pid;
  } catch {
    // not POSIX Chrome, or no lock
  }
  return undefined;
}

async function gatherFacts(dir: string, tmpRoot: string, commandLines: readonly string[] | null, minAgeMs: number): Promise<RemovalFacts | undefined> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(dir)).mtimeMs;
  } catch {
    return undefined; // already gone
  }
  const ownerPid = await readOwnerPid(dir);
  return {
    dir,
    tmpRoot,
    commandLines,
    ownerPid,
    ownerAlive: ownerPid !== undefined && isPidAlive(ownerPid),
    ageMs: Date.now() - mtimeMs,
    minAgeMs,
  };
}

function isLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY';
}

/** Rule 5 + the actual delete, retried until `deadline` (performance.now() ms) because Windows
 *  keeps file handles open briefly after Chrome exits. */
async function removeWithRetries(dir: string, deadline: number): Promise<{ removed: boolean; error?: string }> {
  let lastErr: unknown;
  do {
    try {
      if (process.platform === 'win32') {
        // Chrome holds `lockfile` open exclusively for the profile's whole lifetime: if it
        // can't be removed, the profile is still open — don't start tearing the dir apart.
        await rm(path.join(dir, 'lockfile'), { force: true });
      }
      await rm(dir, { recursive: true, force: true });
      return { removed: true };
    } catch (err) {
      lastErr = err;
      if (!isLockError(err)) break;
    }
    await new Promise((r) => setTimeout(r, 250));
  } while (performance.now() < deadline);
  return { removed: false, error: (lastErr as Error)?.message ?? String(lastErr) };
}

export interface CloseCleanupResult {
  removed: boolean;
  /** Why the dir was kept, if it was. */
  reason?: string;
}

/**
 * `close` path: waits for this session's Chrome to exit (hard timeout), re-checks every safety
 * rule, then removes the dir with retries. Never throws.
 */
export async function removeSessionTempProfile(
  dir: string,
  chromePid: number | undefined,
  opts: { tmpRoot?: string; exitTimeoutMs?: number; removeTimeoutMs?: number; scan?: typeof scanCommandLines } = {},
): Promise<CloseCleanupResult> {
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  if (!isAutoTempProfileDir(dir, tmpRoot)) return { removed: false, reason: 'not-auto-temp' };
  if (chromePid !== undefined && !(await waitForPidExit(chromePid, opts.exitTimeoutMs ?? 10_000))) {
    return { removed: false, reason: `Chrome (pid ${chromePid}) did not exit in time` };
  }
  const facts = await gatherFacts(dir, tmpRoot, await (opts.scan ?? scanCommandLines)(), 0);
  if (!facts) return { removed: true }; // nothing there
  const decision = decideRemoval(facts);
  if (!decision.remove) return { removed: false, reason: decision.reason };
  const res = await removeWithRetries(dir, performance.now() + (opts.removeTimeoutMs ?? 15_000));
  return res.removed ? { removed: true } : { removed: false, reason: res.error };
}

export interface SweepResult {
  removed: string[];
  kept: { dir: string; reason: string }[];
}

/**
 * Session-start path: removes stale auto-created temp profiles under the same rules, with the
 * age threshold. Bounded by `budgetMs` overall (a huge backlog is worked off over several
 * sessions rather than stalling one command). Never throws.
 */
export async function sweepStaleTempProfiles(
  opts: { tmpRoot?: string; budgetMs?: number; minAgeMs?: number; scan?: typeof scanCommandLines } = {},
): Promise<SweepResult> {
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  const deadline = performance.now() + (opts.budgetMs ?? 15_000);
  const result: SweepResult = { removed: [], kept: [] };
  let names: string[];
  try {
    names = (await readdir(tmpRoot)).filter((n) => n.startsWith(TEMP_PROFILE_PREFIX));
  } catch {
    return result;
  }
  const candidates = names.map((n) => path.join(tmpRoot, n)).filter((d) => isAutoTempProfileDir(d, tmpRoot));
  if (candidates.length === 0) return result;
  const commandLines = await (opts.scan ?? scanCommandLines)();
  for (const dir of candidates) {
    if (performance.now() >= deadline) break;
    const facts = await gatherFacts(dir, tmpRoot, commandLines, opts.minAgeMs ?? STALE_MIN_AGE_MS);
    if (!facts) continue;
    const decision = decideRemoval(facts);
    if (!decision.remove) {
      result.kept.push({ dir, reason: decision.reason });
      continue;
    }
    // Short per-dir retry window: a stale dir has no Chrome that just exited.
    const res = await removeWithRetries(dir, Math.min(deadline, performance.now() + 1_000));
    if (res.removed) result.removed.push(dir);
    else result.kept.push({ dir, reason: res.error ?? 'remove failed' });
  }
  return result;
}
