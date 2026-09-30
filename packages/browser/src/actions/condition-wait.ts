/**
 * @file packages/browser/src/actions/condition-wait.ts
 * @description FR2-08: `wait_for` — block until a page condition is true (visible text, text gone,
 * URL substring, a JS expression), or a timeout says which parts were still missing.
 *
 * Why this is NOT `page.waitForFunction` / `waitForSelector({visible})` (spec §0.4, T13-T17):
 * Puppeteer's three pollers all run INSIDE the page (rAF, in-page interval, MutationObserver).
 * rAF stalls in a background tab (measured: FR2-01 GAP-008), in-page timers are clamped to >= 1 s
 * there, mutation polling cannot see a JS variable or `history.pushState`, and a STRING predicate
 * is compiled in the page with `new Function`, which a strict `script-src` CSP blocks. This module
 * polls from NODE (a Node `setTimeout` between passes) with fully-awaited per-frame CDP probes,
 * the same pattern FR2-01 adopted for GAP-008.
 *
 * Text semantics are NOT re-implemented here: `text`/`textGone` call the shared
 * {@link probeVisibleText} (FR2-07's `expect.text` definition, {@link EXPECT_TEXT_CONTRACT}), so
 * "visible text" means one thing in Sutradhar and inherits exactly its documented limits
 * (GAP-329: text in never-painted SVG containers counts; GAP-331: text split across inline-block
 * items and `<textarea>` text). `unavailable` (a hung frame, an open dialog, an exceeded work
 * budget) is NEVER "met" and, for `textGone`, is never read as "gone".
 */

import { EXPECT_TEXT_TIMEOUT_MS, aDialog, bounded } from '../verifier/post-conditions.js';
import { probeVisibleText, type VisibleTextPage } from '../verifier/execution-verifier.js';

export const WAIT_FOR_POLL_MS = 100;
export const WAIT_FOR_PASS_TIMEOUT_MS = 1500;
export const WAIT_FOR_DEFAULT_TIMEOUT_MS = 10000;
export const WAIT_FOR_MAX_TIMEOUT_MS = 300000;
export const WAIT_FOR_DIALOG_GRACE_MS = 1000;
export const WAIT_FOR_JS_DISPLAY_MAX = 200;
const WAIT_FOR_DESCRIBE_JS_MAX = 80;

/** A page-level condition. Given keys are ANDed; each is checked once per pass. */
export interface PageCondition {
  /** Case-sensitive substring of the page's VISIBLE (rendered) text, in any live frame / open shadow root. */
  readonly text?: string;
  /** The same visible-text test, negated: met when no live frame shows it. Met at once if it was never present. */
  readonly textGone?: string;
  /** Case-sensitive substring of the tab's current URL (`page.url()`, includes pushState/hash changes). */
  readonly url?: string;
  /** A JS EXPRESSION evaluated in the main frame; truthy = met. Must be side-effect free. A throw fails the wait. */
  readonly js?: string;
}
export type ConditionKey = keyof PageCondition;
export type ConditionProbe = 'met' | 'unmet' | 'unavailable';

const CONDITION_KEYS: readonly ConditionKey[] = ['text', 'textGone', 'url', 'js'];

/** The page surface `waitForPageCondition` touches (a Puppeteer `Page` satisfies it; unit tests pass mocks). */
export interface ConditionPage extends VisibleTextPage {
  url(): string;
  isClosed(): boolean;
}

export interface ConditionWaitOptions {
  /** Already normalized (see {@link normalizePageCondition}). */
  readonly timeoutMs: number;
  /** Pause between passes; default {@link WAIT_FOR_POLL_MS}. Tests only. */
  readonly pollMs?: number;
  readonly getPendingDialog?: () => { dialogType: string; message: string } | undefined;
}

export interface ConditionWaitResult {
  readonly satisfied: boolean;
  /** Monotonic milliseconds from the first pass's start. */
  readonly elapsedMs: number;
  /** Passes run. */
  readonly polls: number;
  /** Only when `textGone` was given: was the text visible in the first DEFINITIVE pass. */
  readonly presentAtStart?: boolean;
  /** Per-key outcome of the final pass. */
  readonly last: Readonly<Partial<Record<ConditionKey, ConditionProbe>>>;
  /** Per-key one-liner (url: the current URL; text: why it could not be checked). */
  readonly lastDetail: Readonly<Partial<Record<ConditionKey, string>>>;
  /** How many live frames the final pass covered (for the timeout message). */
  readonly frameCount: number;
  readonly fatal?: { readonly kind: 'js-threw' | 'dialog' | 'page-closed'; readonly message: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_KEYS_MESSAGE = 'text, textGone, url, js, timeoutMs';

/**
 * Validates BEFORE any browser contact. Throws `TypeError('wait_for: ...')`. Returns only the keys
 * the caller gave, plus a normalized timeout (default 10000; `<= 0` means "check once"; floored;
 * more than 300000 is an error). `timeoutMs` may sit inside `input` or be passed separately (the
 * separate argument wins).
 */
export function normalizePageCondition(
  input: unknown,
  timeoutMs?: unknown,
): { condition: PageCondition; timeoutMs: number } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('wait_for: the condition must be an object like {text: "Saved"}');
  }
  const obj = input as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) continue;
    if (k === 'selector') {
      throw new TypeError('wait_for: unknown key "selector" — to wait for an element\'s state use wait_for_selector');
    }
    if (!(CONDITION_KEYS as readonly string[]).includes(k) && k !== 'timeoutMs') {
      throw new TypeError(`wait_for: unknown key "${k}" — allowed: ${ALLOWED_KEYS_MESSAGE}`);
    }
  }
  const condition: { -readonly [K in ConditionKey]?: string } = {};
  for (const k of CONDITION_KEYS) {
    const v = obj[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || v.length === 0) {
      throw new TypeError(`wait_for: "${k}" must be a non-empty string`);
    }
    condition[k] = v;
  }
  if (Object.keys(condition).length === 0) {
    throw new TypeError('wait_for: give at least one of text, textGone, url, js');
  }
  if (condition.text !== undefined && condition.text === condition.textGone) {
    throw new TypeError(`wait_for: text and textGone are both "${condition.text}" — that can never be satisfied`);
  }
  const rawTimeout = timeoutMs !== undefined ? timeoutMs : obj.timeoutMs;
  let t: number;
  if (rawTimeout === undefined) t = WAIT_FOR_DEFAULT_TIMEOUT_MS;
  else if (typeof rawTimeout !== 'number' || !Number.isFinite(rawTimeout)) {
    throw new TypeError('wait_for: timeoutMs must be a number of milliseconds (0-300000)');
  } else {
    t = Math.floor(rawTimeout);
    if (t > WAIT_FOR_MAX_TIMEOUT_MS) {
      throw new TypeError(
        `wait_for: timeoutMs ${t} exceeds the maximum ${WAIT_FOR_MAX_TIMEOUT_MS} (5 minutes)`,
      );
    }
    if (t < 0) t = 0;
  }
  return { condition, timeoutMs: t };
}

// ─────────────────────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────────────────────

function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** `text="Saved" AND url~"stage=done" AND js(window.x === 1)` in the fixed key order text, textGone, url, js
 *  (js capped at 80 chars here). */
export function describePageCondition(c: PageCondition): string {
  const parts: string[] = [];
  if (c.text !== undefined) parts.push(`text="${cap(c.text, WAIT_FOR_JS_DISPLAY_MAX)}"`);
  if (c.textGone !== undefined) parts.push(`textGone="${cap(c.textGone, WAIT_FOR_JS_DISPLAY_MAX)}"`);
  if (c.url !== undefined) parts.push(`url~"${cap(c.url, WAIT_FOR_JS_DISPLAY_MAX)}"`);
  if (c.js !== undefined) parts.push(`js(${cap(c.js, WAIT_FOR_DESCRIBE_JS_MAX)})`);
  return parts.join(' AND ');
}

/** The caller's own condition as echoed in a result (`js` capped at {@link WAIT_FOR_JS_DISPLAY_MAX}). */
export function displayPageCondition(c: PageCondition): Record<string, string> {
  const out: Record<string, string> = {};
  if (c.text !== undefined) out.text = c.text;
  if (c.textGone !== undefined) out.textGone = c.textGone;
  if (c.url !== undefined) out.url = c.url;
  if (c.js !== undefined) out.js = cap(c.js, WAIT_FOR_JS_DISPLAY_MAX);
  return out;
}

/**
 * The exact user-facing error for a non-satisfied result. Never contains page text or a JS return
 * value, and never starts with `Action ` (so the engine's timeout classification can't misread it).
 * A `fatal` result's message is used verbatim.
 */
export function formatConditionFailure(c: PageCondition, r: ConditionWaitResult, timeoutMs: number): string {
  if (r.fatal) return r.fatal.message;
  const parts: string[] = [];
  const state = (k: ConditionKey): ConditionProbe => r.last[k] ?? 'unavailable';
  const why = (k: ConditionKey): string => r.lastDetail[k] ?? 'no answer';
  if (c.text !== undefined) {
    const n = c.text;
    const s = state('text');
    parts.push(
      s === 'met'
        ? `text "${cap(n, WAIT_FOR_JS_DISPLAY_MAX)}" is visible`
        : s === 'unmet'
          ? `text "${cap(n, WAIT_FOR_JS_DISPLAY_MAX)}" was not found in the visible text of ${r.frameCount} frame(s)`
          : `text "${cap(n, WAIT_FOR_JS_DISPLAY_MAX)}" could not be checked (${why('text')})`,
    );
  }
  if (c.textGone !== undefined) {
    const n = cap(c.textGone, WAIT_FOR_JS_DISPLAY_MAX);
    const s = state('textGone');
    parts.push(
      s === 'met'
        ? `textGone "${n}" is gone`
        : s === 'unmet'
          ? `textGone "${n}" is still visible`
          : `textGone "${n}" could not be checked (${why('textGone')})`,
    );
  }
  if (c.url !== undefined) {
    const n = cap(c.url, WAIT_FOR_JS_DISPLAY_MAX);
    parts.push(
      state('url') === 'met'
        ? `url contains "${n}"`
        : `url does not contain "${n}" (current URL: ${r.lastDetail.url ?? 'unknown'})`,
    );
  }
  if (c.js !== undefined) {
    const e = cap(c.js, WAIT_FOR_JS_DISPLAY_MAX);
    const s = state('js');
    parts.push(
      s === 'met'
        ? `js ${e} is truthy`
        : s === 'unmet'
          ? `js ${e} is still falsy`
          : `js ${e} did not settle within ${WAIT_FOR_PASS_TIMEOUT_MS}ms`,
    );
  }
  return `wait_for timed out after ${timeoutMs}ms waiting for ${describePageCondition(c)}: ${parts.join('; ')}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The wait
// ─────────────────────────────────────────────────────────────────────────────

/** Navigation / teardown noise that means "try again next pass", not "the expression is broken". */
export function isTransientContextError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /Execution context was destroyed|Cannot find context with specified id|detached Frame|Execution context is not available|Target closed|Session closed/i.test(
    m,
  );
}

/** `js` is wrapped Node-side into a STRING that the page compiles through CDP `Runtime.evaluate`
 *  (not `new Function`, so a strict CSP does not apply). The newline guards a trailing `//` comment. */
export function wrapJsCondition(js: string): string {
  return `(async () => !!(await (${js}\n)))()`;
}

const now = (): number => performance.now();

interface PassState {
  abandoned: boolean;
  results: Partial<Record<ConditionKey, ConditionProbe>>;
  details: Partial<Record<ConditionKey, string>>;
  fatal?: ConditionWaitResult['fatal'];
  frames: number;
}

/**
 * Waits until EVERY given condition holds on the same pass, or `timeoutMs` elapses. Passes run back
 * to back with a Node `setTimeout` of `pollMs` between them; each pass is bounded to
 * {@link WAIT_FOR_PASS_TIMEOUT_MS}, so the worst-case return is `timeoutMs + 1500 ms`. `timeoutMs`
 * of 0 means exactly one pass. Never retried. Never throws. All probes of a pass are strictly
 * sequential and fully awaited (no `Promise.any`/`all` across frames: the PROB-015 rule).
 */
export async function waitForPageCondition(
  page: ConditionPage,
  condition: PageCondition,
  opts: ConditionWaitOptions,
): Promise<ConditionWaitResult> {
  const pollMs = opts.pollMs ?? WAIT_FOR_POLL_MS;
  const start = now();
  const deadline = start + opts.timeoutMs;
  let polls = 0;
  let dialogSince: number | undefined;
  let presentAtStart: boolean | undefined;
  let last: Partial<Record<ConditionKey, ConditionProbe>> = {};
  let lastDetail: Partial<Record<ConditionKey, string>> = {};
  let frameCount = 1;
  const elapsed = (): number => Math.round(now() - start);
  const finish = (satisfied: boolean, fatal?: ConditionWaitResult['fatal']): ConditionWaitResult => ({
    satisfied,
    elapsedMs: elapsed(),
    polls,
    ...(condition.textGone !== undefined && presentAtStart !== undefined ? { presentAtStart } : {}),
    last,
    lastDetail,
    frameCount,
    ...(fatal ? { fatal } : {}),
  });

  for (;;) {
    let closed = false;
    try {
      closed = page.isClosed();
    } catch {
      closed = true;
    }
    if (closed) {
      return finish(false, {
        kind: 'page-closed',
        message: `wait_for failed: the tab was closed while waiting (after ${elapsed()}ms).`,
      });
    }
    polls++;
    const passStart = now();
    const passRemaining = (): number => Math.max(50, Math.round(WAIT_FOR_PASS_TIMEOUT_MS - (now() - passStart)));
    const st: PassState = { abandoned: false, results: {}, details: {}, frames: frameCount };

    const runPass = async (): Promise<void> => {
      // 1. url: no page contact at all
      if (condition.url !== undefined) {
        let cur = '';
        try {
          cur = page.url();
        } catch {
          cur = '';
        }
        st.details.url = cur;
        st.results.url = cur.includes(condition.url) ? 'met' : 'unmet';
      }
      // 2. the dialog gate: page-touching probes freeze behind a native dialog, so skip them
      const touchesPage = condition.text !== undefined || condition.textGone !== undefined || condition.js !== undefined;
      if (touchesPage) {
        let dialog: { dialogType: string; message: string } | undefined;
        try {
          dialog = opts.getPendingDialog?.();
        } catch {
          dialog = undefined;
        }
        if (dialog) {
          const t = now();
          dialogSince ??= t;
          for (const k of ['text', 'textGone', 'js'] as const) {
            if (condition[k] !== undefined) {
              st.results[k] = 'unavailable';
              st.details[k] = `${aDialog(dialog.dialogType)} is open`;
            }
          }
          if (t - dialogSince >= WAIT_FOR_DIALOG_GRACE_MS) {
            st.fatal = {
              kind: 'dialog',
              message:
                `wait_for blocked by an open ${dialog.dialogType} dialog ("${cap(dialog.message ?? '', 100)}") ` +
                `after ${Math.round(t - start)}ms — handle it (browser.handle_dialog, or "sutradhar dialog accept|dismiss"), then wait again.`,
            };
          }
          return;
        }
        dialogSince = undefined;
      }
      // 3. text / textGone through the SHARED visible-text probe
      for (const k of ['text', 'textGone'] as const) {
        const needle = condition[k];
        if (needle === undefined) continue;
        const r = await probeVisibleText(page, needle, Math.min(EXPECT_TEXT_TIMEOUT_MS, passRemaining()));
        if (st.abandoned) return;
        try {
          st.frames = Math.max(1, page.frames().filter((f) => !f.isDetached()).length);
        } catch {
          /* keep the previous count */
        }
        if (r.result === 'unavailable') {
          st.results[k] = 'unavailable';
          st.details[k] = r.detail;
          continue;
        }
        const found = r.result === 'found';
        if (k === 'text') st.results.text = found ? 'met' : 'unmet';
        else {
          st.results.textGone = found ? 'unmet' : 'met';
          presentAtStart ??= found; // the first DEFINITIVE pass
        }
      }
      // 4. js in the main frame, through CDP
      if (condition.js !== undefined) {
        try {
          const v = await page.mainFrame().evaluate(wrapJsCondition(condition.js));
          if (st.abandoned) return;
          st.results.js = v ? 'met' : 'unmet';
        } catch (e) {
          if (st.abandoned) return;
          if (isTransientContextError(e)) {
            st.results.js = 'unavailable';
            st.details.js = 'the page was navigating or the frame went away';
          } else {
            const msg = e instanceof Error ? e.message : String(e);
            st.fatal = {
              kind: 'js-threw',
              message: `wait_for failed: js condition threw after ${elapsed()}ms: ${cap(msg, 400)}`,
            };
          }
        }
      }
    };

    const outcome = await bounded(runPass(), WAIT_FOR_PASS_TIMEOUT_MS);
    st.abandoned = true; // late writes from an abandoned pass are ignored from here on
    if (!outcome.ok) {
      for (const k of CONDITION_KEYS) {
        if (condition[k] !== undefined && st.results[k] === undefined) {
          st.results[k] = 'unavailable';
          st.details[k] = outcome.timedOut
            ? `did not answer within ${WAIT_FOR_PASS_TIMEOUT_MS}ms`
            : `the check failed (${outcome.error ?? 'unknown error'})`;
        }
      }
    }
    last = st.results;
    lastDetail = st.details;
    frameCount = st.frames;
    if (st.fatal) return finish(false, st.fatal);
    if (CONDITION_KEYS.every((k) => condition[k] === undefined || st.results[k] === 'met')) return finish(true);
    const left = deadline - now();
    if (left <= 0) return finish(false);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, left)));
  }
}
