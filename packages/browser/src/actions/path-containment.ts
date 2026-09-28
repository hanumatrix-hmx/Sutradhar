/**
 * @file packages/browser/src/actions/path-containment.ts
 * @description Shared filesystem-containment helpers for download/upload sandboxing (FR2-05).
 *
 * `isPathWithinRoot` (pure, synchronous) and `canonicalizePath`/`findContainingRoot` (real
 * filesystem, symlink/junction-safe) are split so the pure prefix logic can be unit-tested
 * without touching disk, while the async helpers do the real symlink-resolution work needed to
 * fail closed against a link (existing or with a not-yet-created tail) that escapes an allowed
 * root — see FR2-05 spec B2/B3/B4/D3.
 */

import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { realpath, lstat, writeFile, unlink, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Name of the directory (under `os.tmpdir()`) downloads land in when no roots are configured. */
export const DEFAULT_DOWNLOAD_ROOT_DIRNAME = 'sutradhar-downloads';

/** The default download root, evaluated at call time (not module-load time) so tests that swap
 *  `os.tmpdir()` (e.g. via `TEMP`/`TMP`/`TMPDIR`) see the change. */
export function defaultDownloadRoot(): string {
  return path.join(os.tmpdir(), DEFAULT_DOWNLOAD_ROOT_DIRNAME);
}

/**
 * ASCII-only case fold: lower-cases `A`-`Z` (0x41-0x5A) only, leaving every other code point —
 * including non-ASCII letters — untouched.
 *
 * FR2-05 audit-1 GAP-295: `String.prototype.toLowerCase()` performs full Unicode case folding,
 * which maps certain visually-distinct characters onto plain ASCII letters even though NTFS
 * treats them as genuinely different directory names — e.g. the Kelvin sign (U+212A) folds to
 * ordinary `'k'`, and the Angstrom sign (U+212B) folds to `'å'`. A root named `...\work` would
 * then wrongly treat `...\wor<KELVIN SIGN>` (a separate, real directory on NTFS) as the same
 * name. NTFS/Win32 case-insensitivity itself only ever folds ASCII (and a fixed non-ASCII
 * table that does NOT include these look-alikes for containment purposes), so an ASCII-only
 * fold here is strictly narrower than `toLowerCase()` and can never *reject* something a real
 * ASCII-only case difference should allow, while it stops treating Unicode look-alikes as
 * equal.
 */
function foldAsciiCase(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 32) : s[i];
  }
  return out;
}

/**
 * True if `candidate` is `root` itself or nested under it.
 *
 * FR2-05 fix-1 (GAP-295): this used to delegate the actual prefix comparison to
 * `path.win32.relative(fold(root), fold(candidate))`. That looked safe — `fold` was applied
 * before handing the strings to Node — but `path.win32.relative` performs its OWN internal
 * case-insensitive segment comparison on win32, using a full-Unicode-aware fold that is NOT
 * limited to ASCII. Confirmed directly: `path.win32.relative('C:\\work', 'C:\\wor\u212A\\a')`
 * (Kelvin sign, U+212A) returns `'a'` — Node's own comparison treats the Kelvin sign as equal to
 * `'k'` regardless of what pre-folding was applied to the input strings, because the folding
 * happens again, unconditionally, inside `path.relative` itself. So the previous fix attempt
 * (folding the *inputs* with `toLowerCase`, then later ASCII-only) never actually closed
 * GAP-295: `path.relative`'s own internal fold reopened it every time on win32.
 *
 * The fix here does the whole comparison manually — parses out each path's root (drive letter,
 * UNC share, or `\\?\` device prefix; a mismatch here means "not contained", covering the
 * other-drive and device-path-spelling cases the old `isAbsolute(rel)` check used to catch) and
 * compares the remaining path SEGMENT BY SEGMENT with our own {@link foldAsciiCase}, never
 * calling `path.relative` (or any other Node API that might fold case internally) at all. This
 * is the only way to guarantee the comparison folds exactly the ASCII range and nothing else.
 */
export function isPathWithinRoot(
  candidate: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
  /**
   * FR2-05 audit-2 GAP-300 (CRITICAL): whether the comparison should fold ASCII case
   * (`undefined`/`true` semantics below preserve fix-1's default win32 behavior for callers —
   * e.g. the PC1/PC2 pure unit tests — that don't have real disk state to check case-sensitivity
   * against). {@link findContainingRoot}, which DOES touch the real filesystem, always passes an
   * explicit value here, derived from {@link detectCaseSensitivity} against the real on-disk
   * root — never left to this default — because a blanket "win32 is always case-insensitive"
   * assumption is exactly the GAP-300 vulnerability: a folder can be marked case-sensitive
   * (enablable without admin rights; WSL-created folders default to it) so `root` and `ROOT`
   * are genuinely different real directories, but the old unconditional ASCII fold treated them
   * as the same, allowed directory. When explicitly `false` (case-sensitive), segments are
   * compared byte-for-byte with no folding at all, on any platform.
   */
  caseSensitive?: boolean,
): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const effectiveCaseSensitive = caseSensitive === undefined ? platform !== 'win32' : caseSensitive;
  const fold = (s: string): string => (effectiveCaseSensitive ? s : foldAsciiCase(s));

  const resolvedRoot = p.resolve(root);
  const resolvedCandidate = p.resolve(candidate);

  const rootParsed = p.parse(resolvedRoot);
  const candidateParsed = p.parse(resolvedCandidate);

  // Different drive letter, different UNC share, or a different root spelling entirely (e.g. a
  // `\\?\` device path against a plain drive path) — never contained, regardless of what comes
  // after. This subsumes the old `p.isAbsolute(rel)` check (which caught exactly these cases via
  // `path.relative`'s own logic).
  if (fold(rootParsed.root) !== fold(candidateParsed.root)) return false;

  const splitTail = (full: string, parsed: path.ParsedPath): string[] =>
    full
      .slice(parsed.root.length)
      .split(p.sep)
      .filter((seg) => seg.length > 0)
      .map(fold);

  const rootSegs = splitTail(resolvedRoot, rootParsed);
  const candidateSegs = splitTail(resolvedCandidate, candidateParsed);

  if (candidateSegs.length < rootSegs.length) return false;
  for (let i = 0; i < rootSegs.length; i++) {
    if (rootSegs[i] !== candidateSegs[i]) return false;
  }
  return true;
}

/**
 * FR2-05 audit-1 GAP-294 (CRITICAL): rejects any path component that Windows' own path-creation
 * APIs (confirmed identical for Chrome's download-directory creation) silently strip — a
 * trailing `.` or trailing ` ` (space) at the end of a component. Node's `fs.realpath`/`fs.lstat`
 * look such a component up LITERALLY (they use the `\\?\` namespace internally, which does not
 * perform this normalization), so `canonicalizePath` used to see `ENOENT` for e.g. `<root>\jn.\
 * sub` and treat `jn.` as an ordinary not-yet-created directory — approving the whole path as
 * contained. But real Windows path creation (confirmed against plain `CreateDirectoryW`/
 * `os.makedirs`, and against Chrome's own download-directory creation, end-to-end, 3/3 trials)
 * strips the trailing dot/space and resolves straight through `jn` — a junction that can point
 * anywhere, including outside the allowed root.
 *
 * The fix rejects outright, fail-closed, before any existence check: real Windows files/folders
 * essentially never have a trailing dot/space in their name (the OS strips it on creation for
 * exactly this reason), so this has near-zero legitimate-use cost and closes the entire bug
 * class in one place rather than needing Chrome-specific knowledge.
 *
 * Applied to EVERY component of the path being validated (not just the last), because the trick
 * can be planted anywhere along the walk, e.g. `root\subdir.\jn.\sub` (two tricks). Both the
 * requested/candidate path and every configured root go through {@link canonicalizePath}, so
 * this check protects both.
 *
 * win32 only: POSIX filesystems perform no such normalization, so a literal trailing dot/space
 * there is just an ordinary (if unusual) file name with no bypass potential.
 */
function rejectWindowsTrimmedComponents(absPath: string, platform: NodeJS.Platform): void {
  if (platform !== 'win32') return;
  const p = path.win32;
  const parsed = p.parse(absPath);
  const rest = absPath.slice(parsed.root.length);
  if (!rest) return;
  const parts = rest.split(p.sep).filter((part) => part.length > 0);
  for (const part of parts) {
    // `path.resolve`/`path.win32.parse` never leave a literal `.` or `..` segment in the
    // normalized tail, so any segment reaching here that ends in `.` or ` ` is a real,
    // non-dot-segment component with a trailing dot/space — exactly what Windows strips.
    if (part.endsWith('.') || part.endsWith(' ')) {
      throw new Error(
        `path component "${part}" in "${absPath}" ends with a trailing dot or space, which ` +
          `Windows silently strips on path creation — rejecting outright to prevent a ` +
          `containment bypass through a link named with that trick (FR2-05 GAP-294).`,
      );
    }
  }
}

/**
 * FR2-05 audit-2 GAP-300: determine whether directory `dir` (which must exist) is
 * case-SENSITIVE on disk — i.e. whether `dir/foo` and `dir/FOO` are two different real
 * children. Returns `true` (case-sensitive) whenever this can't be determined, per the
 * fix-2 binding decision: "a false 'different' rejection is safe but a false 'same' approval
 * is the actual vulnerability" — so an undetectable directory is treated as the STRICTER
 * (case-sensitive) mode, never silently assumed case-insensitive.
 *
 * Two detection strategies, tried in order:
 * 1. `fsutil file queryCaseSensitiveInfo <dir>` — the documented Windows 10+ API for a
 *    per-directory case-sensitivity flag (NTFS `FILE_CASE_SENSITIVE_DIR`), settable without
 *    admin rights (`fsutil file setCaseSensitiveInfo <dir> enable`) and the mechanism WSL uses
 *    by default for directories it creates. No native addon needed, but this shells out, so it
 *    can fail (fsutil missing from PATH, spawn blocked, non-Windows, unexpected output).
 * 2. A real filesystem probe: create a uniquely-named file, then check whether an
 *    upper-cased spelling of that same name resolves to the SAME file (case-insensitive) or
 *    nothing at all (case-sensitive). This needs write access to `dir` but no shell/subprocess,
 *    so it's a robust fallback when `fsutil` is unavailable or its output can't be parsed.
 *
 * If BOTH fail (e.g. `dir` isn't writable and `fsutil` isn't available either), the directory's
 * case-sensitivity is genuinely undetectable and this returns `true` (fail closed/strict).
 */
/**
 * Per-directory result cache. `detectCaseSensitivity` shells out to `fsutil` (a real, slow-ish
 * subprocess spawn — tens to a couple hundred ms) or falls back to a real filesystem write
 * probe; both are far too slow to pay on every single `download_file`/upload containment check
 * (FR2-05 fix-2 audit self-check: this was found live to slow every call by ~100-300ms, which
 * compounds badly given GAP-301/GAP-302's history of download-path latency problems). A
 * directory's on-disk case-sensitivity mode is not expected to change while this process is
 * running (changing it requires `fsutil ... setCaseSensitiveInfo`, an explicit administrative
 * action, and even then only applies going forward) — so this process-lifetime cache is safe:
 * the worst case is a stale `true`/`false` from before an out-of-band change, and fix-2's own
 * fail-closed default (case-sensitive when undetectable) means a stale entry can only ever be
 * wrong in the SAFE direction if it goes stale from sensitive->insensitive (would then over-
 * reject, not under-reject); the reverse (insensitive->sensitive) is the same direction fresh
 * detection already defaults to on any failure, so it's never less safe than a fresh check.
 */
const caseSensitivityCache = new Map<string, boolean>();

/** Test-only: clears the cache so unit tests exercising different directories don't see stale
 *  results across cases/files that happen to reuse a path or mocked directory string. */
export function _clearCaseSensitivityCacheForTests(): void {
  caseSensitivityCache.clear();
}

export async function detectCaseSensitivity(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== 'win32') {
    // POSIX default (ext4 and most Linux filesystems) is case-sensitive; the existing
    // `isPathWithinRoot` default already never folds case on non-win32, so this is consistent
    // with prior behavior. (macOS's default case-INsensitive APFS/HFS+ is a known, disclosed
    // gap — this project targets win32 for FR2-05's live verification, and out-of-scope
    // platforms fail toward the stricter comparison, which is safe.)
    return true;
  }

  const cacheKey = path.resolve(dir);
  const cached = caseSensitivityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await detectCaseSensitivityUncached(dir);
  caseSensitivityCache.set(cacheKey, result);
  return result;
}

async function detectCaseSensitivityUncached(dir: string): Promise<boolean> {
  const viaFsutil = await detectViaFsutil(dir);
  if (viaFsutil !== undefined) return viaFsutil;

  try {
    return await detectViaProbe(dir);
  } catch {
    return true; // undetectable -> fail closed (case-sensitive / stricter)
  }
}

async function detectViaFsutil(dir: string): Promise<boolean | undefined> {
  try {
    const { stdout } = await execFileAsync('fsutil', ['file', 'queryCaseSensitiveInfo', dir], {
      timeout: 5000,
      windowsHide: true,
    });
    // Observed real output: "Case sensitive attribute: Enabled" / "... Disabled". Match loosely
    // on "enabled"/"disabled" so minor wording differences across Windows builds still parse.
    if (/enabled/i.test(stdout)) return true;
    if (/disabled/i.test(stdout)) return false;
    return undefined; // unparseable — fall through to the probe
  } catch {
    return undefined; // fsutil missing/blocked/errored — fall through to the probe
  }
}

async function detectViaProbe(dir: string): Promise<boolean> {
  const rand = crypto.randomBytes(8).toString('hex');
  const lowerName = `.sutradhar-cs-probe-${rand}`;
  const upperName = lowerName.toUpperCase();
  const lowerPath = path.join(dir, lowerName);
  await writeFile(lowerPath, '');
  try {
    const lowerStat = await stat(lowerPath);
    const upperStat = await stat(path.join(dir, upperName)).catch(() => undefined);
    if (!upperStat) return true; // the upper-cased spelling doesn't resolve at all -> case-sensitive
    // Same underlying file (device+inode match) under both spellings -> case-insensitive.
    return !(lowerStat.dev === upperStat.dev && lowerStat.ino === upperStat.ino);
  } finally {
    await unlink(lowerPath).catch(() => {});
  }
}

/** Walks up from `p` to the deepest ancestor that actually exists (bounded by the filesystem
 *  root). Used to find the real directory whose on-disk case-sensitivity flag governs whether
 *  a candidate path's case matters when comparing it against a configured root — see GAP-300. */
async function deepestExistingAncestor(p: string): Promise<string> {
  let cur = path.resolve(p);
  for (;;) {
    try {
      await stat(cur);
      return cur;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return cur;
      cur = parent;
    }
  }
}

/**
 * FR2-05 audit-2 GAP-300: whether comparing paths against `root` should be case-sensitive,
 * determined from REAL on-disk state rather than assumed from the platform. The confirmed
 * escape shape is a case-different SIBLING of `root` under a directory whose case-sensitivity
 * flag governs its immediate children (e.g. `root`'s parent enabled via `fsutil
 * setCaseSensitiveInfo`) — so this checks both `root`'s own deepest existing ancestor AND that
 * ancestor's parent (covering both "the root itself sits inside a case-sensitive directory" and
 * "the root's existing ancestor's parent is the case-sensitive one" — the exact GAP-300 repro
 * shape). If EITHER check reports case-sensitive, or either check is itself undetectable, the
 * overall result is case-sensitive (the stricter, safe default) — only when both checks
 * positively confirm case-INsensitivity does this return `false`.
 */
export async function isRootCaseSensitive(
  root: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== 'win32') return true;
  const ancestor = await deepestExistingAncestor(root);
  const parent = path.dirname(ancestor);
  const dirsToCheck = parent === ancestor ? [ancestor] : [ancestor, parent];
  for (const dir of dirsToCheck) {
    try {
      if (await detectCaseSensitivity(dir, platform)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Resolve `p` to its real (symlink/junction-resolved) absolute form, walking up to the deepest
 * *existing* ancestor and re-appending the not-yet-created tail — rather than falling back to the
 * literal string the moment the full path doesn't exist (the old bug, B2/B3): that fallback let a
 * link with a nonexistent tail (`<root>/jn/newsub`, where `jn` is a junction/symlink pointing
 * outside the root) pass a prefix check on its literal spelling even though Chrome/CDP creates
 * `newsub` *through* the link, outside the root.
 *
 * A component that exists as a link (`lstat` succeeds) but whose target doesn't (`realpath`
 * throws ENOENT/ENOTDIR) is a dangling link and this REJECTS (throws), rather than silently
 * treating it as a plain not-yet-created directory. Any other `realpath` error (EACCES, ELOOP,
 * …) also rejects — fail closed.
 *
 * Before any of that, on win32, every component of `p` is checked for a trailing dot/space and
 * rejected outright — see {@link rejectWindowsTrimmedComponents} (GAP-294).
 */
export async function canonicalizePath(
  p: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const abs = path.resolve(p);
  rejectWindowsTrimmedComponents(abs, platform);
  let cur = abs;
  const tail: string[] = [];

  for (;;) {
    try {
      const real = await realpath(cur);
      return tail.length ? path.join(real, ...tail) : real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        let isLink = false;
        try {
          await lstat(cur);
          isLink = true;
        } catch {
          isLink = false;
        }
        if (isLink) {
          throw new Error(`broken symlink/junction at "${cur}"`);
        }
        const parent = path.dirname(cur);
        if (parent === cur) {
          // Reached the filesystem root without ever resolving — return the literal absolute path.
          return abs;
        }
        tail.unshift(path.basename(cur));
        cur = parent;
        continue;
      }
      throw err;
    }
  }
}

/**
 * Canonicalizes `candidate` and each of `roots`, and returns the first root `candidate` falls
 * within (per {@link isPathWithinRoot}), or `undefined` if none contain it.
 *
 * A root that fails to canonicalize (e.g. it doesn't exist and isn't a link either — just a
 * literal non-existent directory with no ancestor issues) still canonicalizes fine via the same
 * not-yet-created-tail logic; a root whose canonicalization genuinely errors (a dangling link, or
 * a filesystem error) is skipped rather than aborting the whole containment check. `candidate`'s
 * own canonicalization errors propagate — a broken link in the CANDIDATE path is always fatal.
 */
export async function findContainingRoot(
  candidate: string,
  roots: readonly string[],
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const c = await canonicalizePath(candidate, platform);
  for (const root of roots) {
    let r: string | undefined;
    try {
      r = await canonicalizePath(root, platform);
    } catch {
      continue;
    }
    // FR2-05 audit-2 GAP-300: never assume case-insensitivity as a blanket win32 default (the
    // old bug) — determine it from the REAL on-disk state of this specific root and pass it
    // explicitly, so a case-sensitive folder (enablable without admin rights; WSL-created
    // folders default to it) is compared exactly, not folded into a false match.
    const caseSensitive = await isRootCaseSensitive(root, platform);
    if (isPathWithinRoot(c, r, platform, caseSensitive)) return root;
  }
  return undefined;
}
