/**
 * @file packages/cli/src/warden-control.ts
 * @description FR2-04 Branch W, CLI side: spawns/reuses/stops the per-session `DialogWarden`
 * (packages/browser/src/session/dialog-warden.ts) as a detached OS process, and talks to it over
 * its localhost HTTP API. `warden.json` is a SIDECAR file next to `state.json` (never folded
 * into it) — CliState's own `writeState` is a non-atomic read-modify-write, and the warden
 * writes its own file independently on its own schedule (ready, and on exit); sharing one file
 * between two independent writers would just recreate the same lost-update races FR2-03's state
 * work already has to worry about (R-F).
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, open, rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { WARDEN_HTTP_TIMEOUT_MS } from '@sutradhar/browser';
import type { CliState } from './state.js';

/** GAP-223: exactly one warden per session. `ensureWarden` is called by every gated CLI command,
 *  so several commands racing right after a warden dies (or on first spawn) would otherwise each
 *  see "no healthy warden" and each spawn their own — the audit found 3-4 alive at once for a
 *  single session. This is a plain exclusive-create lock file (`fs` `'wx'` — fails if the file
 *  already exists), not a real OS file lock, because it only needs to work between cooperating
 *  `sutradhar` processes on the SAME machine/state dir, which already coordinate through
 *  `state.json`/`warden.json` the same non-atomic way. */
interface SpawnLockFile {
  readonly pid: number;
  readonly startedAt: number;
}

const SPAWN_LOCK_STALE_MS = 8000;
const SPAWN_LOCK_POLL_MS = 100;
/** How long a loser of the lock will wait for the winner to publish a healthy `warden.json`
 *  before giving up and trying to acquire the lock itself (e.g. the winner crashed after taking
 *  the lock but before writing the file). Comfortably above `WARDEN_READY_TIMEOUT_MS` so a
 *  legitimately-slow-but-successful spawn isn't pre-empted. */
const SPAWN_LOCK_WAIT_MS = 4000;

function spawnLockPath(stateDir: string): string {
  return path.join(stateDir, 'warden.lock');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tries to take the spawn lock. Returns `true` if this call now owns it, `false` if another
 * live, non-stale spawn is already in progress (the caller should wait for its result instead).
 *
 * FR2-04 fix-2/GAP-231: the original stale-lock recovery did `rm(lockPath)` and then looped back
 * to `open(lockPath, 'wx')` — an unlink-then-create pattern with a real window between the two
 * calls where the lock path does not exist at all. audit-2 measured that window being wide enough
 * in practice for several racing processes to each get through their own `rm()` + `open('wx')`
 * pair before any of them observed another's write (stale-lock scenario: 8/10 rounds ended with
 * multiple wardens alive, up to 4). Never do that again: recovering a stale lock now writes the
 * challenger's claim to a uniquely-named temp file first (an `open('wx')` on a name nobody else
 * could be using, so writing it is never itself racy), `rename()`s it onto the lock path (a
 * single filesystem operation — POSIX and Windows both guarantee no observer ever sees the lock
 * path transiently absent during a rename, unlike unlink-then-create), and then reads the lock
 * back to confirm THIS process's write is the one that's actually there — if a concurrent
 * challenger's rename landed after ours, our read-back fails and we correctly report we do not
 * own the lock, rather than assuming the rename alone proved ownership.
 */
/** Exported ONLY for GAP-250's direct unit test (warden-control.spec.ts WC7) — production code
 *  only ever calls this internally via `ensureWarden`. Visibility change alone, no behavior
 *  change. */
export async function tryAcquireSpawnLock(stateDir: string): Promise<boolean> {
  const lockPath = spawnLockPath(stateDir);
  const payload: SpawnLockFile = { pid: process.pid, startedAt: Date.now() };

  // Fast path: nobody holds the lock at all yet. `open(..., 'wx')` (O_CREAT|O_EXCL) is a single
  // atomic filesystem operation on both POSIX and Windows — exactly one concurrent caller can
  // win it for a given path.
  try {
    const handle = await open(lockPath, 'wx');
    try {
      await handle.writeFile(JSON.stringify(payload));
    } finally {
      await handle.close();
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false;
  }

  // Someone already holds it — is it stale?
  let existing: SpawnLockFile | undefined;
  try {
    existing = JSON.parse(await readFile(lockPath, 'utf-8')) as SpawnLockFile;
  } catch {
    existing = undefined; // unreadable/gone between the EEXIST and our read
  }
  const stale = !existing || !isPidAlive(existing.pid) || Date.now() - existing.startedAt > SPAWN_LOCK_STALE_MS;
  if (!stale) return false;

  // Atomic replace, never unlink-then-create: write our claim to a name only we could be using,
  // then rename it over the lock path in one filesystem call.
  const tempPath = `${lockPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(payload), { flag: 'wx' });
    await rename(tempPath, lockPath);
  } catch {
    await rm(tempPath, { force: true });
    return false;
  }
  // Read the lock back: only a payload that's still exactly OURS means our rename is the one
  // that "won" — a concurrent challenger's rename landing microseconds after ours would mean the
  // file we just wrote is already gone, and we must NOT believe we hold the lock.
  try {
    const after = JSON.parse(await readFile(lockPath, 'utf-8')) as SpawnLockFile;
    return after.pid === payload.pid && after.startedAt === payload.startedAt;
  } catch {
    return false;
  }
}

async function releaseSpawnLock(stateDir: string): Promise<void> {
  const lockPath = spawnLockPath(stateDir);
  try {
    const existing = JSON.parse(await readFile(lockPath, 'utf-8')) as SpawnLockFile;
    if (existing.pid === process.pid) await rm(lockPath, { force: true });
  } catch {
    // Already gone, or owned by someone else (shouldn't happen) — nothing more to do.
  }
}

export interface WardenFile {
  readonly v: 1;
  readonly pid: number;
  readonly port: number;
  readonly token: string;
  readonly wsEndpoint: string;
  readonly startedAt: string;
}

const WARDEN_READY_TIMEOUT_MS = 3000;
const WARDEN_READY_POLL_MS = 100;

export function wardenFilePath(stateDir: string): string {
  return path.join(stateDir, 'warden.json');
}

export async function readWardenFile(stateDir: string): Promise<WardenFile | undefined> {
  try {
    const raw = await readFile(wardenFilePath(stateDir), 'utf-8');
    return JSON.parse(raw) as WardenFile;
  } catch {
    return undefined;
  }
}

async function healthCheck(
  file: WardenFile,
  fetchImpl: typeof fetch,
): Promise<{ pid: number; wsEndpoint: string } | undefined> {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${file.port}/v1/health`, {
      headers: { authorization: `Bearer ${file.token}` },
      signal: AbortSignal.timeout(WARDEN_HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as { pid: number; wsEndpoint: string };
  } catch {
    return undefined;
  }
}

/**
 * FR2-04 fix-2/GAP-231: a warden-side singleton check, called by a just-spawned warden process
 * BEFORE it does anything else (connect to Chrome, bind its HTTP server, start tracking targets).
 * The spawn lock in `ensureWarden` above is the primary defense against double-spawning, but
 * audit-2 found it isn't airtight under a stale-lock race; this is the defense-in-depth backstop
 * on the OTHER end — even if two spawns both got past the lock, at most one of them should ever
 * actually start acting as the session's warden. If `warden.json` already names a DIFFERENT,
 * live, healthy warden for the SAME `wsEndpoint`, this process is redundant and must exit
 * immediately without ever attaching to the browser or touching any dialog — the existing warden
 * keeps running untouched. Returns `false` (safe to proceed) when there's no rival, the rival is
 * for a different browser, or the rival is unreachable/stale.
 */
export async function isRivalWardenAlive(
  stateDir: string,
  wsEndpoint: string,
  selfPid: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const existing = await readWardenFile(stateDir);
  if (!existing || existing.pid === selfPid) return false;
  if (!isPidAlive(existing.pid)) return false;
  const health = await healthCheck(existing, fetchImpl);
  return !!health && health.wsEndpoint === wsEndpoint;
}

export interface EnsureWardenDeps {
  readonly stateDir: string;
  readonly wsEndpoint: string;
  readonly spawnFn?: typeof spawn;
  readonly fetchImpl?: typeof fetch;
  readonly execPath?: string;
  readonly argv1?: string;
}

export interface EnsureWardenResult {
  readonly port: number;
  readonly token: string;
  readonly reused: boolean;
}

/**
 * Reuses a healthy existing warden for this exact `wsEndpoint`, or spawns a fresh one. Called by
 * `withSessionFlow` after attach/spawn and BEFORE `fn()`, so the warden is watching before the
 * first action in this command can open a dialog. On a timed-out spawn it logs the exact §2.5
 * warning and returns `undefined` — degraded but not fatal (the gate falls back to
 * `DirectCdpBroker`).
 */
export async function ensureWarden(deps: EnsureWardenDeps): Promise<EnsureWardenResult | undefined> {
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function tryReuse(): Promise<EnsureWardenResult | undefined> {
    const existing = await readWardenFile(deps.stateDir);
    if (!existing) return undefined;
    const health = await healthCheck(existing, fetchImpl);
    if (health && health.wsEndpoint === deps.wsEndpoint) {
      return { port: existing.port, token: existing.token, reused: true };
    }
    return undefined;
  }

  const reused = await tryReuse();
  if (reused) return reused;

  // GAP-223: exactly one warden per session — take the spawn lock before spawning. A caller that
  // loses the race waits for the winner's `warden.json` instead of spawning its own.
  const owns = await tryAcquireSpawnLock(deps.stateDir);
  if (!owns) {
    const waitDeadline = Date.now() + SPAWN_LOCK_WAIT_MS;
    while (Date.now() < waitDeadline) {
      const found = await tryReuse();
      if (found) return found;
      await new Promise((r) => setTimeout(r, SPAWN_LOCK_POLL_MS));
    }
    // The winner never published a healthy warden (crashed mid-spawn?) — try taking the lock
    // ourselves rather than leaving the session with no warden at all.
    const ownsNow = await tryAcquireSpawnLock(deps.stateDir);
    if (!ownsNow) {
      console.error(
        'Warning: the dialog warden did not start, so dialogs left open between commands can\'t be handled ' +
          'or auto-handled. Run "sutradhar dialog" to check.',
      );
      return undefined;
    }
    return spawnAndWait(deps, fetchImpl);
  }
  try {
    // Re-check after acquiring the lock: another process may have finished spawning between our
    // first check and taking the lock.
    const reusedAfterLock = await tryReuse();
    if (reusedAfterLock) return reusedAfterLock;
    return await spawnAndWait(deps, fetchImpl);
  } finally {
    await releaseSpawnLock(deps.stateDir);
  }
}

async function spawnAndWait(deps: EnsureWardenDeps, fetchImpl: typeof fetch): Promise<EnsureWardenResult | undefined> {
  const spawnFn = deps.spawnFn ?? spawn;
  const execPath = deps.execPath ?? process.execPath;
  const argv1 = deps.argv1 ?? process.argv[1]!;
  const payload = Buffer.from(
    JSON.stringify({ wsEndpoint: deps.wsEndpoint, stateFile: path.join(deps.stateDir, 'state.json') }),
  ).toString('base64url');

  const child = spawnFn(execPath, [argv1, '__dialog-warden', payload], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: os.homedir(),
  });
  child.unref();

  const deadline = Date.now() + WARDEN_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const file = await readWardenFile(deps.stateDir);
    if (file && file.wsEndpoint === deps.wsEndpoint) {
      const health = await healthCheck(file, fetchImpl);
      if (health) return { port: file.port, token: file.token, reused: false };
    }
    await new Promise((r) => setTimeout(r, WARDEN_READY_POLL_MS));
  }

  console.error(
    'Warning: the dialog warden did not start, so dialogs left open between commands can\'t be handled ' +
      'or auto-handled. Run "sutradhar dialog" to check.',
  );
  return undefined;
}

/** Stops this session's warden (if any) and removes its sidecar file. Called by `close` and by
 *  self-heal, BEFORE `killChromeTree`/`clearState` — the warden must not still be holding a
 *  session (or, on Windows, a directory handle) once state is cleared out from under it. */
export async function stopWarden(stateDir: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const file = await readWardenFile(stateDir);
  if (!file) return;
  const health = await healthCheck(file, fetchImpl);
  if (health && health.pid === file.pid) {
    try {
      process.kill(file.pid, 'SIGTERM');
    } catch {
      // Already gone — fine, we're removing the file either way.
    }
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const stillUp = await healthCheck(file, fetchImpl);
      if (!stillUp) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await rm(wardenFilePath(stateDir), { force: true });
  await rm(spawnLockPath(stateDir), { force: true }); // tidiness only — a live lock always self-releases
}

/** Writes `warden.json` — called by the warden process itself (via cli.ts's `__dialog-warden`
 *  dispatch) once its HTTP server is listening. */
export async function writeWardenFile(stateDir: string, file: WardenFile): Promise<void> {
  await writeFile(wardenFilePath(stateDir), JSON.stringify(file, null, 2), 'utf-8');
}

/** Deletes `warden.json` ONLY if it still names this pid — called by the warden on its own exit,
 *  so a warden that lost a race to a newer one spawned in its place never deletes the newer
 *  file out from under it. */
export async function removeWardenFileIfOwned(stateDir: string, pid: number): Promise<void> {
  const file = await readWardenFile(stateDir);
  if (file && file.pid === pid) {
    await rm(wardenFilePath(stateDir), { force: true });
  }
}

/** Reads the session's persisted dialog policy for the warden to apply between commands — a
 *  thin adapter so `dialog-warden.ts` (browser package) never needs to know about `CliState`'s
 *  shape or the state file's location. A persisted `'report'` policy (D10) has nothing for the
 *  warden to auto-apply — it means "leave it open and let a command/`sutradhar dialog` handle
 *  it" — so this returns `undefined` for that case, same as no policy at all. */
export function policyFromState(state: CliState | undefined): { mode: 'accept' | 'dismiss'; promptText?: string } | undefined {
  const action = state?.dialogPolicy?.action;
  if (action !== 'accept' && action !== 'dismiss') return undefined;
  return { mode: action, promptText: state!.dialogPolicy!.promptText };
}
