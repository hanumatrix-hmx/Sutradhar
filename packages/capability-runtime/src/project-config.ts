/**
 * @file packages/capability-runtime/src/project-config.ts
 * @description FR2-14: the `.sutradhar.json` project config — discovery (searched from the cwd
 * upward), parsing, validation and path resolution, shared by the CLI, the MCP server and (opt-in)
 * the SDK. Precedence against flags/env vars lives in `config-precedence.ts`; this file only
 * produces a validated {@link LoadedProjectConfig}.
 *
 * Design rules (each is small, shape-free and fails CLOSED):
 *  - Unknown keys WARN (never an error); every other problem is an error that stops startup.
 *    A skipped bad `allowedDomains`/`allowedUploadRoots` would silently WIDEN access.
 *  - Empty arrays are errors, not "unset" (an author writing `[]` meant "allow nothing").
 *  - Duplicate JSON keys are errors (the last one would silently win).
 *  - Error messages never echo file contents (a secret-looking value) beyond a short, key-scoped
 *    value that is known not to be free text; JSON engine messages are redacted.
 *  - A DISCOVERED file is treated as untrusted project content (D12): download roots must stay
 *    inside the file's own directory and outside `.git`, found by FR2-05's symlink-safe
 *    canonicalisation; on POSIX a file owned by someone else or writable by group/others is refused.
 *    An EXPLICIT file (`SUTRADHAR_CONFIG`, SDK `configFile`) is trusted like an env var.
 *  - The filesystem root is never searched; a `.git` (file or directory) or the home directory is
 *    an inclusive boundary.
 */
import { readFile as fsReadFile, stat as fsStat, lstat as fsLstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalizePath, findContainingRoot, isPathWithinRoot, type DialogPolicy } from '@sutradhar/browser';
import { expandHome, resolveConfigPath } from './fs-roots.js';

export const PROJECT_CONFIG_FILE_NAME = '.sutradhar.json';
export const PROJECT_CONFIG_ENV = 'SUTRADHAR_CONFIG';
export const PROJECT_CONFIG_SCHEMA_ID = 'urn:sutradhar:config:1';
export const PROJECT_CONFIG_MAX_BYTES = 65_536;

export interface ProjectConfigFile {
  $schema?: string;
  downloadDir?: string;
  allowedDownloadRoots?: string[];
  allowedUploadRoots?: string[];
  allowedDomains?: string[];
  dialog?: DialogPolicy;
  idleTimeoutMs?: number;
  viewport?: { width: number; height: number };
}

type DeepRequired<T> = T extends readonly (infer U)[]
  ? DeepRequired<U>[]
  : T extends object
    ? { [K in keyof Required<T>]: DeepRequired<T[K]> }
    : T;

/** The 8 recognized top-level keys, in the (deterministic) order they are validated. */
export const PROJECT_CONFIG_KNOWN_KEYS: readonly string[] = [
  '$schema',
  'downloadDir',
  'allowedDownloadRoots',
  'allowedUploadRoots',
  'allowedDomains',
  'dialog',
  'idleTimeoutMs',
  'viewport',
];
const DIALOG_KEYS = ['mode', 'promptText'] as const;
const VIEWPORT_KEYS = ['width', 'height'] as const;
const DIALOG_MODES = ['auto', 'report', 'accept', 'dismiss'] as const;

/** Drift guard: typed `DeepRequired<ProjectConfigFile>` so `tsc` fails the moment the interface
 *  gains a key this example lacks; tests also compare it with the committed JSON schema. */
export const PROJECT_CONFIG_EXAMPLE: DeepRequired<ProjectConfigFile> = {
  $schema: PROJECT_CONFIG_SCHEMA_ID,
  downloadDir: './downloads',
  allowedDownloadRoots: ['./downloads', './out'],
  allowedUploadRoots: ['./fixtures'],
  allowedDomains: ['example.com', 'localhost'],
  dialog: { mode: 'accept', promptText: 'yes' },
  idleTimeoutMs: 1_800_000,
  viewport: { width: 1280, height: 800 },
};

export type ConfigOrigin = 'env' | 'option' | 'discovered';

export interface LoadedProjectConfig {
  /** Absolute path of the file. */
  path: string;
  /** `path.dirname(path)`: relative paths in the file resolve against this. */
  baseDir: string;
  origin: ConfigOrigin;
  /** Validated; a fresh object holding only known keys; paths as written. */
  values: ProjectConfigFile;
  /** Absolute paths (D6); `downloadDir` first, de-duplicated (D14). */
  resolved: { allowedDownloadRoots?: string[]; allowedUploadRoots?: string[] };
  warnings: string[];
}

export type ConfigDiscovery =
  | { status: 'loaded'; config: LoadedProjectConfig; searched: string[] }
  | {
      status: 'none';
      reason: 'not-found' | 'disabled' | 'not-requested';
      searched: string[];
      stoppedAt?: 'git-root' | 'home' | 'filesystem-root';
      stopDir?: string;
    };

export class ProjectConfigError extends Error {
  public override readonly name = 'ProjectConfigError';
  public constructor(
    public readonly file: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** Minimal fs surface (node:fs/promises subset), injectable for tests. */
export interface ConfigFs {
  stat(p: string): Promise<{ isFile(): boolean; size: number; uid: number; mode: number }>;
  lstat(p: string): Promise<unknown>;
  readFile(p: string): Promise<Buffer>;
}
const realFs: ConfigFs = {
  stat: (p) => fsStat(p),
  lstat: (p) => fsLstat(p),
  readFile: (p) => fsReadFile(p),
};

const NO_ESCAPE_HINT = 'Set SUTRADHAR_CONFIG=none to ignore project config.';

function bad(file: string, problem: string): ProjectConfigError {
  return new ProjectConfigError(file, `Invalid project config ${file}: ${problem}`);
}

/** Short, single-line echo of a non-secret scalar for an error message. */
function show(v: unknown): string {
  let s: string;
  try {
    s = typeof v === 'string' ? JSON.stringify(v) : String(JSON.stringify(v));
  } catch {
    s = '<unprintable>';
  }
  return s.length > 64 ? `${s.slice(0, 64)}...` : s;
}

// ───────────────────────── suggestions ─────────────────────────

/** Optimal-string-alignment distance: Levenshtein where one adjacent transposition costs 1, so the
 *  commonest typo ("allowedDomian") is distance 2, not 3. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** The closest known key: a case-insensitive match, or edit distance <= 2. */
export function suggestKey(key: string, known: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  const ci = known.find((k) => k.toLowerCase() === lower);
  if (ci !== undefined) return ci;
  let best: string | undefined;
  let bestD = 3;
  for (const k of known) {
    const d = editDistance(key, k);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best;
}

// ───────────────────────── parsing ─────────────────────────

/** Redacts the source-text snippet (and the offending token) JSON.parse puts in its message. */
function sanitizeJsonError(msg: string): string {
  let m = msg.replace(/,\s*".*"\s+is not valid JSON\s*$/s, '');
  m = m.replace(/token\s+'[^']*'/g, 'token').replace(/token\s+\S+(?=\s+in JSON)/g, 'token');
  if (m.includes('"') || m.includes("'")) m = 'syntax error';
  return m.replace(/\s+/g, ' ').trim();
}

/**
 * Scans text that is ALREADY known to be valid JSON and returns the first object key that is
 * repeated inside the same object (compared after unescaping), or `undefined`.
 */
function findDuplicateKey(text: string): string | undefined {
  type Frame = { obj: true; keys: Set<string>; expectKey: boolean } | { obj: false };
  const stack: Frame[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const raw = text.slice(i, j + 1);
      const top = stack[stack.length - 1];
      if (top && top.obj && top.expectKey) {
        const key = JSON.parse(raw) as string;
        if (top.keys.has(key)) return key;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{') stack.push({ obj: true, keys: new Set(), expectKey: true });
    else if (c === '[') stack.push({ obj: false });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') {
      const top = stack[stack.length - 1];
      if (top && top.obj) top.expectKey = true;
    }
    i++;
  }
  return undefined;
}

/** BOM strip, size guard, empty guard, JSON.parse (redacted errors), duplicate-key guard. */
export function parseProjectConfigText(text: string, file: string): unknown {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  if (Buffer.byteLength(t, 'utf8') > PROJECT_CONFIG_MAX_BYTES) throw bad(file, 'is larger than 64 KiB');
  if (t.trim() === '') throw bad(file, 'is empty');
  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch (e) {
    let extra = '';
    if (/^\s*\/\/|\/\*/m.test(t)) extra = '; comments are not allowed';
    else if (t.includes('\u0000')) extra = '; the file contains NUL characters (is it UTF-16? save it as UTF-8)';
    throw bad(file, `is not valid JSON (${sanitizeJsonError((e as Error).message)}${extra})`);
  }
  const dup = findDuplicateKey(t);
  if (dup !== undefined) {
    throw bad(file, `is not valid: duplicate key ${show(dup)} (a JSON object may not repeat a key; the last one would silently win)`);
  }
  return data;
}

// ───────────────────────── validation ─────────────────────────

const DOMAIN_RE =
  /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function domainSuggestion(v: string): string | undefined {
  let s = v.trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = new URL(s).hostname;
  } catch {
    return undefined;
  }
  s = s.replace(/^\*\./, '').replace(/^\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  return s !== v && DOMAIN_RE.test(s) ? s : undefined;
}

function checkStringList(file: string, key: string, v: unknown): string[] {
  if (!Array.isArray(v)) throw bad(file, `${key} must be an array of strings`);
  if (v.length === 0) throw bad(file, `${key} must list at least one ${key === 'allowedDomains' ? 'domain' : 'directory'}; remove the key for no restriction`);
  v.forEach((item, i) => {
    if (typeof item !== 'string') throw bad(file, `${key}[${i}] must be a string`);
    if (item.length === 0) throw bad(file, `${key}[${i}] must be a non-empty string`);
  });
  return [...(v as string[])];
}

/**
 * Validates already-parsed JSON. Unknown keys (top level and in `dialog`/`viewport`) become
 * warnings and are dropped; the result is a FRESH object that only ever receives known keys, so a
 * `__proto__` key can never reach a prototype. Stops at the first error, deterministically.
 */
export function validateProjectConfig(data: unknown, file: string): { values: ProjectConfigFile; warnings: string[] } {
  if (!isPlainObject(data)) throw bad(file, 'must contain a JSON object at the top level');
  const warnings: string[] = [];
  const warnUnknown = (prefix: string, key: string, known: readonly string[]): void => {
    const s = suggestKey(key, known);
    warnings.push(`${file}: unknown key "${prefix}${key}" ignored${s ? ` (did you mean "${prefix}${s}"?)` : ''}`);
  };
  for (const k of Object.keys(data)) {
    if (!PROJECT_CONFIG_KNOWN_KEYS.includes(k)) warnUnknown('', k, PROJECT_CONFIG_KNOWN_KEYS);
  }
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(data, k);
  const values: ProjectConfigFile = {};

  if (has('$schema')) {
    if (typeof data['$schema'] !== 'string') throw bad(file, '$schema must be a string');
    values.$schema = data['$schema'];
  }

  if (has('downloadDir')) {
    const v = data['downloadDir'];
    if (typeof v !== 'string' || v.length === 0) throw bad(file, 'downloadDir must be a non-empty string');
    values.downloadDir = v;
  }
  if (has('allowedDownloadRoots')) values.allowedDownloadRoots = checkStringList(file, 'allowedDownloadRoots', data['allowedDownloadRoots']);
  if (has('allowedUploadRoots')) values.allowedUploadRoots = checkStringList(file, 'allowedUploadRoots', data['allowedUploadRoots']);
  if (has('allowedDomains')) {
    const list = checkStringList(file, 'allowedDomains', data['allowedDomains']);
    list.forEach((d, i) => {
      if (!DOMAIN_RE.test(d)) {
        const sug = domainSuggestion(d);
        throw bad(
          file,
          `allowedDomains[${i}] ${show(d)} is not a bare domain (${sug ? `write "${sug}"; ` : ''}subdomains are included automatically; no scheme, port, path or wildcard)`,
        );
      }
    });
    values.allowedDomains = list;
  }
  if (has('dialog')) {
    const d = data['dialog'];
    if (!isPlainObject(d)) throw bad(file, 'dialog must be an object like {"mode":"accept"}');
    for (const k of Object.keys(d)) if (!(DIALOG_KEYS as readonly string[]).includes(k)) warnUnknown('dialog.', k, DIALOG_KEYS);
    const mode = d['mode'];
    if (typeof mode !== 'string' || !(DIALOG_MODES as readonly string[]).includes(mode)) {
      throw bad(file, 'dialog.mode is required and must be one of "auto", "report", "accept", "dismiss"');
    }
    const out: { mode: (typeof DIALOG_MODES)[number]; promptText?: string } = { mode: mode as (typeof DIALOG_MODES)[number] };
    if (Object.prototype.hasOwnProperty.call(d, 'promptText')) {
      if (typeof d['promptText'] !== 'string') throw bad(file, 'dialog.promptText must be a string');
      if (mode !== 'accept') {
        throw bad(file, 'dialog.promptText only applies with dialog.mode "accept" (it is the text entered into prompt() dialogs)');
      }
      out.promptText = d['promptText'];
    }
    values.dialog = out;
  }
  if (has('idleTimeoutMs')) {
    const v = data['idleTimeoutMs'];
    if (typeof v !== 'number' || !Number.isInteger(v) || !(v === 0 || (v >= 1000 && v <= 2147483647))) {
      throw bad(
        file,
        `idleTimeoutMs must be 0 (never close idle sessions) or an integer number of milliseconds between 1000 and 2147483647; got ${show(v)}`,
      );
    }
    values.idleTimeoutMs = v;
  }
  if (has('viewport')) {
    const v = data['viewport'];
    if (!isPlainObject(v)) throw bad(file, 'viewport must be an object like {"width":1280,"height":800}');
    for (const k of Object.keys(v)) if (!(VIEWPORT_KEYS as readonly string[]).includes(k)) warnUnknown('viewport.', k, VIEWPORT_KEYS);
    for (const k of VIEWPORT_KEYS) {
      const n = v[k];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw bad(file, `viewport.${k} must be a positive integer`);
    }
    values.viewport = { width: v['width'] as number, height: v['height'] as number };
  }
  return { values, warnings };
}

// ───────────────────────── SUTRADHAR_CONFIG ─────────────────────────

/**
 * `''`/unset -> unset; `none` (any case) -> disabled; otherwise `~` is expanded and the path must
 * be absolute (the process cwd is not a meaningful anchor for an environment variable).
 */
export function readConfigEnv(
  env: Record<string, string | undefined>,
  homedir: string = os.homedir(),
): { kind: 'unset' } | { kind: 'disabled' } | { kind: 'path'; path: string } {
  const raw = env[PROJECT_CONFIG_ENV];
  const v = raw?.trim();
  if (v === undefined || v === '') return { kind: 'unset' };
  if (/^none$/i.test(v)) return { kind: 'disabled' };
  const expanded = expandHome(v, homedir);
  if (expanded === undefined) {
    throw new ProjectConfigError(undefined, `${PROJECT_CONFIG_ENV}: "${v}": ~user is not supported (use ~ or an absolute path)`);
  }
  if (!path.isAbsolute(expanded)) {
    throw new ProjectConfigError(
      undefined,
      `${PROJECT_CONFIG_ENV} must be an absolute path (or "none" to disable project config), got "${v.length > 80 ? v.slice(0, 80) + '...' : v}"`,
    );
  }
  return { kind: 'path', path: expanded };
}

// ───────────────────────── discovery ─────────────────────────

const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;
const isNotFound = (e: unknown): boolean => errCode(e) === 'ENOENT' || errCode(e) === 'ENOTDIR';

async function exists(fs: ConfigFs, p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (e) {
    if (isNotFound(e)) return false;
    throw new ProjectConfigError(p, `${p} cannot be read (${errCode(e) ?? 'error'}). ${NO_ESCAPE_HINT}`);
  }
}

/**
 * Walks from `startDir` towards the root; the NEAREST file wins. A directory holding `.git` (file
 * or directory — a worktree has a file) is a boundary, inclusive: its own file is checked, then
 * the walk stops. If `startDir` is inside the home directory the walk also stops at home,
 * inclusive. The filesystem root is never searched. A candidate that exists but cannot be used
 * (a directory, a permission error, a symlink loop or a dangling symlink) is an ERROR, never a
 * silent miss.
 */
export async function findProjectConfigPath(
  startDir: string,
  o: { homedir?: string; fs?: ConfigFs } = {},
): Promise<{
  path?: string;
  searched: string[];
  stoppedAt: 'found' | 'git-root' | 'home' | 'filesystem-root';
  stopDir?: string;
}> {
  const fs = o.fs ?? realFs;
  // Host path semantics always: this walks the REAL filesystem (a fake platform would make the
  // path flavor disagree with the paths the fs actually has). Tests inject `fs` and `homedir`.
  const platform = process.platform;
  const p = path;
  const homedir = o.homedir ?? os.homedir();

  let dir = p.resolve(startDir);
  let home: string | undefined;
  let inHome = false;
  if (homedir) {
    try {
      home = await canonicalizePath(homedir);
      inHome = isPathWithinRoot(await canonicalizePath(dir), home, platform);
    } catch (e) {
      throw new ProjectConfigError(undefined, `cannot resolve the working directory or home directory while searching for ${PROJECT_CONFIG_FILE_NAME} (${(e as Error).message}). ${NO_ESCAPE_HINT}`);
    }
  }

  const searched: string[] = [];
  for (;;) {
    if (p.dirname(dir) === dir) return { searched, stoppedAt: 'filesystem-root' };
    const cand = p.join(dir, PROJECT_CONFIG_FILE_NAME);
    searched.push(cand);
    let st: Awaited<ReturnType<ConfigFs['stat']>> | undefined;
    try {
      st = await fs.stat(cand);
    } catch (e) {
      if (isNotFound(e)) {
        // stat follows links: ENOENT with a link present is a DANGLING symlink — an error, not "absent".
        if (await exists(fs, cand)) throw new ProjectConfigError(cand, `${cand} is a broken symbolic link. ${NO_ESCAPE_HINT}`);
      } else {
        throw new ProjectConfigError(cand, `${cand} cannot be read (${errCode(e) ?? 'error'}). ${NO_ESCAPE_HINT}`);
      }
    }
    if (st) {
      if (st.isFile()) return { path: cand, searched, stoppedAt: 'found' };
      throw new ProjectConfigError(cand, `${cand} exists but is not a regular file. ${NO_ESCAPE_HINT}`);
    }
    if (await exists(fs, p.join(dir, '.git'))) return { searched, stoppedAt: 'git-root', stopDir: dir };
    if (inHome && home !== undefined) {
      let here: string;
      try {
        here = await canonicalizePath(dir);
      } catch (e) {
        throw new ProjectConfigError(undefined, `cannot resolve "${dir}" while searching for ${PROJECT_CONFIG_FILE_NAME} (${(e as Error).message}). ${NO_ESCAPE_HINT}`);
      }
      const sameFold = (a: string, b: string): boolean => isPathWithinRoot(a, b, platform) && isPathWithinRoot(b, a, platform);
      if (sameFold(here, home)) return { searched, stoppedAt: 'home', stopDir: dir };
    }
    dir = p.dirname(dir);
  }
}

// ───────────────────────── loading ─────────────────────────

const foldAscii = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/**
 * Loads a project config. Order: explicit path (no walk) or discovery; ownership (discovered,
 * POSIX); size/read/decode/parse/validate; path resolution; containment (discovered). Throws
 * {@link ProjectConfigError} for every failure — callers decide whether that is fatal (it is, for
 * the CLI/MCP/SDK; `doctor` reports it and still exits 0).
 */
export async function loadProjectConfig(i: {
  cwd: string;
  discover: boolean;
  explicitPath?: string;
  explicitOrigin?: 'env' | 'option';
  homedir?: string;
  platform?: NodeJS.Platform;
  fs?: ConfigFs;
  getuid?: () => number | undefined;
}): Promise<ConfigDiscovery> {
  const fs = i.fs ?? realFs;
  const platform = i.platform ?? process.platform;
  const homedir = i.homedir ?? os.homedir();
  const getuid = i.getuid ?? (() => (typeof process.getuid === 'function' ? process.getuid() : undefined));

  let file: string;
  let origin: ConfigOrigin;
  let searched: string[] = [];
  if (i.explicitPath !== undefined) {
    file = path.resolve(i.cwd, i.explicitPath);
    origin = i.explicitOrigin ?? 'env';
  } else if (!i.discover) {
    return { status: 'none', reason: 'not-requested', searched: [] };
  } else {
    const found = await findProjectConfigPath(i.cwd, { homedir, fs });
    searched = found.searched;
    if (found.path === undefined) {
      return {
        status: 'none',
        reason: 'not-found',
        searched,
        stoppedAt: found.stoppedAt === 'found' ? undefined : found.stoppedAt,
        stopDir: found.stopDir,
      };
    }
    file = found.path;
    origin = 'discovered';
  }

  let st: Awaited<ReturnType<ConfigFs['stat']>>;
  try {
    st = await fs.stat(file);
  } catch (e) {
    if (isNotFound(e)) {
      throw new ProjectConfigError(
        file,
        origin === 'option' ? `configFile "${file}" does not exist.` : `${PROJECT_CONFIG_ENV} points to "${file}", which does not exist.`,
      );
    }
    throw new ProjectConfigError(file, `${file} cannot be read (${errCode(e) ?? 'error'})`);
  }
  if (!st.isFile()) throw new ProjectConfigError(file, `${file} exists but is not a regular file`);

  if (origin === 'discovered' && platform !== 'win32') {
    const me = getuid();
    if (me !== undefined && st.uid !== me && st.uid !== 0) {
      throw new ProjectConfigError(
        file,
        `${file} is owned by uid ${st.uid}, not by you (uid ${me}); refusing a project config another user controls. Fix its ownership, or set ${PROJECT_CONFIG_ENV}=none.`,
      );
    }
    if ((st.mode & 0o022) !== 0) {
      throw new ProjectConfigError(
        file,
        `${file} is writable by group/others (mode ${(st.mode & 0o777).toString(8)}); refusing it. chmod go-w it, or set ${PROJECT_CONFIG_ENV}=none.`,
      );
    }
  }
  if (st.size > PROJECT_CONFIG_MAX_BYTES + 3) throw bad(file, 'is larger than 64 KiB');

  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch (e) {
    throw new ProjectConfigError(file, `${file} cannot be read (${errCode(e) ?? 'error'})`);
  }
  if (buf.byteLength > PROJECT_CONFIG_MAX_BYTES + 3) throw bad(file, 'is larger than 64 KiB');
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    throw bad(file, 'is UTF-16 encoded; save it as UTF-8');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw bad(file, 'is not valid UTF-8; save it as UTF-8');
  }

  const { values, warnings } = validateProjectConfig(parseProjectConfigText(text, file), file);

  const baseDir = path.dirname(file);
  const toAbs = (entry: string, label: string): string => {
    if (entry.includes('\u0000')) throw bad(file, `${label} contains a NUL character`);
    try {
      return resolveConfigPath(entry, baseDir, homedir, platform);
    } catch (e) {
      throw bad(file, `${label} ${(e as Error).message}`);
    }
  };
  const dlEntries: Array<{ label: string; entry: string; abs: string }> = [];
  if (values.downloadDir !== undefined) dlEntries.push({ label: 'downloadDir', entry: values.downloadDir, abs: toAbs(values.downloadDir, 'downloadDir') });
  (values.allowedDownloadRoots ?? []).forEach((e, idx) => {
    const label = `allowedDownloadRoots[${idx}]`;
    dlEntries.push({ label, entry: e, abs: toAbs(e, label) });
  });
  const seen = new Set<string>();
  const dl = dlEntries.filter((d) => {
    const k = platform === 'win32' ? foldAscii(path.normalize(d.abs)) : path.normalize(d.abs);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const ul = values.allowedUploadRoots?.map((e, idx) => toAbs(e, `allowedUploadRoots[${idx}]`));

  if (origin === 'discovered') {
    let base: string;
    try {
      base = await canonicalizePath(baseDir);
    } catch (e) {
      throw bad(file, `cannot resolve this config's own directory (${(e as Error).message})`);
    }
    for (const d of dl) {
      let c: string;
      try {
        c = await canonicalizePath(d.abs);
      } catch (e) {
        throw bad(file, `${d.label} "${d.entry}" cannot be checked (${(e as Error).message}); refusing it. Fix or remove it, or load the file explicitly with ${PROJECT_CONFIG_ENV}=<file>.`);
      }
      if ((await findContainingRoot(d.abs, [baseDir])) === undefined) {
        throw bad(
          file,
          `${d.label} "${d.entry}" resolves to "${c}", outside this config's directory "${base}". A project config found by searching upward may only allow downloads inside its own directory tree. To allow it anyway, set SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS, or load this file explicitly with ${PROJECT_CONFIG_ENV}=<file>.`,
        );
      }
      const rel = c.slice(base.length).split(/[\\/]+/).filter((s) => s.length > 0);
      if (rel.some((s) => foldAscii(s) === '.git')) {
        throw bad(file, `${d.label} "${d.entry}" resolves to "${c}", which is inside a .git directory; downloads there could plant git hooks. Choose another directory.`);
      }
    }
  }

  return {
    status: 'loaded',
    searched,
    config: {
      path: file,
      baseDir,
      origin,
      values,
      resolved: { allowedDownloadRoots: dl.length > 0 ? dl.map((d) => d.abs) : undefined, allowedUploadRoots: ul },
      warnings,
    },
  };
}
