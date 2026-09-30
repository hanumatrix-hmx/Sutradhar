/**
 * @file packages/browser/src/session/action-history.ts
 * @description FR2-11: pure helpers for the action history. Everything that reaches an
 * {@link ActionHistoryEntry} (and, through the CLI, `history.jsonl` on disk) goes through
 * {@link sanitizeHistoryEntry}, so a token in a URL, a typed value, clipboard text, or a long eval
 * body can never be stored in full. No I/O and no state in this file.
 *
 * Privacy contract (FR2-11 spec section 0.7 / 7 R1, tightened by fix-1 after audit-1 found leaks):
 *  - URLs are stored as origin + pathname; the query, the fragment, path parameters (`;...`) and userinfo are
 *    ALWAYS dropped (FR2-09 D5). This is FAIL-CLOSED: {@link redactHistoryText} does not try to recognise URL
 *    grammar, it cuts from the first `?` `#` or `;` to the end of any whitespace-delimited token that carries a
 *    URL marker (`scheme://`, a leading `//`, `host[:port]/`, `user:pass@`), and drops the following tokens
 *    until the next marker, because a URL typed with literal spaces would otherwise leak its tail.
 *  - Local file paths are stored as their basename only (an absolute Windows / UNC / POSIX / `~/` path, or a
 *    `file://` URL). A path that contains spaces is reduced across the spaces.
 *  - Typed text and clipboard text are never stored (only a length, built by the caller).
 *  - eval code is stored only as a whitespace-collapsed, redacted preview of at most 200 chars.
 *  - Strings are capped at 200 characters, error / reason / detail at 300 (FR2-07 D1 / D11).
 * One function ({@link redactHistoryText}) serves the MCP / SDK entries AND the CLI's history.jsonl.
 */
import path from 'node:path';
import type { ActionParams, VerificationResultDto } from '../actions/action-types.js';
import type { ActionHistoryEntry } from './browser-tab.js';

/** FR2-07 D1's scalar-string cap: selector, target, url, evidence expected/observed. */
export const HISTORY_STRING_CAP = 200;
/** FR2-07's detail cap: error, verification.reason, evidence detail. */
export const HISTORY_TEXT_CAP = 300;

/** One entry of a session-wide history: a tab entry plus the tab it came from and a per-session sequence number. */
export interface SessionActionHistoryEntry extends ActionHistoryEntry {
  readonly tabId: string;
  /** 1-based, strictly increasing per session. Merge order = recording order (not timestamp). */
  readonly seq: number;
}

// eslint-disable-next-line no-control-regex -- deliberately matches control characters
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** End-truncate to `cap` characters ('…' as the last one); control characters (\r \n \t ...) become ' ' first. */
export function capHistoryString(s: string, cap: number = HISTORY_STRING_CAP): string {
  const flat = s.replace(CONTROL_CHARS, ' ');
  return flat.length <= cap ? flat : flat.slice(0, cap - 1) + '…';
}

/** What replaces a cut query / fragment / path parameter in free text. Documented in AGENT_SETUP.md and the CLI README. */
export const REDACTED_PLACEHOLDER = '[redacted]';
/** Redaction looks at no more than this many characters of one string (every stored field is capped far below it). */
const MAX_REDACT_INPUT = 8_000;

/** The last non-empty path segment of a Windows / UNC / POSIX path (either separator). '' when there is none. */
export function basenameOfPath(p: string): string {
  const parts = p.split(/[\\/]+/).filter((x) => x !== '');
  return parts.length === 0 ? '' : parts[parts.length - 1]!;
}

const FILE_URL_PREFIX = 'file://…/';

/**
 * FR2-09 D5's rules WITHOUT the 80-char display truncation: http/https/ws/wss and every other
 * host-bearing scheme -> origin + pathname; file: -> 'file://…/' + the file's basename (fix-1: never the full local
 * path); blob: -> 'blob:' + inner origin; data: -> 'data:…'; javascript: -> 'javascript:…'; about: / chrome-error:
 * as is (minus any query/fragment); '' -> '(no url)'; anything else (unparsable, scheme-less, opaque) -> the
 * fail-closed {@link redactHistoryText} of it, cut at its first '?' '#' or ';'.
 * The query, the fragment, path parameters (';...') and any userinfo are ALWAYS dropped.
 */
export function redactHistoryUrl(url: string): string {
  if (url === '') return '(no url)';
  const cutAtDelimiter = (s: string): string => s.replace(/[?#;].*$/s, '');
  // the whole string is a URL here: cut it at its first delimiter first (nothing after it is kept), then the text rule strips userinfo and paths
  const fallback = (): string => redactHistoryText(cutAtDelimiter(url));
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return fallback();
  }
  switch (u.protocol) {
    case 'http:':
    case 'https:':
    case 'ws:':
    case 'wss:':
      return u.origin + cutAtDelimiter(u.pathname);
    case 'file:':
      return FILE_URL_PREFIX + basenameOfPath(u.pathname);
    case 'blob:': {
      try {
        return 'blob:' + new URL(u.pathname).origin;
      } catch {
        return 'blob:…';
      }
    }
    case 'data:':
      return 'data:…';
    case 'javascript:':
    case 'vbscript:':
      return u.protocol + '…';
    case 'about:':
      return 'about:' + cutAtDelimiter(u.pathname);
    default:
      // chrome-error://chromewebdata/, chrome://settings/ ... : host-bearing non-special schemes keep scheme, host and path.
      // An opaque path (mailto:, tel:, `example.com:80/p`, `user:pass@host/p` parsed as a scheme) goes through the text rule.
      return u.host && !u.username && !u.password ? `${u.protocol}//${u.host}${cutAtDelimiter(u.pathname)}` : fallback();
  }
}

// ── free-text redaction ──────────────────────────────────────────────────────────────────────────────────────────────
// Token-based and fail-closed. Text is split on whitespace; a token that carries a URL marker is cut at its first
// `?` `#` or `;`; a token that starts an absolute local path is reduced to the path's basename.

/** `scheme://` (scheme of 2+ chars, so a one-letter Windows drive is never a scheme), also JSON-escaped `:\/\/`. */
const SCHEME_SEP = /[A-Za-z][A-Za-z0-9+.-]+:(?:\\?\/){2}/;
/** A fully percent-encoded `scheme://` (`http%3A%2F%2F...`): nothing inside it can be trusted, the whole rest of the token goes. */
const ENCODED_SCHEME = /[A-Za-z][A-Za-z0-9+.-]+%3[Aa](?:%2[Ff]){2}/;
/** A query string with no URL around it (`/p?token=X`, `intranet/app?t=X`, a bare `?t=X`): a `?` followed by a `key=`. */
const QUERY_LIKE = /\?[^\s?&=#]*=/;
/** A form-encoded body or bare query (`a=1&token=X`): two `key=value` pairs joined by `&`. */
const FORM_PAIRS = /[^\s&=?#]+=[^\s&]*&[^\s&=?#]+=/;
const DATA_URL = /(?<![A-Za-z0-9])data:(?=\S)/i;
const LEADING_DOUBLE_SLASH = /^[^\w/\\]*(\/\/)(?=[^/\s])/;
const SCHEMELESS_USERINFO = /(?<![\w.-])[^\s/\\@:]+:[^\s/\\@]*@(?=[^\s/\\@])/;
const SCHEMELESS_HOST =
  /(?<![\w.-])(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[A-Za-z0-9-]+\.)+[A-Za-z][A-Za-z0-9-]*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?(?=[/\\]|[?#]\S)/;
const WIN_DRIVE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/;
// a doubled backslash right after a word character is JSON-escaped text inside a path (`Smith\\my`), not a UNC root
const UNC_PATH = /(?<![\w.:-])\\\\(?=[^\\/\s])/;
const POSIX_PATH = /(?<![\w.:/\\%~-])(?:~\/|\/)(?=[^/\s])/;
const HAS_SEP = /[\\/]/;
const TRAILING_PUNCT = /^(.*?)([)\]}'"`>.,;:!?\u201d\u2019\uff09\u3002]*)$/s;

interface UrlHit {
  start: number;
  kind: 'scheme' | 'blob' | 'file' | 'data' | 'encoded' | 'form' | 'other';
}

/** Earliest URL marker in a token (scheme://, data:, leading //, user:pass@, host[:port]/). */
function findUrlMarker(t: string): UrlHit | undefined {
  const hits: UrlHit[] = [];
  const scheme = SCHEME_SEP.exec(t);
  if (scheme) {
    if (/^file:/i.test(scheme[0])) hits.push({ start: scheme.index, kind: 'file' });
    else if (/blob:$/i.test(t.slice(0, scheme.index))) hits.push({ start: scheme.index - 5, kind: 'blob' });
    else hits.push({ start: scheme.index, kind: 'scheme' });
  }
  const enc = ENCODED_SCHEME.exec(t);
  if (enc) hits.push({ start: enc.index, kind: 'encoded' });
  const data = DATA_URL.exec(t);
  if (data) hits.push({ start: data.index, kind: 'data' });
  const query = QUERY_LIKE.exec(t);
  if (query) hits.push({ start: query.index, kind: 'other' });
  const form = FORM_PAIRS.exec(t);
  if (form) hits.push({ start: form.index, kind: 'form' });
  const dbl = LEADING_DOUBLE_SLASH.exec(t);
  if (dbl) hits.push({ start: dbl.index + dbl[0].length - 2, kind: 'other' });
  const ui = SCHEMELESS_USERINFO.exec(t);
  if (ui) hits.push({ start: ui.index, kind: 'other' });
  const host = SCHEMELESS_HOST.exec(t);
  // a host right after '@' has its userinfo in front of it: when another marker already covers the token, that one wins;
  // otherwise the URL is taken to start at the token's beginning so the userinfo is stripped too
  if (host && !(t[host.index - 1] === '@' && hits.length > 0)) hits.push({ start: host.index > 0 && t[host.index - 1] === '@' ? 0 : host.index, kind: 'other' });
  if (hits.length === 0) return undefined;
  return hits.reduce((a, b) => (b.start < a.start ? b : a));
}

/**
 * Earliest absolute local path start in a token: `C:\`, `C:/`, `\\server`, `/a/b`, `~/a`. -1 when none. A lone
 * `/segment` counts only when the NEXT token contains a separator (`/my dir/file`: a first segment with a space).
 */
function findPathStart(t: string, nextToken?: string): number {
  const starts = [WIN_DRIVE_PATH.exec(t)?.index, UNC_PATH.exec(t)?.index].filter((x): x is number => x !== undefined);
  const posix = POSIX_PATH.exec(t);
  if (posix && (HAS_SEP.test(t.slice(posix.index + posix[0].length)) || (nextToken !== undefined && HAS_SEP.test(nextToken)))) starts.push(posix.index);
  return starts.length === 0 ? -1 : Math.min(...starts);
}

/** Cut a token's URL part: strip userinfo, then cut from the first `?` `#` `;` and append the placeholder. */
function redactUrlToken(t: string, hit: UrlHit): { out: string; cut: boolean } {
  if (hit.kind === 'data') return { out: t.slice(0, hit.start) + 'data:…', cut: true };
  if (hit.kind === 'encoded') return { out: t.slice(0, hit.start) + REDACTED_PLACEHOLDER, cut: true };
  if (hit.kind === 'form') return { out: t.slice(0, hit.start) + REDACTED_PLACEHOLDER, cut: false };
  const prefix = t.slice(0, hit.start);
  let rest = t.slice(hit.start);
  const isBlob = hit.kind === 'blob';
  if (isBlob) rest = rest.slice(5);
  const head = /^(?:[A-Za-z][A-Za-z0-9+.-]+:(?:\\?\/){2,}|\/\/)?/.exec(rest)![0];
  let body = rest.slice(head.length);
  // userinfo: everything up to the LAST '@' of the authority (the text before the first path separator)
  const authority = body.split(/[\\/]/, 1)[0]!;
  const at = authority.lastIndexOf('@');
  if (at >= 0) body = body.slice(at + 1);
  const hadDelimiter = /[?#;]/.test(prefix + head + body);
  if (isBlob) {
    // blob:<origin>/<uuid>: the inner origin only
    const origin = body.split(/[\\/?#;]/, 1)[0]!;
    return { out: prefix + 'blob:' + head + origin + (hadDelimiter ? REDACTED_PLACEHOLDER : ''), cut: hadDelimiter };
  }
  let full = prefix + head + body;
  const c = full.search(/[?#;]/);
  if (c >= 0) full = full.slice(0, c) + REDACTED_PLACEHOLDER;
  return { out: full, cut: c >= 0 };
}

/**
 * Reduce the run of tokens `parts[i..]` that starts an absolute path at character `p` of `parts[i]` to its basename.
 * The run extends over following tokens up to the LAST one that contains a path separator (a path may contain
 * spaces), and stops at a token that starts a URL or another path. Returns the replacement text and the index of the
 * last part consumed.
 */
function reducePathRun(parts: readonly string[], i: number, p: number, fileUrl: boolean): { out: string; last: number; cut: boolean } {
  let last = i;
  for (let j = i + 2; j < parts.length; j += 2) {
    const tk = parts[j]!;
    if (tk === '' || findUrlMarker(tk) || findPathStart(tk) >= 0) break;
    if (HAS_SEP.test(tk)) last = j;
  }
  const first = parts[i]!;
  let prefix = first.slice(0, p);
  let body = first.slice(p);
  for (let j = i + 1; j <= last; j++) body += parts[j]!;
  let cut = false;
  if (fileUrl) {
    body = body.slice(/^file:(?:\\?\/)*/i.exec(body)?.[0].length ?? 0);
    prefix += FILE_URL_PREFIX;
  }
  // a query / fragment on a path is cut too, and the text after it dropped (a path can carry `?token=` as well)
  const q = body.search(/[?#]/);
  if (q >= 0) {
    body = body.slice(0, q);
    cut = true;
  }
  const m = TRAILING_PUNCT.exec(body)!;
  const name = basenameOfPath(m[1]!) || '…';
  return { out: prefix + name + (cut ? REDACTED_PLACEHOLDER : m[2]!), last, cut };
}

/**
 * THE redaction function for every free-text string that reaches history (verification reasons, error messages,
 * evidence strings, selectors, eval previews, CLI args), used by the MCP / SDK entries and by history.jsonl alike.
 * Fail-closed and token-based, see the file header for the rule:
 *  1. Split on whitespace. A token with a URL marker is cut at its first `?` `#` or `;` (replaced by
 *     {@link REDACTED_PLACEHOLDER}); userinfo (`user:pass@`) is removed; `data:` bodies become `data:…`; blob: keeps the origin.
 *  2. After a cut, following tokens are dropped until the next token that carries a URL marker or starts a path.
 *  3. A token that starts an absolute path (`C:\`, `C:/`, `\\unc`, `/a/b`, `~/a`) or a `file://` URL is reduced to the
 *     path's basename; the run extends across spaces to the last token that contains a separator.
 * Idempotent. Over-redaction is acceptable, a leak is not.
 */
export function redactHistoryText(text: string): string {
  const input = text.length > MAX_REDACT_INPUT ? text.slice(0, MAX_REDACT_INPUT) : text;
  const parts = input.split(/(\s+)/); // [tok, ws, tok, ws, ..., tok]
  const out: string[] = [];
  let swallowing = false;
  for (let i = 0; i < parts.length; i += 2) {
    const tok = parts[i]!;
    const ws = i > 0 ? parts[i - 1]! : '';
    if (tok === '') {
      if (!swallowing) out.push(ws);
      continue;
    }
    const url = findUrlMarker(tok);
    const pathAt = findPathStart(tok, parts[i + 2]);
    if (url?.kind === 'file' && (pathAt < 0 || url.start <= pathAt)) {
      const r = reducePathRun(parts, i, url.start, true);
      out.push(ws, r.out);
      swallowing = r.cut;
      i = r.last;
    } else if (pathAt >= 0 && (!url || pathAt < url.start)) {
      const r = reducePathRun(parts, i, pathAt, false);
      out.push(ws, r.out);
      swallowing = r.cut;
      i = r.last;
    } else if (url) {
      const r = redactUrlToken(tok, url);
      out.push(ws, r.out);
      swallowing = r.cut;
    } else if (!swallowing) {
      out.push(ws, tok);
    }
  }
  return out.join('');
}

/** Deprecated name kept for compatibility: the same single function as {@link redactHistoryText}. */
export const redactUrlsInText = redactHistoryText;

/** Collapse whitespace, trim, redact URLs, then cap at 200. The stored form of eval code. */
export function evalCodePreview(code: string): string {
  return capHistoryString(redactHistoryText(code.replace(/\s+/g, ' ').trim()), HISTORY_STRING_CAP);
}

const redactedString = (s: string, cap: number): string => capHistoryString(redactHistoryText(s), cap);

/**
 * Pure: returns a NEW object and never mutates `e` or `e.verification`. Keys that were undefined stay
 * absent. `verification` is read structurally (`'evidence' in v`) so this works against both the
 * pre- and post-FR2-07 shape of {@link VerificationResultDto}.
 */
export function sanitizeHistoryEntry(e: ActionHistoryEntry): ActionHistoryEntry {
  const out: Record<string, unknown> = { ...e };
  if (typeof e.selector === 'string') out.selector = redactedString(e.selector, HISTORY_STRING_CAP);
  if (typeof e.target === 'string') {
    out.target =
      e.actionType === 'navigate'
        ? capHistoryString(redactHistoryUrl(e.target), HISTORY_STRING_CAP)
        : e.actionType === 'eval'
          ? evalCodePreview(e.target)
          : redactedString(e.target, HISTORY_STRING_CAP);
  }
  if (typeof e.url === 'string') out.url = capHistoryString(redactHistoryUrl(e.url), HISTORY_STRING_CAP);
  if (typeof e.error === 'string') out.error = redactedString(e.error, HISTORY_TEXT_CAP);
  if (e.verification) out.verification = sanitizeVerification(e.verification);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as ActionHistoryEntry;
}

function sanitizeVerification(v: VerificationResultDto): VerificationResultDto {
  const scalar = (x: unknown): unknown => (typeof x === 'string' ? redactedString(x, HISTORY_STRING_CAP) : x);
  const out: Record<string, unknown> = { ...v };
  if (typeof v.reason === 'string') out.reason = redactedString(v.reason, HISTORY_TEXT_CAP);
  const ev = (v as unknown as { evidence?: { checks?: readonly Record<string, unknown>[] } }).evidence;
  if (ev && typeof ev === 'object') {
    const evOut: Record<string, unknown> = { ...ev };
    if (Array.isArray(ev.checks)) {
      evOut.checks = ev.checks.map((c) => {
        const cOut: Record<string, unknown> = { ...c };
        if ('expected' in c) cOut.expected = scalar(c.expected);
        if ('observed' in c) cOut.observed = scalar(c.observed);
        if (typeof c.detail === 'string') cOut.detail = redactedString(c.detail, HISTORY_TEXT_CAP);
        for (const k of Object.keys(cOut)) if (cOut[k] === undefined) delete cOut[k];
        return cOut;
      });
    }
    out.evidence = evOut;
  }
  return out as unknown as VerificationResultDto;
}

/**
 * The engine-side `target`: what an action was aimed at when that is not a selector. NEVER reads
 * `params.value` (typed text) or `values` (select options).
 */
export function describeActionTarget(params: ActionParams): string | undefined {
  switch (params.actionType) {
    case 'navigate':
      return params.url;
    case 'press_key':
      return params.key === undefined ? undefined : [...(params.modifiers ?? []), params.key].join('+');
    case 'click_by_text':
      return params.text;
    case 'click_by_role':
      return params.role === undefined ? undefined : params.name ? `${params.role} "${params.name}"` : params.role;
    case 'type_by_label':
      return params.label;
    case 'scroll': {
      const t = [params.direction, params.amount].filter((x) => x !== undefined).join(' ');
      return t === '' ? undefined : t;
    }
    case 'wait':
      return params.milliseconds === undefined ? undefined : `${params.milliseconds}ms`;
    case 'wait_for_selector':
      return `state=${params.state ?? 'visible'}`;
    case 'upload_file':
      return params.filePath === undefined ? undefined : path.basename(params.filePath.replace(/\\/g, '/'));
    default:
      return undefined;
  }
}

/** {@link scrubActionError} applied to every free-text string of a verification (reason, evidence
 *  expected/observed/detail): a failed action's `reason` is "Action failed: <the error>", so it quotes the same secrets. Pure. */
export function scrubVerification(params: ActionParams, v: VerificationResultDto): VerificationResultDto {
  const s = (x: unknown): unknown => (typeof x === 'string' ? scrubActionError(params, x) : x);
  const out: Record<string, unknown> = { ...v };
  if (typeof v.reason === 'string') out.reason = scrubActionError(params, v.reason);
  const ev = (v as unknown as { evidence?: { checks?: readonly Record<string, unknown>[] } }).evidence;
  if (ev && typeof ev === 'object') {
    const evOut: Record<string, unknown> = { ...ev };
    if (Array.isArray(ev.checks)) {
      evOut.checks = ev.checks.map((c) => {
        const cOut: Record<string, unknown> = { ...c };
        if ('expected' in c) cOut.expected = s(c.expected);
        if ('observed' in c) cOut.observed = s(c.observed);
        if ('detail' in c) cOut.detail = s(c.detail);
        return cOut;
      });
    }
    out.evidence = evOut;
  }
  return out as unknown as VerificationResultDto;
}

/**
 * Removes a typed value (and, for a `type did not land` failure, the field's real content) from an
 * engine error message before it is recorded. `type` and `type_by_label` failures quote BOTH the
 * requested value and what the field actually held ("expected \"hunter2\", but the element's real
 * content reads ..."), which would otherwise persist a secret.
 */
export function scrubActionError(params: ActionParams, error: string): string {
  const landed = error.indexOf('type did not land the expected value');
  if ((params.actionType === 'type' || params.actionType === 'type_by_label') && landed >= 0) {
    // keeps any prefix ("Action failed: ") and drops everything after, which is where both quotes live
    return error.slice(0, landed) + 'type did not land the expected value (the typed text and the field content are not recorded)';
  }
  let out = error;
  for (const value of [params.value, ...(params.values ?? [])]) {
    if (typeof value === 'string' && value.length >= 3) {
      out = out.split(JSON.stringify(value)).join('<value>').split(value).join('<value>');
    }
  }
  return out;
}
