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
import { realpath, lstat } from 'node:fs/promises';

/** Name of the directory (under `os.tmpdir()`) downloads land in when no roots are configured. */
export const DEFAULT_DOWNLOAD_ROOT_DIRNAME = 'sutradhar-downloads';

/** The default download root, evaluated at call time (not module-load time) so tests that swap
 *  `os.tmpdir()` (e.g. via `TEMP`/`TMP`/`TMPDIR`) see the change. */
export function defaultDownloadRoot(): string {
  return path.join(os.tmpdir(), DEFAULT_DOWNLOAD_ROOT_DIRNAME);
}

/**
 * True if `candidate` is `root` itself or nested under it, using `path.relative` rather than a
 * plain string prefix comparison. `path.relative` correctly handles the `C:\` (drive-root) case,
 * where a naive `root + path.sep` string produces `C:\\` and rejects everything — see FR2-05 B4.
 *
 * Case-folds on win32 only (NTFS/ReFS are case-preserving but case-insensitive); POSIX
 * filesystems are case-sensitive by default, so folding there could wrongly ALLOW a path that is
 * actually a different, disallowed entry.
 */
export function isPathWithinRoot(
  candidate: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const fold = (s: string): string => (platform === 'win32' ? s.toLowerCase() : s);
  const rel = p.relative(fold(root), fold(candidate));
  if (rel === '') return true;
  if (p.isAbsolute(rel)) return false;
  if (rel === '..' || rel.startsWith('..' + p.sep)) return false;
  return true;
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
 */
export async function canonicalizePath(p: string): Promise<string> {
  const abs = path.resolve(p);
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
): Promise<string | undefined> {
  const c = await canonicalizePath(candidate);
  for (const root of roots) {
    let r: string | undefined;
    try {
      r = await canonicalizePath(root);
    } catch {
      continue;
    }
    if (isPathWithinRoot(c, r)) return root;
  }
  return undefined;
}
