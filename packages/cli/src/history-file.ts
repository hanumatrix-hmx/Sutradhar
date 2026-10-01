/**
 * @file packages/cli/src/history-file.ts
 * @description FR2-11: the CLI's persistent command history. Every session-bound command appends ONE JSON
 * line to `history.jsonl` next to `state.json`; `sutradhar history` reads it back. Each CLI invocation is its
 * own process with an empty in-memory action history, so a file is the only way a record can outlive a command.
 *
 * Privacy (the hard requirement): positional args are redacted per verb before they are stored (typed text,
 * clipboard text, select values and dialog prompt text become lengths; eval code becomes a 200-char redacted preview; URL
 * arguments of nav/newtab/audit/compare are reduced to origin + path; file-path arguments of upload/screenshot/compare to
 * their basename and directory arguments of download/audit to `<dir>`), and EVERY arg then goes through the same single
 * character-rule function the MCP / SDK history uses ({@link redactHistoryText}: tokens split on any Unicode whitespace; cut
 * from the first `?` `#` `;`; a token that still holds `=` or `&` replaced whole; `userinfo@` stripped; a path reduced to
 * its last segment; encoded forms of those characters decoded first). The args that ARE selectors (click, hover, type, select,
 * press, drag, upload) use the selector variant of the same function so `#id` and `[a=b]` stay readable.
 * The actions a command produced were already sanitized by the browser package. As defense in depth,
 * {@link buildHistoryLine} also scrubs the raw secret strings from every string that is stored. Flags are not recorded in v1.
 * `cwd` is stored home-relative (`~/sub/dir`) when it is under the home directory, else as `<dir>` ({@link redactCwd}), so
 * the user's home directory name never appears in a line.
 *
  * Concurrency: a line is written with ONE `write` call on a handle opened for append (O_APPEND on POSIX,
 * FILE_APPEND_DATA on Windows), and a line is kept under {@link HISTORY_MAX_LINE_BYTES}, so two processes
 * appending at once cannot interleave bytes inside a line. A torn last line (a process killed mid-write) is
 * repaired by the NEXT append (it starts with a newline when the file does not end with one) and skipped by the
 * reader.
 */
import { open, readFile, rename, stat, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  basenameOfPath,
  capHistoryString,
  displayFrameUrl,
  evalCodePreview,
  redactHistorySelector,
  redactHistoryText,
  redactHistoryUrl,
  sanitizeHistoryEntry,
  type ActionHistoryEntry,
  type SessionActionHistoryEntry,
} from '@sutradhar/browser';

export const HISTORY_SCHEMA_VERSION = 1;
/** A guard only: a CLI line is about 0.5-8 KB in practice. Staying under it also keeps each line one write. */
export const HISTORY_MAX_LINE_BYTES = 64 * 1024;
export const HISTORY_ROTATE_BYTES = 5 * 1024 * 1024;
export const HISTORY_ROTATED_FILE_NAME = 'history.1.jsonl';
/** FR2-07 D1's scalar cap / detail cap, reused (no new per-field numbers). */
const ARG_CAP = 200;
const ERROR_CAP = 300;
/** More positional args than this is not a real command; the rest are dropped only when the line is over the guard. */
const ARGS_KEPT_WHEN_OVER_GUARD = 20;

export interface CliHistoryLineV1 {
  v: 1;
  type: 'command';
  /** ISO-8601 UTC, command START time. */
  ts: string;
  /** The session the command ran against (post self-heal id); null when none could be determined. */
  sessionId: string | null;
  cwd: string;
  verb: string;
  /** Positional args after {@link redactCliArgs}. Flags are not recorded in v1. */
  args: string[];
  /** The exit code the command ended with (0/1/3/4...), 1 when it threw. */
  exitCode: number;
  durationMs: number;
  /** Thrown error message, URL-redacted and capped at 300. */
  error?: string;
  /** The session ring's entries recorded in THIS process (already sanitized). */
  actions: SessionActionHistoryEntry[];
  /** Session ring eviction count (non-zero only if one command did more than 200 actions). */
  actionsEvicted: number;
  /** Why the actions could not be read (e.g. the session was gone). */
  actionsUnavailable?: string;
  /** Set when the line hit {@link HISTORY_MAX_LINE_BYTES} and actions were dropped. */
  truncated?: true;
  /** With `truncated`: how many actions were dropped. */
  actionsOmitted?: number;
}

/** Verbs whose positional args (by index) are element references / CSS selectors: the selector variant of the rule. */
const SELECTOR_ARG_INDEXES: Readonly<Record<string, readonly number[]>> = {
  click: [0],
  hover: [0],
  type: [0],
  select: [0],
  press: [0],
  drag: [0, 1],
  upload: [0],
  download: [0],
};

/**
 * The working directory as stored: `~` or `~/sub/dir` (forward slashes) when it is the home directory or under it, otherwise
 * `<dir>`. The home directory's own name never appears. Idempotent for an already reduced value.
 */
export function redactCwd(cwd: string, home: string = os.homedir()): string {
  if (cwd === '<dir>' || cwd === '~' || cwd.startsWith('~/')) return cwd;
  const norm = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  const c = norm(cwd);
  const h = norm(home);
  if (h === '' || h === '/') return '<dir>';
  // Windows paths are case-insensitive
  const ci = /^[A-Za-z]:/.test(h) || h.startsWith('//');
  const cmp = (x: string): string => (ci ? x.toLowerCase() : x);
  if (cmp(c) === cmp(h)) return '~';
  if (cmp(c).startsWith(cmp(h) + '/')) return '~' + c.slice(h.length);
  return '<dir>';
}

const lenTag = (s: string): string => `<${s.length} chars>`;

/** Verbs whose positional args (by index) are URLs: reduced with {@link redactHistoryUrl} before the text rule. */
const URL_ARG_INDEXES: Readonly<Record<string, readonly number[]>> = { nav: [0], newtab: [0], audit: [0], compare: [0, 1] };
/** Verbs whose positional args (by index) are local FILE paths: stored as a basename, relative or not. */
const PATH_ARG_INDEXES: Readonly<Record<string, readonly number[]>> = {
  upload: [1],
  screenshot: [0],
  compare: [2],
};
/** Verbs whose positional args (by index) are local DIRECTORIES (download dir, audit output dir): stored as the kind `<dir>`,
 *  not even a basename (a directory's name says nothing the history needs, and it is often a per-user or per-project name). */
const DIR_ARG_INDEXES: Readonly<Record<string, readonly number[]>> = { download: [1], audit: [1] };

/**
 * Positional-arg redaction by verb, then the ONE shared text redaction and a 200-char cap on every arg:
 *  type / select  -> [ref, `<n chars>`]        (typed text, e.g. passwords; a select value is a field value)
 *  setclipboard   -> [`<n chars>`]
 *  eval           -> [200-char code preview]
 *  dialog         -> [accept|dismiss, `<n chars>`?]   (prompt text)
 *  URL args (nav, newtab, audit, compare) -> origin + path
 *  file path args (upload, screenshot, compare) -> basename;  directory args (download, audit) -> `<dir>`
 *  everything else-> each arg redacted + capped
 */
export function redactCliArgs(verb: string, args: readonly string[]): string[] {
  const fin = (a: string): string => capHistoryString(redactHistoryText(a), ARG_CAP);
  const finSel = (a: string): string => capHistoryString(redactHistorySelector(a), ARG_CAP);
  const selIdx = SELECTOR_ARG_INDEXES[verb] ?? [];
  const urlIdx = URL_ARG_INDEXES[verb] ?? [];
  const pathIdx = PATH_ARG_INDEXES[verb] ?? [];
  const dirIdx = DIR_ARG_INDEXES[verb] ?? [];
  const perArg = (a: string, i: number): string =>
    dirIdx.includes(i)
      ? '<dir>'
      : pathIdx.includes(i)
        ? fin(basenameOfPath(redactHistoryText(a)) || '…')
        : urlIdx.includes(i)
          ? fin(redactHistoryUrl(a))
          : selIdx.includes(i)
            ? finSel(a)
            : fin(a);
  switch (verb) {
    case 'type':
    case 'select':
      return args.length === 0 ? [] : [finSel(args[0]!), ...(args.length > 1 ? [lenTag(args.slice(1).join(' '))] : [])];
    case 'setclipboard':
      return [lenTag(args.join(' '))];
    case 'eval':
      return args.length === 0 ? [] : [evalCodePreview(args.join(' '))];
    case 'dialog':
      return args.length === 0 ? [] : [fin(args[0]!), ...(args.length > 1 ? [lenTag(args.slice(1).join(' '))] : [])];
    default:
      return args.map(perArg);
  }
}

/** The raw strings a verb's args must never leak (for the defense-in-depth scrub of everything stored). */
export function secretsOfCliArgs(verb: string, args: readonly string[]): string[] {
  switch (verb) {
    case 'type':
    case 'select':
      return args.length > 1 ? [args.slice(1).join(' ')] : [];
    case 'setclipboard':
      return [args.join(' ')];
    case 'dialog':
      return args.length > 1 ? [args.slice(1).join(' ')] : [];
    default:
      return [];
  }
}

function scrubDeep<T>(value: T, secrets: readonly string[]): T {
  const usable = secrets.filter((s) => s.length >= 3);
  if (usable.length === 0) return value;
  const scrubString = (s: string): string => {
    let out = s;
    for (const secret of usable) out = out.split(secret).join('<redacted>');
    return out;
  };
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return scrubString(x);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x)) o[k] = walk(v);
      return o;
    }
    return x;
  };
  return walk(value) as T;
}

export interface BuildHistoryLineInput {
  ts: string;
  sessionId: string | null;
  /** The raw working directory; {@link buildHistoryLine} stores it through {@link redactCwd}. */
  cwd: string;
  /** Home directory used by {@link redactCwd} (default: the OS home directory; tests inject one). */
  home?: string;
  verb: string;
  /** Already redacted with {@link redactCliArgs}. */
  args: readonly string[];
  exitCode: number;
  durationMs: number;
  error?: string;
  actions?: readonly SessionActionHistoryEntry[];
  actionsEvicted?: number;
  actionsUnavailable?: string;
  /** Raw strings that must not appear anywhere in the stored line ({@link secretsOfCliArgs}). */
  secrets?: readonly string[];
}

/** Pure. Builds the line and applies the 64 KiB guard (actions dropped, `truncated` + `actionsOmitted` set). */
export function buildHistoryLine(input: BuildHistoryLineInput): CliHistoryLineV1 {
  const secrets = input.secrets ?? [];
  // the runtime already sanitized every action; running the SAME function again (it is idempotent) means a caller that hands in a raw
  // entry can never put one on disk
  const actions = scrubDeep(
    (input.actions ?? []).map((a) => sanitizeHistoryEntry(a) as SessionActionHistoryEntry),
    secrets,
  );
  const error = input.error !== undefined ? capHistoryString(redactHistoryText(scrubDeep(input.error, secrets)), ERROR_CAP) : undefined;
  const line: CliHistoryLineV1 = {
    v: HISTORY_SCHEMA_VERSION,
    type: 'command',
    ts: input.ts,
    sessionId: input.sessionId,
    cwd: redactCwd(input.cwd, input.home),
    verb: input.verb,
    args: [...input.args],
    exitCode: input.exitCode,
    durationMs: input.durationMs,
    ...(error !== undefined ? { error } : {}),
    actions,
    actionsEvicted: input.actionsEvicted ?? 0,
    ...(input.actionsUnavailable !== undefined ? { actionsUnavailable: capHistoryString(redactHistoryText(input.actionsUnavailable), ERROR_CAP) } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(line), 'utf-8') >= HISTORY_MAX_LINE_BYTES) {
    const omitted = line.actions.length;
    line.actions = [];
    line.truncated = true;
    line.actionsOmitted = omitted;
    if (Buffer.byteLength(JSON.stringify(line), 'utf-8') >= HISTORY_MAX_LINE_BYTES) {
      line.args = line.args.slice(0, ARGS_KEPT_WHEN_OVER_GUARD);
    }
  }
  return line;
}

export type AppendResult = { ok: true; rotated: boolean } | { ok: false; code: string };

export interface AppendDeps {
  rotateBytes?: number;
}

/**
 * mkdir -p the directory; if the file is at least `rotateBytes` (default 5 MiB) rename it to
 * `history.1.jsonl` (replacing that; any rename failure just skips rotation this time); then append ONE line
 * with ONE write. When the file does not end in a newline (a torn last line from a killed writer) the line
 * is prefixed with one so it cannot be glued onto the fragment. Never throws.
 */
export async function appendHistoryLine(file: string, line: CliHistoryLineV1, deps: AppendDeps = {}): Promise<AppendResult> {
  const rotateBytes = deps.rotateBytes ?? HISTORY_ROTATE_BYTES;
  try {
    const dir = path.dirname(file);
    await mkdir(dir, { recursive: true });
    let rotated = false;
    try {
      const st = await stat(file);
      if (st.isFile() && st.size >= rotateBytes) {
        await rename(file, path.join(dir, HISTORY_ROTATED_FILE_NAME));
        rotated = true;
      }
    } catch {
      /* ENOENT (nothing to rotate) / EPERM / EBUSY (another process holds it): skip rotation this time */
    }
    const payload = JSON.stringify(line) + '\n';
    const fh = await open(file, 'a+', 0o600);
    try {
      let prefix = '';
      const size = (await fh.stat()).size;
      if (size > 0) {
        const last = Buffer.alloc(1);
        const { bytesRead } = await fh.read(last, 0, 1, size - 1);
        if (bytesRead === 1 && last[0] !== 0x0a) prefix = '\n';
      }
      const buf = Buffer.from(prefix + payload, 'utf-8');
      let written = 0;
      while (written < buf.length) {
        const { bytesWritten } = await fh.write(buf, written, buf.length - written);
        written += bytesWritten;
      }
    } finally {
      await fh.close();
    }
    return { ok: true, rotated };
  } catch (e) {
    return { ok: false, code: (e as NodeJS.ErrnoException)?.code ?? 'UNKNOWN' };
  }
}

export interface HistoryLineRecord {
  raw: string;
  parsed: Record<string, unknown> & { v: number };
}

export interface ReadHistoryResult {
  lines: HistoryLineRecord[];
  /** Non-blank lines that were not a JSON object with a positive-integer `v` (a torn last line, garbage). */
  skipped: number;
  rotatedExists: boolean;
}

/**
 * Splits on /\r?\n/, skips blank lines; a line is valid iff it JSON.parses to an object (not an array) whose
 * `v` is a positive integer. A missing file is `{lines: [], skipped: 0}`; any other read error throws.
 */
export async function readHistoryFile(file: string): Promise<ReadHistoryResult> {
  let text: string;
  try {
    text = await readFile(file, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return { lines: [], skipped: 0, rotatedExists: await rotatedExists(file) };
    throw e;
  }
  const lines: HistoryLineRecord[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Number.isInteger((parsed as { v?: unknown }).v) && (parsed as { v: number }).v > 0) {
      lines.push({ raw, parsed: parsed as HistoryLineRecord['parsed'] });
    } else {
      skipped++;
    }
  }
  return { lines, skipped, rotatedExists: await rotatedExists(file) };
}

async function rotatedExists(file: string): Promise<boolean> {
  try {
    return (await stat(path.join(path.dirname(file), HISTORY_ROTATED_FILE_NAME))).isFile();
  } catch {
    return false;
  }
}

// ── human output ─────────────────────────────────────────────────────────────────────────────────

const firstLine = (s: string, cap: number): string => capHistoryString(s.split(/\r?\n/, 1)[0] ?? '', cap);

function middleTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor((max - 1) / 2);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/**
 * URL tokens inside a command's text use FR2-09's display rule (origin + path, middle-truncated at 80). The text goes
 * through {@link redactHistoryText} first, so a line written by an older build is never SHOWN with its query.
 */
function displayCommandText(verb: string, args: readonly string[]): string {
  const sel = SELECTOR_ARG_INDEXES[verb] ?? [];
  // one arg at a time: the text after a cut in one arg is dropped, and must not eat the next arg
  const shown = [redactHistoryText(verb), ...args.map((a, i) => (sel.includes(i) ? redactHistorySelector(a) : redactHistoryText(a)))].join(' ');
  return capHistoryString(shown.replace(/\b(?:https?|wss?|blob):\/\/\S+/gi, (m) => displayFrameUrl(m)), 200);
}

const ts19 = (ts: string): string => `${ts.slice(0, 19).replace('T', ' ')}Z`;

function verifLabel(v: unknown): string {
  const ver = v as { verified?: unknown; evidence?: { tier?: unknown } } | undefined;
  if (!ver || typeof ver !== 'object') return 'no-verification';
  if (typeof ver.evidence?.tier === 'string') return ver.evidence.tier;
  return ver.verified === true ? 'verified' : 'not-verified';
}

/**
 * The human `sutradhar history` output. Exactly: a header with the valid-line count, a `--- session <id>
 * [(current)] ---` row whenever the session changes, one row per command and one indented row per action.
 */
export function formatHistoryHuman(r: ReadHistoryResult, opts: { file: string; currentSessionId?: string }): string {
  const out: string[] = [`History: ${r.lines.length} command(s) in ${opts.file}`];
  let previousSession: string | null | undefined;
  for (const { parsed } of r.lines) {
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : null;
    if (previousSession === undefined || sessionId !== previousSession) {
      out.push(`--- session ${sessionId ?? '(none)'}${sessionId !== null && sessionId === opts.currentSessionId ? ' (current)' : ''} ---`);
      previousSession = sessionId;
    }
    const when = typeof parsed.ts === 'string' ? ts19(parsed.ts) : '(no time)';
    if (parsed.v > HISTORY_SCHEMA_VERSION) {
      out.push(`${when}  (history line version ${parsed.v} — upgrade sutradhar to display it)`);
      continue;
    }
    const args = Array.isArray(parsed.args) ? (parsed.args as unknown[]).map(String) : [];
    const cmd = displayCommandText(String(parsed.verb ?? '?'), args);
    const exit = String(parsed.exitCode ?? '?').padEnd(3);
    const dur = `${String(parsed.durationMs ?? '?').padStart(5)}ms`;
    out.push(`${when}  exit ${exit} ${dur}  ${cmd}`);
    // every text shown goes through the SAME functions as the stored form, so a line written by an older build is never shown with its query
    if (typeof parsed.error === 'string') out.push(`    error: ${firstLine(redactHistoryText(parsed.error), ERROR_CAP)}`);
    const actions = Array.isArray(parsed.actions)
      ? (parsed.actions as Record<string, unknown>[]).map((x) => sanitizeHistoryEntry(x as unknown as ActionHistoryEntry) as unknown as Record<string, unknown>)
      : [];
    for (const a of actions) {
      const what = middleTruncate(String(a.target ?? a.selector ?? ''), 80);
      const err = typeof a.error === 'string' ? `: ${firstLine(a.error, 200)}` : '';
      const row = `    - ${String(a.actionType ?? '?')} ${a.success === true ? 'ok' : 'FAILED'} ${verifLabel(a.verification)} ${String(a.tabId ?? '?')}`;
      out.push(what === '' ? `${row}${err}` : `${row} ${what}${err}`);
    }
    const evicted = typeof parsed.actionsEvicted === 'number' ? parsed.actionsEvicted : 0;
    if (evicted > 0) out.push(`    (${evicted} earlier action(s) of this command were evicted from the 200-entry in-memory history)`);
    if (typeof parsed.actionsUnavailable === 'string') out.push(`    (actions unavailable: ${firstLine(redactHistoryText(parsed.actionsUnavailable), 200)})`);
    if (parsed.truncated === true) out.push(`    (line truncated: ${String(parsed.actionsOmitted ?? '?')} action(s) omitted)`);
  }
  if (r.rotatedExists) out.push(`Older commands were rotated to ${path.join(path.dirname(opts.file), HISTORY_ROTATED_FILE_NAME)} (not shown).`);
  return out.join('\n');
}
