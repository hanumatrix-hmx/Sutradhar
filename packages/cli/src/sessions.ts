/**
 * @file packages/cli/src/sessions.ts
 * @description Read-only session inventory (`sutradhar sessions`) — scans every CLI state
 * file under the state root, classifies each as live/unresponsive/unknown/stale/unreadable
 * (FR2-03 spec §0.3), and formats the result. Never mutates anything; `doctor --gc` reuses
 * `scanStateFiles`/`classifySession` to decide what it's safe to actually clean up.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseCliState, type CliState } from './state.js';
import { isPidAlive, type ListProcessesResult } from './process-list.js';
import { extractUserDataDir } from './process-list.js';
import { normalizePathForCompare } from './profile-cleanup.js';

export type SessionStatus = 'live' | 'unresponsive' | 'unknown' | 'stale' | 'unreadable';

export interface ScannedSession {
  stateFile: string;
  current: boolean;
  raw: CliState | undefined;
  /** `undefined` only for an `unreadable` entry. */
  parseOk: boolean;
  /** GAP-189 (FR2-03 fix-3): true only when this entry's SOLE discovery route was a
   *  command-line marker read off some OTHER process (`discoverMarkerStateFiles`) rather than
   *  the trusted directory scan under `stateRoot` or an explicit `extraStateFiles` override. A
   *  marker is attacker-shapeable (any process can put the right substrings on its own command
   *  line), so a `viaMarker` entry must never be allowed to justify a deletion/clear action —
   *  see `planGc`'s pass-1 loop, which is structured so the only branch that emits
   *  clearState/deleteDir actions is unreachable for `viaMarker` entries. It can still gate
   *  protection (kept/referencedPids/referencedDirs) exactly like any other status. */
  viaMarker: boolean;
  cwd: string | null;
  createdAt: string | null;
  ageMs: number;
  ageSource: 'createdAt' | 'stateFileMtime';
  chromePid: number | null;
  profileDir: string | null;
  profileDirOwned: boolean;
  profileName: string | null;
  wsEndpoint: string | null;
  sessionId: string | null;
}

/** Scans `<stateRoot>/*\/state.json` (plus an extra dir, e.g. a legacy `SUTRADHAR_CLI_STATE_DIR`
 *  outside the root) into raw, unclassified entries. An ENOENT root gives `[]`, not an error —
 *  "no CLI has ever run here" is a normal, common case. */
export async function scanStateFiles(
  stateRoot: string,
  currentStateFile: string,
  extraStateFiles: string[] = [],
  /** GAP-189 (FR2-03 fix-3): state-file paths discovered via a command-line marker on some
   *  OTHER process (`discoverMarkerStateFiles`), kept structurally separate from the trusted
   *  `stateRoot` scan and `extraStateFiles` (an explicit, same-process env override — trusted
   *  the same way `stateRoot` itself is). Only a path whose SOLE discovery route is this list
   *  gets `viaMarker: true`; a path also reachable via the trusted routes is trusted in full. */
  markerStateFiles: string[] = [],
): Promise<ScannedSession[]> {
  let entries: string[];
  try {
    entries = await readdir(stateRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  // Dedup by normalized path: `extraStateFiles`/`markerStateFiles` may legitimately overlap with
  // a file already found under `stateRoot`, and scanning the same state.json twice would
  // double-count it in the sessions list and in every referencedPids/referencedDirs set derived
  // from it. Trusted paths (stateRoot scan + extraStateFiles) are listed FIRST so a path present
  // in both a trusted route and `markerStateFiles` is recorded once, as trusted.
  const trustedPaths = [...entries.map((e) => path.join(stateRoot, e, 'state.json')), ...extraStateFiles];
  const trustedNorm = new Set(trustedPaths.map((p) => normalizePathForCompare(p)));
  const seen = new Set<string>();
  const stateFiles: Array<{ file: string; viaMarker: boolean }> = [];
  for (const f of [...trustedPaths, ...markerStateFiles]) {
    const key = normalizePathForCompare(f);
    if (seen.has(key)) continue;
    seen.add(key);
    stateFiles.push({ file: f, viaMarker: !trustedNorm.has(key) });
  }
  const out: ScannedSession[] = [];
  for (const { file, viaMarker } of stateFiles) {
    // GAP-188 (FR2-03 fix-3): unify EVERY way this file can fail to yield trustworthy content
    // — `stat` throwing for a reason other than "doesn't exist" (EBUSY/EACCES/any I/O error),
    // `readFile` throwing (the exact live-reproduced case: a concurrent writer holding the file
    // open with FileShare.None), or the content parsing as garbage — into ONE outcome, the same
    // `unreadable` (protected, never actioned) status GAP-185 already gives a parse failure.
    // Previously `stat`/`readFile` throwing hit a separate `catch { continue }` that silently
    // DROPPED the session entirely, which then fell through to the old dead-owner-pid default
    // (treats it as orphaned) — the exact same underlying bug as GAP-185, reached via a sibling
    // path. There is now exactly one "could not determine trustworthy state" outcome, not two.
    let statInfo: { mtimeMs: number } | undefined;
    let ioFailed = false;
    try {
      statInfo = await stat(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; // genuinely doesn't exist — not a state.json at all
      ioFailed = true; // EBUSY/EACCES/etc — file exists but we couldn't stat it; unreadable, not absent
    }
    let raw: string | undefined;
    if (!ioFailed) {
      try {
        raw = await readFile(file, 'utf-8');
      } catch {
        ioFailed = true;
      }
    }
    const parsed = !ioFailed && raw !== undefined ? parseCliState(raw) : undefined;
    const current = normalizePathForCompare(file) === normalizePathForCompare(currentStateFile);
    if (!parsed) {
      out.push({
        stateFile: file,
        current,
        raw: undefined,
        parseOk: false,
        viaMarker,
        cwd: null,
        createdAt: null,
        ageMs: statInfo ? Date.now() - statInfo.mtimeMs : 0,
        ageSource: 'stateFileMtime',
        chromePid: null,
        profileDir: null,
        profileDirOwned: false,
        profileName: null,
        wsEndpoint: null,
        sessionId: null,
      });
      continue;
    }
    const ageSource: 'createdAt' | 'stateFileMtime' = parsed.createdAt ? 'createdAt' : 'stateFileMtime';
    const ageMs = parsed.createdAt
      ? Date.now() - new Date(parsed.createdAt).getTime()
      : Date.now() - statInfo!.mtimeMs;
    out.push({
      stateFile: file,
      current,
      raw: parsed,
      parseOk: true,
      viaMarker,
      cwd: parsed.cwd ?? null,
      createdAt: parsed.createdAt ?? null,
      ageMs,
      ageSource,
      chromePid: parsed.chromePid ?? null,
      profileDir: parsed.profileDir ?? null,
      profileDirOwned: parsed.profileDirOwned ?? false,
      profileName: parsed.profileName ?? null,
      wsEndpoint: parsed.wsEndpoint,
      sessionId: parsed.sessionId,
    });
  }
  return out;
}

export interface EndpointProbeResult {
  reachable: boolean;
  reason?: string;
}

/** Parses `ws://H:P/devtools/browser/<id>`, then `GET http://H:P/json/version` with a 1500ms
 *  timeout. `reachable` requires HTTP 200 AND the returned `webSocketDebuggerUrl` to end with
 *  `/devtools/browser/<the same id>` — a different id means some other browser reused the
 *  port, which must count as unreachable (otherwise a kill/delete could target the wrong
 *  browser entirely). */
export async function probeEndpoint(wsEndpoint: string): Promise<EndpointProbeResult> {
  let url: URL;
  try {
    url = new URL(wsEndpoint);
  } catch {
    return { reachable: false, reason: 'unparsable-endpoint' };
  }
  const idMatch = url.pathname.match(/\/devtools\/browser\/(.+)$/);
  if (!idMatch) return { reachable: false, reason: 'unparsable-endpoint' };
  const id = idMatch[1];
  try {
    const res = await fetch(`http://${url.host}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { reachable: false, reason: `http-${res.status}` };
    const info = (await res.json()) as { webSocketDebuggerUrl?: string };
    if (!info.webSocketDebuggerUrl?.endsWith(`/devtools/browser/${id}`)) {
      return { reachable: false, reason: 'browser-id-mismatch' };
    }
    return { reachable: true };
  } catch (err) {
    return { reachable: false, reason: (err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message };
  }
}

export interface ClassifyInput {
  reachable: boolean;
  pidAlive: boolean | null; // null when there's no chromePid to check at all
  /** true = command line references this session's profileDir; false = it doesn't (PID
   *  reused); null = enumeration was unavailable, so it can't be checked at all. */
  pidMatchesProfile: boolean | null;
}

/** Pure classification per FR2-03 spec §0.3's table. `pidAlive === null` (no chromePid recorded
 *  at all — shouldn't normally happen once every write path sets it, but a hand-edited or
 *  exotic state file could) is treated the same as `false` for status purposes: without a PID
 *  there is nothing to consider alive. */
export function classifySession(input: ClassifyInput): SessionStatus {
  if (input.reachable) return 'live';
  const alive = input.pidAlive === true;
  if (!alive) return 'stale';
  if (input.pidMatchesProfile === true) return 'unresponsive';
  if (input.pidMatchesProfile === false) return 'stale'; // PID reused by an unrelated process
  return 'unknown'; // alive, but enumeration couldn't confirm which process it actually is
}

export interface SessionsSnapshot {
  stateRoot: string;
  generatedAt: string;
  processEnumeration: { ok: true } | { ok: false; reason: string };
  sessions: Array<{
    stateFile: string;
    current: boolean;
    status: SessionStatus;
    /** GAP-189: see `ScannedSession.viaMarker` — carried through so `planGc` can gate the
     *  deletion-eligible branch off of it. */
    viaMarker: boolean;
    sessionId: string | null;
    cwd: string | null;
    createdAt: string | null;
    ageMs: number;
    ageSource: 'createdAt' | 'stateFileMtime';
    chromePid: number | null;
    pidAlive: boolean | null;
    pidMatchesProfile: boolean | null;
    endpoint: string | null;
    endpointReachable: boolean;
    profileDir: string | null;
    profileDirOwned: boolean;
    profileDirExists: boolean;
    profileName: string | null;
  }>;
}

/** Builds the full classified snapshot: scans state files, probes endpoints (all in parallel,
 *  capped concurrency), and folds in process-enumeration evidence for the `pidMatchesProfile`
 *  check. Legacy states (no `profileDir`) match on the CLI temp-dir prefix instead. */
export async function buildSessionsSnapshot(opts: {
  stateRoot: string;
  currentStateFile: string;
  extraStateFiles?: string[];
  /** GAP-189: marker-discovered state-file paths — see `scanStateFiles`'s `markerStateFiles`. */
  markerStateFiles?: string[];
  processEnumeration: ListProcessesResult;
  tempRoot: string;
  existsFn?: (p: string) => boolean;
}): Promise<SessionsSnapshot> {
  const scanned = await scanStateFiles(
    opts.stateRoot,
    opts.currentStateFile,
    opts.extraStateFiles ?? [],
    opts.markerStateFiles ?? [],
  );
  const existsFn = opts.existsFn ?? existsSync;

  const CONCURRENCY = 16;
  const results: SessionsSnapshot['sessions'] = new Array(scanned.length);
  let idx = 0;
  async function worker() {
    while (idx < scanned.length) {
      const i = idx++;
      const s = scanned[i]!;
      if (!s.parseOk) {
        results[i] = {
          stateFile: s.stateFile,
          current: s.current,
          status: 'unreadable',
          viaMarker: s.viaMarker,
          sessionId: null,
          cwd: null,
          createdAt: null,
          ageMs: s.ageMs,
          ageSource: s.ageSource,
          chromePid: null,
          pidAlive: null,
          pidMatchesProfile: null,
          endpoint: null,
          endpointReachable: false,
          profileDir: null,
          profileDirOwned: false,
          profileDirExists: false,
          profileName: null,
        };
        continue;
      }
      const probe = s.wsEndpoint ? await probeEndpoint(s.wsEndpoint) : { reachable: false, reason: 'no-endpoint' };
      const pidAlive = s.chromePid != null ? isPidAlive(s.chromePid) : null;
      let pidMatchesProfile: boolean | null = null;
      if (opts.processEnumeration.ok && s.chromePid != null) {
        const proc = opts.processEnumeration.processes.find((p) => p.pid === s.chromePid);
        if (proc) {
          const udd = proc.commandLine ? extractUserDataDir(proc.commandLine) : undefined;
          if (s.profileDir) {
            pidMatchesProfile = udd ? normalizePathForCompare(udd) === normalizePathForCompare(s.profileDir) : false;
          } else {
            pidMatchesProfile = proc.commandLine
              ? proc.commandLine.includes(path.join(opts.tempRoot, 'sutradhar-cli-'))
              : false;
          }
        } else {
          pidMatchesProfile = false;
        }
      } else if (!opts.processEnumeration.ok) {
        pidMatchesProfile = null;
      }
      const status = classifySession({ reachable: probe.reachable, pidAlive, pidMatchesProfile });
      results[i] = {
        stateFile: s.stateFile,
        current: s.current,
        status,
        viaMarker: s.viaMarker,
        sessionId: s.sessionId,
        cwd: s.cwd,
        createdAt: s.createdAt,
        ageMs: s.ageMs,
        ageSource: s.ageSource,
        chromePid: s.chromePid,
        pidAlive,
        pidMatchesProfile,
        endpoint: s.wsEndpoint,
        endpointReachable: probe.reachable,
        profileDir: s.profileDir,
        profileDirOwned: s.profileDirOwned,
        profileDirExists: s.profileDir ? existsFn(s.profileDir) : false,
        profileName: s.profileName,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(scanned.length, 1)) }, worker));

  return {
    stateRoot: opts.stateRoot,
    generatedAt: new Date().toISOString(),
    processEnumeration: opts.processEnumeration.ok ? { ok: true } : { ok: false, reason: opts.processEnumeration.reason },
    sessions: results,
  };
}

export function toSessionsJson(snapshot: SessionsSnapshot): SessionsSnapshot {
  return snapshot;
}

const STATUS_ORDER: SessionStatus[] = ['live', 'unresponsive', 'unknown', 'stale', 'unreadable'];

function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function formatSessionsHuman(snapshot: SessionsSnapshot): string {
  if (snapshot.sessions.length === 0) {
    return `No CLI sessions found in ${snapshot.stateRoot}.`;
  }
  const sorted = [...snapshot.sessions].sort((a, b) => {
    const so = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    return so !== 0 ? so : a.ageMs - b.ageMs;
  });
  const lines: string[] = [];
  const enumNote = snapshot.processEnumeration.ok ? 'ok' : `unavailable: ${snapshot.processEnumeration.reason}`;
  lines.push(`Sessions (${snapshot.sessions.length}) in ${snapshot.stateRoot}   (process check: ${enumNote})`);
  for (const s of sorted) {
    const pidCol = s.chromePid == null ? 'n/a' : `${s.chromePid} ${s.pidAlive ? 'alive' : s.pidMatchesProfile === false ? 'reused' : 'dead'}`;
    const cwdCol = s.cwd ?? '(unknown: created before 0.5.0)';
    lines.push(
      `${s.current ? '*' : ' '} ${s.status.padEnd(12)} ${formatAge(s.ageMs).padEnd(7)} ${pidCol.padEnd(15)} ${
        s.endpointReachable ? 'reachable' : 'unreachable'
      }     ${cwdCol}`,
    );
  }
  const staleCount = snapshot.sessions.filter((s) => s.status === 'stale').length;
  if (staleCount > 0) {
    lines.push(`${staleCount} stale: run "sutradhar doctor --gc --dry-run" to preview cleanup.`);
  }
  return lines.join('\n');
}
