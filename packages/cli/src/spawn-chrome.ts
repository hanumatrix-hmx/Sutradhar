/**
 * @file packages/cli/src/spawn-chrome.ts
 * @description Spawns Chrome directly (bypassing PinchTabRuntime.launch()/Puppeteer's own
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
import os from 'node:os';
import path from 'node:path';
import { BrowserLauncher } from '@pinchtab/browser';

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
   *  shutdown/close (by design: PinchTab doesn't own an attached browser's lifecycle, since
   *  attach mode is normally used against the user's own already-running browser). For a
   *  process WE spawned, something has to actually kill it, or every "pinchtab close" leaks
   *  the Chrome process — this PID is what `close` uses to do that. */
  pid: number;
}

/** Spawns a detached Chrome with remote debugging enabled and returns its browser-level CDP
 *  WebSocket endpoint plus its PID, once it's actually ready to accept connections.
 *  `userDataDir` defaults to a fresh throwaway temp directory — pass a named profile's
 *  directory (via `PinchTabRuntime.getProfileManager().resolveUserDataDir(name)`) to launch
 *  with persistent cookies/history/localStorage instead. */
export async function spawnDetachedChrome(headless: boolean, userDataDir?: string): Promise<SpawnedChrome> {
  const chromePath = new BrowserLauncher().findExecutablePath();
  if (!chromePath) {
    throw new Error('No Chrome/Chromium/Edge found on this system. Run "pinchtab doctor" to diagnose.');
  }

  const port = await getFreePort();
  const resolvedUserDataDir = userDataDir ?? path.join(os.tmpdir(), `pinchtab-cli-${Date.now()}`);
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${resolvedUserDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (headless) args.push('--headless=new');

  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  const pid = child.pid;
  if (!pid) throw new Error('Failed to spawn Chrome — no PID returned.');
  child.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const info = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (info.webSocketDebuggerUrl) return { wsEndpoint: info.webSocketDebuggerUrl, pid };
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
 *  already be gone (killed externally, crashed) — that's not an error worth surfacing. */
export function killChromeTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
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
