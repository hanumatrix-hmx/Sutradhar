/**
 * @file packages/utils/src/formatters/echo.ts
 * @description FR2-14 fix-2 (N1): the ONE choke point for text that came from a project-config
 * FILE and is about to appear in an error, warning or note. Every such message must pass through
 * {@link echo}, {@link echoPath} or {@link echoValue}, so that (a) its length is capped (64 chars;
 * 200 for a path), (b) it is a single line, and (c) control characters, NUL and bidi/line-separator
 * controls are replaced. A message path that bypasses this is caught by the generated hostile-corpus
 * test and by the source-level guard test (`echo-choke-point.spec.ts`), so a NEW message path cannot
 * escape unnoticed the way the `~user` one did.
 *
 * A3-1 (audit-3): the implementation lives here in @sutradhar/utils (the lowest package both
 * `@sutradhar/browser` and `@sutradhar/capability-runtime` can import) and is re-exported by
 * `capability-runtime/src/echo.ts`. There is exactly ONE implementation. The runtime refusals that
 * list the configured upload roots, download roots and domains use {@link echoList}.
 * The cap applies to MESSAGES only; access decisions always use the real, uncapped values.
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

/** Most entries a refusal message lists before summarising the rest as "+N more". */
export const ECHO_LIST_MAX = 10;

/**
 * Single-line, capped echo of a list of configured entries (roots, domains) for a refusal message:
 * at most {@link ECHO_LIST_MAX} entries, each through {@link echo} (or {@link echoPath} when
 * `isPath`), joined by ", ". Bounded by ECHO_LIST_MAX * (cap + 5) + a short tail.
 */
export function echoList(items: readonly string[], isPath = false): string {
  const shown = items.slice(0, ECHO_LIST_MAX).map((s) => (isPath ? echoPath(s) : echo(s)));
  const more = items.length - shown.length;
  return shown.join(', ') + (more > 0 ? `, ... +${more} more` : '');
}
