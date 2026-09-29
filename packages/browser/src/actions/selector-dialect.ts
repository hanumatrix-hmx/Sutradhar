/**
 * @file packages/browser/src/actions/selector-dialect.ts
 * @description FR2-06: detects Playwright-style selector syntax (text=, role=, >>, :has-text(),
 * getBy*(), internal:, ...) up front and rejects it with an actionable hint, instead of letting
 * it silently fail or get misread as literal (and usually invalid) CSS. Also provides the
 * browser-side syntax probe used by the engine to fail fast on genuinely invalid CSS/XPath, and
 * `toPuppeteerQuery`, which lets Puppeteer's own `pierce/`, `xpath/`, `aria/` and `text/` prefixes
 * actually work on engine-routed actions (they previously got double-prefixed into `pierce/xpath/…`
 * and always failed).
 *
 * Lives in `@sutradhar/browser` (the lowest layer) so both the capability-runtime façade
 * (`normalizeTarget`) and the action engine (the pre-loop probe) can import it without a
 * dependency cycle.
 */

/**
 * Actionable tail appended to every selector-syntax error raised across the runtime. Single
 * source of truth — moved here from `capability-runtime/src/types.ts`, where FR2-02 introduced
 * it; that module now re-exports this constant unchanged in name.
 */
export const SELECTOR_SYNTAX_HINT =
  'Use standard CSS or a snapshot node id (e.g. "12"); Puppeteer\'s pierce/, xpath/, aria/ and text/ ' +
  'prefixes also work for element actions. Playwright-style selectors (text=, role=, >>, :has-text(), ' +
  'getBy*(), internal:) are not supported: to target by visible text or accessible role/name, use ' +
  'click_by_text, click_by_role or type_by_label (CLI: clicktext, clickrole), or take a snapshot and ' +
  'use a node id.';

/**
 * Extracts the first line of a browser selector-parser error message, with a leading
 * "SyntaxError: " / "DOMException: " prefix stripped, for use in a Sutradhar-authored error
 * message. Never returns an empty string — falls back to a generic phrase when given no message.
 * (Moved verbatim from `capability-runtime/src/types.ts`, FR2-02.)
 */
export function selectorSyntaxDetail(parserMessage: string): string {
  const firstLine = (parserMessage ?? '').split('\n')[0]?.trim() ?? '';
  const stripped = firstLine.replace(/^(SyntaxError|DOMException):\s*/i, '').trim();
  return stripped.length > 0 ? stripped : 'invalid selector syntax';
}

export type InvalidSelectorKind = 'foreign-dialect' | 'invalid-syntax';

/**
 * Thrown synchronously — before any session lookup, `await`, or CDP call — when a caller-supplied
 * selector is written in a foreign selector dialect (Playwright syntax), or (via
 * {@link invalidSelectorSyntaxError}) when the browser's own parser has already rejected it.
 */
export class InvalidSelectorError extends Error {
  public override readonly name = 'InvalidSelectorError';
  public readonly selector: string;
  /** One sentence, no hint — wrappers (extract, frameSelector) rebuild their own framing from it. */
  public readonly reason: string;
  public readonly kind: InvalidSelectorKind;

  public constructor(selector: string, reason: string, kind: InvalidSelectorKind) {
    super(`Invalid selector "${selector}" — ${reason} ${SELECTOR_SYNTAX_HINT}`);
    this.selector = selector;
    this.reason = reason;
    this.kind = kind;
  }
}

export interface ForeignDialectMatch {
  rule: ForeignDialectRule;
  token: string;
  reason: string;
}

export type ForeignDialectRule =
  | 'node-id-syntax'
  | 'quoted-text'
  | 'bare-xpath'
  | 'internal'
  | 'engine-prefix'
  | 'chain'
  | 'pseudo'
  | 'locator-method';

/** Slash prefixes Puppeteer resolves natively. The `=` spellings are deliberately NOT here (D5). */
export const PUPPETEER_SELECTOR_PREFIX_RE = /^(pierce|xpath|aria|text)\//;

/**
 * One pass over `input`: `\` plus the next char becomes `_`; a `"…"`/`'…'` string (with escapes
 * inside) becomes an empty pair of the same quotes (unterminated -> consumed to the end); a
 * `/* … *\/` comment becomes one space (unterminated -> consumed to the end). This keeps every
 * detection rule below from ever matching a Playwright-shaped TOKEN that only appears inside a
 * real string literal, escape or comment of otherwise-valid CSS (D9).
 */
function stripCssOpaqueRegions(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === '\\') {
      out += '_';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += quote + quote;
      i += 1;
      while (i < n) {
        if (input[i] === '\\') {
          i += 2;
          continue;
        }
        if (input[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      out += ' ';
      i += 2;
      const end = input.indexOf('*/', i);
      i = end === -1 ? n : end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const ENGINE_PREFIX_RE = /^(text|role|css|xpath|aria|pierce|id|data-testid|data-test-id|data-test)\s*=/i;
const NODE_ID_RE = /^\[?#(\d+)\]?$/;
const QUOTED_TEXT_RE = /^["']/;
const BARE_XPATH_RE = /^\(*\s*\.{0,2}\//;
const INTERNAL_RE = /(?<![\w.#-])internal:[a-z][a-z-]*\s*=/;
const CHAIN_RE = /(?<!>)>>(?!>)/;
const PSEUDO_RE = /:(?:has-text|text-is|text-matches|text|nth-match)\(|:visible(?![\w-])/;
const LOCATOR_METHOD_RE = /getBy[A-Z][A-Za-z]*\s*\(/;

function engineReason(prefix: string): string {
  // `prefix` is the raw regex match (e.g. "xpath=", "Xpath = "), which already carries its own
  // trailing "=" (and possibly whitespace before it, per ENGINE_PREFIX_RE's `\s*=`). Strip that
  // off FIRST so the strings built below don't double it (GAP-205).
  const norm = prefix.toLowerCase().replace(/\s*=$/, '');
  if (norm.startsWith('text')) {
    return '"text=" is Playwright selector-engine syntax (Puppeteer\'s own text query is spelled "text/").';
  }
  if (norm.startsWith('role')) {
    return '"role=" is Playwright selector-engine syntax.';
  }
  if (norm.startsWith('css')) {
    return '"css=" is Playwright\'s explicit CSS-engine prefix; drop it and pass the CSS itself.';
  }
  if (norm.startsWith('xpath') || norm.startsWith('aria') || norm.startsWith('pierce')) {
    return `"${norm}=" is not supported; use the slash form "${norm}/".`;
  }
  // id=, data-testid=, data-test-id=, data-test=
  return `"${norm}=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [${norm}="…"].`;
}

/**
 * Pure, synchronous, O(n). Returns `null` for anything that isn't provably Playwright-shaped
 * (including plain valid CSS that merely LOOKS similar — see D9/D2's false-positive guard list).
 */
export function detectForeignSelectorDialect(selector: string): ForeignDialectMatch | null {
  const s = selector.trim();
  if (s.length === 0) return null;

  let css = s;
  const prefixMatch = PUPPETEER_SELECTOR_PREFIX_RE.exec(s);
  if (prefixMatch) {
    const kind = prefixMatch[1]!.toLowerCase();
    if (kind === 'xpath' || kind === 'aria' || kind === 'text') return null; // D4: never scanned
    // kind === 'pierce': the payload after the prefix IS CSS, and IS scanned (D4). Trim it
    // (GAP-213): a stray space right after "pierce/" (e.g. "pierce/ text=Submit") otherwise
    // defeats every `^`-anchored detection regex below (ENGINE_PREFIX_RE, BARE_XPATH_RE, ...),
    // letting Playwright syntax slip through as an uncoached browser parser error instead.
    css = s.slice(prefixMatch[0].length).trimStart();
  }

  const bare = stripCssOpaqueRegions(css);

  const nodeId = NODE_ID_RE.exec(css);
  if (nodeId) {
    return {
      rule: 'node-id-syntax',
      token: css,
      reason: `this looks like a snapshot node id; pass just the number, e.g. "${nodeId[1]}".`,
    };
  }
  if (QUOTED_TEXT_RE.test(css)) {
    return {
      rule: 'quoted-text',
      token: '"',
      reason: "a quoted string is Playwright's legacy text selector, not CSS.",
    };
  }
  if (BARE_XPATH_RE.test(css)) {
    return {
      rule: 'bare-xpath',
      token: '//',
      reason: 'this looks like an XPath expression; prefix it with "xpath/" (e.g. xpath///button[@id="go"]).',
    };
  }
  const internalMatch = INTERNAL_RE.exec(bare);
  if (internalMatch) {
    return {
      rule: 'internal',
      token: internalMatch[0],
      reason: `"${internalMatch[0]}" is Playwright-internal selector syntax (as printed by Playwright locators/codegen), not CSS.`,
    };
  }
  const enginePrefixMatch = ENGINE_PREFIX_RE.exec(css);
  if (enginePrefixMatch) {
    return {
      rule: 'engine-prefix',
      token: enginePrefixMatch[0],
      reason: engineReason(enginePrefixMatch[0]),
    };
  }
  if (CHAIN_RE.test(bare)) {
    return {
      rule: 'chain',
      token: '>>',
      reason: '">>" (Playwright selector chaining) is Playwright selector syntax.',
    };
  }
  const pseudoMatch = PSEUDO_RE.exec(bare);
  if (pseudoMatch) {
    return {
      rule: 'pseudo',
      token: pseudoMatch[0],
      reason: `"${pseudoMatch[0]}" is a Playwright-only pseudo-class, not CSS.`,
    };
  }
  const locatorMatch = LOCATOR_METHOD_RE.exec(bare);
  if (locatorMatch) {
    return {
      rule: 'locator-method',
      token: locatorMatch[0],
      reason: `"${locatorMatch[0]}" is a Playwright locator method, not a selector.`,
    };
  }
  return null;
}

/** Throws {@link InvalidSelectorError} (`kind: 'foreign-dialect'`) synchronously when `selector`
 *  is written in a foreign (Playwright) selector dialect; otherwise returns. */
export function assertSupportedSelectorDialect(selector: string): void {
  const match = detectForeignSelectorDialect(selector);
  if (match) {
    throw new InvalidSelectorError(selector, match.reason, 'foreign-dialect');
  }
}

/**
 * Builds the error for a selector the BROWSER's own parser has rejected (CSS `querySelector` or
 * XPath `createExpression` threw a `SyntaxError`) — as opposed to {@link assertSupportedSelectorDialect}'s
 * pure-string Playwright detection.
 */
export function invalidSelectorSyntaxError(
  selector: string,
  parserMessage: string,
  opts?: { enginePath?: boolean },
): InvalidSelectorError {
  let reason = selectorSyntaxDetail(parserMessage);
  if (opts?.enginePath && /(>>>|::-p-)/.test(stripCssOpaqueRegions(selector))) {
    reason +=
      " (Puppeteer's >>> and ::-p-*() extensions are not supported for element actions; open shadow " +
      'roots are already searched automatically, so use a plain descendant combinator.)';
  }
  return new InvalidSelectorError(selector, reason, 'invalid-syntax');
}

/** `t = selector.trim()`; passes an already-prefixed selector through unchanged, otherwise adds
 *  Puppeteer's `pierce/` prefix so plain CSS still crosses shadow roots as it does today. */
export function toPuppeteerQuery(selector: string): string {
  const t = selector.trim();
  return PUPPETEER_SELECTOR_PREFIX_RE.test(t) ? t : `pierce/${selector}`;
}

export type SelectorProbeTarget = { kind: 'css' | 'xpath'; expr: string };

const EXACT_NODE_ID_RE = /^\[data-sd-node-id="\d+"\]$/;

/** What (if anything) the pre-loop browser-side syntax probe should run for `selector`. `null`
 *  means "skip the probe" — an exact node-id selector (already known valid) or an `aria/`/`text/`
 *  prefix (Puppeteer semantics the DOM parser can't judge). */
export function selectorProbeTarget(selector: string): SelectorProbeTarget | null {
  const t = selector.trim();
  if (EXACT_NODE_ID_RE.test(t)) return null;
  const prefixMatch = PUPPETEER_SELECTOR_PREFIX_RE.exec(t);
  if (prefixMatch) {
    const kind = prefixMatch[1]!.toLowerCase();
    if (kind === 'aria' || kind === 'text') return null;
    const payload = t.slice(prefixMatch[0].length);
    return kind === 'xpath' ? { kind: 'xpath', expr: payload } : { kind: 'css', expr: payload };
  }
  return { kind: 'css', expr: t };
}

/**
 * Runs INSIDE THE PAGE (Puppeteer serializes this with `toString()`, so it must be fully
 * self-contained: no imports, no outside references, no module-level constants). Returns the
 * parser's message iff the expression is DEFINITELY invalid (a `SyntaxError`); `null` when valid
 * OR when some other exception fired (inconclusive — never a guess).
 */
export function selectorSyntaxProbeInPage(kind: 'css' | 'xpath', expr: string): string | null {
  try {
    if (kind === 'xpath') {
      document.createExpression(expr);
    } else {
      document.createDocumentFragment().querySelector(expr);
    }
    return null;
  } catch (e) {
    return e && (e as { name?: string }).name === 'SyntaxError' ? String((e as { message?: unknown }).message ?? e) : null;
  }
}

/** Bound on {@link selectorSyntaxProbeInPage}'s round trip — the probe is never part of an
 *  action's own `timeoutMs` and never counted as a retry. */
export const SELECTOR_SYNTAX_PROBE_TIMEOUT_MS = 500;
