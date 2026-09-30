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
import net from 'node:net';
import { BrowserLauncher } from '@sutradhar/browser';
import { createTempProfileDir, writeOwnerMarker } from './temp-profile.js';

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

/** Spawns a detached Chrome with remote debugging enabled and returns its browser-level CDP
 *  WebSocket endpoint plus its PID, once it's actually ready to accept connections.
 *  `userDataDir` defaults to a fresh throwaway temp directory — pass a named profile's
 *  directory (via `SutradharRuntime.getProfileManager().resolveUserDataDir(name)`) to launch
 *  with persistent cookies/history/localStorage instead. `userAgent`, if given, overrides
 *  `navigator.userAgent` via Chrome's own `--user-agent` flag — unset by default, so the real
 *  Chrome UA (including "HeadlessChrome" when headless) is left as-is; see the equivalent doc
 *  comment on `BrowserLaunchOptions.userAgent` for why this must never default to stripping it. */
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
): Promise<SpawnedChrome> {
  const chromePath = new BrowserLauncher().findExecutablePath();
  if (!chromePath) {
    throw new Error('No Chrome/Chromium/Edge found on this system. Run "sutradhar doctor" to diagnose.');
  }

  const port = await getFreePort();
  const tempProfile = userDataDir === undefined;
  const resolvedUserDataDir = userDataDir ?? (await createTempProfileDir());
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${resolvedUserDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (headless) args.push('--headless=new');
  if (userAgent) args.push(`--user-agent=${userAgent}`);
  if (!headless && windowSize) args.push(`--window-size=${windowSize.width},${windowSize.height}`);

  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  const pid = child.pid;
  if (!pid) throw new Error('Failed to spawn Chrome — no PID returned.');
  child.unref();
  // Records the owning Chrome PID so a later stale sweep can tell a dead session's dir from a
  // live one (temp-profile.ts rule 3).
  if (tempProfile) await writeOwnerMarker(resolvedUserDataDir, pid);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const info = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (info.webSocketDebuggerUrl) return { wsEndpoint: info.webSocketDebuggerUrl, pid, userDataDir: resolvedUserDataDir, tempProfile };
      }
    } catch {
      // Chrome's DevTools HTTP endpoint isn't up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for Chrome to start on port ${port}.`);
}

/** Kills a Chrome process (and its child processes — a plain `process.kill(pid)` only signals
 *  the top-level process, leaving the renderer/GPU/utility subprocesses it spawned running as
 *  orphans) previously started by {@link spawnDetachedChrome}. Best-effort: the process may
 *  already be gone (killed externally, crashed) — that's not an error worth surfacing.
 *  Resolves once the kill command itself has finished (hard timeout `timeoutMs`), so a caller
 *  can go on to wait for the process to exit and clean up its profile dir (GAP-315). */
export async function killChromeTree(pid: number, timeoutMs = 10_000): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
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
