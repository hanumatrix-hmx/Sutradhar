/**
 * @file packages/browser/src/session/action-history.ts
 * @description FR2-11: pure helpers for the action history. Everything that reaches an
 * {@link ActionHistoryEntry} (and, through the CLI, `history.jsonl` on disk) goes through
 * {@link sanitizeHistoryEntry}, so a token in a URL, a typed value, clipboard text, or a long eval
 * body can never be stored in full. No I/O and no state in this file.
 *
 * Privacy contract (FR2-11 spec section 0.7 / 7 R1; fix-2: the CHARACTER RULE, see {@link redactHistoryText}):
 *  - Free text is redacted by characters, never by recognising URL shapes: tokens are split on any Unicode whitespace; each
 *    token is cut from its first `?`, `#` or `;` (and the rest of the text after a cut is dropped); a token that still holds
 *    `=` or `&` is replaced whole; `userinfo@` is stripped; a path token is reduced to its last segment. Percent-, double-
 *    percent-, JSON- and fullwidth encodings of those characters are decoded first.
 *  - Structured URL fields (`target` of navigate, `url`) keep FR2-09 D5's origin + pathname, then go through the same rule.
 *  - Typed text and clipboard text are never stored (only a length, built by the caller).
 *  - eval code is stored only as a whitespace-collapsed, redacted preview of at most 200 chars (spec H5 / R2).
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
 * FR2-09 D5's rules WITHOUT the 80-char display truncation: http/https/ws/wss and every other host-bearing scheme ->
 * origin + pathname; file: -> 'file://…/' + the file's basename; blob: -> 'blob:' + inner origin; data: -> 'data:…';
 * javascript: -> 'javascript:…'; about: / chrome-error: as is (minus any query/fragment); '' -> '(no url)'; anything else
 * (unparsable, scheme-less, opaque) -> {@link redactHistoryText} of it. The RESULT of every branch then goes through
 * {@link redactHistoryText} too (an encoded `%3F` or a `=` in the path is cut like anywhere else), so a structured field
 * can never hold something the free-text rule would have cut.
 */
export function redactHistoryUrl(url: string): string {
  if (url === '') return '(no url)';
  return redactHistoryText(redactHistoryUrlD5(decodeDelimiters(url)));
}

function redactHistoryUrlD5(url: string): string {
  const cutAtDelimiter = (s: string): string => s.replace(/[?#;].*$/s, '');
  const fallback = (): string => cutAtDelimiter(url);
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
      // chrome-error://chromewebdata/, chrome://settings/ ...: host-bearing non-special schemes keep scheme, host and path.
      // An opaque path (mailto:, tel:, `example.com:80/p`, a custom-scheme redirect, `user:pass@host/p`) goes through the text rule.
      return u.host && !u.username && !u.password ? `${u.protocol}//${u.host}${cutAtDelimiter(u.pathname)}` : fallback();
  }
}

// ── free-text redaction: THE CHARACTER RULE ──────────────────────────────────────────────────────────────────────────
// Shape-independent and fail-closed (fix-2). fix-0 (a character-class URL regex) and fix-1 (a list of URL markers) both
// decided WHICH tokens were URLs and kept everything else, so every audit found the next unlisted shape. This rule never
// asks what a token is; it looks at characters only:
//   0. decode `%3F %23 %3B %3D %26 %40 %2F %5C %3A` (also double-encoded `%253F`), JSON unicode / hex escapes of them (backslash-u003f, backslash-x3f), and fold
//      fullwidth forms (NFKC: `？` -> `?`) so an encoded delimiter is a delimiter;
//   1. split on ANY Unicode whitespace (tab, NBSP, zero-width, ideographic ...);
//   2. per token, (a) cut from the first `?`, `#` or `;` and put the placeholder there; the rest of the text after a cut
//      is dropped too (a URL typed with a space in its query cannot leak its tail);
//   3. (b) a token that still contains `=` or `&` is replaced whole (a `&` also drops the rest of the text);
//   4. (c) `userinfo@` is stripped from the authority of a token;
//   5. a token with a `/` or `\` separator followed by more text is reduced to its last segment (a segment without a `.`
//      is a directory name and becomes `<dir>`), unless it is a `scheme://` URL (kept as origin + path) or a `file:` URL
//      (`file://…/<basename>`); `blob:` keeps its origin; `data:` / `javascript:` bodies become `data:…` / `javascript:…`.
// Selectors (`mode: 'selector'`) are the ONE variant of the same function: CSS uses `#id`, `[a=b]`, so there `#` cuts only
// when it follows something URL-shaped (a separator, `@`, `%` or `:` earlier in the token, or a URL-shaped token earlier in the
// string) and `=` inside `[...]` is allowed; `&` is never allowed.
// Over-redaction of ordinary prose that contains those characters is accepted and documented; a leak is not.

/** Tokens are split on these: every JS `\s` plus controls, NBSP, zero-width, bidi and invisible separators. */
// eslint-disable-next-line no-control-regex -- deliberately matches control characters
const WS_SPLIT = /([\s\u0000-\u001f\u007f\u0085\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]+)/;
/** `scheme://` inside a token (also the JSON-escaped `:\/\/`): the URL test of the path rule and the userinfo strip. */
const SCHEME_SEP = /:(?:\\?\/){2,}/;
const SCHEME_NAME_END = /[A-Za-z][A-Za-z0-9+.-]*$/;

/** Index just after the `scheme://` of a token whose text before the scheme holds no path separator (`fetch("https://h/p`, `(http://h`); -1 otherwise. */
function schemeEnd(t: string): number {
  const m = SCHEME_SEP.exec(t);
  if (!m) return -1;
  const pre = t.slice(0, m.index);
  if (!SCHEME_NAME_END.test(pre) || /[/\\]/.test(pre.replace(/\\["']/g, ''))) return -1;
  return m.index + m[0].length;
}
const OPAQUE_BODY = /(?<![A-Za-z0-9])(?:data|javascript|vbscript):/i;
// `file:` and `blob:` anywhere in a token, not glued to a longer word (`fetch("file:///C:/Users/x/f.txt")`)
const FILE_TOKEN = /(?<![A-Za-z0-9])file:/i;
const BLOB_TOKEN = /(?<![A-Za-z0-9])blob:((?:[A-Za-z][A-Za-z0-9+.-]*:(?:\\?\/){2})?[^\s/\\?#;]*)/i;
const SEP_THEN_TEXT = /[\\/][^\\/]/;
const HAS_EXTENSION = /\w\.\w|^\.\w/;
/** Selector mode only: something URL-shaped (a separator, `:` + digit or `/`, a known scheme) that a CSS selector does not contain. */
const URLISH = /[/\\@%]|:[0-9/]|:$|^[^A-Za-z0-9]*(?:about|chrome|chrome-error|edge|view-source|blob|file|data|javascript|mailto|tel|urn|ws|wss|ftp|http|https):/i;
/** Selector mode: a `#` after any of these inside ITS OWN token is a fragment (`about:blank#S`, `host/p#S`), not `tag#id`. */
const TOKEN_URLISH = /[/\\@%:]/;
const DIR_PLACEHOLDER = '<dir>';
/** A character that can follow the `#` of an element id (letters, digits, `_`, `-`, an escape, any non-ASCII letter). */
const IDENT_CHAR = /[\w\-\\]|[\u0080-\uffff]/;
/** A token that is exactly `#` plus identifier characters: a mention of an element id. */
const BARE_ID = /^#(?:[\w\-\\]|[\u0080-\uffff])+$/;
const PERCENT_DELIM = /%(3[AFBDafbd]|23|26|2[Ff]|40|5[Cc])/g;
const JSON_ESC_DELIM = /\\(?:u00|x)(3[AFBDafbd]|23|26|2[Ff]|40|5[Cc])/g;

/** Fold encodings of the rule's characters to the characters themselves (once, before tokenising). */
function decodeDelimiters(s: string): string {
  let out = s.normalize('NFKC');
  out = out.replace(JSON_ESC_DELIM, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  for (let i = 0; i < 8; i++) {
    const n = out.replace(/%25(?=[0-9a-fA-F]{2})/g, '%'); // double (and deeper) encoding: one level per pass
    if (n === out) break;
    out = n;
  }
  return out.replace(PERCENT_DELIM, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** `userinfo@` (everything up to the last `@` of the authority, the text before the first path separator). */
function stripUserinfo(t: string): string {
  const end = schemeEnd(t);
  const lead = end >= 0 ? end : /^(?:\/\/|\\\\)/.test(t) ? 2 : 0;
  const prefix = t.slice(0, lead);
  const rest = t.slice(lead);
  const authority = rest.split(/[\\/]/, 1)[0]!;
  const at = authority.lastIndexOf('@');
  return at < 0 ? t : prefix + rest.slice(at + 1);
}

/** Reduce a path-like token; returns the token unchanged when it has no separator followed by text. */
function reducePathToken(t: string): string {
  const file = FILE_TOKEN.exec(t);
  if (file) {
    const base = basenameOfPath(t.slice(file.index + file[0].length));
    // a last segment without an extension is a directory name (a user name, a home directory): not stored
    return t.slice(0, file.index) + FILE_URL_PREFIX + (base === '' ? '…' : HAS_EXTENSION.test(base) ? base : DIR_PLACEHOLDER);
  }
  const blob = BLOB_TOKEN.exec(t);
  if (blob) return t.slice(0, blob.index) + 'blob:' + blob[1];
  if (schemeEnd(t) >= 0) return t;
  if (!SEP_THEN_TEXT.test(t)) return t;
  const name = basenameOfPath(t);
  return HAS_EXTENSION.test(name) ? name : DIR_PLACEHOLDER;
}

export interface RedactOptions {
  /** `selector`: the CSS-aware variant (see the header). Default: free text. */
  mode?: 'text' | 'selector';
}

interface TokenResult {
  out: string;
  /** Everything after this token (up to the end of the text) is dropped. */
  swallow: boolean;
}

function redactToken(tok: string, selector: boolean, afterUrlish: boolean): TokenResult {
  const opaque = OPAQUE_BODY.exec(tok);
  if (opaque) return { out: tok.slice(0, opaque.index) + opaque[0].toLowerCase() + '…', swallow: true };
  // (a) cut at the first `?` `#` `;`
  let cutAt = -1;
  for (let i = 0; i < tok.length; i++) {
    const c = tok[i]!;
    if (c === '?' || c === ';') {
      cutAt = i;
      break;
    }
    // selector mode: a `#` with no identifier character after it (`host#` then a space, `a#)`) is never CSS, so it is a fragment
    if (c === '#' && (!selector || afterUrlish || TOKEN_URLISH.test(tok.slice(0, i)) || !IDENT_CHAR.test(tok[i + 1] ?? ''))) {
      cutAt = i;
      break;
    }
  }
  let head = cutAt < 0 ? tok : tok.slice(0, cutAt);
  // a bare `#x` (the WHOLE token is `#` plus identifier characters) does not drop the following text: it is most often a mention of an
  // element id. Anything else that starts with `#` (a lone `#`, `#a;b`, `#a=b`, `#x)`) does: `# S` could be a fragment typed with a space.
  const swallow = cutAt >= 0 && !(cutAt === 0 && BARE_ID.test(tok));
  head = stripUserinfo(head);
  // (b) `=` / `&` left after the cut: replace the whole token. In selector mode `=` inside `[...]` is CSS attribute syntax.
  const probe = selector ? head.replace(/\[[^\]]*\]?/g, '') : head;
  if (/=/.test(probe) || head.includes('&')) {
    return { out: REDACTED_PLACEHOLDER, swallow: swallow || head.includes('&') };
  }
  // the placeholder is part of the token BEFORE the path reduction, so a second pass over the stored text changes nothing
  const whole = cutAt >= 0 ? head + REDACTED_PLACEHOLDER : head;
  // selector mode: `a[href="/x"]` (an attribute selector) holds a `/` that is CSS, not a path
  // the userinfo strip runs again on the reduced token: a leading `\"` or `'` can hide the authority from the first pass
  return { out: selector && /\[[^\]]*=/.test(head) ? whole : stripUserinfo(reducePathToken(whole)), swallow };
}

/**
 * THE redaction function for every free-text string that reaches history (verification reasons, error messages,
 * evidence strings, selectors, eval previews, CLI args), used by the MCP / SDK entries AND by history.jsonl. See the
 * section header for the rule. Idempotent. Input beyond {@link MAX_REDACT_INPUT} characters is dropped.
 */
export function redactHistoryText(text: string, opts: RedactOptions = {}): string {
  const selector = opts.mode === 'selector';
  const raw = text.length > MAX_REDACT_INPUT ? text.slice(0, MAX_REDACT_INPUT) : text;
  const input = decodeDelimiters(raw);
  const parts = input.split(WS_SPLIT); // [tok, ws, tok, ws, ..., tok]
  // input cut at the cap: its last token may be only the FIRST part of a token whose separator / delimiter was cut off, so it is not kept
  if (raw.length < text.length && parts[parts.length - 1] !== '') parts[parts.length - 1] = REDACTED_PLACEHOLDER;
  const out: string[] = [];
  // selector mode: text that carried an ENCODED delimiter (percent, JSON escape or fullwidth form) is not CSS, so its `#` cuts
  let afterUrlish = selector && input !== raw;
  for (let i = 0; i < parts.length; i += 2) {
    const tok = parts[i]!;
    const ws = i > 0 ? parts[i - 1]! : '';
    if (tok === '') {
      out.push(ws);
      continue;
    }
    const r = redactToken(tok, selector, afterUrlish);
    out.push(ws, r.out);
    if (r.swallow) break;
    afterUrlish = afterUrlish || URLISH.test(tok);
  }
  return out.join('');
}

/** The selector variant of {@link redactHistoryText} (same function, `mode: 'selector'`). */
export const redactHistorySelector = (text: string): string => redactHistoryText(text, { mode: 'selector' });

/** Deprecated name kept for compatibility: the same single function as {@link redactHistoryText}. */
export const redactUrlsInText = redactHistoryText;

/** Collapse whitespace, trim, redact URLs, then cap at 200. The stored form of eval code. */
export function evalCodePreview(code: string): string {
  return capHistoryString(redactHistoryText(code.replace(/\s+/g, ' ').trim()), HISTORY_STRING_CAP);
}

/** The engine-generated target of wait_for_selector: a closed vocabulary, the one `=` the rule must not eat. */
const WAIT_STATE_TARGET = /^state=(?:visible|hidden|attached|detached)$/;

/**
 * The engine-generated target of upload_file is the file's basename. Same rule as a path in free text: a name with no extension is
 * a directory-like name (a user name, a home directory) and is not stored; anything else goes through the character rule.
 */
const uploadTarget = (name: string): string => (HAS_EXTENSION.test(name) ? redactedString(name, HISTORY_STRING_CAP) : DIR_PLACEHOLDER);

const redactedString = (s: string, cap: number): string => capHistoryString(redactHistoryText(s), cap);

/** Stands in for the `=` of an engine-generated `text="..."` key while the rule runs (a private-use character: not whitespace, not a rule character). */
const KEY_EQ = String.fromCharCode(0xe000);
const CONDITION_KEY = /(^| AND )(textGone|text)="/g;

/**
 * The `selector` of a wait_for entry is the engine's description of the caller's condition (FR2-08: `text="Saved successfully"`,
 * `textGone="..."`, `url~"..."`, `js(...)`). The KEY syntax `text="` is engine vocabulary, not user data, so its `=` must not trip
 * rule (b); the PAYLOAD after it is the caller's text and goes through the rule like any other selector text (a `?`, `;`, `&`, a second
 * `=` or a path inside it is cut exactly as elsewhere).
 */
function conditionSelector(s: string): string {
  // free-text mode, not the selector variant: a condition is page text / a URL / JS, not CSS (`a#S` must not survive here)
  return redactHistoryText(s.replace(CONDITION_KEY, (_m, sep: string, k: string) => `${sep}${k}${KEY_EQ}"`))
    .split(KEY_EQ)
    .join('=');
}

/**
 * Pure: returns a NEW object and never mutates `e` or `e.verification`. Keys that were undefined stay
 * absent. `verification` is read structurally (`'evidence' in v`) so this works against both the
 * pre- and post-FR2-07 shape of {@link VerificationResultDto}.
 */
export function sanitizeHistoryEntry(e: ActionHistoryEntry): ActionHistoryEntry {
  const out: Record<string, unknown> = { ...e };
  if (typeof e.selector === 'string') {
    out.selector = capHistoryString(e.actionType === 'wait_for' ? conditionSelector(e.selector) : redactHistorySelector(e.selector), HISTORY_STRING_CAP);
  }
  if (typeof e.target === 'string') {
    out.target =
      e.actionType === 'navigate'
        ? capHistoryString(redactHistoryUrl(e.target), HISTORY_STRING_CAP)
        : e.actionType === 'eval'
          ? evalCodePreview(e.target)
          : e.actionType === 'upload_file' || e.actionType === 'upload_file_via_trigger'
            ? uploadTarget(e.target)
            : WAIT_STATE_TARGET.test(e.target)
              ? e.target
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
