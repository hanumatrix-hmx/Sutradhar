/**
 * @file packages/cli/src/state.ts
 * @description Persists the "current session" across separate CLI process invocations. Each
 * `sutradhar <verb>` call is its own short-lived Node process — there's no long-running daemon
 * (unlike the real sutradhar/sutradhar Go project's server/bridge model) — so continuity comes
 * from writing the live session's CDP wsEndpoint to disk after `nav`, then every subsequent
 * command `attach()`-ing back to that same wsEndpoint before doing anything else.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface CliState {
  sessionId: string;
  wsEndpoint: string;
  /** PID of the Chrome process this CLI spawned itself (undefined if the session came from
   *  attaching to a browser the CLI didn't start) — see spawn-chrome.ts's killChromeTree. */
  chromePid?: number;
  lastUrl?: string;
  /** The --profile name this session was launched with, if any — lets `close` persist the
   *  current storage state into that profile before killing Chrome. See cli.ts's cmdClose for
   *  why this can't just rely on SutradharRuntime.shutdown()'s own auto-save. */
  profileName?: string;
  /** Permissions granted via `grant`, re-applied on every subsequent command's reattach.
   *  Necessary because Puppeteer's `overridePermissions()` does not survive a CDP client
   *  disconnect/reconnect cycle (confirmed live: a permission granted in one CLI invocation was
   *  gone by the next, even though the same browser/session persisted) — without this, `grant`
   *  would only ever be visible to the exact command that called it, making it useless in
   *  practice for the CLI's one-process-per-command architecture. */
  grantedPermissions?: { origin: string; permissions: string[] }[];
  /** The tab `focustab` last switched to. Necessary for the same reason as
   * `grantedPermissions`: `focustab`'s effect on the session's in-memory active-tab pointer is
   * discarded the instant that CLI process exits, so without persisting it, the very next
   * command's fresh `attach()` silently reverts to its own default (the most-recently-opened
   * tab) — found live testing the new `tabs`/`newtab`/`focustab` commands together. */
  activeTabId?: string;
}

const STATE_DIR = path.join(os.homedir(), '.sutradhar-cli');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

export async function readState(): Promise<CliState | undefined> {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as CliState;
  } catch {
    return undefined;
  }
}

export async function writeState(state: CliState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export async function clearState(): Promise<void> {
  await rm(STATE_FILE, { force: true });
}
