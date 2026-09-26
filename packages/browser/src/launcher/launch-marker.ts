/**
 * @file packages/browser/src/launcher/launch-marker.ts
 * @description Marks every Chrome process Sutradhar itself launches (CLI or runtime) with
 * unmistakable, harmless command-line switches, plus (for runtime-launched, unnamed temp
 * profile dirs only) a small owner file dropped inside the profile directory. Neither has any
 * stealth/fingerprint effect: Chrome ignores unknown switches, and page-visible JS can't read
 * the browser's own command line. This is the single source of truth both the CLI
 * (`spawn-chrome.ts`) and the runtime (`browser-launcher.ts`) build markers from, and what
 * FR2-03's process-enumeration/garbage-collection code (`packages/cli/src/gc.ts`) parses back
 * out, so a leaked/orphaned Chrome can be proven to be Sutradhar's before anything touches it.
 * See `.ai/loop/field-report-2/evidence/FR2-03/spec.md` §0.1/§2.1 for the full design.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MARKER_LAUNCH = '--sutradhar-launch';
export const MARKER_OWNER_PID = '--sutradhar-owner-pid';
export const MARKER_OWNER_START = '--sutradhar-owner-start';
export const MARKER_STATE = '--sutradhar-state';
export const OWNER_FILE_NAME = '.sutradhar-owner.json';

export type LaunchKind = 'cli' | 'runtime';

export interface LaunchMarker {
  kind: LaunchKind;
  ownerPid: number;
  ownerStartMs: number;
  /** Absolute path to the CLI's state.json, present only for `kind: 'cli'`. */
  stateFile?: string;
}

/** `Date.now() - process.uptime()*1000`, rounded — this process's own approximate start time
 *  in epoch ms. Used both to stamp `--sutradhar-owner-start` and, on the reading side, to
 *  decide whether a live PID is the SAME process that launched a Chrome (vs. a different
 *  process that happens to have reused the PID) — see gc.ts's "alive-and-same" check. */
export function processStartMs(): number {
  return Math.round(Date.now() - process.uptime() * 1000);
}

function encodeStateFile(stateFile: string): string {
  return Buffer.from(path.resolve(stateFile), 'utf-8').toString('base64url');
}

function decodeStateFile(encoded: string): string | undefined {
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

/** Builds the Chrome command-line switches for a launch marker. Every value is restricted to
 *  digits or base64url (`[A-Za-z0-9_-]`), so no arg can ever contain whitespace or a quote —
 *  safe to pass through `spawn()`'s argv array (no shell involved) on every platform. */
export function buildMarkerArgs(marker: LaunchMarker): string[] {
  const args = [
    `${MARKER_LAUNCH}=${marker.kind}`,
    `${MARKER_OWNER_PID}=${marker.ownerPid}`,
    `${MARKER_OWNER_START}=${marker.ownerStartMs}`,
  ];
  if (marker.kind === 'cli' && marker.stateFile) {
    args.push(`${MARKER_STATE}=${encodeStateFile(marker.stateFile)}`);
  }
  return args;
}

function extractFlagValue(text: string, flag: string): string | undefined {
  // Matches `--flag=value`, stopping at whitespace or a double quote — command-line strings on
  // Windows may still carry a trailing `"` from a quoted preceding arg; argv arrays never do.
  const re = new RegExp(`${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^\\s"]+)`);
  const m = text.match(re);
  return m?.[1];
}

/** Parses launch-marker switches back out of either an argv array (from `spawnargs`, or split
 *  process-list output) or a single command-line string. Returns `undefined` when no marker is
 *  present, or when `--sutradhar-owner-pid`/`--sutradhar-owner-start` don't parse as integers —
 *  a partially-corrupted marker is treated as "no marker" rather than trusted partially. */
export function parseMarkerArgs(argvOrCmdline: readonly string[] | string): LaunchMarker | undefined {
  const text: string = typeof argvOrCmdline === 'string' ? argvOrCmdline : argvOrCmdline.join(' ');
  const kindRaw = extractFlagValue(text, MARKER_LAUNCH);
  if (kindRaw !== 'cli' && kindRaw !== 'runtime') return undefined;
  const ownerPidRaw = extractFlagValue(text, MARKER_OWNER_PID);
  const ownerStartRaw = extractFlagValue(text, MARKER_OWNER_START);
  if (!ownerPidRaw || !/^\d+$/.test(ownerPidRaw)) return undefined;
  if (!ownerStartRaw || !/^\d+$/.test(ownerStartRaw)) return undefined;
  const ownerPid = Number(ownerPidRaw);
  const ownerStartMs = Number(ownerStartRaw);
  if (!Number.isSafeInteger(ownerPid) || !Number.isSafeInteger(ownerStartMs)) return undefined;

  const marker: LaunchMarker = { kind: kindRaw, ownerPid, ownerStartMs };
  if (kindRaw === 'cli') {
    const stateRaw = extractFlagValue(text, MARKER_STATE);
    if (stateRaw) {
      const decoded = decodeStateFile(stateRaw);
      if (decoded) marker.stateFile = decoded;
    }
  }
  return marker;
}

export interface OwnerFile {
  v: 1;
  tool: 'sutradhar';
  kind: 'runtime';
  ownerPid: number;
  ownerStartMs: number;
  chromePid?: number;
  createdAt: string;
}

/** Writes `.sutradhar-owner.json` into a Puppeteer-managed temp profile dir right after launch,
 *  when `options.userDataDir === undefined` (i.e. Puppeteer, not Sutradhar, chose the dir) —
 *  the only way GC can later prove such a dir is Sutradhar's, since every Puppeteer user on the
 *  machine shares the same `puppeteer_dev_chrome_profile-*` naming. Throws on failure; the
 *  caller (`browser-launcher.ts`) swallows it at `warn` — an unwritten owner file just means
 *  this one dir stays unattributable and therefore never garbage-collected (safe, not a leak
 *  GC would otherwise have caused). */
export async function writeOwnerFile(userDataDir: string, data: Omit<OwnerFile, 'v' | 'tool'>): Promise<void> {
  const full: OwnerFile = { v: 1, tool: 'sutradhar', ...data };
  await writeFile(path.join(userDataDir, OWNER_FILE_NAME), JSON.stringify(full), 'utf-8');
}

/** Strict parse: rejects anything that isn't exactly `{v:1, tool:'sutradhar', kind:'runtime',
 *  ownerPid: <integer>, ownerStartMs: <integer>, createdAt: <string>, chromePid?: <integer>}` —
 *  a `v:2` file from a future format, a foreign tool's same-shaped file, or a hand-tampered one
 *  with a non-integer PID must never be trusted enough to attribute a kill/delete to it. */
export function parseOwnerFile(raw: string): OwnerFile | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
  const o = obj as Record<string, unknown>;
  if (o.v !== 1 || o.tool !== 'sutradhar' || o.kind !== 'runtime') return undefined;
  if (typeof o.ownerPid !== 'number' || !Number.isSafeInteger(o.ownerPid)) return undefined;
  if (typeof o.ownerStartMs !== 'number' || !Number.isSafeInteger(o.ownerStartMs)) return undefined;
  if (typeof o.createdAt !== 'string') return undefined;
  if (o.chromePid !== undefined && (typeof o.chromePid !== 'number' || !Number.isSafeInteger(o.chromePid))) {
    return undefined;
  }
  return {
    v: 1,
    tool: 'sutradhar',
    kind: 'runtime',
    ownerPid: o.ownerPid,
    ownerStartMs: o.ownerStartMs,
    createdAt: o.createdAt,
    chromePid: o.chromePid as number | undefined,
  };
}

/** Reads and parses an owner file at `userDataDir/.sutradhar-owner.json`; `undefined` for any
 *  I/O or parse failure (missing file, permissions, corrupt JSON) — never throws. */
export async function readOwnerFile(userDataDir: string): Promise<OwnerFile | undefined> {
  try {
    const raw = await readFile(path.join(userDataDir, OWNER_FILE_NAME), 'utf-8');
    return parseOwnerFile(raw);
  } catch {
    return undefined;
  }
}
