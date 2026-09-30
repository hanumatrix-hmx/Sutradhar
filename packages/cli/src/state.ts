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
import crypto from 'node:crypto';

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
  /** FR2-04. The session's default policy for native dialogs, set by `--dialog accept|dismiss`
   *  (with `--dialog-text`), and equally explicitly set to `'report'` by `--dialog report`
   *  (FR2-14's D10 fold-in — decisions.md 2026-09-26: `--dialog report` PERSISTS, it does not
   *  clear this key). Absent (the key never having been set at all) also means report — the
   *  CLI's own default. Re-applied on every reattach, like `viewport`, because in-process dialog
   *  handling dies with each process. */
  dialogPolicy?: { action: 'accept' | 'dismiss' | 'report'; promptText?: string; setAt: string };
  /** FR2-04. The last pending dialog a command saw when it exited. Diagnostics, plus detection
   *  fallback if the gate's own live probe can't reach the browser. The broker (gate/warden) is
   *  the source of truth; this is best-effort. */
  lastPendingDialog?: {
    targetId?: string;
    type: string;
    message: string;
    defaultValue?: string;
    url: string;
    openedAt: string;
  };
}

/**
 * Where the "current session" pointer lives. Defaults to a directory scoped to the caller's
 * cwd under `~/.sutradhar-cli/<hash-of-cwd>`, but can be overridden entirely with
 * `SUTRADHAR_CLI_STATE_DIR`.
 *
 * History (PROB-041): this used to be one single flat `~/.sutradhar-cli` directory shared by
 * every CLI invocation on the machine, with an opt-in `SUTRADHAR_CLI_STATE_DIR` escape hatch —
 * found live 2026-08-17 during a WebBench benchmark run (a concurrent UI-audit job navigated
 * the run's tab out from under it: `nav <a nps.gov url>` reported "Navigated to
 * http://bharattech.localhost:18000/portal/me?ui-shot=schooladmin", a URL the caller never
 * asked for). That fix required every caller to *know about and set* the env var themselves,
 * which real usage proved insufficient: a real user hit the identical default-shared-session
 * symptom on 2026-08-19 running the CLI from two unrelated project directories at once, with
 * neither having set the override. Cwd-scoping the default closes that gap with zero config:
 * repeated invocations from the *same* project directory still resolve to the same state file
 * (the continuity this whole mechanism exists for), while two different project directories
 * now get different files automatically, with no collision and nothing for the caller to set.
 * `SUTRADHAR_CLI_STATE_DIR` still works as an explicit override for anyone who wants shared or
 * custom state (e.g. deliberately sharing one session across sibling directories in CI).
 * Overriding HOME/USERPROFILE instead of either of these is not a workaround: Chrome inherits
 * those and fails to start (confirmed live — "Timed out waiting for Chrome to start on port ...").
 */
export function resolveStateDir(cwd: string, envOverride: string | undefined): string {
  if (envOverride) return path.resolve(envOverride);
  const cwdHash = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 16);
  return path.join(os.homedir(), '.sutradhar-cli', cwdHash);
}

export const STATE_DIR = resolveStateDir(process.cwd(), process.env.SUTRADHAR_CLI_STATE_DIR);
const STATE_FILE = path.join(STATE_DIR, 'state.json');
/** FR2-11: the append-only command history, a sibling of `state.json` (and `warden.json`). It is never read-
 *  modified-written and {@link clearState} never touches it: the record outlives `close` and self-heal. */
export const HISTORY_FILE_PATH = path.join(STATE_DIR, 'history.jsonl');

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
