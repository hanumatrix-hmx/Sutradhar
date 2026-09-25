/**
 * @file packages/cli/src/gc.ts
 * @description `doctor --gc` / `close --all-stale` (D3: one operation, two spellings) — finds
 * every leaked CLI/runtime Chrome profile directory and orphaned Chrome process this CLI or
 * runtime marked as its own, kills only what's provably orphaned, and deletes only a directory
 * that's provably unreferenced. See FR2-03 spec §0.1-§0.5 and §2.8 for the full attribution and
 * kill/delete rule set this module implements; `planGc` is the pure decision function so it can
 * be unit-tested without touching the filesystem or spawning anything real.
 */
import path from 'node:path';
import os from 'node:os';
import { readdir, lstat, realpath } from 'node:fs/promises';
import type { ListProcessesResult, ProcessInfo } from './process-list.js';
import { extractUserDataDir, isBrowserProcess, isPidAlive, killPid, listProcesses } from './process-list.js';
import { parseMarkerArgs, readOwnerFile, type OwnerFile } from '@sutradhar/browser';
import {
  GC_GRACE_MS,
  SUTRADHAR_TEMP_DIR_RE,
  PUPPETEER_TEMP_DIR_RE,
  isOwnedTempProfileDir,
  normalizePathForCompare,
  probeLock,
  removeDirWithRetry,
  type RemoveResult,
} from './profile-cleanup.js';
import { clearStateFileIfUnchanged, STATE_FILE_PATH, resolveStateRoot } from './state.js';
import { killChromeTree } from './spawn-chrome.js';
import { buildSessionsSnapshot, type SessionsSnapshot } from './sessions.js';

export interface CandidateDir {
  path: string;
  mtimeMs: number;
  isSymlink: boolean;
  isDirectory: boolean;
  /** parsed .sutradhar-owner.json contents, when present and valid (Puppeteer dirs only) */
  ownerFile?: OwnerFile;
}

export interface GcScope {
  tempRoot: string;
  stateRoot: string;
  extraStateDirs: string[];
}

export interface GcSnapshot {
  scope: GcScope;
  sessions: SessionsSnapshot;
  processEnumeration: ListProcessesResult;
  candidateDirs: CandidateDir[];
  /** Only consulted when `processEnumeration.ok === false` (degraded mode, §0.2). */
  lockProbes: Record<string, 'free' | 'in-use' | 'unknown'>;
  now: number;
}

export type KeptReason =
  | 'live-session'
  | 'unresponsive-session'
  | 'unknown-liveness'
  | 'in-use'
  | 'grace'
  | 'not-sutradhar'
  | 'out-of-scope'
  | 'named-profile'
  | 'symlink'
  | 'unreadable-state';

export interface KillAction {
  type: 'kill';
  pid: number;
  role: 'browser' | 'child';
  userDataDir?: string;
  reason: 'orphan-cli' | 'orphan-runtime' | 'legacy-orphan';
  result: 'planned' | 'killed' | 'failed';
  error?: string;
}
export interface ClearStateAction {
  type: 'clearState';
  stateFile: string;
  result: 'planned' | 'cleared' | 'changed-concurrently' | 'absent';
}
export interface DeleteDirAction {
  type: 'deleteDir';
  path: string;
  reason: 'stale-session' | 'orphan-browser' | 'owner-dead' | 'orphan-dir';
  result: 'planned' | 'deleted' | 'absent' | 'failed';
  code?: string;
  attempts?: number;
}
export type GcAction = KillAction | ClearStateAction | DeleteDirAction;

export interface KeptItem {
  path?: string;
  pid?: number;
  reason: KeptReason;
}

export interface GcPlan {
  actions: GcAction[];
  kept: KeptItem[];
  incomplete: boolean;
}

/** GAP-175: extracts every distinct CLI-marker state-file path referenced by a marked Chrome's
 *  own command line (`--sutradhar-state=<base64url(path)>`, D1), from a process enumeration.
 *  Pure and independently unit-testable so the discovery step itself (not just its downstream
 *  effect on `planGc`) has real coverage. Returns `[]` when enumeration is unavailable.
 *
 *  GAP-184 (audit-2): the original version trusted this marker on ANY process, pointing at ANY
 *  path, with zero validation — live-reproduced (adv-forged-marker.mjs) as a plain `node`
 *  process (no `--user-data-dir` at all, not a Chrome process by any measure) carrying a forged
 *  `--sutradhar-state` pointing at an arbitrary foreign file, which GC then deleted along with
 *  its parent dir and an unrelated, grace-protected young profile dir. `tempRoot` scopes trust:
 *  a marker is only ever discovered from a process that (a) actually looks like a browser
 *  (`isBrowserProcess`: no `--type=`) AND (b) carries its OWN `--user-data-dir` sitting inside
 *  `tempRoot` with the exact CLI temp-dir naming (`isOwnedTempProfileDir(.., 'cli')`) — every
 *  genuine CLI-spawned Chrome satisfies this unconditionally (`spawnDetachedChrome` always
 *  creates its owned profile dir under `os.tmpdir()`, regardless of where `SUTRADHAR_CLI_STATE_DIR`
 *  points), so this closes the "any process, any path" hole without narrowing GAP-175's own
 *  legitimate case (a custom, out-of-stateRoot `--sutradhar-state` target) at all. The referenced
 *  state-file path itself must also literally be named `state.json` (real state files are never
 *  named anything else) — rejects the forged repro's `session-cache.json` outright.
 *
 *  Deliberately NOT required here: that the referenced file, if it exists, already parses as a
 *  well-formed `CliState` (spec-suggested check (b)). A forged payload can trivially satisfy that
 *  shape (the adv-forged-marker repro's JSON had valid `sessionId`/`wsEndpoint` fields — shape
 *  alone doesn't distinguish it), so it adds no real defense here; worse, REQUIRING a successful
 *  parse at discovery time would silently drop a genuine session's own state file during exactly
 *  the mid-write race GAP-185 exists to protect (the file is real and legitimate, just
 *  transiently unreadable) — turning a protection into a new blind spot. Content-shape validation
 *  is instead left to the existing downstream `scanStateFiles`/`classifySession` path, which
 *  already reports a file that doesn't parse as `unreadable` (protected, never actioned — see
 *  GAP-185's fix in `planGc`) rather than silently discarding it. */
export function discoverMarkerStateFiles(processEnumeration: ListProcessesResult, tempRoot: string): string[] {
  if (!processEnumeration.ok) return [];
  const out = new Set<string>();
  for (const proc of processEnumeration.processes) {
    if (!proc.commandLine) continue;
    if (!isBrowserProcess(proc.commandLine)) continue; // GAP-184: never trust a non-browser carrier
    const udd = extractUserDataDir(proc.commandLine);
    if (!udd || !isOwnedTempProfileDir(udd, tempRoot, 'cli')) continue; // GAP-184: carrier must be our own real CLI Chrome
    const marker = parseMarkerArgs(proc.commandLine);
    if (marker?.kind === 'cli' && marker.stateFile && path.basename(marker.stateFile) === 'state.json') {
      out.add(marker.stateFile);
    }
  }
  return [...out];
}

function isInScope(dir: string | undefined, tempRoot: string): boolean {
  if (!dir) return false;
  return normalizePathForCompare(path.dirname(dir)) === normalizePathForCompare(tempRoot);
}

function withinGrace(ageMs: number): boolean {
  return ageMs < GC_GRACE_MS;
}

/** Alive-and-same: the owner PID is alive, and (when a start time is known for both) the
 *  start times agree within 5s — otherwise it's a different process that reused the PID. An
 *  alive owner with no comparable start time still counts as alive-and-same (never falsely
 *  treated as a PID-reuse orphan just because we can't double-check the timestamp). */
function ownerAliveAndSame(ownerPid: number, ownerStartMs: number, processes: ProcessInfo[]): boolean {
  if (!isPidAlive(ownerPid)) return false;
  const proc = processes.find((p) => p.pid === ownerPid);
  if (!proc) return true; // alive per process.kill(pid,0), just not in this snapshot's list — trust "alive"
  return Math.abs(proc.startMs - ownerStartMs) <= 5000;
}

/**
 * Pure GC planner: given a snapshot (already-collected sessions/processes/dirs, no I/O here),
 * decides every kill/clearState/deleteDir action and every `kept` item. Never mutates anything.
 */
export function planGc(snapshot: GcSnapshot): GcPlan {
  const { scope, sessions, processEnumeration, candidateDirs, lockProbes, now } = snapshot;
  const actions: GcAction[] = [];
  const kept: KeptItem[] = [];
  const incomplete = !processEnumeration.ok;

  const referencedDirs = new Set<string>();
  const referencedPids = new Set<number>();

  // --- 1. Sessions, pass 1: live/unresponsive/unknown/unreadable are untouchable and their
  //     pid/dir get reserved in `referencedDirs`/`referencedPids` BEFORE any stale session's dir
  //     is considered for deletion (GAP-177). A stale session's own state file is safe to clear
  //     unconditionally (compare-and-delete, keyed on sessionId+wsEndpoint), but its *dir* is
  //     only queued for deletion in pass 3 below, once every other session AND every live
  //     process has had a chance to claim that same dir — a stale state file can, in practice
  //     (hand-edited, or two sessions racing onto the same reused temp name), point at a
  //     directory a genuinely live session or process still owns; deleting it there would be
  //     exactly the "kills a live session" class of bug this item exists to close.
  const pendingStaleDirDeletes: string[] = [];
  // GAP-185: a state file that can't be read/parsed at all (empty, garbage, truncated by a
  // concurrent writeState — live-reproduced 3/3 deterministic + 1/348 under a realistic
  // concurrent-write race, see midwrite-race-strict.mjs) must make its session's liveness
  // UNKNOWN, never "orphan". `kept.push` below already protects the *stateFile path itself*
  // from clearState/deleteDir, but that alone did NOT stop the corresponding Chrome from being
  // killed: the browser process is attributed independently in pass 2 via its OWN command-line
  // marker (`--sutradhar-owner-pid` = the long-exited CLI that spawned it, which always reads
  // "dead" — that's the normal case, not evidence of an orphan), with no link back to this
  // session's unreadable status at all. Recording every unreadable session's stateFile here so
  // pass 2 can refuse to kill the exact browser whose marker points at it closes that gap.
  const unreadableStateFiles = new Set<string>();
  for (const s of sessions.sessions) {
    if (s.status === 'unreadable') {
      unreadableStateFiles.add(normalizePathForCompare(s.stateFile));
      kept.push({ path: s.stateFile, reason: 'unreadable-state' });
      continue;
    }
    if (s.status === 'live') {
      if (s.chromePid != null) referencedPids.add(s.chromePid);
      if (s.profileDir) referencedDirs.add(normalizePathForCompare(s.profileDir));
      kept.push({ path: s.stateFile, reason: 'live-session' });
      continue;
    }
    if (s.status === 'unresponsive') {
      if (s.chromePid != null) referencedPids.add(s.chromePid);
      if (s.profileDir) referencedDirs.add(normalizePathForCompare(s.profileDir));
      kept.push({ path: s.stateFile, reason: 'unresponsive-session' });
      continue;
    }
    if (s.status === 'unknown') {
      if (s.chromePid != null) referencedPids.add(s.chromePid);
      if (s.profileDir) referencedDirs.add(normalizePathForCompare(s.profileDir));
      kept.push({ path: s.stateFile, reason: 'unknown-liveness' });
      continue;
    }
    // stale
    if (s.sessionId && s.endpoint) {
      actions.push({ type: 'clearState', stateFile: s.stateFile, result: 'planned' });
    }
    if (s.profileDir) {
      if (s.profileDirOwned && isOwnedTempProfileDir(s.profileDir, scope.tempRoot)) {
        pendingStaleDirDeletes.push(s.profileDir);
      } else if (!s.profileDirOwned) {
        kept.push({ path: s.profileDir, reason: 'named-profile' });
      }
    }
  }

  // --- 2. Process attribution and orphan detection.
  const processes = processEnumeration.ok ? processEnumeration.processes : [];
  const killedBrowserPids = new Set<number>();
  const dirsWithKilledBrowser = new Set<string>();

  if (processEnumeration.ok) {
    for (const proc of processes) {
      if (!isBrowserProcess(proc.commandLine)) continue; // children are handled via PPID chain below
      const marker = proc.commandLine ? parseMarkerArgs(proc.commandLine) : undefined;
      const udd = proc.commandLine ? extractUserDataDir(proc.commandLine) : undefined;

      if (marker?.kind === 'cli') {
        const inScope =
          isInScope(udd, scope.tempRoot) ||
          (marker.stateFile &&
            (normalizePathForCompare(path.dirname(marker.stateFile)).startsWith(normalizePathForCompare(scope.stateRoot)) ||
              scope.extraStateDirs.some((d) => normalizePathForCompare(marker.stateFile!).startsWith(normalizePathForCompare(d)))));
        if (!inScope) {
          kept.push({ pid: proc.pid, path: udd, reason: 'out-of-scope' });
          continue;
        }
        if (referencedPids.has(proc.pid)) continue; // a live/unresponsive/unknown session already covers it
        // GAP-185: this browser's own marker points at a state file this run could not read or
        // parse at all — liveness is UNKNOWN (it might be a live session whose state.json we
        // just caught mid-write), never "confirmed orphan". Protect it exactly like an
        // `unknown-liveness` session rather than falling through to the owner-pid check below
        // (whose exited-CLI-owner reading is the *expected*, not-orphaned, steady state here).
        if (marker.stateFile && unreadableStateFiles.has(normalizePathForCompare(marker.stateFile))) {
          kept.push({ pid: proc.pid, path: udd, reason: 'unknown-liveness' });
          continue;
        }
        const ownerOk = ownerAliveAndSame(marker.ownerPid, marker.ownerStartMs, processes);
        // Named-profile CLI orphan: dir is outside tempRoot (or not owned) — kill process, keep dir.
        const isNamedProfileTarget = udd ? !isOwnedTempProfileDir(udd, scope.tempRoot, 'cli') : true;
        if (!ownerOk) {
          actions.push({ type: 'kill', pid: proc.pid, role: 'browser', userDataDir: udd, reason: 'orphan-cli', result: 'planned' });
          killedBrowserPids.add(proc.pid);
          if (udd) {
            if (isNamedProfileTarget) {
              kept.push({ path: udd, reason: 'named-profile' });
            } else {
              dirsWithKilledBrowser.add(normalizePathForCompare(udd));
            }
          }
        } else {
          if (udd) kept.push({ path: udd, reason: 'in-use' });
        }
        continue;
      }

      if (marker?.kind === 'runtime') {
        // GAP-180: a runtime marker has no state-file concept to fall back on (unlike `cli`),
        // so its ONLY scope evidence is the profile dir itself. A caller-supplied `userDataDir`
        // (spec §0.1 row D — SDK/MCP callers that pass their own dir) is legitimately outside
        // `tempRoot`, and its owner going away is business as usual for that caller, not
        // Sutradhar's to act on: GC's reach must stay bounded to its own scratch area.
        if (udd && !isInScope(udd, scope.tempRoot)) {
          kept.push({ pid: proc.pid, path: udd, reason: 'out-of-scope' });
          continue;
        }
        if (referencedPids.has(proc.pid)) continue;
        const ownerOk = ownerAliveAndSame(marker.ownerPid, marker.ownerStartMs, processes);
        if (!ownerOk) {
          actions.push({ type: 'kill', pid: proc.pid, role: 'browser', userDataDir: udd, reason: 'orphan-runtime', result: 'planned' });
          killedBrowserPids.add(proc.pid);
          if (udd) dirsWithKilledBrowser.add(normalizePathForCompare(udd));
        } else if (udd) {
          kept.push({ path: udd, reason: 'in-use' });
        }
        continue;
      }

      // Unmarked browser process. Only relevant if it sits on a legacy-looking CLI dir under
      // tempRoot (pre-0.5.0 CLI); anything else (including an unmarked Puppeteer dir) is simply
      // not Sutradhar's to touch.
      if (udd && isOwnedTempProfileDir(udd, scope.tempRoot, 'cli') && isInScope(udd, scope.tempRoot)) {
        if (referencedPids.has(proc.pid)) continue;
        const ageMs = now - (proc.startMs || now);
        if (withinGrace(ageMs)) {
          kept.push({ path: udd, pid: proc.pid, reason: 'grace' });
        } else {
          actions.push({ type: 'kill', pid: proc.pid, role: 'browser', userDataDir: udd, reason: 'legacy-orphan', result: 'planned' });
          killedBrowserPids.add(proc.pid);
          dirsWithKilledBrowser.add(normalizePathForCompare(udd));
        }
      } else if (udd) {
        kept.push({ path: udd, pid: proc.pid, reason: 'not-sutradhar' });
      }
    }

    // --- 3. Structural descendants of a killed browser (PPID chain, e.g. Windows's
    //     crashpad-handler, which -- unlike renderer/gpu/utility children -- DOES carry its own
    //     `--user-data-dir` per spec §0.2's measurement). This is deliberately a STRUCTURAL
    //     check (ancestor chain reaches a pid this plan is about to kill), not a real
    //     `isPidAlive` check on the parent: at planning time the tree kill hasn't happened yet,
    //     so the parent is still alive by definition and a liveness check here can never fire
    //     (GAP-182 -- the check this replaced could structurally never trigger, so its own
    //     coverage was a false pass; a whole-tree kill (taskkill /T, POSIX process-group SIGKILL)
    //     takes every one of these descendants down together with the root browser regardless).
    const killedTreePids = new Set<number>(killedBrowserPids);
    for (const proc of processes) {
      if (killedTreePids.has(proc.pid)) continue;
      let ancestor = proc.ppid;
      let child = proc;
      let hops = 0;
      let root: ProcessInfo | undefined;
      while (hops < 10) {
        const parent = processes.find((p) => p.pid === ancestor);
        if (!parent) break;
        // GAP-183 (BLOCKER, audit-2): spec §0.2 requires proving the candidate parent actually
        // PREDATES the child before trusting the PPID link at all — PIDs get reused (live-
        // reproduced on this machine: an orphan browser's PID landed on a dead parent's reused
        // PID after ~150 spawns; a real `doctor --gc` then killed a totally unrelated live
        // process it misclassified as that browser's "child", with a computed worst case of 211
        // processes including explorer.exe on this machine's real process table). If either
        // side's start time is missing/non-finite, OR the "parent" was created strictly AFTER
        // the child, the link is UNVERIFIED: stop walking here rather than trusting it —
        // protecting the candidate, never killing it on an unproven ancestry. `<=` (not a
        // strict `<`) deliberately tolerates the two landing in the SAME enumeration-resolution
        // millisecond — a real browser's own structural child (e.g. crashpad-handler) is
        // routinely spawned fast enough to round to its parent's exact millisecond on a coarse
        // clock; only a parent that reads LATER than its supposed child is provably wrong.
        const parentStart = parent.startMs;
        const childStart = child.startMs;
        if (!Number.isFinite(parentStart) || !Number.isFinite(childStart) || parentStart > childStart) {
          break;
        }
        if (killedBrowserPids.has(parent.pid) || isBrowserProcess(parent.commandLine)) {
          root = parent;
          break;
        }
        child = parent;
        ancestor = parent.ppid;
        hops++;
      }
      if (root && killedBrowserPids.has(root.pid)) killedTreePids.add(proc.pid);
    }
    for (const proc of processes) {
      if (isBrowserProcess(proc.commandLine)) continue; // roots already have their own kill action
      if (killedTreePids.has(proc.pid)) {
        actions.push({ type: 'kill', pid: proc.pid, role: 'child', reason: 'orphan-cli', result: 'planned' });
      }
    }

    // --- 4. Any process still referencing a dir keeps it alive -- EXCEPT a descendant of a
    //     browser this same run is already killing (GAP-176: a killed browser's profile dir was
    //     being reported "in-use" forever because only the browser's own pid was excluded here,
    //     never its children -- e.g. crashpad-handler's `--user-data-dir` reference on the exact
    //     same dir -- so the dir was never actually reclaimed in the run that killed its owner).
    for (const proc of processes) {
      const udd = proc.commandLine ? extractUserDataDir(proc.commandLine) : undefined;
      if (udd && !killedTreePids.has(proc.pid)) referencedDirs.add(normalizePathForCompare(udd));
    }
  }

  // --- 5. Stale-session dirs deferred from pass 1 (GAP-177): only queued for deletion now that
  //     every live/unresponsive/unknown session AND every still-referencing process (steps 2-4)
  //     has had a chance to claim the same dir. A stale STATE FILE pointing at a dir some other,
  //     genuinely live session or process still owns must never delete that dir -- the delete
  //     rules (spec §2.8 rules 3-4) apply here exactly as they do to every other delete path.
  for (const dir of pendingStaleDirDeletes) {
    const norm = normalizePathForCompare(dir);
    if (actions.some((a) => a.type === 'deleteDir' && normalizePathForCompare(a.path) === norm)) continue;
    if (referencedDirs.has(norm)) {
      kept.push({ path: dir, reason: 'in-use' });
      continue;
    }
    if (!processEnumeration.ok) {
      const lock = lockProbes[dir] ?? 'unknown';
      if (lock !== 'free') {
        kept.push({ path: dir, reason: lock === 'in-use' ? 'in-use' : 'unknown-liveness' });
        continue;
      }
    }
    actions.push({ type: 'deleteDir', path: dir, reason: 'stale-session', result: 'planned' });
  }

  // --- 6. Directory scan: legacy/orphan/fake dirs not already handled via a session/process
  //     path above.
  for (const dir of candidateDirs) {
    const norm = normalizePathForCompare(dir.path);
    if (actions.some((a) => a.type === 'deleteDir' && normalizePathForCompare(a.path) === norm)) continue;
    if (kept.some((k) => k.path && normalizePathForCompare(k.path) === norm)) continue;

    if (dir.isSymlink) {
      kept.push({ path: dir.path, reason: 'symlink' });
      continue;
    }
    if (!isOwnedTempProfileDir(dir.path, scope.tempRoot)) {
      kept.push({ path: dir.path, reason: 'not-sutradhar' });
      continue;
    }
    if (referencedDirs.has(norm)) {
      kept.push({ path: dir.path, reason: 'in-use' });
      continue;
    }

    const isPuppeteerDir = /^puppeteer_dev_chrome_profile-/.test(path.basename(dir.path));
    const ageMs = now - dir.mtimeMs;

    // D2 (Puppeteer dirs are collected only when attributed) applies identically whether
    // enumeration is available or degraded -- GAP-178(a): degraded mode used to fall through to
    // the lock-probe branch below BEFORE this ownership gate ran at all, so it would happily
    // delete an unmarked, un-owned Puppeteer dir (another tool's, or another MCP server's) the
    // instant its lock looked free. The ownership requirement must be checked first, always.
    if (isPuppeteerDir) {
      if (!dir.ownerFile && !dirsWithKilledBrowser.has(norm)) {
        kept.push({ path: dir.path, reason: 'not-sutradhar' });
        continue;
      }
      if (!processEnumeration.ok) {
        const lock = lockProbes[dir.path] ?? 'unknown';
        if (lock === 'free') {
          actions.push({ type: 'deleteDir', path: dir.path, reason: 'owner-dead', result: 'planned' });
        } else {
          kept.push({ path: dir.path, reason: lock === 'in-use' ? 'in-use' : 'unknown-liveness' });
        }
        continue;
      }
      const ownerDead = dir.ownerFile ? !ownerAliveAndSame(dir.ownerFile.ownerPid, dir.ownerFile.ownerStartMs, processes) : undefined;
      if (dirsWithKilledBrowser.has(norm) || ownerDead === true) {
        actions.push({ type: 'deleteDir', path: dir.path, reason: dirsWithKilledBrowser.has(norm) ? 'orphan-browser' : 'owner-dead', result: 'planned' });
      } else {
        kept.push({ path: dir.path, reason: 'in-use' });
      }
      continue;
    }

    // Legacy sutradhar-cli-* dir with no session/process reference at all. GAP-178(b): the
    // 120s grace period must be honored in degraded mode too -- it protects a dir mid-`mkdtemp`
    // (spec §0.4's race window) regardless of whether process enumeration happens to be
    // available on this run; it must never be skipped just because enumeration failed.
    if (processEnumeration.ok && dirsWithKilledBrowser.has(norm)) {
      actions.push({ type: 'deleteDir', path: dir.path, reason: 'orphan-browser', result: 'planned' });
      continue;
    }
    if (withinGrace(ageMs)) {
      kept.push({ path: dir.path, reason: 'grace' });
      continue;
    }
    if (!processEnumeration.ok) {
      const lock = lockProbes[dir.path] ?? 'unknown';
      if (lock === 'free') {
        actions.push({ type: 'deleteDir', path: dir.path, reason: 'orphan-dir', result: 'planned' });
      } else {
        kept.push({ path: dir.path, reason: lock === 'in-use' ? 'in-use' : 'unknown-liveness' });
      }
      continue;
    }
    actions.push({ type: 'deleteDir', path: dir.path, reason: 'orphan-dir', result: 'planned' });
  }

  return { actions, kept, incomplete };
}

export interface ExecuteGcDeps {
  killChromeTree?: typeof killChromeTree;
  killPid?: typeof killPid;
  removeDirWithRetry?: typeof removeDirWithRetry;
  clearStateFileIfUnchanged?: typeof clearStateFileIfUnchanged;
  sessionsByStateFile?: Map<string, { sessionId: string; wsEndpoint: string }>;
}

export interface GcReport {
  dryRun: boolean;
  scope: GcScope;
  graceMs: number;
  processEnumeration: { ok: true; count: number } | { ok: false; reason: string };
  actions: GcAction[];
  kept: KeptItem[];
  remaining: { orphanProcesses: number; orphanDirs: number };
  exitCode: 0 | 1 | 2;
}

/** Executes a plan (mutating: kills, clears state, deletes dirs) in the order the spec
 *  requires — every kill resolves before the first `rm` call — using injectable deps so tests
 *  never touch a real filesystem or process. */
export async function executeGc(plan: GcPlan, snapshot: GcSnapshot, dryRun: boolean, deps: ExecuteGcDeps = {}): Promise<GcReport> {
  const doKillTree = deps.killChromeTree ?? killChromeTree;
  const doKillPid = deps.killPid ?? killPid;
  const doRemoveDir = deps.removeDirWithRetry ?? removeDirWithRetry;
  const doClearState = deps.clearStateFileIfUnchanged ?? clearStateFileIfUnchanged;

  const actions = plan.actions.map((a) => ({ ...a }));
  let anyFailed = false;

  if (!dryRun) {
    // Kills first, all in parallel.
    const killActions = actions.filter((a): a is KillAction => a.type === 'kill');
    await Promise.all(
      killActions.map(async (a) => {
        try {
          if (a.role === 'browser') {
            const { exited } = await doKillTree(a.pid);
            a.result = exited ? 'killed' : 'failed';
            if (!exited) {
              a.error = 'pid still alive after wait';
              anyFailed = true;
            }
          } else {
            doKillPid(a.pid);
            a.result = 'killed';
          }
        } catch (err) {
          a.result = 'failed';
          a.error = (err as Error).message;
          anyFailed = true;
        }
      }),
    );

    // Then clearState.
    const clearActions = actions.filter((a): a is ClearStateAction => a.type === 'clearState');
    for (const a of clearActions) {
      const sess = deps.sessionsByStateFile?.get(a.stateFile) ??
        (() => {
          const s = snapshot.sessions.sessions.find((x) => x.stateFile === a.stateFile);
          return s?.sessionId && s?.endpoint ? { sessionId: s.sessionId, wsEndpoint: s.endpoint } : undefined;
        })();
      if (!sess) {
        a.result = 'absent';
        continue;
      }
      const r = await doClearState(a.stateFile, sess);
      a.result = r;
    }

    // Then deleteDir, concurrency 4.
    const deleteActions = actions.filter((a): a is DeleteDirAction => a.type === 'deleteDir');
    let di = 0;
    async function delWorker() {
      while (di < deleteActions.length) {
        const a = deleteActions[di++]!;
        const r: RemoveResult = await doRemoveDir(a.path);
        a.result = r.status;
        a.code = r.code;
        a.attempts = r.attempts;
        if (r.status === 'failed') anyFailed = true;
      }
    }
    await Promise.all(Array.from({ length: 4 }, delWorker));
  }

  const remainingOrphanProcesses = actions.filter((a) => a.type === 'kill' && a.result !== 'killed').length;
  const remainingOrphanDirs = actions.filter((a) => a.type === 'deleteDir' && a.result !== 'deleted' && a.result !== 'absent').length;

  let exitCode: 0 | 1 | 2 = 0;
  if (dryRun) {
    exitCode = 0;
  } else if (anyFailed || !snapshot.processEnumeration.ok) {
    exitCode = 2;
  }

  return {
    dryRun,
    scope: snapshot.scope,
    graceMs: GC_GRACE_MS,
    processEnumeration: snapshot.processEnumeration.ok
      ? { ok: true, count: snapshot.processEnumeration.processes.length }
      : { ok: false, reason: snapshot.processEnumeration.reason },
    actions,
    kept: plan.kept,
    remaining: { orphanProcesses: remainingOrphanProcesses, orphanDirs: remainingOrphanDirs },
    exitCode,
  };
}

/** Collects a real `GcSnapshot` from the filesystem/process table. Order matters (§2.8): list
 *  candidate dirs FIRST, then scan states, then enumerate processes, then probe endpoints —
 *  so any Chrome that already existed when the dir listing ran is guaranteed visible to the
 *  later process enumeration (closing the mkdtemp-to-launch race window, see spec §0.4). */
export async function collectGcSnapshot(opts?: { extraStateDirs?: string[] }): Promise<GcSnapshot> {
  const tempRoot = await realpath(os.tmpdir()).catch(() => os.tmpdir());
  const stateRoot = resolveStateRoot(process.env.SUTRADHAR_CLI_STATE_ROOT);
  const extraStateDirs = opts?.extraStateDirs ?? [];

  // 1. Candidate dirs, first.
  const candidateDirs: CandidateDir[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(tempRoot);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (!SUTRADHAR_TEMP_DIR_RE.test(name) && !PUPPETEER_TEMP_DIR_RE.test(name)) continue;
    const full = path.join(tempRoot, name);
    let info;
    try {
      info = await lstat(full);
    } catch {
      continue;
    }
    const isPuppeteer = PUPPETEER_TEMP_DIR_RE.test(name);
    const ownerFile = isPuppeteer && info.isDirectory() && !info.isSymbolicLink() ? await readOwnerFile(full) : undefined;
    candidateDirs.push({
      path: full,
      mtimeMs: info.mtimeMs,
      isSymlink: info.isSymbolicLink(),
      isDirectory: info.isDirectory(),
      ownerFile,
    });
  }

  // 2 & 4. Process enumeration (also feeds the sessions scan's pidMatchesProfile check).
  const processEnumeration = await listProcesses();

  // GAP-175 (blocker): a CLI-marked Chrome carries `--sutradhar-state=<base64url(its own
  // state.json path)>` on its own command line (D1) -- read that back directly, rather than
  // relying only on a caller-supplied/env-supplied `extraStateDirs`. A session started with
  // `SUTRADHAR_CLI_STATE_DIR` pointing outside `stateRoot` is otherwise invisible to the
  // sessions scan once the CLI process that set that env var has exited (which is normal: the
  // CLI always exits after each command, only Chrome keeps running) -- there is then nothing
  // left in THIS process's own environment to say where that session's state file lives, and
  // its `ownerPid` (the exited CLI process) always reads back "dead". Without this, that dead
  // ownerPid was the ONLY signal `planGc` had, so a perfectly live session's Chrome and profile
  // got killed and deleted out from under it. Reading the marker's own state-file reference
  // finds the actual state file wherever it is, so the sessions scan can classify it properly
  // (typically `live`, via a real endpoint probe) and `planGc`'s `referencedPids`/`referencedDirs`
  // then protect it directly -- independent of whether its long-exited owner process is alive.
  const discoveredStateFiles = discoverMarkerStateFiles(processEnumeration, tempRoot);

  // 3 & 5. Scan states + probe endpoints.
  const sessions = await buildSessionsSnapshot({
    stateRoot,
    currentStateFile: STATE_FILE_PATH,
    extraStateFiles: [...extraStateDirs.map((d) => path.join(d, 'state.json')), ...discoveredStateFiles],
    processEnumeration,
    tempRoot,
  });

  // Degraded-mode-only lock probes.
  const lockProbes: Record<string, 'free' | 'in-use' | 'unknown'> = {};
  if (!processEnumeration.ok) {
    for (const dir of candidateDirs) {
      lockProbes[dir.path] = await probeLock(dir.path);
    }
  }

  return {
    scope: { tempRoot, stateRoot, extraStateDirs },
    sessions,
    processEnumeration,
    candidateDirs,
    lockProbes,
    now: Date.now(),
  };
}

export function formatGcHuman(report: GcReport): string {
  const lines: string[] = [];
  lines.push(report.dryRun ? 'Dry run — nothing was changed.' : 'GC run:');
  for (const a of report.actions) {
    if (a.type === 'kill') lines.push(`  kill pid=${a.pid} (${a.reason}): ${a.result}${a.error ? ` — ${a.error}` : ''}`);
    if (a.type === 'clearState') lines.push(`  clearState ${a.stateFile}: ${a.result}`);
    if (a.type === 'deleteDir') {
      lines.push(`  deleteDir ${a.path} (${a.reason}): ${a.result}${a.code ? ` [${a.code}, ${a.attempts} attempts]` : ''}`);
    }
  }
  for (const k of report.kept) {
    lines.push(`  kept ${k.path ?? `pid=${k.pid}`}: ${k.reason}`);
  }
  const killed = report.actions.filter((a) => a.type === 'kill' && a.result === 'killed').length;
  const killTotal = report.actions.filter((a) => a.type === 'kill').length;
  const cleared = report.actions.filter((a) => a.type === 'clearState' && a.result === 'cleared').length;
  const deleted = report.actions.filter((a) => a.type === 'deleteDir' && a.result === 'deleted').length;
  const deleteTotal = report.actions.filter((a) => a.type === 'deleteDir').length;
  const failed = report.actions.filter((a) => (a.type === 'kill' || a.type === 'deleteDir') && a.result === 'failed').length;
  lines.push(
    `Summary: killed ${killed}/${killTotal} orphan browsers, cleared ${cleared} stale sessions, deleted ${deleted}/${deleteTotal} dirs, ${failed} FAILED.`,
  );
  return lines.join('\n');
}
