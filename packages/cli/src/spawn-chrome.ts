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
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { BrowserLauncher } from '@sutradhar/browser';
import { buildMarkerArgs, processStartMs } from '@sutradhar/browser';
import { waitForPidExit } from './process-list.js';

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
  /** The exact `--user-data-dir` Chrome was launched with. */
  userDataDir: string;
  /** True only when this function created `userDataDir` itself as a throwaway temp dir (no
   *  `userDataDir` argument was given); false when the caller passed a named-profile dir. Only
   *  a `true` dir is ever a GC deletion candidate. */
  ownsUserDataDir: boolean;
}

/** Pure argument-builder, extracted so it's testable without actually spawning Chrome (SC1/SC2
 *  in the FR2-03 test plan). `stateFile`, when given, becomes the CLI marker's
 *  `--sutradhar-state` (base64url of its absolute path) — how GC later finds the state file
 *  that (if still valid) proves this Chrome isn't an orphan. */
export function buildChromeArgs(opts: {
  port: number;
  userDataDir: string;
  headless: boolean;
  userAgent?: string;
  windowSize?: { width: number; height: number };
  stateFile?: string;
}): string[] {
  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (opts.headless) args.push('--headless=new');
  if (opts.userAgent) args.push(`--user-agent=${opts.userAgent}`);
  if (!opts.headless && opts.windowSize) {
    args.push(`--window-size=${opts.windowSize.width},${opts.windowSize.height}`);
  }
  args.push(
    ...buildMarkerArgs({
      kind: 'cli',
      ownerPid: process.pid,
      ownerStartMs: processStartMs(),
      stateFile: opts.stateFile,
    }),
  );
  return args;
}

/** Spawns a detached Chrome with remote debugging enabled and returns its browser-level CDP
 *  WebSocket endpoint plus its PID, once it's actually ready to accept connections.
 *  `userDataDir` defaults to a fresh throwaway temp directory — pass a named profile's
 *  directory (via `SutradharRuntime.getProfileManager().resolveUserDataDir(name)`) to launch
 *  with persistent cookies/history/localStorage instead. `userAgent`, if given, overrides
 *  `navigator.userAgent` via Chrome's own `--user-agent` flag — unset by default, so the real
 *  Chrome UA (including "HeadlessChrome" when headless) is left as-is; see the equivalent doc
 *  comment on `BrowserLaunchOptions.userAgent` for why this must never default to stripping it.
 *  `stateFile`, when given, is embedded in the CLI launch marker (see `buildChromeArgs`) — GC
 *  uses it to tell a live session's Chrome apart from a genuine orphan. On any failure after
 *  the process is spawned (the 10s DevTools-ready timeout, or any other throw), the spawned
 *  Chrome is killed and, if this call created the temp dir, that dir is removed — a failed
 *  `nav` must never leak either. */
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
  stateFile?: string,
): Promise<SpawnedChrome> {
  const chromePath = new BrowserLauncher().findExecutablePath();
  if (!chromePath) {
    throw new Error('No Chrome/Chromium/Edge found on this system. Run "sutradhar doctor" to diagnose.');
  }

  const port = await getFreePort();
  const ownsUserDataDir = userDataDir === undefined;
  // mkdtemp's random suffix fixes a real same-millisecond collision: two concurrent spawns
  // used to share one `sutradhar-cli-${Date.now()}` dir, and Chrome's own singleton-lock
  // handoff would then silently attach the second spawn to the first browser instead of
  // starting its own. The prefix keeps the existing SUTRADHAR_TEMP_DIR_RE recognizable.
  const resolvedUserDataDir = ownsUserDataDir
    ? await mkdtemp(path.join(os.tmpdir(), `sutradhar-cli-${Date.now()}-`))
    : userDataDir!;

  const args = buildChromeArgs({ port, userDataDir: resolvedUserDataDir, headless, userAgent, windowSize, stateFile });

  let pid: number | undefined;
  try {
    const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
    pid = child.pid;
    if (!pid) throw new Error('Failed to spawn Chrome — no PID returned.');
    child.unref();

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const info = (await res.json()) as { webSocketDebuggerUrl?: string };
          if (info.webSocketDebuggerUrl) {
            return { wsEndpoint: info.webSocketDebuggerUrl, pid, userDataDir: resolvedUserDataDir, ownsUserDataDir };
          }
        }
      } catch {
        // Chrome's DevTools HTTP endpoint isn't up yet — keep polling.
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for Chrome to start on port ${port}.`);
  } catch (err) {
    if (pid) await killChromeTree(pid).catch(() => {});
    if (ownsUserDataDir) await rm(resolvedUserDataDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** Kills a Chrome process (and its child processes — a plain `process.kill(pid)` only signals
 *  the top-level process, leaving the renderer/GPU/utility subprocesses it spawned running as
 *  orphans) previously started by {@link spawnDetachedChrome}. Best-effort: the process may
 *  already be gone (killed externally, crashed) — that's not an error worth surfacing. Awaits
 *  the kill command's own exit, then polls for the PID to actually disappear (up to `waitMs`)
 *  before returning — the caller (close/self-heal/GC) needs to know whether it's actually safe
 *  to remove the profile directory next, not just that a kill command was *issued*. */
export async function killChromeTree(pid: number, waitMs = 5000): Promise<{ exited: boolean }> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      child.on('close', () => resolve());
      child.on('error', () => resolve());
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
  const exited = await waitForPidExit(pid, waitMs);
  return { exited };
}
