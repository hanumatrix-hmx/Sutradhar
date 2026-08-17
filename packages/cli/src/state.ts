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
  /** The viewport `--viewport WIDTHxHEIGHT` last applied, re-applied on every subsequent
   *  command's reattach for the same reason as `grantedPermissions`/`activeTabId`: the CDP
   *  device-metrics override does not survive a client disconnect/reconnect cycle, so without
   *  this a session's viewport would silently revert to Chrome's default the moment a second
   *  CLI command runs (external field report, PROB-042). */
  viewport?: { width: number; height: number };
}

/**
 * Where the "current session" pointer lives. Defaults to `~/.sutradhar-cli`, but can be
 * redirected with `SUTRADHAR_CLI_STATE_DIR`.
 *
 * Why the override exists (found live, 2026-08-17, during a WebBench benchmark run): this file
 * is a single *global* mutable pointer, and every CLI invocation reads it to decide which
 * browser to attach to. Two unrelated CLI users on the same machine therefore silently share
 * one browser session — the second one attaches to the first one's live session and drives the
 * first one's tab. That was observed for real: a concurrent UI-audit job navigated this
 * benchmark run's tab out from under it, so `nav <a nps.gov url>` reported
 * "Navigated to http://bharattech.localhost:18000/portal/me?ui-shot=schooladmin" — a URL the
 * caller never asked for. There is no locking here and deliberately no daemon (see the file
 * header), so the cheap, non-invasive fix is to let each caller opt into its own state dir.
 * Overriding HOME/USERPROFILE instead is not a workaround: Chrome inherits those and fails to
 * start (confirmed live — "Timed out waiting for Chrome to start on port ...").
 */
const STATE_DIR = process.env.SUTRADHAR_CLI_STATE_DIR
  ? path.resolve(process.env.SUTRADHAR_CLI_STATE_DIR)
  : path.join(os.homedir(), '.sutradhar-cli');
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
