/**
 * @file packages/browser/src/session/action-history.ts
 * @description FR2-11: pure helpers for the action history. Everything that reaches an
 * {@link ActionHistoryEntry} (and, through the CLI, `history.jsonl` on disk) goes through
 * {@link sanitizeHistoryEntry}, so a token in a URL, a typed value, clipboard text, or a long eval
 * body can never be stored in full. No I/O and no state in this file.
 *
 * Privacy contract (FR2-11 spec section 0.7 / 7 R1):
 *  - URLs are stored as origin + pathname; the query and the fragment are ALWAYS dropped (FR2-09 D5).
 *  - Typed text and clipboard text are never stored (only a length, built by the caller).
 *  - eval code is stored only as a whitespace-collapsed, URL-redacted preview of at most 200 chars.
 *  - Strings are capped at 200 characters, error / reason / detail at 300 (FR2-07 D1 / D11).
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

/**
 * FR2-09 D5's rules WITHOUT the 80-char display truncation: http/https/ws/wss and every other
 * host-bearing scheme -> origin + pathname; file: -> 'file://' + pathname; blob: -> 'blob:' + inner
 * origin; data: -> 'data:…'; javascript: -> 'javascript:…'; about: / chrome-error: as is (minus any
 * query/fragment); '' -> '(no url)'; unparsable -> the raw string cut at its first '?' or '#'.
 * The query and the fragment are ALWAYS dropped, as is any userinfo.
 */
export function redactHistoryUrl(url: string): string {
  if (url === '') return '(no url)';
  const cutAtQueryOrFragment = (s: string): string => s.replace(/[?#].*$/s, '');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return cutAtQueryOrFragment(url);
  }
  switch (u.protocol) {
    case 'http:':
    case 'https:':
    case 'ws:':
    case 'wss:':
      return u.origin + u.pathname;
    case 'file:':
      return 'file://' + u.pathname;
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
      return 'about:' + cutAtQueryOrFragment(u.pathname);
    default:
      // chrome-error://chromewebdata/, chrome://settings/ ... : host-bearing non-special schemes
      // keep their scheme, host and path; an opaque path (mailto:, tel:) keeps the path only.
      return u.host ? `${u.protocol}//${u.host}${u.pathname}` : u.protocol + cutAtQueryOrFragment(u.pathname);
  }
}

const URL_IN_TEXT = /\b(?:https?|wss?|file|blob):\/\/[^\s"'`<>()[\]{}]+/gi;
const DATA_URL_IN_TEXT = /\bdata:[^\s"'`<>]+/gi;

/** Replace every URL-looking token inside free text with {@link redactHistoryUrl} of it. */
export function redactUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, (m) => redactHistoryUrl(m)).replace(DATA_URL_IN_TEXT, 'data:…');
}

/** Collapse whitespace, trim, redact URLs, then cap at 200. The stored form of eval code. */
export function evalCodePreview(code: string): string {
  return capHistoryString(redactUrlsInText(code.replace(/\s+/g, ' ').trim()), HISTORY_STRING_CAP);
}

const redactedString = (s: string, cap: number): string => capHistoryString(redactUrlsInText(s), cap);

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

/**
 * Removes a typed value (and, for a `type did not land` failure, the field's real content) from an
 * engine error message before it is recorded. `type` and `type_by_label` failures quote BOTH the
 * requested value and what the field actually held ("expected \"hunter2\", but the element's real
 * content reads ..."), which would otherwise persist a secret.
 */
export function scrubActionError(params: ActionParams, error: string): string {
  if ((params.actionType === 'type' || params.actionType === 'type_by_label') && /^type did not land the expected value/.test(error)) {
    return 'type did not land the expected value (the typed text and the field content are not recorded)';
  }
  let out = error;
  for (const value of [params.value, ...(params.values ?? [])]) {
    if (typeof value === 'string' && value.length >= 3) {
      out = out.split(JSON.stringify(value)).join('<value>').split(value).join('<value>');
    }
  }
  return out;
}
