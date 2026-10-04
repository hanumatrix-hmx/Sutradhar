/**
 * @file packages/capability-runtime/src/page-text.ts
 * @description I-048: page-text windowing. Validation, the surrogate-safe window computation (in-page and
 * Node-side twins), the shared truncation-marker formatter and the explicit read-failure error.
 *
 * The page text used to be cut at 4000 characters with no marker and no way to read the rest. A caller can
 * now read any window, always sees the total, and a truncated read is announced by {@link formatPageTextMarker}.
 */

import {
  DEFAULT_PAGE_TEXT_MAX_CHARS,
  MAX_PAGE_TEXT_CHARS,
  type PageTextResult,
} from './types.js';

/** A page-text read failed (DOM evaluate rejected, or a PDF could not be fetched/parsed). Surfaces match it by
 *  `err.name === 'PageTextReadError'` (the class is duplicated into each bundle, so `instanceof` is unreliable). */
export class PageTextReadError extends Error {
  public override readonly name = 'PageTextReadError';
  public readonly source: 'dom' | 'pdf';
  public override readonly cause?: unknown;
  constructor(source: 'dom' | 'pdf', reason: string, cause?: unknown) {
    super(
      source === 'pdf'
        ? `the PDF text could not be extracted: ${reason}`
        : `the page text could not be read: ${reason}`,
    );
    this.source = source;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Human-readable reason for an arbitrary thrown value. */
export function pageTextFailureReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 300 ? `${msg.slice(0, 300)}...` : msg;
}

/** Validates and defaults the caller options. Throws `TypeError` (naming the parameter and its range) BEFORE any
 *  browser round trip. `maxChars` defaults to {@link DEFAULT_PAGE_TEXT_MAX_CHARS}, `offset` to 0. */
export function validatePageTextOptions(
  opts?: { offset?: number; maxChars?: number },
): { offset: number; maxChars: number } {
  const offset = opts?.offset ?? 0;
  const maxChars = opts?.maxChars ?? DEFAULT_PAGE_TEXT_MAX_CHARS;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new TypeError(`offset must be an integer >= 0 (got ${String(offset)})`);
  }
  if (typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_PAGE_TEXT_CHARS) {
    throw new TypeError(`maxChars must be an integer from 1 to ${MAX_PAGE_TEXT_CHARS} (got ${String(maxChars)})`);
  }
  return { offset, maxChars };
}

/** Raw window of a full text: `total` = full length, `start` = effective start, `slice` = the window. */
export interface RawTextWindow {
  total: number;
  start: number;
  slice: string;
}

/**
 * Node-side window computation (used for PDF text). Surrogate rules: a start that lands on a low surrogate whose
 * predecessor is a high surrogate moves back one; an end that would split a pair is extended by one. A window is
 * never empty unless `offset >= total`. Must stay byte-for-byte equivalent to {@link pageWindowInPage}
 * (a unit test compares them over every (offset, maxChars) of a surrogate-rich text).
 */
export function windowPageText(t: string, o: number, m: number): RawTextWindow {
  const total = t.length;
  let start = o;
  if (start > 0 && start < total) {
    const c = t.charCodeAt(start);
    const p = t.charCodeAt(start - 1);
    if (c >= 0xdc00 && c <= 0xdfff && p >= 0xd800 && p <= 0xdbff) start -= 1;
  }
  let end = Math.min(total, start + m);
  if (end > start && end < total) {
    const last = t.charCodeAt(end - 1);
    const next = t.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end += 1;
  }
  return { total, start, slice: start >= total ? '' : t.slice(start, end) };
}

/**
 * The function that runs INSIDE the page (`page.evaluate(pageWindowInPage, offset, maxChars)`): reads
 * `document.body.innerText` once and returns only the window plus the total, so a 5 MB page never crosses CDP.
 * Self-contained on purpose (serialised by `page.evaluate`): no closure variables, no nested helper functions.
 */
export function pageWindowInPage(o: number, m: number): RawTextWindow {
  const t: string = document.body?.innerText ?? '';
  const total = t.length;
  let start = o;
  if (start > 0 && start < total) {
    const c = t.charCodeAt(start);
    const p = t.charCodeAt(start - 1);
    if (c >= 0xdc00 && c <= 0xdfff && p >= 0xd800 && p <= 0xdbff) start -= 1;
  }
  let end = Math.min(total, start + m);
  if (end > start && end < total) {
    const last = t.charCodeAt(end - 1);
    const next = t.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end += 1;
  }
  return { total, start, slice: start >= total ? '' : t.slice(start, end) };
}

/** `truncated` per the spec: `offset > 0 || offset + returnedChars < totalChars`, except that an empty page (or any
 *  `offset >= total`) is truncated only when there is text (`total > 0`). */
export function isPageTextTruncated(offset: number, returnedChars: number, totalChars: number): boolean {
  if (offset >= totalChars) return totalChars > 0;
  return offset > 0 || offset + returnedChars < totalChars;
}

/** Builds the public result from a raw window. */
export function toPageTextResult(args: {
  sessionId: string;
  tabId: string;
  url: string;
  source: 'dom' | 'pdf';
  window: RawTextWindow;
  requestedOffset: number;
}): PageTextResult {
  const { window: w } = args;
  // Past the end the effective start is the offset as given (nothing to back up onto).
  const offset = w.start >= w.total ? args.requestedOffset : w.start;
  return {
    sessionId: args.sessionId,
    tabId: args.tabId,
    url: args.url,
    text: w.slice,
    offset,
    returnedChars: w.slice.length,
    totalChars: w.total,
    truncated: isPageTextTruncated(offset, w.slice.length, w.total),
    source: args.source,
  };
}

/**
 * The one shared truncation marker (ASCII only; a surface puts it on its own final line). `null` when the read
 * was complete. `<end>` = offset + returnedChars.
 *  A  more follows:       `[page text truncated: showing characters <offset>-<end> of <total>. <continueHint>]`
 *  B  last paged window:  `[page text: showing characters <offset>-<end> of <total> (end)]`
 *  C  offset past the end: `[page text: offset <offset> is past the end; the page text has <total> characters]`
 */
export function formatPageTextMarker(
  r: Pick<PageTextResult, 'offset' | 'returnedChars' | 'totalChars' | 'truncated'>,
  continueHint?: string,
): string | null {
  if (!r.truncated) return null;
  const end = r.offset + r.returnedChars;
  if (r.offset >= r.totalChars) {
    if (r.totalChars <= 0) return null;
    return `[page text: offset ${r.offset} is past the end; the page text has ${r.totalChars} characters]`;
  }
  if (end >= r.totalChars) {
    return `[page text: showing characters ${r.offset}-${end} of ${r.totalChars} (end)]`;
  }
  return `[page text truncated: showing characters ${r.offset}-${end} of ${r.totalChars}.${continueHint ? ` ${continueHint}` : ''}]`;
}
