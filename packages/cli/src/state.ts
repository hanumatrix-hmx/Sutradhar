/**
 * @file packages/cli/src/state.ts
 * @description Persists the "current session" across separate CLI process invocations. Each
 * `sutradhar <verb>` call is its own short-lived Node process — there's no long-running daemon
 * (unlike the real sutradhar/sutradhar Go project's server/bridge model) — so continuity comes
 * from writing the live session's CDP wsEndpoint to disk after `nav`, then every subsequent
 * command `attach()`-ing back to that same wsEndpoint before doing anything else.
 */
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
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
  /** NEW (FR2-03). The exact `--user-data-dir` passed to Chrome for this session — the
   *  throwaway temp dir `spawnDetachedChrome` created, or the resolved named-profile dir when
   *  `--profile` was used. Absent in state files written before 0.5.0 (see resolveStateRoot's
   *  doc comment and §0.8 of the FR2-03 spec for the backward-compat story). */
  profileDir?: string;
  /** NEW (FR2-03). True only when the CLI created `profileDir` itself as a throwaway temp dir
   *  (`ownsUserDataDir` from `spawnDetachedChrome`); false for `--profile`. Only a `true` dir is
   *  ever a garbage-collection deletion candidate — a named profile is deleted only via
   *  `sutradhar profile delete`, never by GC. */
  profileDirOwned?: boolean;
  /** NEW (FR2-03). `path.resolve(process.cwd())` at session-creation time — shown by `sessions`
   *  and used to correlate a state file back to the directory that owns it. */
  cwd?: string;
  /** NEW (FR2-03). ISO-8601 time the session was created — the primary age source for
   *  `sessions`; a legacy state with no `createdAt` falls back to the state file's own mtime. */
  createdAt?: string;
}

/**
 * Root directory all CLI session-state directories (one per cwd-hash) live under. Defaults to
 * `~/.sutradhar-cli`, overridable with `SUTRADHAR_CLI_STATE_ROOT` — distinct from
 * `SUTRADHAR_CLI_STATE_DIR` (which points at one specific session's directory directly).
 * `SUTRADHAR_CLI_STATE_ROOT` exists so a test harness (or CI) can redirect *every* session this
 * process creates into a scratch directory without needing to know or override each
 * individual cwd-hash path, and without touching `HOME`/`USERPROFILE` (which breaks Chrome —
 * see `resolveStateDir`'s existing doc comment).
 */
export function resolveStateRoot(envRoot: string | undefined): string {
  return envRoot ? path.resolve(envRoot) : path.join(os.homedir(), '.sutradhar-cli');
}

/**
 * Where the "current session" pointer lives. Defaults to a directory scoped to the caller's
 * cwd under `<stateRoot>/<hash-of-cwd>`, but can be overridden entirely with
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
export function resolveStateDir(cwd: string, envOverride: string | undefined, envRoot?: string): string {
  if (envOverride) return path.resolve(envOverride);
  const cwdHash = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 16);
  return path.join(resolveStateRoot(envRoot), cwdHash);
}

const STATE_DIR = resolveStateDir(
  process.cwd(),
  process.env.SUTRADHAR_CLI_STATE_DIR,
  process.env.SUTRADHAR_CLI_STATE_ROOT,
);
const STATE_FILE = path.join(STATE_DIR, 'state.json');

/** Exported so callers that need the exact path (the CLI marker embeds it; GC's `sessions`
 *  scan compares against it to mark the current cwd's row) don't have to re-derive it. */
export const STATE_FILE_PATH = STATE_FILE;

/** Tolerant parse of a `state.json`'s raw text: accepts anything shaped like a `CliState`
 *  (a plain object with at least string `sessionId` and `wsEndpoint`), including a pre-0.5.0
 *  file with none of the new fields — those simply come back `undefined`, exactly as
 *  `readState`'s callers already expect from an old file. Rejects `null`, arrays, and anything
 *  missing/mistyping the two required fields. Never throws. */
export function parseCliState(raw: string): CliState | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
  const o = obj as Record<string, unknown>;
  if (typeof o.sessionId !== 'string' || typeof o.wsEndpoint !== 'string') return undefined;
  return o as unknown as CliState;
}

export async function readState(): Promise<CliState | undefined> {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    return parseCliState(raw);
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

/**
 * Compare-and-delete for `state.json`, used by garbage collection (which decides a session is
 * stale from a *snapshot* taken some time before it actually deletes anything) so a `close` or
 * self-heal that raced in in the meantime and wrote a genuinely new session isn't clobbered.
 * Deletes only if the file on disk right now still has the exact `sessionId`/`wsEndpoint` GC
 * planned against; any other content (including the file being gone already) is left alone.
 * After a successful clear, also removes the now-parent directory, but ONLY if it's now empty —
 * a sibling `history.jsonl` (FR2-11) or any other file must survive.
 */
export async function clearStateFileIfUnchanged(
  file: string,
  expect: { sessionId: string; wsEndpoint: string },
): Promise<'cleared' | 'changed-concurrently' | 'absent'> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf-8');
  } catch {
    return 'absent';
  }
  const current = parseCliState(raw);
  if (!current || current.sessionId !== expect.sessionId || current.wsEndpoint !== expect.wsEndpoint) {
    return 'changed-concurrently';
  }
  await rm(file, { force: true });
  const dir = path.dirname(file);
  try {
    const remaining = await readdir(dir);
    if (remaining.length === 0) await rm(dir, { recursive: true, force: true });
  } catch {
    // Directory already gone, or unreadable — nothing further to do either way.
  }
  return 'cleared';
}
