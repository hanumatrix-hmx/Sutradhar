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
 *     It must also be a REAL directory: a symlink/junction or a regular file that merely carries such a
 *     name is never touched, and nothing is ever read or deleted THROUGH it (S6e-1).
 *  2. The running-process scan SUCCEEDED and no process has the dir on its command line
 *     (Chrome's renderer/GPU/utility children carry `--user-data-dir=` too). A failed scan
 *     means "unknown", and unknown means keep.
 *  3. The dir's owning Chrome PID (from the marker file this module writes, or Chrome's own
 *     POSIX `SingletonLock`) is not alive. A marker that is PRESENT but unreadable or corrupt means
 *     "owner unknown" and keeps the dir (`owner-unknown`); only an ABSENT marker falls back to the lock (S6e-4).
 *  4. Stale sweeps only: the dir was last modified more than {@link STALE_MIN_AGE_MS} ago.
 *  5. At removal time on Windows, Chrome's own exclusive `lockfile` handle is probed first: if
 *     it can't be deleted, some process still holds the profile open and the dir is kept.
 *
 * Time bounds (0.6.1): ONE deadline per operation, on the monotonic clock (`performance.now()`).
 * Every phase (exit wait, process scan, each rm attempt) is clamped to what is left of it, and no
 * rm attempt STARTS with less than {@link MIN_RM_START_MS} left. One rm attempt that has already
 * started can still finish after the deadline (Node cannot cancel an in-flight fs call), so the
 * real worst case is the deadline plus one rm of one profile dir.
 *
 * Diagnostics: with SUTRADHAR_CLI_DEBUG_CLEANUP=1 every path this module considers, creates,
 * decides on, tries to remove, removes or keeps is printed to stderr as
 * `[cleanup] <event> ... path="<abs>"`. Logging happens only in the I/O paths, never in the pure
 * predicates.
 */
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { powershellExe, psBin } from './system-binaries.js';

export const TEMP_PROFILE_PREFIX = 'sutradhar-cli-';
/** `sutradhar-cli-<epochMs>` (pre-GAP-315 builds) or `sutradhar-cli-<epochMs>-<mkdtemp suffix>`. */
const TEMP_PROFILE_NAME = /^sutradhar-cli-\d{10,}(?:-[A-Za-z0-9]{1,16})?$/;
export const OWNER_MARKER = '.sutradhar-owner.json';
/** A stale dir must be at least this old (mtime) before a sweep may touch it. Generous on
 *  purpose: a live session's dir is also protected by rules 2, 3 and 5; this only guards the
 *  window where another CLI process has created a dir but not yet spawned Chrome into it. */
export const STALE_MIN_AGE_MS = 10 * 60_000;
/** Overall deadline of one `close`/self-heal profile cleanup (exit wait + scan + removal). */
export const CLOSE_CLEANUP_DEADLINE_MS = 15_000;
/** Cap of one process scan (also clamped to the time left). */
export const SCAN_TIMEOUT_MS = 8_000;
/** Overall budget of one session-start sweep, measured from BEFORE the readdir and the scan. */
export const SWEEP_BUDGET_MS = 15_000;
/** Cap of the read-only "has the owning Chrome exited" poll (also clamped to the time left). */
export const EXIT_WAIT_CAP_MS = 10_000;
/** No rm attempt starts with less than this left of the overall deadline. */
export const MIN_RM_START_MS = 1_000;
/** Per-dir retry window of the sweep (a stale dir has no Chrome that just exited). */
export const SWEEP_PER_DIR_RETRY_MS = 1_000;
/** Pause between two rm attempts on the same dir (Windows keeps handles briefly after exit). */
const RM_RETRY_PAUSE_MS = 250;

// --- debug seam -------------------------------------------------------------------------------

type DebugFields = Record<string, string | number | boolean | null | undefined>;

/** `[cleanup] <event> key=value ...` on stderr, only when SUTRADHAR_CLI_DEBUG_CLEANUP=1 (read at
 *  call time). Every path is written as `path="<abs>"`. Never throws. NEVER call this from a pure
 *  predicate (isAutoTempProfileDir, commandLinesReference, decideRemoval). */
export function dlog(event: string, fields: DebugFields = {}): void {
  if (process.env.SUTRADHAR_CLI_DEBUG_CLEANUP !== '1') return;
  try {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      if (k === 'path') parts.push(`path="${path.resolve(String(v)).replaceAll('"', '%22')}"`);
      else if (typeof v === 'string' && /[\s"]/.test(v)) parts.push(`${k}=${JSON.stringify(v)}`);
      else parts.push(`${k}=${String(v)}`);
    }
    process.stderr.write(`[cleanup] ${event}${parts.length ? ' ' + parts.join(' ') : ''}\n`);
  } catch {
    // diagnostics must never affect behaviour
  }
}

export interface OwnerMarker {
  chromePid: number;
  cliPid: number;
  createdAt: string;
}

/** Creates a fresh, uniquely named temp profile dir. `mkdtemp` adds a random suffix, so two
 *  sessions spawned in the same millisecond no longer share one dir. */
export async function createTempProfileDir(tmpRoot: string = os.tmpdir()): Promise<string> {
  const dir = await mkdtemp(path.join(tmpRoot, `${TEMP_PROFILE_PREFIX}${Date.now()}-`));
  dlog('created', { path: dir });
  return dir;
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
  /** State of the owner marker: `absent` (falls back to `SingletonLock`), `valid`, or `invalid` (present but
   *  unreadable/corrupt: `owner-unknown`, kept). `undefined` = not checked, decision unchanged. */
  ownerState?: 'absent' | 'valid' | 'invalid';
  /** `lstat` says the candidate is a real directory (not a symlink/junction, not a file). `false` keeps it
   *  (`not-a-directory`); `undefined` means "not checked" and leaves the decision unchanged. */
  realDir?: boolean;
}

export type RemovalDecision =
  | { remove: true }
  | {
      remove: false;
      reason: 'not-auto-temp' | 'not-a-directory' | 'scan-unavailable' | 'in-use' | 'owner-unknown' | 'owner-alive' | 'too-young';
    };

/** Rules 1-4 (+ the real-directory check). Pure — the unit-tested core of every deletion. */
export function decideRemoval(f: RemovalFacts): RemovalDecision {
  if (!isAutoTempProfileDir(f.dir, f.tmpRoot)) return { remove: false, reason: 'not-auto-temp' };
  if (f.realDir === false) return { remove: false, reason: 'not-a-directory' };
  if (f.commandLines === null) return { remove: false, reason: 'scan-unavailable' };
  if (commandLinesReference(f.dir, f.commandLines)) return { remove: false, reason: 'in-use' };
  if (f.ownerState === 'invalid') return { remove: false, reason: 'owner-unknown' };
  if (f.ownerAlive) return { remove: false, reason: 'owner-alive' };
  // minAgeMs 0 means "no threshold": a just-created dir's mtime can read slightly in the future.
  if (f.minAgeMs > 0 && f.ageMs < f.minAgeMs) return { remove: false, reason: 'too-young' };
  return { remove: true };
}

/** Read-only liveness probe (`process.kill(pid, 0)` sends no signal). */
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

/** Polls until `pid` is gone. Hard timeout; returns whether it actually exited. Never kills. */
export async function waitForPidExit(pid: number, timeoutMs: number, alive = isPidAlive): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (alive(pid)) {
    if (performance.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

/** Test/seam surface of {@link scanCommandLines}. Production passes none of it. */
export interface ScanDeps {
  /** Runs an absolute executable and returns its stdout, or `null` if it failed or timed out. */
  run?: (file: string, args: string[], timeoutMs: number) => Promise<string | null>;
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Linux only: the command line of every process (NUL separators already turned into spaces),
   *  or `null` if `/proc` is unreadable. Defaults to {@link readProcCommandLines}. */
  readProc?: (timeoutMs: number) => Promise<string[] | null>;
}

/** The `fs` calls {@link readProcCommandLines} makes (injectable for tests). */
export interface ProcFs {
  readdir(dir: string): Promise<string[]>;
  readFile(file: string): Promise<Buffer>;
}

const realProcFs: ProcFs = { readdir: (d) => readdir(d), readFile: (f) => readFile(f) };

/** Linux process scan source: `/proc/<pid>/cmdline` of every process (NUL separators become
 *  spaces; empty command lines, i.e. kernel threads, are dropped). Unlike `ps`, it needs no procps
 *  package and never truncates a long argv. Returns `null` (fail closed) if `/proc` cannot be listed,
 *  if not a single command line could be read (a directory that merely LOOKS like `/proc`: the
 *  process's own cmdline is always readable on a working one), or if `timeoutMs` ran out. A process
 *  that exits between the listing and the read is simply skipped. */
export async function readProcCommandLines(timeoutMs: number, procFs: ProcFs = realProcFs): Promise<string[] | null> {
  const deadline = performance.now() + timeoutMs;
  let names: string[];
  try {
    names = await procFs.readdir('/proc');
  } catch {
    return null;
  }
  const lines: string[] = [];
  let readable = 0;
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    if (performance.now() >= deadline) return null;
    let raw: Buffer;
    try {
      raw = await procFs.readFile(`/proc/${name}/cmdline`);
    } catch {
      continue; // exited since the listing, or hidden from this user
    }
    readable++;
    const line = raw.toString('utf8').split('\0').join(' ').trim();
    if (line) lines.push(line);
  }
  if (readable === 0 || performance.now() >= deadline) return null;
  return lines;
}

/** Keeps the lines that mention {@link TEMP_PROFILE_PREFIX}, CASE-INSENSITIVELY, on every platform.
 *  The Windows query (`LIKE`) is case-insensitive, so a process that holds the dir as
 *  `SUTRADHAR-CLI-...` is returned by it; a case-sensitive filter here would drop that line and let
 *  the dir be deleted (S4 audit F2). The prefix constant is lower-case. This is only a substring
 *  pre-filter: the whole-token matching lives in {@link commandLinesReference}. */
function keepPrefixed(lines: readonly string[]): string[] {
  return lines.filter((l) => l.toLowerCase().includes(TEMP_PROFILE_PREFIX));
}

const execRun: NonNullable<ScanDeps['run']> = (file, args, timeoutMs) =>
  new Promise<string | null>((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : stdout),
    );
  });

/** Command lines of every running process that mentions {@link TEMP_PROFILE_PREFIX}, or `null`
 *  if the scan failed or timed out (callers must then keep everything). `timeoutMs` defaults to
 *  {@link SCAN_TIMEOUT_MS}; callers pass what is left of their own deadline.
 *  Windows: a CIM query through the absolute PowerShell path. Linux: `/proc/<pid>/cmdline`
 *  ({@link readProcCommandLines}; no `ps`). Other POSIX (macOS): `ps -A -ww -o args=` (`-ww` = no
 *  width limit, so a long argv is not cut). Executables are absolute system paths
 *  (system-binaries.ts), never bare names resolved from the cwd. */
export async function scanCommandLines(timeoutMs = SCAN_TIMEOUT_MS, deps: ScanDeps = {}): Promise<string[] | null> {
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? execRun;
  if (platform === 'win32') {
    const script =
      "$ErrorActionPreference='Stop'; " +
      `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%${TEMP_PROFILE_PREFIX}%'" | ` +
      "ForEach-Object { $_.CommandLine }";
    const out = await run(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command', script], timeoutMs);
    return out === null ? null : keepPrefixed(out.split(/\r?\n/));
  }
  if (platform === 'linux') {
    const lines = await (deps.readProc ?? readProcCommandLines)(timeoutMs);
    return lines === null ? null : keepPrefixed(lines);
  }
  const out = await run(psBin(), ['-A', '-ww', '-o', 'args='], timeoutMs);
  return out === null ? null : keepPrefixed(out.split('\n'));
}

/** Runs the (real or injected) scan with an already-clamped timeout and logs `scan ms= result=`.
 *  A scan that REJECTS counts as a failed scan: `null`, which keeps everything (fail closed). */
async function runScan(scan: typeof scanCommandLines, timeoutMs: number): Promise<string[] | null> {
  const t0 = performance.now();
  let lines: string[] | null;
  try {
    lines = await scan(timeoutMs);
  } catch (err) {
    dlog('scan-error', { message: errMessage(err) });
    lines = null;
  }
  dlog('scan', { ms: Math.round(performance.now() - t0), result: lines === null ? 'null' : lines.length });
  return lines;
}

type OwnerMarkerRead = { state: 'absent' } | { state: 'valid'; pid: number } | { state: 'invalid' };

/** Reads the owner marker with three distinct outcomes (N1): `absent` only for ENOENT (a pre-GAP-315 dir or
 *  Chrome without a marker); ANY other read error (EACCES, EISDIR, EBUSY, ...), a JSON parse failure, or a
 *  `chromePid` that is not a positive integer is `invalid`, which callers must treat as "owner unknown"
 *  (keep), never as "owner dead". Never throws. */
async function readOwnerMarker(dir: string): Promise<OwnerMarkerRead> {
  let raw: string;
  try {
    raw = await readFile(path.join(dir, OWNER_MARKER), 'utf-8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'absent' } : { state: 'invalid' };
  }
  try {
    const m = JSON.parse(raw) as Partial<OwnerMarker> | null;
    const pid = m?.chromePid;
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? { state: 'valid', pid } : { state: 'invalid' };
  } catch {
    return { state: 'invalid' };
  }
}

/** POSIX only: the PID in Chrome's `SingletonLock` symlink (`<hostname>-<pid>`), if there is one. */
async function readLockPid(dir: string): Promise<number | undefined> {
  try {
    const target = await readlink(path.join(dir, 'SingletonLock'));
    const pid = Number(target.slice(target.lastIndexOf('-') + 1));
    if (Number.isInteger(pid) && pid > 0) return pid;
  } catch {
    // not POSIX Chrome, or no lock
  }
  return undefined;
}

/** Rule 3 input: the marker's chromePid, else (POSIX) the PID in Chrome's `SingletonLock`
 *  symlink (`<hostname>-<pid>`). Exported with its original behaviour (the S4 probes call it); the
 *  removal rules use {@link readOwnerMarker} so that a corrupt marker is not mistaken for "no owner". */
export async function readOwnerPid(dir: string): Promise<number | undefined> {
  try {
    const m = JSON.parse(await readFile(path.join(dir, OWNER_MARKER), 'utf-8')) as Partial<OwnerMarker>;
    if (typeof m.chromePid === 'number') return m.chromePid;
  } catch {
    // no marker (pre-GAP-315 dir) — fall through
  }
  return readLockPid(dir);
}

/** True only for a REAL directory: `lstat` (never follows) succeeds and the entry is neither a symlink
 *  (a Windows junction reports `isSymbolicLink() === true` too) nor a file. Any lstat error is `false`. */
async function realDirectory(dir: string): Promise<boolean> {
  try {
    const st = await lstat(dir);
    return !st.isSymbolicLink() && st.isDirectory();
  } catch {
    return false;
  }
}

async function gatherFacts(
  dir: string,
  tmpRoot: string,
  commandLines: readonly string[] | null,
  minAgeMs: number,
  isAlive: (pid: number) => boolean,
): Promise<RemovalFacts | undefined> {
  // FIRST, before stat, before reading the marker or SingletonLock and before any path.join(dir, ...):
  // a link or a file named like a profile must never be followed (S4 audit F1/N3).
  const realDir = await realDirectory(dir);
  if (!realDir) {
    try {
      await lstat(dir);
    } catch {
      return undefined; // already gone
    }
    return { dir, tmpRoot, commandLines, ownerAlive: false, ageMs: 0, minAgeMs, realDir: false };
  }
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(dir)).mtimeMs;
  } catch {
    return undefined; // already gone
  }
  const marker = await readOwnerMarker(dir);
  const ownerPid = marker.state === 'valid' ? marker.pid : await readLockPid(dir);
  return {
    dir,
    tmpRoot,
    commandLines,
    ownerPid,
    ownerState: marker.state,
    ownerAlive: ownerPid !== undefined && isAlive(ownerPid),
    ageMs: Date.now() - mtimeMs,
    minAgeMs,
    realDir: true,
  };
}

function isLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY';
}

function errMessage(err: unknown): string {
  return (err as Error)?.message ?? String(err);
}

interface RemoveOutcome {
  removed: boolean;
  /** The overall deadline is what ended it (an attempt could not start, or not start again). */
  deadline?: boolean;
  /** The last rm error, if any attempt failed. */
  error?: string;
}

/** Rule 5 + the actual delete, retried because Windows keeps file handles open briefly after
 *  Chrome exits. `deadlineAt` (performance.now() ms) is the OVERALL deadline: an attempt starts
 *  only while at least {@link MIN_RM_START_MS} of it is left, so a tiny remainder is never spent
 *  starting a delete that cannot be allowed to finish in time. `retryUntil` (<= deadlineAt) ends
 *  the retrying for this dir; it never blocks the FIRST attempt. One attempt that has started may
 *  still finish after the deadline (it cannot be cancelled). */
async function removeWithRetries(
  dir: string,
  o: { deadlineAt: number; retryUntil: number; rmFn?: typeof rm },
): Promise<RemoveOutcome> {
  const rmFn = o.rmFn ?? rm;
  let lastErr: unknown;
  let n = 0;
  for (;;) {
    const now = performance.now();
    const remaining = o.deadlineAt - now;
    if (remaining < MIN_RM_START_MS) {
      dlog('rm-stop', { path: dir, n, reason: 'deadline', 'remaining-ms': Math.round(remaining) });
      return { removed: false, deadline: true, error: lastErr === undefined ? undefined : errMessage(lastErr) };
    }
    if (n > 0 && now >= o.retryUntil) {
      return { removed: false, error: errMessage(lastErr) };
    }
    n++;
    dlog('rm-attempt', { path: dir, n, 'remaining-ms': Math.round(remaining) });
    // Re-check right before the lockfile probe / delete: the candidate may have been swapped for a link
    // since the facts were gathered. A kept link is a harmless leak; following it would be a loss.
    if (!(await realDirectory(dir))) {
      dlog('rm-stop', { path: dir, n, reason: 'not-a-directory' });
      return { removed: false, error: 'not-a-directory' };
    }
    try {
      if (process.platform === 'win32') {
        // Chrome holds `lockfile` open exclusively for the profile's whole lifetime: if it
        // can't be removed, the profile is still open — don't start tearing the dir apart.
        await rmFn(path.join(dir, 'lockfile'), { force: true });
      }
      await rmFn(dir, { recursive: true, force: true });
      return { removed: true };
    } catch (err) {
      lastErr = err;
      if (!isLockError(err)) return { removed: false, error: errMessage(err) };
    }
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(RM_RETRY_PAUSE_MS, o.retryUntil - performance.now()))));
  }
}

export interface CloseCleanupResult {
  removed: boolean;
  /** Why the dir was kept, if it was. */
  reason?: string;
}

export interface RemoveSessionOptions {
  tmpRoot?: string;
  /** Test seam: replaces the process scan. Receives the clamped scan timeout. */
  scan?: typeof scanCommandLines;
  /** Test seam: replaces fs.rm for every delete attempt (including the Windows lockfile probe). */
  rmFn?: typeof rm;
  /** Absolute overall deadline (performance.now() ms). Wins over {@link RemoveSessionOptions.deadlineMs}. */
  deadlineAt?: number;
  /** Overall deadline relative to the call; default {@link CLOSE_CLEANUP_DEADLINE_MS}. */
  deadlineMs?: number;
  /** The single liveness seam: used by the exit wait AND by the owner-alive fact. Default {@link isPidAlive}. */
  isAlive?: (pid: number) => boolean;
  /** Cap of the exit wait (default {@link EXIT_WAIT_CAP_MS}); always clamped to the overall deadline. */
  exitTimeoutMs?: number;
  /** Cap of the removal retry window (default: whatever is left); always clamped to the overall deadline. */
  removeTimeoutMs?: number;
}

/**
 * `close` path: waits (read-only) for this session's Chrome to exit, re-checks every safety
 * rule, then removes the dir with retries — all inside ONE overall deadline (default
 * {@link CLOSE_CLEANUP_DEADLINE_MS}) on the monotonic clock. Never kills anything: the exit wait is
 * a `process.kill(pid, 0)` poll. If time runs out the dir is kept (`reason: 'deadline'`) and the
 * next session-start sweep retries it. Never throws.
 */
export async function removeSessionTempProfile(
  dir: string,
  chromePid: number | undefined,
  opts: RemoveSessionOptions = {},
): Promise<CloseCleanupResult> {
  try {
    if (typeof dir !== 'string') return { removed: false, reason: 'not-auto-temp' }; // hand-corrupted state.json
    return await removeSessionTempProfileUnguarded(dir, chromePid, opts);
  } catch (err) {
    // The documented "never throws" contract: any unexpected error keeps the dir.
    dlog('error', { path: typeof dir === 'string' ? dir : undefined, message: errMessage(err) });
    return { removed: false, reason: 'error' };
  }
}

async function removeSessionTempProfileUnguarded(
  dir: string,
  chromePid: number | undefined,
  opts: RemoveSessionOptions,
): Promise<CloseCleanupResult> {
  const t0 = performance.now();
  const deadlineAt = opts.deadlineAt ?? t0 + (opts.deadlineMs ?? CLOSE_CLEANUP_DEADLINE_MS);
  const isAlive = opts.isAlive ?? isPidAlive;
  const finish = (res: CloseCleanupResult): CloseCleanupResult => {
    dlog(res.removed ? 'removed' : 'kept', { path: dir, reason: res.reason });
    dlog('phase cleanup', { ms: Math.round(performance.now() - t0) });
    return res;
  };
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  dlog('consider', { path: dir, mode: 'close' });
  if (!isAutoTempProfileDir(dir, tmpRoot)) {
    dlog('decision', { path: dir, reason: 'not-auto-temp' });
    return finish({ removed: false, reason: 'not-auto-temp' });
  }
  if (chromePid !== undefined) {
    const cap = opts.exitTimeoutMs ?? EXIT_WAIT_CAP_MS;
    const left = deadlineAt - performance.now();
    const byDeadline = left < cap;
    if (!(await waitForPidExit(chromePid, Math.max(0, Math.min(cap, left)), isAlive))) {
      const reason = byDeadline ? 'deadline' : `Chrome (pid ${chromePid}) did not exit in time`;
      dlog('decision', { path: dir, reason });
      return finish({ removed: false, reason });
    }
  }
  const scanMs = Math.min(SCAN_TIMEOUT_MS, deadlineAt - performance.now());
  if (scanMs <= 0) {
    dlog('decision', { path: dir, reason: 'deadline' });
    return finish({ removed: false, reason: 'deadline' });
  }
  const facts = await gatherFacts(dir, tmpRoot, await runScan(opts.scan ?? scanCommandLines, scanMs), 0, isAlive);
  if (!facts) {
    dlog('decision', { path: dir, reason: 'already-gone' });
    return finish({ removed: true }); // nothing there
  }
  const decision = decideRemoval(facts);
  dlog('decision', { path: dir, reason: decision.remove ? 'remove' : decision.reason });
  if (!decision.remove) return finish({ removed: false, reason: decision.reason });
  const left = deadlineAt - performance.now();
  const res = await removeWithRetries(dir, {
    deadlineAt,
    retryUntil: performance.now() + Math.max(0, Math.min(opts.removeTimeoutMs ?? left, left)),
    rmFn: opts.rmFn,
  });
  if (res.removed) return finish({ removed: true });
  return finish({ removed: false, reason: res.deadline ? 'deadline' : (res.error ?? 'remove failed') });
}

export interface SweepResult {
  removed: string[];
  kept: { dir: string; reason: string }[];
}

export interface SweepOptions {
  tmpRoot?: string;
  /** Overall budget (default {@link SWEEP_BUDGET_MS}), measured from before the readdir and the scan. */
  budgetMs?: number;
  minAgeMs?: number;
  /** Test seam: replaces the process scan. Receives the clamped scan timeout. */
  scan?: typeof scanCommandLines;
  /** Test seam: replaces fs.rm for every delete attempt (including the Windows lockfile probe). */
  rmFn?: typeof rm;
  isAlive?: (pid: number) => boolean;
}

/**
 * Session-start path: removes stale auto-created temp profiles under the same rules, with the
 * age threshold. Bounded by ONE budget ({@link SWEEP_BUDGET_MS}) that starts BEFORE the readdir and
 * the scan, so a slow scan eats into it (a huge backlog is worked off over several sessions rather
 * than stalling one command). No rm attempt starts with less than {@link MIN_RM_START_MS} left;
 * one that has already started may finish after the budget. Never throws.
 */
export async function sweepStaleTempProfiles(opts: SweepOptions = {}): Promise<SweepResult> {
  const t0 = performance.now();
  const result: SweepResult = { removed: [], kept: [] };
  try {
    await sweepInto(opts, result, t0);
  } catch (err) {
    // The documented "never throws" contract: an unexpected error ends the sweep, keeping what is left.
    dlog('error', { message: errMessage(err) });
  }
  dlog('phase sweep', { ms: Math.round(performance.now() - t0), removed: result.removed.length, kept: result.kept.length });
  return result;
}

async function sweepInto(opts: SweepOptions, result: SweepResult, t0: number): Promise<void> {
  const deadline = t0 + (opts.budgetMs ?? SWEEP_BUDGET_MS);
  const tmpRoot = opts.tmpRoot ?? os.tmpdir();
  const isAlive = opts.isAlive ?? isPidAlive;
  let names: string[];
  try {
    names = (await readdir(tmpRoot)).filter((n) => n.startsWith(TEMP_PROFILE_PREFIX));
  } catch {
    return;
  }
  const candidates = names.map((n) => path.join(tmpRoot, n)).filter((d) => isAutoTempProfileDir(d, tmpRoot));
  for (const d of candidates) dlog('consider', { path: d, mode: 'sweep' });
  if (candidates.length === 0) return;
  const scanMs = Math.min(SCAN_TIMEOUT_MS, deadline - performance.now());
  if (scanMs <= 0) return;
  const commandLines = await runScan(opts.scan ?? scanCommandLines, scanMs);
  for (const [i, dir] of candidates.entries()) {
    if (deadline - performance.now() < MIN_RM_START_MS) {
      for (const rest of candidates.slice(i)) {
        dlog('kept', { path: rest, reason: 'deadline' });
        result.kept.push({ dir: rest, reason: 'deadline' });
      }
      break;
    }
    const facts = await gatherFacts(dir, tmpRoot, commandLines, opts.minAgeMs ?? STALE_MIN_AGE_MS, isAlive);
    if (!facts) continue;
    const decision = decideRemoval(facts);
    dlog('decision', { path: dir, reason: decision.remove ? 'remove' : decision.reason });
    if (!decision.remove) {
      dlog('kept', { path: dir, reason: decision.reason });
      result.kept.push({ dir, reason: decision.reason });
      continue;
    }
    // Short per-dir retry window: a stale dir has no Chrome that just exited.
    const res = await removeWithRetries(dir, {
      deadlineAt: deadline,
      retryUntil: Math.min(deadline, performance.now() + SWEEP_PER_DIR_RETRY_MS),
      rmFn: opts.rmFn,
    });
    if (res.removed) {
      dlog('removed', { path: dir });
      result.removed.push(dir);
    } else {
      const reason = res.deadline ? 'deadline' : (res.error ?? 'remove failed');
      dlog('kept', { path: dir, reason });
      result.kept.push({ dir, reason });
    }
  }
}
