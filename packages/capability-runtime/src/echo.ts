/**
 * @file packages/capability-runtime/src/echo.ts
 * @description FR2-14 fix-2 (N1): the ONE choke point for text that came from a project-config
 * FILE and is about to appear in an error, warning or note. Every such message must pass through
 * {@link echo}, {@link echoPath} or {@link echoValue}, so that (a) its length is capped (64 chars;
 * 200 for a path), (b) it is a single line, and (c) control characters, NUL and bidi/line-separator
 * controls are replaced. A message path that bypasses this is caught by the generated hostile-corpus
 * test and by the source-level guard test (`echo-choke-point.spec.ts`), so a NEW message path cannot
 * escape unnoticed the way the `~user` one did.
 */

/** Longest piece of file content any message echoes (key names, string values, entries). */
export const ECHO_MAX = 64;
/** A resolved path derived from a file entry may be longer, since its tail is what matters. */
export const ECHO_PATH_MAX = 200;

// Replaced with `?`: C0/C1 controls (incl. NUL, CR, LF, ESC), LS/PS, zero-width and bidi controls,
// BOM, and lone surrogates (a cap may cut a pair in half).
const UNSAFE =
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Single-line, length-capped echo of text that came from the file. */
export function echo(s: string, max: number = ECHO_MAX): string {
  const head = s.length > max ? s.slice(0, max) : s;
  return `${head.replace(UNSAFE, '?')}${s.length > max ? '...' : ''}`;
}

/** {@link echo} with the longer cap used for resolved paths. */
export function echoPath(s: string): string {
  return echo(s, ECHO_PATH_MAX);
}

/** Short, single-line echo of a scalar/array/object from the file (JSON form), capped at {@link ECHO_MAX}. */
export function echoValue(v: unknown): string {
  let s: string;
  try {
    s = typeof v === 'string' ? JSON.stringify(v) : String(JSON.stringify(v));
  } catch {
    s = '<unprintable>';
  }
  return echo(s);
}
