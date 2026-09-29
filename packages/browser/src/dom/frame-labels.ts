/**
 * @file packages/browser/src/dom/frame-labels.ts
 * @description Pure, unit-testable helpers for labelling iframe/shadow-DOM context in
 * snapshot text and structured output (FR2-09). Nothing here touches a live page — every
 * function takes plain data (a URL string, a duck-typed frame-like object, a name) and
 * returns a plain string, so a caller (dom-semantic-engine.ts, ax-snapshot.ts) can compute
 * frame identity once and reuse these formatters for both the DOM snapshot and the
 * accessibility snapshot.
 */

import type { SkippedFrame, SkippedFrameReason } from './semantic-element-graph.js';

/**
 * D5 display rule for a frame's URL: shown once per frame in the text listing. Full fidelity
 * (including query/fragment) is preserved separately in the structured `frame.url` field —
 * this is a *display* transform, dropping session-carrying query/fragment data and bounding
 * length. Never throws: any parse failure falls back to the raw string, still capped at 80
 * characters.
 */
export function displayFrameUrl(url: string): string {
  if (!url) return '(no url)';
  try {
    let candidate: string;
    if (url.startsWith('chrome-error://') || url.startsWith('about:')) {
      candidate = url;
    } else if (url.startsWith('data:')) {
      return 'data:…';
    } else if (url.startsWith('blob:')) {
      candidate = `blob:${originOf(url.slice(5))}`;
    } else if (url.startsWith('file:')) {
      const pathname = new URL(url).pathname;
      const full = `file://${pathname}`;
      // FR2-09 fix-1 (GAP-144/spec section 5.7, remedy option i): a long local file:// path
      // (routine in a dev/test worktree many directories deep) is mostly directory noise to an
      // LLM reader once it's long enough to need truncation anyway — show just the file name
      // instead of a middle-truncated absolute path. A short file:// URL (the common
      // real-world case, and every existing pinned fixture/unit test) is completely
      // unaffected: this only changes behavior once truncation would otherwise kick in.
      candidate = full.length <= 80 ? full : `file://${fileNameOf(pathname)}`;
    } else {
      const u = new URL(url);
      candidate = `${u.origin}${u.pathname}`;
    }
    return truncateMiddle(candidate, 80);
  } catch {
    return truncateMiddle(url, 80);
  }
}

function fileNameOf(pathname: string): string {
  const parts = pathname.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : pathname;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** First 38 + "…" + last 41 characters — 80 total — so a file name at the end survives. */
function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const headLen = 38;
  const tailLen = max - headLen - 1;
  return `${s.slice(0, headLen)}…${s.slice(s.length - tailLen)}`;
}

/** D5 origin-only form, used by placeholder lines for a frame that couldn't be inspected. */
export function frameOrigin(url: string): string {
  if (!url) return '(no url)';
  if (url.startsWith('chrome-error://')) return 'chrome-error://';
  if (url.startsWith('about:')) return url;
  if (url.startsWith('file:')) return 'file://';
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/**
 * D14: a frame name is page-controlled and now lands in text an LLM reads. Strips characters
 * that could forge a line or close the bracket (`[`, `]`, `"`), collapses newlines/tabs to
 * spaces, trims, and caps at 30 characters.
 */
export function sanitizeFrameName(name: string | undefined): string {
  if (!name) return '';
  const cleaned = name
    .replace(/[\r\n\t]/g, ' ')
    .replace(/"/g, "'")
    .replace(/[[\]]/g, '')
    .trim();
  return cleaned.slice(0, 30);
}

/**
 * D4 designator: `"name"` when the sanitized name is non-empty AND unique among `allNames`
 * (the sanitized names of every frame in this snapshot, listed and skipped) — otherwise the
 * bare index, otherwise `?` when neither is known.
 */
export function frameDesignator(
  ref: { readonly name?: string; readonly index?: number },
  allNames: readonly string[],
): string {
  const name = sanitizeFrameName(ref.name);
  if (name) {
    const occurrences = allNames.filter((n) => n === name).length;
    if (occurrences === 1) return `"${name}"`;
  }
  if (ref.index !== undefined) return String(ref.index);
  return '?';
}

/** D2 text rendering of a shadow-host chain: 1 → `a`; 2 → `a > b`; 3+ → `a > … > z`. */
export function formatShadowChain(chain: readonly string[]): string {
  if (chain.length <= 2) return chain.join(' > ');
  return `${chain[0]} > … > ${chain[chain.length - 1]}`;
}

/**
 * D3: fixed, main-first traversal order — `[main, ...frames.filter(!detached && !== main)]`.
 * On a normal page `frames[0]` is already the main frame, so this is a no-op there. Duck-typed
 * so both a real Puppeteer `Frame` and a test double satisfy it. The main frame is NEVER
 * filtered out (even if `isDetached()` would say otherwise), matching `buildGraph`'s existing
 * "main always scanned" behavior.
 */
export function orderSnapshotFrames<F extends { isDetached(): boolean }>(frames: readonly F[], main: F): F[] {
  return [main, ...frames.filter((f) => f !== main && !f.isDetached())];
}

/** D6 reason text for a skipped (not-inspectable) frame, keyed by every reason except
 *  `frame-limit` (which aggregates instead of naming one frame — see {@link formatSkippedFrameLines}). */
export const SKIPPED_REASON_TEXT: Record<Exclude<SkippedFrameReason, 'frame-limit'>, (detail?: string) => string> = {
  timeout: (detail) => `timed out after ${detail}ms`,
  navigated: () => 'navigated during snapshot',
  error: (detail) => `error: ${detail}`,
  'error-page': () => 'browser error page: blocked or failed to load',
};

/**
 * D6: honest placeholder lines for frames whose content is NOT in this snapshot, rather than
 * silently omitting them. Per-frame lines are emitted in input order; `frame-limit` entries
 * are aggregated into a single trailing line.
 */
export function formatSkippedFrameLines(skipped: readonly SkippedFrame[], maxFrames: number): string[] {
  const lines: string[] = [];
  let limitCount = 0;
  for (const s of skipped) {
    if (s.reason === 'frame-limit') {
      limitCount++;
      continue;
    }
    const namePart = s.name ? `"${sanitizeFrameName(s.name)}" ` : '';
    const reasonText = SKIPPED_REASON_TEXT[s.reason](s.detail);
    // GAP-154: a 'likely' urlConfidence means the origin below came from the fallback
    // iframe-src-attribute read, not a CDP-confirmed unreachableUrl — flag it so the text never
    // states a guessed origin with the same certainty as a confirmed one.
    const originText = s.urlConfidence === 'likely' ? `${s.origin} (likely, unconfirmed)` : s.origin;
    lines.push(`[iframe ${namePart}${originText} — not inspectable] (${reasonText})`);
  }
  if (limitCount > 0) {
    lines.push(`[${limitCount} more iframe${limitCount === 1 ? '' : 's'} not scanned — frame limit ${maxFrames}]`);
  }
  return lines;
}
