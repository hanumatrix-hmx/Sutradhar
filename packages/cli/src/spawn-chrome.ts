/**
 * @file packages/cli/src/spawn-chrome.ts
 * @description Spawns Chrome directly (bypassing SutradharRuntime.launch()/Puppeteer's own
 * launcher) so it survives this CLI process exiting.
 *
 * Puppeteer's `launch()` registers its own process-exit cleanup that closes the browser it
 * spawned once the launching Node process exits — reasonable for a script that owns the
 * browser's whole lifecycle, but exactly wrong for a CLI where each command is a separate
 * short-lived process and the browser needs to keep running for the NEXT command to attach to.
 * Spawning Chrome ourselves with `detached: true` and connecting to it via `runtime.attach()`
 * (which already knows how to adopt an already-open page — see
 * BrowserSession.adoptExistingPage) sidesteps that entirely.
 */
import { spawn, type SpawnOptions } from 'node:child_process';
import net from 'node:net';
import { BrowserLauncher } from '@sutradhar/browser';
import { KILL_CAP_MS } from './close-session.js';
import { createTempProfileDir, dlog, removeSessionTempProfile, writeOwnerMarker } from './temp-profile.js';
import { taskkillExe } from './system-binaries.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface SpawnedChrome {
  wsEndpoint: string;
  /** The spawned Chrome process's PID — `attach()`-ed sessions only ever DETACH on
   *  shutdown/close (by design: Sutradhar doesn't own an attached browser's lifecycle, since
   *  attach mode is normally used against the user's own already-running browser). For a
   *  process WE spawned, something has to actually kill it, or every "sutradhar close" leaks
   *  the Chrome process — this PID is what `close` uses to do that. */
  pid: number;
  /** The `--user-data-dir` Chrome was started with. */
  userDataDir: string;
  /** True when {@link userDataDir} is an auto-created throwaway temp dir (no `--profile`) that
   *  `close` must remove (GAP-315). Never true for a named profile's dir. */
  tempProfile: boolean;
}

/** The minimal child-process surface {@link spawnDetachedChrome} uses (a real `ChildProcess` satisfies it). */
export interface ChildLike {
  pid?: number;
  unref(): void;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (err: Error) => void): unknown;
}

/** Test seams of {@link spawnDetachedChrome} / {@link discardSpawnedProfile} (GAP-349). Production
 *  passes none of them. */
export interface SpawnDeps {
  /** Replaces the Chrome lookup. */
  executablePath?: string;
  /** Root of the auto-created temp profile dir (default `os.tmpdir()`); also given to the removal. */
  tmpRoot?: string;
  spawnFn?: (file: string, args: string[], options: SpawnOptions) => ChildLike;
  /** Resolves the browser-level WebSocket endpoint once Chrome answers, else undefined. */
  probeEndpoint?: (port: number) => Promise<string | undefined>;
  /** How long to wait for Chrome to come up (default 10_000 ms, monotonic clock). */
  startTimeoutMs?: number;
  /** Defaults to `killChromeTree` itself, by reference: the same kill as 0.6.0. */
  kill?: (pid: number, timeoutMs: number) => Promise<void>;
  /** Defaults to `removeSessionTempProfile`. */
  removeProfile?: typeof removeSessionTempProfile;
  /** The single liveness seam handed through to `removeProfile` (default `isPidAlive`). */
  isAlive?: (pid: number) => boolean;
}

async function probeVersionEndpoint(port: number): Promise<string | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) {
      const info = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    }
  } catch {
    // Chrome's DevTools HTTP endpoint isn't up yet — keep polling.
  }
  return undefined;
}

export interface DiscardTarget {
  /** The spawned Chrome's PID, if one was ever obtained. */
  pid?: number;
  /** `false` when the child is known to have exited already: it is then NOT killed (its PID may
   *  have been reused by an unrelated process). Anything else (true/undefined) means "may be alive". */
  alive?: boolean;
  userDataDir: string;
  tempProfile: boolean;
}

/** GAP-349: undoes a spawn that will not be used — kills the Chrome (if it may be alive) and, for an
 *  auto-created temp profile only, removes its dir. When a kill was issued the PID is handed to the
 *  removal so the bounded, read-only exit wait runs before the delete (otherwise the just-killed
 *  Chrome would still count as alive and the dir would be kept). A named profile is never removed.
 *  Never throws. */
export async function discardSpawnedProfile(target: DiscardTarget, deps: SpawnDeps = {}): Promise<void> {
  let killed = false;
  dlog('discard', { path: target.userDataDir, pid: target.pid, alive: target.alive, temp: target.tempProfile });
  if (target.pid !== undefined && target.alive !== false) {
    killed = true;
    try {
      await (deps.kill ?? killChromeTree)(target.pid, KILL_CAP_MS);
    } catch {
      // best effort: the removal below still waits (read-only) for the process to be gone
    }
  }
  if (target.tempProfile) {
    try {
      await (deps.removeProfile ?? removeSessionTempProfile)(target.userDataDir, killed ? target.pid : undefined, {
        tmpRoot: deps.tmpRoot,
        isAlive: deps.isAlive,
      });
    } catch {
      // never throws; a leaked dir is retried by the next session-start sweep
    }
  }
}

const errCode = (err: unknown): string => (err as NodeJS.ErrnoException)?.code ?? 'unknown error';
const errText = (err: unknown): string => (err as Error)?.message ?? String(err);

/** Spawns a detached Chrome with remote debugging enabled and returns its browser-level CDP
 *  WebSocket endpoint plus its PID, once it's actually ready to accept connections.
 *  `userDataDir` defaults to a fresh throwaway temp directory — pass a named profile's
 *  directory (via `SutradharRuntime.getProfileManager().resolveUserDataDir(name)`) to launch
 *  with persistent cookies/history/localStorage instead. `userAgent`, if given, overrides
 *  `navigator.userAgent` via Chrome's own `--user-agent` flag — unset by default, so the real
 *  Chrome UA (including "HeadlessChrome" when headless) is left as-is; see the equivalent doc
 *  comment on `BrowserLaunchOptions.userAgent` for why this must never default to stripping it.
 *
 *  GAP-349: every failure after the auto-created temp dir exists (spawn throws, no PID, start
 *  timeout with the child alive, child already exited) removes that dir again via
 *  {@link discardSpawnedProfile} before the error is thrown. */
export async function spawnDetachedChrome(
  headless: boolean,
  userDataDir?: string,
  userAgent?: string,
  /** Real Chrome `--window-size` launch flag, applied only when `headless` is false (headless
   *  Chrome has no real OS window to size — the CDP device-metrics override, applied separately
   *  after attaching, is what actually matters there). Not pixel-perfect for a headed window —
   *  Chrome's own toolbar/frame chrome still eats a few dozen px this doesn't account for — but
   *  it's what stops a `--viewport 390x844` request from rendering phone-sized content inside a
   *  full-desktop-sized window with a large empty grey margin (found live via an external field
   *  report, PROB-042). */
  windowSize?: { width: number; height: number },
  deps: SpawnDeps = {},
): Promise<SpawnedChrome> {
  const chromePath = deps.executablePath ?? new BrowserLauncher().findExecutablePath();
  if (!chromePath) {
    throw new Error('No Chrome/Chromium/Edge found on this system. Run "sutradhar doctor" to diagnose.');
  }

  const port = await getFreePort();
  const tempProfile = userDataDir === undefined;
  const resolvedUserDataDir = userDataDir ?? (await createTempProfileDir(deps.tmpRoot));
  const discard = async (pid?: number, alive?: boolean): Promise<void> => {
    await discardSpawnedProfile({ pid, alive, userDataDir: resolvedUserDataDir, tempProfile }, deps);
  };
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${resolvedUserDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (headless) args.push('--headless=new');
  if (userAgent) args.push(`--user-agent=${userAgent}`);
  if (!headless && windowSize) args.push(`--window-size=${windowSize.width},${windowSize.height}`);

  let child: ChildLike;
  try {
    const spawnFn = deps.spawnFn ?? ((file, a, o) => spawn(file, a, o));
    child = spawnFn(chromePath, args, { detached: true, stdio: 'ignore' });
  } catch (err) {
    // P0: spawn threw synchronously (e.g. EFTYPE / UNKNOWN for a non-executable file).
    await discard();
    throw new Error(`Failed to spawn Chrome (${errCode(err)}): ${errText(err)}`);
  }
  // Always listen: an unhandled 'error' event would crash the CLI, and 'exit' tells the start loop
  // (and the discard) that the child is already gone.
  const seen: { error?: Error; exited?: { code: number | null; signal: NodeJS.Signals | null } } = {};
  child.once('error', (err) => {
    seen.error = err;
  });
  child.once('exit', (code, signal) => {
    seen.exited = { code, signal };
  });
  const pid = child.pid;
  if (!pid) {
    // P1: no PID (ENOENT is reported asynchronously through 'error', so read it after the await).
    await discard();
    await new Promise<void>((r) => setImmediate(r));
    const why = seen.error ? ` (${errCode(seen.error)}: ${errText(seen.error)})` : '';
    throw new Error(`Failed to spawn Chrome — no PID returned${why}.`);
  }
  child.unref();
  // Records the owning Chrome PID so a later stale sweep can tell a dead session's dir from a
  // live one (temp-profile.ts rule 3).
  if (tempProfile) await writeOwnerMarker(resolvedUserDataDir, pid);

  const probe = deps.probeEndpoint ?? probeVersionEndpoint;
  const startTimeoutMs = deps.startTimeoutMs ?? 10_000;
  const t0 = performance.now();
  while (seen.exited === undefined && performance.now() - t0 < startTimeoutMs) {
    const wsEndpoint = await probe(port).catch(() => undefined);
    if (wsEndpoint) return { wsEndpoint, pid, userDataDir: resolvedUserDataDir, tempProfile };
    await new Promise((r) => setTimeout(r, 150));
  }
  if (seen.exited !== undefined) {
    // P2x: the child is already gone — never kill a PID that may have been reused.
    const how = seen.exited.code !== null ? `code ${seen.exited.code}` : `signal ${seen.exited.signal}`;
    await discard(pid, false);
    throw new Error(`Chrome exited (${how}) before it was ready on port ${port}.`);
  }
  // P2: still alive but never became ready — never leave a Chrome (or its dir) no state file knows about.
  await discard(pid, true);
  throw new Error(`Timed out waiting for Chrome to start on port ${port}.`);
}

/** What {@link killChromeTree} needs from the `taskkill` child (a real `ChildProcess` satisfies it). */
export interface KillChild {
  on(event: 'exit' | 'error', listener: () => void): unknown;
}

/** Kills a Chrome process (and its child processes — a plain `process.kill(pid)` only signals
 *  the top-level process, leaving the renderer/GPU/utility subprocesses it spawned running as
 *  orphans) previously started by {@link spawnDetachedChrome}. Best-effort: the process may
 *  already be gone (killed externally, crashed) — that's not an error worth surfacing.
 *  Resolves once the kill command itself has finished (hard timeout `timeoutMs`), so a caller
 *  can go on to wait for the process to exit and clean up its profile dir (GAP-315). */
export async function killChromeTree(
  pid: number,
  timeoutMs = 10_000,
  /** Test seam (S6e-3): lets a unit test see the executable that is run. Production passes none. */
  spawnFn: (file: string, args: string[], options: SpawnOptions) => KillChild = (file, args, options) => spawn(file, args, options),
): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      // Absolute path (system-binaries.ts): same program and arguments as before, but never a
      // planted taskkill.exe from the cwd (Node 18/20 search the cwd first for a bare name).
      const tk = spawnFn(taskkillExe(), ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      const timer = setTimeout(resolve, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      tk.on('exit', done);
      tk.on('error', done);
    });
  } else {
    try {
      process.kill(-pid, 'SIGKILL'); // negative PID targets the whole process group
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}
