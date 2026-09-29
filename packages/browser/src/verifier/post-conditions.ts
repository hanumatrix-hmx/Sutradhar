/**
 * @file packages/browser/src/verifier/post-conditions.ts
 * @description FR2-07: the real, per-action post-condition checks behind the single verification
 * contract. Three layers:
 *
 *  1. Pure deciders (`decideKeyVerdict`, `decideNavigationVerdict`, ...): take a plain
 *     observation object, return a {@link BuiltInVerdict}. Unit-tested without a browser.
 *  2. In-page functions (`*InPage`): serialised into the page by Puppeteer via `toString()`, so
 *     each is FULLY self-contained (no imports, no outer references) and never returns a field
 *     value, only lengths / flags / element descriptors (D11).
 *  3. Observers (I/O): each wrapped by {@link bounded}, never throwing. A check that can't run
 *     records `not-run` with a concrete reason; it never fails the action (D4) and never raises
 *     confidence on its own (§4.8).
 *
 * Rules every observer here follows (they are pinned by existing engine tests):
 *  - Never `page.evaluate` (a pending dialog freezes the page's main thread and would hang it).
 *    In-page calls go through `page.mainFrame()` / `frame.evaluate` / `handle.evaluate` / CDP.
 *  - Nothing page-observable that disguises a page primitive: listeners and expandos only.
 *  - A page without a frame API (a mock, or none) makes the check `not-run` synchronously, with
 *    no timer created.
 */

import type { ElementHandle, Frame, Page } from 'puppeteer-core';
import type {
  BuiltInVerdict,
  EvidenceCheck,
  EvidenceOutcome,
  EvidenceScalar,
  VerificationEvidence,
} from '../actions/action-types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const OBSERVE_BEFORE_TIMEOUT_MS = 1000;
export const OBSERVE_AFTER_TIMEOUT_MS = 1500;
export const EXPECT_TEXT_TIMEOUT_MS = 1500;
export const NAV_PROBE_TIMEOUT_MS = 1000;
export const CLIPBOARD_READBACK_TIMEOUT_MS = 1500;
export const DOWNLOAD_PARTIAL_GRACE_MS = 2000;
export const DOWNLOAD_MTIME_TOLERANCE_MS = 2000;
export const EVIDENCE_STRING_MAX = 200;
export const EVIDENCE_DETAIL_MAX = 300;
export const EVIDENCE_MAX_CHECKS = 8;
const DOWNLOAD_PARTIAL_POLL_MS = 100;
const UPLOAD_POLL_MS = 100;
const UPLOAD_POLL_TOTAL_MS = 500;
const UPLOAD_OBSERVE_TIMEOUT_MS = 1000;
const FOCUS_CHECK_TIMEOUT_MS = 1000;
const MAX_FRAME_DEPTH = 4;

/** The minimal slice of an `IBrowserTab` the observers need. */
export interface ObservedTab {
  readonly url?: string;
  readonly page?: Page;
  getPendingDialog?(): { dialogType: string; message?: string } | undefined;
}

/** `an alert dialog` / `a confirm dialog` (used inside reasons). */
export function aDialog(type: string): string {
  return `${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${type} dialog`;
}

/** The type of the tab's currently-pending dialog, or undefined (also when the tab can't say). */
export function pendingDialogType(tab: ObservedTab | undefined): string | undefined {
  try {
    return tab?.getPendingDialog?.()?.dialogType;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// bounded / recorder / evidence capping
// ─────────────────────────────────────────────────────────────────────────────

export type BoundedResult<T> = { ok: true; value: T } | { ok: false; timedOut: boolean; error?: string };

/**
 * Races `p` against `ms`. Never rejects. Attaches a no-op catch to `p` so an abandoned promise
 * (one we raced away from) can never surface as an unhandled rejection (PROB-015 rule).
 */
export function bounded<T>(p: Promise<T>, ms: number): Promise<BoundedResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded: Promise<BoundedResult<T>> = Promise.resolve(p).then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => ({
      ok: false as const,
      timedOut: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  const timeout = new Promise<BoundedResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), ms);
  });
  return Promise.race([guarded, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Copies a decider's verdict (checks + conclusion) into a recorder. */
export function applyVerdict(rec: PostConditionRecorder, v: BuiltInVerdict): void {
  for (const c of v.checks) rec.check(c);
  rec.verdict(v.outcome, v.reason);
}

/** Accumulates the checks and the conclusion of ONE dispatch attempt (fresh per attempt). */
export class PostConditionRecorder {
  private readonly checks: EvidenceCheck[] = [];
  private concluded: { outcome: EvidenceOutcome; reason: string } | undefined;

  public constructor(public readonly actionType: string) {}

  /** Appended in order. */
  public check(c: EvidenceCheck): void {
    this.checks.push(c);
  }

  /** Last call wins. */
  public verdict(outcome: EvidenceOutcome, reason: string): void {
    this.concluded = { outcome, reason };
  }

  /** `undefined` iff nothing was recorded AND no verdict was set. */
  public toBuiltIn(): BuiltInVerdict | undefined {
    if (this.checks.length === 0 && !this.concluded) return undefined;
    if (this.concluded) {
      return { outcome: this.concluded.outcome, reason: this.concluded.reason, checks: [...this.checks] };
    }
    const firstFail = this.checks.find((c) => c.outcome === 'fail');
    if (firstFail) {
      return { outcome: 'fail', reason: firstFail.detail ?? `${firstFail.check} failed`, checks: [...this.checks] };
    }
    if (this.checks.every((c) => c.outcome === 'pass')) {
      return { outcome: 'pass', reason: 'every recorded check passed', checks: [...this.checks] };
    }
    return { outcome: 'not-run', reason: 'the observation did not complete', checks: [...this.checks] };
  }
}

function capString(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function capScalar(v: EvidenceScalar | undefined): EvidenceScalar | undefined {
  return typeof v === 'string' ? capString(v, EVIDENCE_STRING_MAX) : v;
}

/** Truncates strings (200 / detail 300) and keeps the first 8 checks, noting any dropped. */
export function capEvidence(evidence: VerificationEvidence): VerificationEvidence {
  const kept = evidence.checks.slice(0, EVIDENCE_MAX_CHECKS);
  const dropped = evidence.checks.length - kept.length;
  const checks = kept.map((c, i): EvidenceCheck => {
    let detail = c.detail === undefined ? undefined : capString(c.detail, EVIDENCE_DETAIL_MAX);
    if (dropped > 0 && i === kept.length - 1) {
      detail = `${detail ? `${detail} ` : ''}(+${dropped} more checks omitted)`;
    }
    const out: { -readonly [K in keyof EvidenceCheck]: EvidenceCheck[K] } = { check: c.check, outcome: c.outcome };
    if (c.expected !== undefined) out.expected = capScalar(c.expected);
    if (c.observed !== undefined) out.observed = capScalar(c.observed);
    if (detail !== undefined) out.detail = detail;
    return out;
  });
  return { tier: evidence.tier, checks };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Puppeteer/CDP's "the page navigated under us" family of errors. */
export function isContextDestroyed(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('detached Frame') ||
    message.includes('Cannot find context with specified id') ||
    message.includes('Inspected target navigated or closed')
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fmt(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

/**
 * Pure: `tag#id.cls1.cls2` (at most 80 chars) plus ` [#N]` when `data-sd-node-id` is present;
 * `body` for the body; `null` for no element. Self-contained (kept in sync with the inline
 * describers inside each `*InPage` function, which cannot import it).
 */
export function describeElementInPage(el: Element | null): string {
  if (!el) return 'null';
  const tag = el.tagName.toLowerCase();
  if (tag === 'body') return 'body';
  let s = tag;
  if (el.id) s += `#${el.id}`;
  const cn = typeof el.className === 'string' ? el.className.trim() : '';
  if (cn) s += `.${cn.split(/\s+/).slice(0, 2).join('.')}`;
  if (s.length > 80) s = `${s.slice(0, 79)}…`;
  const n = el.getAttribute('data-sd-node-id');
  if (n) s += ` [#${n}]`;
  return s;
}

/** A descend-to-the-frame helper result: the frame owning the focused/pointed element. */
type FrameLike = Pick<Frame, 'evaluate' | 'childFrames'> & Partial<Pick<Frame, 'isDetached'>>;

/**
 * True only when the page hands back a REAL frame: one with both `evaluate` and `childFrames`
 * (frame descent needs the latter). A partial double (a mock exposing only `evaluate`) is treated
 * as "no frame API", so no observation is attempted and no renderer call is made.
 */
export function hasFrameApi(page: Page | undefined): page is Page {
  if (!page || typeof page.mainFrame !== 'function') return false;
  let frame: Frame | undefined;
  try {
    frame = page.mainFrame();
  } catch {
    return false;
  }
  return !!frame && typeof frame.evaluate === 'function' && typeof frame.childFrames === 'function';
}

/** The frame whose `<iframe>` element is marked (via `predicate` evaluated on its owner element). */
async function matchChildFrame(frame: FrameLike, predicate: (el: Element) => boolean): Promise<FrameLike | undefined> {
  const children = typeof frame.childFrames === 'function' ? frame.childFrames() : [];
  for (const c of children) {
    try {
      const owner = await c.frameElement();
      if (!owner) continue;
      const hit = await owner.evaluate(predicate);
      if (hit) return c;
    } catch {
      /* a frame we can't reach is simply not the match */
    }
  }
  return undefined;
}

// ═════════════════════════════════════════════════════════════════════════════
// press_key
// ═════════════════════════════════════════════════════════════════════════════

export interface TargetInfo {
  kind: 'element' | 'body' | 'none' | 'frame-unreachable';
  desc: string;
  textEntry: boolean;
  readOnly: boolean;
  selStart: number | null;
  selEnd: number | null;
  valueLen: number;
}

export type KeyEffectRule = 'value-changed' | 'focus-moved' | 'none';

/** `key === requested || code === requested || (single char && case-insensitive key match)`. */
export function keyMatches(requested: string, ev: { key: string; code?: string }): boolean {
  return (
    ev.key === requested ||
    ev.code === requested ||
    (requested.length === 1 && typeof ev.key === 'string' && ev.key.toLowerCase() === requested.toLowerCase())
  );
}

/** What a key deterministically does to a focused target (only where that is knowable). */
export function keyEffectRule(
  key: string,
  modifiers: readonly string[] | undefined,
  target: Pick<TargetInfo, 'kind' | 'textEntry' | 'selStart' | 'selEnd' | 'valueLen'>,
): KeyEffectRule {
  const mods = modifiers ?? [];
  const noMods = mods.length === 0;
  const shiftOnly = mods.length === 1 && mods[0] === 'Shift';
  if (target.kind !== 'element') return 'none';
  if (key === 'Tab' && (noMods || shiftOnly)) return 'focus-moved';
  if (!target.textEntry) return 'none';
  if ([...key].length === 1 && (noMods || shiftOnly)) return 'value-changed';
  const { selStart, selEnd, valueLen } = target;
  if (noMods && selStart !== null && selEnd !== null) {
    if (key === 'Backspace') return selStart > 0 || selStart !== selEnd ? 'value-changed' : 'none';
    if (key === 'Delete') return selEnd < valueLen || selStart !== selEnd ? 'value-changed' : 'none';
  }
  return 'none';
}

export interface KeyPre {
  skipped?: 'dialog' | 'no-frame-api';
  /** Set when the pre-observation errored or timed out. */
  error?: string;
  target?: TargetInfo;
  /** Non-serialisable plumbing for {@link finishKeyObservation}. */
  frame?: FrameLike;
  token?: string;
}

export interface KeyPost {
  delivered: boolean;
  onTarget: boolean;
  valueChanged: boolean;
  afterValueLen: number;
  focusMoved: boolean;
  afterDesc?: string;
}

export interface KeyObservation {
  key: string;
  modifiers?: readonly string[];
  pre: KeyPre;
  post?: KeyPost;
  navigated?: boolean;
  postTimedOut?: boolean;
  postError?: string;
  /** Type of a dialog that is pending AFTER the press, if any. */
  dialogAfter?: string;
}

/** Decides the `press_key` verdict per the §2.8.1 table (first match wins). */
export function decideKeyVerdict(obs: KeyObservation): BuiltInVerdict {
  const { key, modifiers, pre, post } = obs;
  const checks: EvidenceCheck[] = [];
  const done = (outcome: EvidenceOutcome, reason: string): BuiltInVerdict => ({ outcome, reason, checks });
  const target = pre.target;
  const desc = target?.desc ?? 'unknown';

  if (pre.skipped === 'dialog') {
    checks.push({ check: 'press_key.focused-target', outcome: 'not-run', detail: 'a dialog was already open' });
    return done(
      'not-run',
      'a dialog was already open before the press (see dialogPending); the page could not be observed',
    );
  }
  if (pre.skipped === 'no-frame-api' || pre.error !== undefined || !target) {
    const err = pre.error ?? (pre.skipped === 'no-frame-api' ? 'the page exposes no frame API' : 'no observation');
    checks.push({ check: 'press_key.focused-target', outcome: 'not-run', detail: capString(err, 200) });
    return done('not-run', `could not observe the page's focused element before the press (${err})`);
  }
  if (target.kind === 'frame-unreachable') {
    checks.push({ check: 'press_key.focused-target', outcome: 'not-run', observed: 'frame-unreachable' });
    return done(
      'not-run',
      'focus is inside an <iframe> whose frame could not be matched, so its document could not be observed',
    );
  }
  checks.push({
    check: 'press_key.focused-target',
    outcome: target.kind === 'element' ? 'pass' : 'not-run',
    observed: desc,
  });
  if (obs.navigated) {
    checks.push({ check: 'press_key.key-delivered', outcome: 'pass', observed: 'navigated' });
    return done(
      'pass',
      'the page navigated right after the key press, which is treated as delivered (the same rule as click); ' +
        "the key's effect on the old page can't be read",
    );
  }
  if (target.kind === 'body' || target.kind === 'none') {
    checks.push({ check: 'press_key.key-delivered', outcome: 'not-run', detail: 'no focused element to observe' });
    return done(
      'not-run',
      'no element had focus (document.activeElement was <body>), so the key went to the page with no target whose effect could be checked',
    );
  }
  if (obs.postTimedOut || obs.postError !== undefined || !post) {
    if (obs.dialogAfter) {
      checks.push({ check: 'press_key.key-delivered', outcome: 'not-run', detail: `${aDialog(obs.dialogAfter)} opened` });
      return done(
        'not-run',
        `${aDialog(obs.dialogAfter)} opened after the press (see dialogPending); the page can't be inspected until it's handled`,
      );
    }
    const why = obs.postTimedOut
      ? `the page did not answer the post-press observation within ${OBSERVE_AFTER_TIMEOUT_MS}ms`
      : `the post-press observation failed (${obs.postError ?? 'no answer'})`;
    checks.push({ check: 'press_key.key-delivered', outcome: 'not-run', detail: capString(why, 250) });
    return done('not-run', why);
  }

  checks.push({
    check: 'press_key.key-delivered',
    outcome: post.delivered ? 'pass' : 'fail',
    expected: `trusted keydown '${key}'`,
    observed: post.delivered ? 'delivered' : 'not seen',
  });
  const rule = keyEffectRule(key, modifiers, target);
  const before = target.valueLen;
  const after = post.afterValueLen;
  if (rule === 'value-changed') {
    const observed = post.valueChanged ? `length ${before}→${after}` : 'unchanged';
    checks.push({
      check: 'press_key.effect',
      outcome: post.valueChanged ? 'pass' : 'fail',
      expected: rule,
      observed,
    });
    if (post.valueChanged) {
      return done('pass', `keydown '${key}' reached the focused ${desc} and its value changed (length ${before}→${after})`);
    }
    return done(
      'fail',
      `keydown '${key}' ${post.delivered && post.onTarget ? 'reached' : 'did not reach'} the focused ${desc}, ` +
        `but its value did not change (length ${before}→${after})${target.readOnly ? '; the field is readonly' : ''}`,
    );
  }
  if (rule === 'focus-moved') {
    checks.push({
      check: 'press_key.effect',
      outcome: post.focusMoved ? 'pass' : 'fail',
      expected: rule,
      observed: post.focusMoved ? `moved to ${post.afterDesc ?? 'another element'}` : 'unchanged',
    });
    return post.focusMoved
      ? done('pass', `Tab moved focus from ${desc} to ${post.afterDesc ?? 'another element'}`)
      : done('fail', `Tab did not move focus away from ${desc}`);
  }
  // rule === 'none': only delivery is checkable.
  if (post.delivered && post.onTarget) {
    checks.push({ check: 'press_key.effect', outcome: 'not-run', expected: 'none', detail: 'no deterministic effect for this key' });
    return done(
      'pass',
      `keydown '${key}' was delivered to the focused ${desc}; no deterministic effect is defined for this key, so only delivery was verified`,
    );
  }
  checks.push({ check: 'press_key.effect', outcome: 'not-run', expected: 'none' });
  if (post.delivered) {
    return done('fail', `keydown '${key}' was dispatched while ${desc} had focus, but it reached a different element`);
  }
  return done(
    'fail',
    `no trusted keydown '${key}' reached the page while ${desc} had focus (the key may not have been delivered; ` +
      'a page listener that stops propagation at window capture can also hide it)',
  );
}

/** In-page: what has focus (through open shadow roots), described without any field value. */
export function activeInfoInPage(): TargetInfo & { isFrameElement: boolean } {
  const d = (e: Element | null): string => {
    if (!e) return 'null';
    const tag = e.tagName.toLowerCase();
    if (tag === 'body') return 'body';
    let s = tag;
    if (e.id) s += '#' + e.id;
    const cn = typeof e.className === 'string' ? e.className.trim() : '';
    if (cn) s += '.' + cn.split(/\s+/).slice(0, 2).join('.');
    if (s.length > 80) s = s.slice(0, 79) + '…';
    const n = e.getAttribute('data-sd-node-id');
    if (n) s += ' [#' + n + ']';
    return s;
  };
  let el: Element | null = document.activeElement;
  for (let i = 0; i < 20 && el; i++) {
    const sr = (el as HTMLElement).shadowRoot;
    if (sr && sr.activeElement) el = sr.activeElement;
    else break;
  }
  if (!el || el === document.body || el === document.documentElement) {
    return {
      isFrameElement: false,
      kind: 'body',
      desc: 'body',
      textEntry: false,
      readOnly: false,
      selStart: null,
      selEnd: null,
      valueLen: 0,
    };
  }
  const tag = el.tagName;
  const isInput = tag === 'INPUT';
  const isTa = tag === 'TEXTAREA';
  const type = ((el.getAttribute('type') ?? 'text') || 'text').toLowerCase();
  const textTypes = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
  const textEntry = (isInput && textTypes.indexOf(type) >= 0) || isTa || (el as HTMLElement).isContentEditable === true;
  let selStart: number | null = null;
  let selEnd: number | null = null;
  try {
    if (isInput || isTa) {
      selStart = (el as HTMLInputElement).selectionStart;
      selEnd = (el as HTMLInputElement).selectionEnd;
    }
  } catch {
    selStart = null;
    selEnd = null;
  }
  const valueLen = isInput || isTa ? (el as HTMLInputElement).value.length : (el.textContent ?? '').length;
  return {
    isFrameElement: tag === 'IFRAME' || tag === 'FRAME',
    kind: 'element',
    desc: d(el),
    textEntry,
    readOnly: !!(el as HTMLInputElement).readOnly || !!(el as HTMLInputElement).disabled,
    selStart,
    selEnd,
    valueLen,
  };
}

/** In-page: mark the focused element and start recording trusted keydowns in this window. */
export function armKeyListenerInPage(token: string): void {
  const w = window as unknown as Record<string, unknown>;
  let el: Element | null = document.activeElement;
  for (let i = 0; i < 20 && el; i++) {
    const sr = (el as HTMLElement).shadowRoot;
    if (sr && sr.activeElement) el = sr.activeElement;
    else break;
  }
  const readVal = (e: Element | null): string =>
    e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') ? (e as HTMLInputElement).value : e ? (e.textContent ?? '') : '';
  const state: {
    el: Element | null;
    before: string;
    events: Array<{ key: string; code: string; trusted: boolean; onTarget: boolean }>;
    off: () => void;
  } = { el, before: readVal(el), events: [], off: () => {} };
  const onKey = (e: KeyboardEvent): void => {
    state.events.push({
      key: e.key,
      code: e.code,
      trusted: e.isTrusted,
      onTarget: !!state.el && e.composedPath().indexOf(state.el) >= 0,
    });
  };
  window.addEventListener('keydown', onKey, true);
  state.off = () => window.removeEventListener('keydown', onKey, true);
  w[token] = state;
  if (el) (el as unknown as Record<string, unknown>).__sdKeyMark = token;
}

/** In-page: read what the armed listener saw, then remove every trace of it. */
export function readKeyObservationInPage(token: string, requested: string): KeyPost | { missing: true } {
  const w = window as unknown as Record<string, any>;
  const s = w[token];
  if (!s) return { missing: true };
  s.off();
  const readVal = (e: Element | null): string =>
    e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') ? (e as HTMLInputElement).value : e ? (e.textContent ?? '') : '';
  const d = (e: Element | null): string => {
    if (!e) return 'null';
    const tag = e.tagName.toLowerCase();
    if (tag === 'body') return 'body';
    let str = tag;
    if (e.id) str += '#' + e.id;
    const cn = typeof e.className === 'string' ? e.className.trim() : '';
    if (cn) str += '.' + cn.split(/\s+/).slice(0, 2).join('.');
    if (str.length > 80) str = str.slice(0, 79) + '…';
    const n = e.getAttribute('data-sd-node-id');
    if (n) str += ' [#' + n + ']';
    return str;
  };
  const matches = (ev: { key: string; code: string }): boolean =>
    ev.key === requested ||
    ev.code === requested ||
    (requested.length === 1 && typeof ev.key === 'string' && ev.key.toLowerCase() === requested.toLowerCase());
  const hits = (s.events as Array<{ key: string; code: string; trusted: boolean; onTarget: boolean }>).filter(
    (ev) => ev.trusted && matches(ev),
  );
  let deep: Element | null = document.activeElement;
  for (let i = 0; i < 20 && deep; i++) {
    const sr = (deep as HTMLElement).shadowRoot;
    if (sr && sr.activeElement) deep = sr.activeElement;
    else break;
  }
  const el: Element | null = s.el;
  const after = readVal(el);
  const out: KeyPost = {
    delivered: hits.length > 0,
    onTarget: hits.some((h) => h.onTarget),
    valueChanged: after !== s.before,
    afterValueLen: after.length,
    focusMoved: !(deep && (deep as unknown as Record<string, unknown>).__sdKeyMark === token),
    afterDesc: deep && deep !== document.body ? d(deep) : 'body',
  };
  delete w[token];
  if (el) delete (el as unknown as Record<string, unknown>).__sdKeyMark;
  return out;
}

/**
 * Observes the DEEP focused element (through open shadow roots and, via `frameElement()` identity,
 * through same- and cross-origin frames) and arms a trusted-keydown listener in that element's
 * own window. Bounded, never throws, creates no timer when it can't run.
 */
export async function observeFocusForKey(tab: ObservedTab): Promise<KeyPre> {
  if (pendingDialogType(tab)) return { skipped: 'dialog' };
  const page = tab.page;
  if (!hasFrameApi(page)) return { skipped: 'no-frame-api' };
  const token = `__sdKey_${Math.random().toString(36).slice(2)}`;
  const run = async (): Promise<KeyPre> => {
    let frame: FrameLike = page.mainFrame();
    let info: TargetInfo & { isFrameElement: boolean } = await frame.evaluate(activeInfoInPage);
    for (let depth = 0; info.isFrameElement && depth < MAX_FRAME_DEPTH; depth++) {
      const child = await matchChildFrame(frame, (el) => (el.getRootNode() as Document | ShadowRoot).activeElement === el);
      if (!child) {
        return { target: { ...info, kind: 'frame-unreachable' } };
      }
      frame = child;
      info = await frame.evaluate(activeInfoInPage);
    }
    if (info.isFrameElement) return { target: { ...info, kind: 'frame-unreachable' } };
    if (info.kind === 'element') await frame.evaluate(armKeyListenerInPage, token);
    const { isFrameElement: _ignored, ...target } = info;
    void _ignored;
    return { target, frame, token };
  };
  const r = await bounded(run(), OBSERVE_BEFORE_TIMEOUT_MS);
  if (!r.ok) return { error: r.timedOut ? `no answer within ${OBSERVE_BEFORE_TIMEOUT_MS}ms` : (r.error ?? 'unknown error') };
  return r.value;
}

/** Best-effort removal of an armed key listener when the press itself threw (never throws). */
export async function disposeKeyObservation(pre: KeyPre): Promise<void> {
  if (!pre.frame || !pre.token || pre.target?.kind !== 'element') return;
  await bounded(pre.frame.evaluate(readKeyObservationInPage, pre.token, ''), OBSERVE_AFTER_TIMEOUT_MS);
}

/** Reads the armed observation back after the press and returns the verdict inputs. */
export async function finishKeyObservation(
  tab: ObservedTab,
  pre: KeyPre,
  params: { key: string; modifiers?: readonly string[] },
  urlBefore: string | undefined,
): Promise<BuiltInVerdict> {
  const obs: KeyObservation = { key: params.key, modifiers: params.modifiers, pre };
  if (pre.frame && pre.token && pre.target?.kind === 'element') {
    const r = await bounded(pre.frame.evaluate(readKeyObservationInPage, pre.token, params.key), OBSERVE_AFTER_TIMEOUT_MS);
    if (r.ok) {
      if ('missing' in r.value) obs.navigated = true;
      else obs.post = r.value;
    } else if (r.timedOut) {
      obs.postTimedOut = true;
    } else if (isContextDestroyed(new Error(r.error ?? ''))) {
      obs.navigated = true;
    } else {
      obs.postError = r.error;
    }
  }
  if (!obs.navigated && urlBefore !== undefined && tab.url !== undefined && tab.url !== urlBefore && !obs.post) {
    obs.navigated = true;
  }
  if (!obs.post && !obs.navigated) obs.dialogAfter = pendingDialogType(tab);
  return decideKeyVerdict(obs);
}

// ═════════════════════════════════════════════════════════════════════════════
// focus
// ═════════════════════════════════════════════════════════════════════════════

export interface FocusObservation {
  ok?: boolean;
  observed?: string;
  desc?: string;
  timedOut?: boolean;
  error?: string;
  dialog?: string;
}

export function decideFocusVerdict(o: FocusObservation): BuiltInVerdict {
  if (o.dialog) {
    return {
      outcome: 'not-run',
      reason: `${aDialog(o.dialog)} is open (see dialogPending)`,
      checks: [{ check: 'focus.active-element', outcome: 'not-run', detail: `${aDialog(o.dialog)} is open` }],
    };
  }
  if (o.timedOut || o.error !== undefined || o.ok === undefined) {
    const why = o.timedOut ? `the page did not answer within ${FOCUS_CHECK_TIMEOUT_MS}ms` : (o.error ?? 'no answer');
    return {
      outcome: 'not-run',
      reason: `could not read the active element after focus (${why})`,
      checks: [{ check: 'focus.active-element', outcome: 'not-run', detail: capString(why, 250) }],
    };
  }
  const desc = o.desc ?? 'the element';
  if (o.ok) {
    return {
      outcome: 'pass',
      reason: `document.activeElement in the element's own document is ${desc}`,
      checks: [
        {
          check: 'focus.active-element',
          outcome: 'pass',
          expected: desc,
          observed: desc,
          detail: "checked in the element's own frame document",
        },
      ],
    };
  }
  return {
    outcome: 'fail',
    reason:
      `after .focus(), the active element in the element's own document is ${o.observed ?? 'body'}, not ${desc} ` +
      '(the element may not be focusable, or the page moved focus away)',
    checks: [{ check: 'focus.active-element', outcome: 'fail', expected: desc, observed: o.observed ?? 'body' }],
  };
}

/** After `handle.focus()`: is the handle the active element of ITS OWN document/shadow root? */
export async function checkFocus(handle: ElementHandle<Element>, tab: ObservedTab, rec: PostConditionRecorder): Promise<void> {
  const dialog = pendingDialogType(tab);
  let o: FocusObservation;
  if (dialog) {
    o = { dialog };
  } else {
    const r = await bounded(
      handle.evaluate((el) => {
        const d = (e: Element | null): string => {
          if (!e) return 'null';
          const tag = e.tagName.toLowerCase();
          if (tag === 'body') return 'body';
          let s = tag;
          if (e.id) s += '#' + e.id;
          const cn = typeof e.className === 'string' ? e.className.trim() : '';
          if (cn) s += '.' + cn.split(/\s+/).slice(0, 2).join('.');
          if (s.length > 80) s = s.slice(0, 79) + '…';
          const n = e.getAttribute('data-sd-node-id');
          if (n) s += ' [#' + n + ']';
          return s;
        };
        const root = el.getRootNode() as Document | ShadowRoot;
        const a = root.activeElement ?? null;
        return { ok: a === el, observed: a ? d(a) : 'body', desc: d(el) };
      }),
      FOCUS_CHECK_TIMEOUT_MS,
    );
    o = r.ok ? r.value : { timedOut: r.timedOut, error: r.error };
  }
  const v = decideFocusVerdict(o);
  for (const c of v.checks) rec.check(c);
  rec.verdict(v.outcome, v.reason);
}

// ═════════════════════════════════════════════════════════════════════════════
// touch_tap
// ═════════════════════════════════════════════════════════════════════════════

export interface TouchObservation {
  isHit?: boolean;
  desc?: string;
  topDesc?: string;
  mark?: { trusted: boolean; type: string } | null;
  timedOut?: boolean;
  error?: string;
  dialog?: string;
}

export function decideTouchVerdict(o: TouchObservation): BuiltInVerdict {
  const desc = o.desc ?? 'the element';
  if (o.dialog) {
    return {
      outcome: 'not-run',
      reason: `${aDialog(o.dialog)} is open (see dialogPending)`,
      checks: [{ check: 'touch_tap.touch-delivered', outcome: 'not-run', detail: `${aDialog(o.dialog)} is open` }],
    };
  }
  if (o.timedOut || o.error !== undefined || o.isHit === undefined) {
    const why = o.timedOut ? 'the page did not answer in time' : (o.error ?? 'no answer');
    return {
      outcome: 'not-run',
      reason: `could not observe whether the tap was delivered (${why})`,
      checks: [{ check: 'touch_tap.touch-delivered', outcome: 'not-run', detail: capString(why, 250) }],
    };
  }
  const checks: EvidenceCheck[] = [
    { check: 'touch_tap.hit-element', outcome: o.isHit ? 'pass' : 'fail', expected: desc, observed: o.isHit ? desc : (o.topDesc ?? 'another element') },
  ];
  if (o.mark && o.mark.trusted) {
    checks.push({ check: 'touch_tap.touch-delivered', outcome: 'pass', observed: o.mark.type });
    return { outcome: 'pass', reason: `a trusted ${o.mark.type} reached ${desc}`, checks };
  }
  checks.push({ check: 'touch_tap.touch-delivered', outcome: 'fail', observed: 'no trusted event' });
  if (!o.isHit) {
    return {
      outcome: 'fail',
      reason: `the tap point is occluded by ${o.topDesc ?? 'another element'}; no touch event reached ${desc}`,
      checks,
    };
  }
  return { outcome: 'fail', reason: `no trusted touch/pointer/click event reached ${desc}`, checks };
}

/** Arms touch/pointer/click listeners on the element and reports the hit status at its centre. */
export async function armTouchObservation(
  handle: ElementHandle<Element>,
  tab: ObservedTab,
): Promise<{ isHit?: boolean; desc?: string; topDesc?: string; error?: string; timedOut?: boolean; dialog?: string }> {
  const dialog = pendingDialogType(tab);
  if (dialog) return { dialog };
  const r = await bounded(
    handle.evaluate((el) => {
      const d = (e: Element | null): string => {
        if (!e) return 'null';
        const tag = e.tagName.toLowerCase();
        if (tag === 'body') return 'body';
        let s = tag;
        if (e.id) s += '#' + e.id;
        const cn = typeof e.className === 'string' ? e.className.trim() : '';
        if (cn) s += '.' + cn.split(/\s+/).slice(0, 2).join('.');
        if (s.length > 80) s = s.slice(0, 79) + '…';
        const n = e.getAttribute('data-sd-node-id');
        if (n) s += ' [#' + n + ']';
        return s;
      };
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const root = el.getRootNode() as Document | ShadowRoot;
      let top: Element | null = root.elementFromPoint ? root.elementFromPoint(cx, cy) : null;
      for (let i = 0; i < 20 && top; i++) {
        const sr = (top as HTMLElement).shadowRoot;
        const inner: Element | null = sr && sr.elementFromPoint ? sr.elementFromPoint(cx, cy) : null;
        if (inner && inner !== top) top = inner;
        else break;
      }
      const isHit = !!top && (top === el || el.contains(top));
      const rec = el as unknown as Record<string, unknown>;
      rec.__sdTapMark = null;
      const onEvt = (e: Event): void => {
        const pe = e as PointerEvent;
        if (e.type === 'pointerup' && pe.pointerType !== 'touch') return;
        rec.__sdTapMark = { trusted: e.isTrusted, type: e.type };
      };
      for (const t of ['touchend', 'pointerup', 'click']) el.addEventListener(t, onEvt, { capture: true, once: true });
      return { isHit, desc: d(el), topDesc: top ? d(top) : 'nothing' };
    }),
    OBSERVE_BEFORE_TIMEOUT_MS,
  );
  return r.ok ? r.value : { timedOut: r.timedOut, error: r.error };
}

export async function finishTouchObservation(
  handle: ElementHandle<Element>,
  tab: ObservedTab,
  armed: Awaited<ReturnType<typeof armTouchObservation>>,
  rec: PostConditionRecorder,
): Promise<void> {
  let o: TouchObservation;
  if (armed.dialog || armed.error !== undefined || armed.timedOut || armed.isHit === undefined) {
    o = { ...armed };
  } else {
    const dialog = pendingDialogType(tab);
    if (dialog) {
      o = { dialog };
    } else {
      const r = await bounded(
        handle.evaluate((el) => {
          const rec = el as unknown as Record<string, unknown>;
          const m = rec.__sdTapMark as { trusted: boolean; type: string } | null | undefined;
          delete rec.__sdTapMark;
          return m ?? null;
        }),
        OBSERVE_AFTER_TIMEOUT_MS,
      );
      o = r.ok
        ? { isHit: armed.isHit, desc: armed.desc, topDesc: armed.topDesc, mark: r.value }
        : { timedOut: r.timedOut, error: r.error };
    }
  }
  const v = decideTouchVerdict(o);
  for (const c of v.checks) rec.check(c);
  rec.verdict(v.outcome, v.reason);
}

// ═════════════════════════════════════════════════════════════════════════════
// download_file
// ═════════════════════════════════════════════════════════════════════════════

export interface StatFs {
  stat(p: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean }>;
}

/** Fill in `fs/promises` lazily so this module stays importable in a non-Node bundle. */
async function defaultFs(): Promise<StatFs> {
  const mod = await import('node:fs/promises');
  return { stat: (p) => mod.stat(p) };
}

function isLocalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * Checks that a download Chrome reported "completed" really is a non-empty regular file, written
 * during this action, at the reported path. Not-run when the browser is on another host (its
 * download directory isn't on this machine's filesystem).
 */
export async function statDownloadedFile(
  filePath: string,
  startedAtMs: number,
  opts: { browserWsEndpoint?: string; fs?: StatFs; partialPolls?: number } = {},
): Promise<BuiltInVerdict> {
  const check = (outcome: EvidenceOutcome, observed: string, detail?: string): EvidenceCheck => ({
    check: 'download_file.file-on-disk',
    outcome,
    expected: '>0 bytes, written during this action',
    observed,
    ...(detail ? { detail: capString(detail, EVIDENCE_DETAIL_MAX) } : {}),
  });
  if (opts.browserWsEndpoint) {
    try {
      const host = new URL(opts.browserWsEndpoint).hostname;
      if (!isLocalHost(host)) {
        const reason = `the browser runs on another host (${host}), so its download directory isn't on this machine's filesystem`;
        return { outcome: 'not-run', reason, checks: [check('not-run', 'remote-browser', reason)] };
      }
    } catch {
      /* an unparseable endpoint: assume local, like when none is exposed */
    }
  }
  const fs = opts.fs ?? (await defaultFs());
  const polls = opts.partialPolls ?? Math.ceil(DOWNLOAD_PARTIAL_GRACE_MS / DOWNLOAD_PARTIAL_POLL_MS);
  let st: Awaited<ReturnType<StatFs['stat']>> | undefined;
  try {
    st = await fs.stat(filePath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      const reason = `the downloaded file could not be inspected (${(e as Error)?.message ?? String(e)})`;
      return { outcome: 'not-run', reason, checks: [check('not-run', 'unreadable', reason)] };
    }
    let partial = false;
    try {
      await fs.stat(`${filePath}.crdownload`);
      partial = true;
    } catch {
      partial = false;
    }
    if (partial) {
      for (let i = 0; i < polls && !st; i++) {
        await sleep(DOWNLOAD_PARTIAL_POLL_MS);
        try {
          st = await fs.stat(filePath);
        } catch {
          st = undefined;
        }
      }
    }
    if (!st) {
      const reason = `Chrome reported the download complete, but no file exists at ${filePath}${partial ? '; only a partial .crdownload file exists' : ''}`;
      return { outcome: 'fail', reason, checks: [check('fail', 'missing', reason)] };
    }
  }
  if (!st.isFile()) {
    const reason = `${filePath} is not a regular file`;
    return { outcome: 'fail', reason, checks: [check('fail', 'not-a-file', reason)] };
  }
  if (st.size === 0) {
    const reason = 'the downloaded file is 0 bytes';
    return { outcome: 'fail', reason, checks: [check('fail', '0 bytes', reason)] };
  }
  if (st.mtimeMs < startedAtMs - DOWNLOAD_MTIME_TOLERANCE_MS) {
    const reason = `the file at ${filePath} predates this download (modified ${new Date(st.mtimeMs).toISOString()}), so it isn't this download's output`;
    return { outcome: 'fail', reason, checks: [check('fail', 'stale', reason)] };
  }
  const reason = `${st.size} bytes written to ${filePath} during this action`;
  return { outcome: 'pass', reason, checks: [check('pass', `${st.size} bytes`, reason)] };
}

/** Engine glue: run the stat check and record it. Returns the size on success (for outputData). */
export async function recordDownloadEvidence(
  filePath: string,
  startedAtMs: number,
  page: Page,
  rec: PostConditionRecorder,
): Promise<number | undefined> {
  let wsEndpoint: string | undefined;
  try {
    wsEndpoint = page.browser?.()?.wsEndpoint?.();
  } catch {
    wsEndpoint = undefined;
  }
  const v = await statDownloadedFile(filePath, startedAtMs, { browserWsEndpoint: wsEndpoint });
  for (const c of v.checks) rec.check(c);
  rec.verdict(v.outcome, v.reason);
  if (v.outcome === 'pass') {
    const m = /^(\d+) bytes/.exec(String(v.checks[0]?.observed ?? ''));
    return m ? Number(m[1]) : undefined;
  }
  return undefined;
}

// ═════════════════════════════════════════════════════════════════════════════
// navigate / go_back / go_forward / reload
// ═════════════════════════════════════════════════════════════════════════════

export type NavKind = 'navigate' | 'go_back' | 'go_forward' | 'reload';

export interface NavSnapshot {
  url: string;
  loaderId?: string;
  index: number;
  count: number;
}

export interface NavObservation {
  kind: NavKind;
  requestedUrl?: string;
  before?: NavSnapshot;
  /** Why the baseline couldn't be captured. */
  unavailable?: string;
  after?: NavSnapshot;
  afterError?: string;
  /** HTTP status of the committed document; undefined / 0 = unknown. */
  status?: number;
  dialog?: string;
}

function sameHref(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

/** Decides the navigation verdict per §2.8.4. */
export function decideNavigationVerdict(o: NavObservation): BuiltInVerdict {
  const t = o.kind;
  const doc = `${t}.document`;
  if (o.unavailable !== undefined || !o.before) {
    const reason = `the navigation baseline couldn't be captured (${o.unavailable ?? 'no baseline'})`;
    return { outcome: 'not-run', reason, checks: [{ check: doc, outcome: 'not-run', detail: capString(reason, 250) }] };
  }
  const before = o.before;
  if (o.dialog) {
    const reason = `${aDialog(o.dialog)} is open (see dialogPending)`;
    const checks: EvidenceCheck[] = [{ check: doc, outcome: 'not-run', detail: reason }];
    if (o.after && (t === 'go_back' || t === 'go_forward')) {
      checks.push({ check: `${t}.history-index`, outcome: 'not-run', expected: before.index + (t === 'go_back' ? -1 : 1), observed: o.after.index });
    }
    return { outcome: 'not-run', reason, checks };
  }
  if (!o.after) {
    const reason = `the post-navigation state couldn't be read (${o.afterError ?? 'no answer'})`;
    return { outcome: 'not-run', reason, checks: [{ check: doc, outcome: 'not-run', detail: capString(reason, 250) }] };
  }
  const after = o.after;
  const checks: EvidenceCheck[] = [];
  const newDoc = before.loaderId !== undefined && after.loaderId !== undefined && after.loaderId !== before.loaderId;
  const sameDoc = !newDoc && after.url !== before.url;
  const docObserved = newDoc ? 'new-document' : sameDoc ? 'same-document' : 'none';
  let outcome: EvidenceOutcome;
  let reason: string;

  if (t === 'navigate') {
    if (newDoc) {
      const redirected = o.requestedUrl && !sameHref(o.requestedUrl, after.url) ? ` (redirected from ${o.requestedUrl})` : '';
      outcome = 'pass';
      reason = `a new document committed at ${after.url}${redirected}`;
    } else if (sameDoc) {
      outcome = 'pass';
      reason = `a same-document navigation moved the tab to ${after.url}`;
    } else if (sameHref(after.url, o.requestedUrl)) {
      outcome = 'pass';
      reason = `the tab was already at ${after.url}; Chrome treats this as a same-document fragment navigation with no load`;
    } else {
      outcome = 'fail';
      reason =
        `no new document committed and the URL did not change (${before.url}); the navigation may have been ` +
        'cancelled, e.g. by a beforeunload dialog (see dialogPending)';
    }
    checks.push({ check: doc, outcome, expected: 'new-document or url change', observed: docObserved, detail: capString(reason, EVIDENCE_DETAIL_MAX) });
  } else if (t === 'reload') {
    outcome = newDoc ? 'pass' : 'fail';
    reason = newDoc ? 'a new document committed (loader changed)' : 'reload did not commit a new document';
    checks.push({ check: doc, outcome, expected: 'new-document', observed: docObserved });
  } else {
    const delta = t === 'go_back' ? -1 : 1;
    const edge = t === 'go_back' ? before.index === 0 : before.index === before.count - 1;
    checks.push({ check: doc, outcome: newDoc || sameDoc ? 'pass' : 'fail', observed: docObserved });
    checks.push({
      check: `${t}.history-index`,
      outcome: !edge && after.index === before.index + delta ? 'pass' : 'fail',
      expected: before.index + delta,
      observed: after.index,
    });
    if (edge) {
      outcome = 'fail';
      reason =
        t === 'go_back'
          ? `there was no history entry to go back to (index ${before.index} of ${before.count})`
          : 'there was no forward history entry';
    } else if (after.index === before.index + delta) {
      outcome = 'pass';
      reason =
        `history moved from entry ${before.index} to ${after.index} (${after.url})` +
        (newDoc ? ' (new document)' : ' (same-document)');
    } else {
      outcome = 'fail';
      reason = `the history index did not move (still ${before.index})`;
    }
  }

  if (o.status !== undefined && o.status > 0) {
    const bad = newDoc && o.status >= 400;
    checks.push({
      check: `${t}.http-status`,
      outcome: bad ? 'fail' : 'pass',
      expected: '<400',
      observed: o.status,
    });
    if (bad) {
      outcome = 'fail';
      reason = `the navigation committed, but the server answered HTTP ${o.status}`;
    }
  }
  return { outcome, reason, checks };
}

interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  detach(): Promise<void>;
}

async function readNavSnapshot(page: Page, withFrameTree: boolean): Promise<NavSnapshot> {
  const s = (await page.createCDPSession()) as unknown as CdpLike;
  try {
    const hist = await s.send('Page.getNavigationHistory');
    let loaderId: string | undefined;
    if (withFrameTree) {
      const tree = await s.send('Page.getFrameTree');
      loaderId = tree?.frameTree?.frame?.loaderId;
    }
    return { url: page.url(), loaderId, index: hist.currentIndex, count: hist.entries.length };
  } finally {
    await s.detach().catch(() => {});
  }
}

/** Captures navigation identity (CDP loaderId + history index) before and after a navigation. */
export class NavigationProbe {
  private constructor(
    private readonly page: Page | undefined,
    private readonly tab: ObservedTab | undefined,
    private readonly before: NavSnapshot | undefined,
    private readonly unavailable: string | undefined,
  ) {}

  public static async begin(page: Page | undefined, tab?: ObservedTab): Promise<NavigationProbe> {
    if (!page || typeof page.createCDPSession !== 'function') {
      return new NavigationProbe(page, tab, undefined, 'the page exposes no CDP session');
    }
    if (pendingDialogType(tab)) {
      return new NavigationProbe(page, tab, undefined, 'a dialog was already open');
    }
    const r = await bounded(readNavSnapshot(page, true), NAV_PROBE_TIMEOUT_MS);
    if (r.ok) return new NavigationProbe(page, tab, r.value, undefined);
    return new NavigationProbe(page, tab, undefined, r.timedOut ? `no answer within ${NAV_PROBE_TIMEOUT_MS}ms` : (r.error ?? 'unknown error'));
  }

  public async finish(kind: NavKind, requestedUrl: string | undefined, rec: PostConditionRecorder): Promise<void> {
    const obs: NavObservation = { kind, requestedUrl, before: this.before, unavailable: this.unavailable };
    const page = this.page;
    if (page && this.before) {
      const dialog = pendingDialogType(this.tab);
      if (dialog) {
        obs.dialog = dialog;
        // History is answered by the browser process, so it is still recorded; the frame tree
        // and the status read (renderer-touching) are skipped while the dialog is open.
        const r = await bounded(readNavSnapshot(page, false), NAV_PROBE_TIMEOUT_MS);
        if (r.ok) obs.after = r.value;
        const v = decideNavigationVerdict(obs);
        for (const c of v.checks) rec.check(c);
        rec.verdict(v.outcome, v.reason);
        return;
      }
      const r = await bounded(readNavSnapshot(page, true), NAV_PROBE_TIMEOUT_MS);
      if (r.ok) {
        obs.after = r.value;
        if (this.before.loaderId !== undefined && r.value.loaderId !== this.before.loaderId) {
          const st = await bounded(
            page.mainFrame().evaluate(() => {
              const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
              return e && typeof (e as unknown as { responseStatus?: number }).responseStatus === 'number'
                ? (e as unknown as { responseStatus: number }).responseStatus
                : 0;
            }),
            NAV_PROBE_TIMEOUT_MS,
          );
          if (st.ok) obs.status = st.value;
        }
      } else {
        obs.afterError = r.timedOut ? `no answer within ${NAV_PROBE_TIMEOUT_MS}ms` : r.error;
      }
    }
    const v = decideNavigationVerdict(obs);
    for (const c of v.checks) rec.check(c);
    rec.verdict(v.outcome, v.reason);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// click_at_point / drag_at_points
// ═════════════════════════════════════════════════════════════════════════════

export interface PointEvent {
  type: string;
  trusted: boolean;
  onHit: boolean;
  cx: number;
  cy: number;
  targetDesc: string;
}

export interface PointObservation {
  x: number;
  y: number;
  /** Expected coordinates inside the frame that owns the hit (equals x/y in the main frame). */
  innerX?: number;
  innerY?: number;
  /** For drags: the destination point (main frame only). */
  toX?: number;
  toY?: number;
  event: string;
  skipped?: 'dialog' | 'no-frame-api';
  error?: string;
  hit?: { desc: string } | null;
  frameUnreachable?: boolean;
  events?: PointEvent[];
  navigated?: boolean;
  postTimedOut?: boolean;
  postError?: string;
  dialogAfter?: string;
  /** Drag only: the from-point is on an iframe. */
  fromInFrame?: boolean;
}

export function decidePointVerdict(o: PointObservation): BuiltInVerdict {
  const hitCheck = (outcome: EvidenceOutcome, observed: string, detail?: string): EvidenceCheck => ({
    check: 'click_at_point.hit-element',
    outcome,
    observed,
    ...(detail ? { detail: capString(detail, 250) } : {}),
  });
  const delivered = (outcome: EvidenceOutcome, observed: string): EvidenceCheck => ({
    check: 'click_at_point.click-delivered',
    outcome,
    expected: `trusted ${o.event}`,
    observed,
  });
  if (o.dialogAfter) {
    const reason = `${aDialog(o.dialogAfter)} opened (see dialogPending); delivery couldn't be read`;
    return { outcome: 'not-run', reason, checks: [hitCheck('not-run', 'dialog', reason)] };
  }
  if (o.skipped || o.error !== undefined) {
    const why = o.skipped === 'dialog' ? 'a dialog was already open' : (o.error ?? 'the page exposes no frame API');
    const reason = `could not observe the point before the click (${why})`;
    return { outcome: 'not-run', reason, checks: [hitCheck('not-run', 'unobserved', reason)] };
  }
  if (o.hit === null) {
    const reason = `no element is at (${o.x}, ${o.y}); the point is outside the viewport or the document`;
    return { outcome: 'fail', reason, checks: [hitCheck('fail', 'nothing', reason)] };
  }
  if (o.frameUnreachable || !o.hit) {
    const reason = 'the point is inside an <iframe> whose frame could not be matched';
    return { outcome: 'not-run', reason, checks: [hitCheck('not-run', 'frame-unreachable', reason)] };
  }
  const desc = o.hit.desc;
  const checks: EvidenceCheck[] = [hitCheck('pass', desc)];
  if (o.navigated) {
    checks.push(delivered('pass', 'navigated'));
    return { outcome: 'pass', reason: 'the page navigated right after the click, which is treated as delivered', checks };
  }
  if (o.postTimedOut || o.postError !== undefined || !o.events) {
    const why = o.postTimedOut ? `the page did not answer within ${OBSERVE_AFTER_TIMEOUT_MS}ms` : (o.postError ?? 'no answer');
    checks.push({ check: 'click_at_point.click-delivered', outcome: 'not-run', detail: capString(why, 250) });
    return { outcome: 'not-run', reason: `the click's delivery could not be read (${why})`, checks };
  }
  const ex = o.innerX ?? o.x;
  const ey = o.innerY ?? o.y;
  const trusted = o.events.filter((e) => e.trusted && e.type === o.event);
  const good = trusted.find((e) => e.onHit && Math.abs(e.cx - ex) <= 1 && Math.abs(e.cy - ey) <= 1);
  if (good) {
    checks.push(delivered('pass', 'delivered'));
    return { outcome: 'pass', reason: `a trusted ${o.event} landed on ${desc}, the element at (${o.x}, ${o.y})`, checks };
  }
  if (trusted.length > 0) {
    const other = trusted[0]!;
    checks.push(delivered('fail', `landed on ${other.targetDesc}`));
    return {
      outcome: 'fail',
      reason: `the click at (${o.x}, ${o.y}) landed on ${other.targetDesc}, not on ${desc}, which was at that point when it was dispatched`,
      checks,
    };
  }
  checks.push(delivered('fail', 'not seen'));
  return { outcome: 'fail', reason: `no trusted ${o.event} reached the page at (${o.x}, ${o.y})`, checks };
}

export function decideDragVerdict(o: PointObservation): BuiltInVerdict {
  const c = (name: string, outcome: EvidenceOutcome, observed?: string, expected?: string): EvidenceCheck => ({
    check: `drag_at_points.${name}`,
    outcome,
    ...(expected ? { expected } : {}),
    ...(observed ? { observed } : {}),
  });
  if (o.fromInFrame) {
    const reason = "drag delivery inside frames isn't observed";
    return { outcome: 'not-run', reason, checks: [c('down-delivered', 'not-run', 'in-frame')] };
  }
  if (o.dialogAfter) {
    const reason = `${aDialog(o.dialogAfter)} opened (see dialogPending); delivery couldn't be read`;
    return { outcome: 'not-run', reason, checks: [c('down-delivered', 'not-run', 'dialog')] };
  }
  if (o.skipped || o.error !== undefined) {
    const why = o.skipped === 'dialog' ? 'a dialog was already open' : (o.error ?? 'the page exposes no frame API');
    return { outcome: 'not-run', reason: `could not observe the drag start point (${why})`, checks: [c('down-delivered', 'not-run', 'unobserved')] };
  }
  if (o.hit === null) {
    const reason = `no element is at (${o.x}, ${o.y}); the point is outside the viewport or the document`;
    return { outcome: 'fail', reason, checks: [c('down-delivered', 'fail', 'nothing')] };
  }
  if (o.frameUnreachable || !o.hit) {
    return {
      outcome: 'not-run',
      reason: 'the drag start point is inside an <iframe> whose frame could not be matched',
      checks: [c('down-delivered', 'not-run', 'frame-unreachable')],
    };
  }
  if (o.navigated) {
    return {
      outcome: 'pass',
      reason: 'the page navigated right after the drag, which is treated as delivered',
      checks: [c('down-delivered', 'pass', 'navigated')],
    };
  }
  if (o.postTimedOut || o.postError !== undefined || !o.events) {
    const why = o.postTimedOut ? `the page did not answer within ${OBSERVE_AFTER_TIMEOUT_MS}ms` : (o.postError ?? 'no answer');
    return { outcome: 'not-run', reason: `the drag's delivery could not be read (${why})`, checks: [c('down-delivered', 'not-run', why)] };
  }
  const tx = o.toX ?? o.x;
  const ty = o.toY ?? o.y;
  const down = o.events.find((e) => e.type === 'mousedown' && e.trusted && e.onHit && Math.abs(e.cx - o.x) <= 1 && Math.abs(e.cy - o.y) <= 1);
  const up = o.events.find((e) => e.type === 'mouseup' && e.trusted && Math.abs(e.cx - tx) <= 1 && Math.abs(e.cy - ty) <= 1);
  const checks = [
    c('down-delivered', down ? 'pass' : 'fail', down ? o.hit.desc : 'not seen', `trusted mousedown on ${o.hit.desc}`),
    c('up-delivered', up ? 'pass' : 'fail', up ? 'delivered' : 'not seen', `trusted mouseup at (${tx}, ${ty})`),
  ];
  if (down && up) {
    return {
      outcome: 'pass',
      reason: `mousedown reached ${o.hit.desc} at (${o.x}, ${o.y}) and mouseup was delivered at (${tx}, ${ty}); the drag's app-level effect was not checked — use expect`,
      checks,
    };
  }
  if (!down) {
    return { outcome: 'fail', reason: `no trusted mousedown reached ${o.hit.desc} at (${o.x}, ${o.y})`, checks };
  }
  return { outcome: 'fail', reason: `mousedown was delivered, but no trusted mouseup reached (${tx}, ${ty})`, checks };
}

/**
 * In-page: hit-test (through open shadow roots). On an `<iframe>` it marks the element with `token`
 * and returns the coordinates inside it; otherwise it arms capture listeners for `events` and
 * remembers the hit element.
 */
export function armPointInPage(
  x: number,
  y: number,
  events: string[],
  token: string,
): { hit: null } | { frame: true; innerX: number; innerY: number } | { armed: true; desc: string } {
  const d = (e: Element | null): string => {
    if (!e) return 'null';
    const tag = e.tagName.toLowerCase();
    if (tag === 'body') return 'body';
    let s = tag;
    if (e.id) s += '#' + e.id;
    const cn = typeof e.className === 'string' ? e.className.trim() : '';
    if (cn) s += '.' + cn.split(/\s+/).slice(0, 2).join('.');
    if (s.length > 80) s = s.slice(0, 79) + '…';
    const n = e.getAttribute('data-sd-node-id');
    if (n) s += ' [#' + n + ']';
    return s;
  };
  let el: Element | null = document.elementFromPoint(x, y);
  for (let i = 0; i < 20 && el; i++) {
    const sr = (el as HTMLElement).shadowRoot;
    const inner: Element | null = sr && sr.elementFromPoint ? sr.elementFromPoint(x, y) : null;
    if (inner && inner !== el) el = inner;
    else break;
  }
  if (!el) return { hit: null };
  if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
    const r = el.getBoundingClientRect();
    (el as unknown as Record<string, unknown>).__sdPointMark = token;
    return { frame: true, innerX: x - r.left - el.clientLeft, innerY: y - r.top - el.clientTop };
  }
  const w = window as unknown as Record<string, any>;
  const state: {
    hit: Element;
    events: Array<{ type: string; trusted: boolean; onHit: boolean; cx: number; cy: number; targetDesc: string }>;
    off: () => void;
  } = { hit: el, events: [], off: () => {} };
  const handler = (e: Event): void => {
    const me = e as MouseEvent;
    const path = e.composedPath();
    state.events.push({
      type: e.type,
      trusted: e.isTrusted,
      onHit: path.indexOf(state.hit) >= 0,
      cx: me.clientX,
      cy: me.clientY,
      targetDesc: d((path[0] as Element) ?? null),
    });
  };
  for (const t of events) window.addEventListener(t, handler, true);
  state.off = () => {
    for (const t of events) window.removeEventListener(t, handler, true);
  };
  w[token] = state;
  return { armed: true, desc: d(el) };
}

/** In-page: read (and remove) what {@link armPointInPage} recorded. */
export function readPointInPage(token: string): { missing: true } | { events: PointEvent[] } {
  const w = window as unknown as Record<string, any>;
  const s = w[token];
  if (!s) return { missing: true };
  s.off();
  delete w[token];
  return { events: s.events as PointEvent[] };
}

export interface PointArm {
  skipped?: 'dialog' | 'no-frame-api';
  error?: string;
  hit?: { desc: string } | null;
  frameUnreachable?: boolean;
  innerX?: number;
  innerY?: number;
  frame?: FrameLike;
  token?: string;
  fromInFrame?: boolean;
}

/** Hit-tests (x, y), descending into frames, and arms listeners for `events` in the owning window. */
export async function observePoint(tab: ObservedTab, x: number, y: number, events: string[]): Promise<PointArm> {
  if (pendingDialogType(tab)) return { skipped: 'dialog' };
  const page = tab.page;
  if (!hasFrameApi(page)) return { skipped: 'no-frame-api' };
  const token = `__sdPt_${Math.random().toString(36).slice(2)}`;
  const run = async (): Promise<PointArm> => {
    let frame: FrameLike = page.mainFrame();
    let cx = x;
    let cy = y;
    let inFrame = false;
    for (let depth = 0; depth <= 3; depth++) {
      const r = await frame.evaluate(armPointInPage, cx, cy, events, token);
      if ('hit' in r) return { hit: null, fromInFrame: inFrame };
      if ('armed' in r) return { hit: { desc: r.desc }, innerX: cx, innerY: cy, frame, token, fromInFrame: inFrame };
      inFrame = true;
      const child = await matchChildFrame(frame, (el) => (el as unknown as Record<string, unknown>).__sdPointMark === token);
      // clear the mark best-effort (the marked element lives in the parent frame)
      await frame.evaluate((t) => {
        for (const f of Array.from(document.querySelectorAll('iframe,frame'))) {
          if ((f as unknown as Record<string, unknown>).__sdPointMark === t) delete (f as unknown as Record<string, unknown>).__sdPointMark;
        }
      }, token).catch(() => {});
      if (!child) return { frameUnreachable: true, fromInFrame: true };
      frame = child;
      cx = r.innerX;
      cy = r.innerY;
    }
    return { frameUnreachable: true, fromInFrame: true };
  };
  const r = await bounded(run(), OBSERVE_BEFORE_TIMEOUT_MS);
  if (!r.ok) return { error: r.timedOut ? `no answer within ${OBSERVE_BEFORE_TIMEOUT_MS}ms` : (r.error ?? 'unknown error') };
  return r.value;
}

/** Reads the armed events back and assembles the observation for the deciders. */
export async function finishPointObservation(
  tab: ObservedTab,
  arm: PointArm,
  base: { x: number; y: number; event: string; toX?: number; toY?: number },
  urlBefore: string | undefined,
): Promise<PointObservation> {
  const obs: PointObservation = {
    ...base,
    skipped: arm.skipped,
    error: arm.error,
    hit: arm.hit,
    frameUnreachable: arm.frameUnreachable,
    innerX: arm.innerX,
    innerY: arm.innerY,
    fromInFrame: arm.fromInFrame,
  };
  if (arm.frame && arm.token && arm.hit) {
    const r = await bounded(arm.frame.evaluate(readPointInPage, arm.token), OBSERVE_AFTER_TIMEOUT_MS);
    if (r.ok) {
      if ('missing' in r.value) obs.navigated = true;
      else obs.events = r.value.events;
    } else if (r.timedOut) {
      obs.postTimedOut = true;
    } else if (isContextDestroyed(new Error(r.error ?? ''))) {
      obs.navigated = true;
    } else {
      obs.postError = r.error;
    }
    if (!obs.events && !obs.navigated) obs.dialogAfter = pendingDialogType(tab);
    if (!obs.events && !obs.navigated && urlBefore !== undefined && tab.url !== undefined && tab.url !== urlBefore) {
      obs.navigated = true;
    }
  }
  return obs;
}

// ═════════════════════════════════════════════════════════════════════════════
// upload_file_via_trigger
// ═════════════════════════════════════════════════════════════════════════════

export interface UploadInputState {
  desc: string;
  before: string[] | null;
  after: string[];
  afterSizes: number[];
}

export interface UploadObservation {
  name: string;
  size: number;
  skipped?: 'dialog' | 'no-frame-api';
  error?: string;
  event?: { trusted: boolean; names: string[]; sizes: number[] } | null;
  inputs?: UploadInputState[];
}

export function decideUploadVerdict(o: UploadObservation): BuiltInVerdict {
  const c = (outcome: EvidenceOutcome, observed: string, detail?: string): EvidenceCheck => ({
    check: 'upload_file_via_trigger.files-read-back',
    outcome,
    expected: `${o.name} (${o.size} B)`,
    observed,
    ...(detail ? { detail: capString(detail, 250) } : {}),
  });
  if (o.skipped || o.error !== undefined) {
    const why = o.skipped === 'dialog' ? 'a dialog was open' : o.skipped === 'no-frame-api' ? 'the page exposes no frame API' : (o.error ?? 'unknown');
    const reason = `the upload could not be observed (${why})`;
    return { outcome: 'not-run', reason, checks: [c('not-run', 'unobserved', reason)] };
  }
  const name = o.name;
  const idxOf = (names: string[]): number => names.indexOf(name);
  const ev = o.event && o.event.trusted ? o.event : undefined;
  if (ev && idxOf(ev.names) >= 0 && ev.sizes[idxOf(ev.names)] === o.size) {
    const reason = `a trusted change event delivered "${name}" (${o.size} B) to a file input`;
    return { outcome: 'pass', reason, checks: [c('pass', 'change event')] };
  }
  const inputs = o.inputs ?? [];
  if (!ev) {
    const changed = inputs.find(
      (i) => idxOf(i.after) >= 0 && i.afterSizes[idxOf(i.after)] === o.size && JSON.stringify(i.before ?? []) !== JSON.stringify(i.after),
    );
    if (changed) {
      const reason = `${changed.desc}'s files now hold "${name}" (${o.size} B)`;
      return { outcome: 'pass', reason, checks: [c('pass', 'files list')] };
    }
  }
  if (ev) {
    const idx = idxOf(ev.names);
    if (idx < 0) {
      const reason = `the file input received [${ev.names.join(', ')}], not "${name}"`;
      return { outcome: 'fail', reason, checks: [c('fail', `[${ev.names.join(', ')}]`, reason)] };
    }
    const reason = `the file input received "${name}" but with size ${ev.sizes[idx]} B, not ${o.size} B`;
    return { outcome: 'fail', reason, checks: [c('fail', `${ev.sizes[idx]} B`, reason)] };
  }
  const already = inputs.find((i) => i.before && i.before.length === 1 && i.before[0] === name && i.after.length === 1 && i.after[0] === name);
  if (already) {
    const reason = `${already.desc} already held a file named "${name}" before this upload and no change event fired, so the new upload can't be told apart`;
    return { outcome: 'not-run', reason, checks: [c('not-run', 'already-held', reason)] };
  }
  const reason =
    "the file was handed to the page's file chooser, but no connected <input type=file> in the main document holds it and " +
    'no change event reached the document; the receiving input may be detached, in a closed shadow root, or in an iframe';
  return { outcome: 'not-run', reason, checks: [c('not-run', 'not-found', reason)] };
}

/** In-page: record every file input and start capturing `change` events. */
export function armUploadListenerInPage(token: string): number {
  const inputs: HTMLInputElement[] = [];
  const collect = (root: ParentNode): void => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') inputs.push(el as HTMLInputElement);
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) collect(sr);
    }
  };
  collect(document);
  const names = (i: HTMLInputElement): string[] => Array.from(i.files ?? []).map((f) => f.name);
  const w = window as unknown as Record<string, any>;
  const state: {
    inputs: HTMLInputElement[];
    before: string[][];
    event: { trusted: boolean; names: string[]; sizes: number[] } | null;
    off: () => void;
  } = { inputs, before: inputs.map(names), event: null, off: () => {} };
  const handler = (e: Event): void => {
    const t = e.target as HTMLInputElement | null;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'file') return;
    const mark = e as unknown as Record<string, unknown>;
    if (mark.__sdUp === token) return;
    mark.__sdUp = token;
    state.event = { trusted: e.isTrusted, names: Array.from(t.files ?? []).map((f) => f.name), sizes: Array.from(t.files ?? []).map((f) => f.size) };
  };
  document.addEventListener('change', handler, true);
  for (const i of inputs) i.addEventListener('change', handler, true);
  state.off = () => {
    document.removeEventListener('change', handler, true);
    for (const i of state.inputs) i.removeEventListener('change', handler, true);
  };
  w[token] = state;
  return inputs.length;
}

/** In-page: rescan file inputs and return the recorded change event. `remove` also cleans up. */
export function readUploadObservationInPage(
  token: string,
  remove: boolean,
): { missing: true } | { event: { trusted: boolean; names: string[]; sizes: number[] } | null; inputs: UploadInputState[] } {
  const w = window as unknown as Record<string, any>;
  const s = w[token];
  if (!s) return { missing: true };
  const d = (e: Element | null): string => {
    if (!e) return 'null';
    const tag = e.tagName.toLowerCase();
    let str = tag;
    if (e.id) str += '#' + e.id;
    const cn = typeof e.className === 'string' ? e.className.trim() : '';
    if (cn) str += '.' + cn.split(/\s+/).slice(0, 2).join('.');
    if (str.length > 80) str = str.slice(0, 79) + '…';
    return str;
  };
  const all: HTMLInputElement[] = [];
  const collect = (root: ParentNode): void => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') all.push(el as HTMLInputElement);
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) collect(sr);
    }
  };
  collect(document);
  const known: HTMLInputElement[] = s.inputs;
  const inputs = all.map((i) => {
    const k = known.indexOf(i);
    const files = Array.from(i.files ?? []);
    return {
      desc: d(i),
      before: k >= 0 ? (s.before[k] as string[]) : null,
      after: files.map((f) => f.name),
      afterSizes: files.map((f) => f.size),
    };
  });
  const event = s.event as { trusted: boolean; names: string[]; sizes: number[] } | null;
  if (remove) {
    s.off();
    delete w[token];
  }
  return { event, inputs };
}

export interface UploadArm {
  skipped?: 'dialog' | 'no-frame-api';
  error?: string;
  token?: string;
  frame?: FrameLike;
}

export async function observeUploadTargets(tab: ObservedTab): Promise<UploadArm> {
  if (pendingDialogType(tab)) return { skipped: 'dialog' };
  const page = tab.page;
  if (!hasFrameApi(page)) return { skipped: 'no-frame-api' };
  const token = `__sdUp_${Math.random().toString(36).slice(2)}`;
  const frame: FrameLike = page.mainFrame();
  const r = await bounded(frame.evaluate(armUploadListenerInPage, token), OBSERVE_BEFORE_TIMEOUT_MS);
  if (!r.ok) return { error: r.timedOut ? `no answer within ${OBSERVE_BEFORE_TIMEOUT_MS}ms` : (r.error ?? 'unknown error') };
  return { token, frame };
}

/** Best-effort cleanup when the trigger click / chooser step threw. */
export async function removeUploadListener(arm: UploadArm): Promise<void> {
  if (!arm.frame || !arm.token) return;
  await bounded(arm.frame.evaluate(readUploadObservationInPage, arm.token, true), OBSERVE_BEFORE_TIMEOUT_MS);
}

/** Polls (≤ 500 ms) for a trusted change event, then reads the inputs and decides. */
export async function finishUploadObservation(
  arm: UploadArm,
  fileName: string,
  fileSize: number,
): Promise<BuiltInVerdict> {
  const base: UploadObservation = { name: fileName, size: fileSize, skipped: arm.skipped, error: arm.error };
  if (arm.frame && arm.token) {
    const frame = arm.frame;
    const token = arm.token;
    const run = async (): Promise<UploadObservation> => {
      for (let waited = 0; waited <= UPLOAD_POLL_TOTAL_MS; waited += UPLOAD_POLL_MS) {
        const last = await frame.evaluate(readUploadObservationInPage, token, false);
        if ('event' in last && last.event) break;
        await sleep(UPLOAD_POLL_MS);
      }
      const fin = await frame.evaluate(readUploadObservationInPage, token, true);
      if ('missing' in fin) return { ...base, error: 'the page navigated or reset during the upload' };
      return { ...base, event: fin.event, inputs: fin.inputs };
    };
    const r = await bounded(run(), UPLOAD_OBSERVE_TIMEOUT_MS + UPLOAD_POLL_TOTAL_MS);
    if (r.ok) return decideUploadVerdict(r.value);
    return decideUploadVerdict({ ...base, error: r.timedOut ? 'the page did not answer in time' : (r.error ?? 'unknown') });
  }
  return decideUploadVerdict(base);
}

// ═════════════════════════════════════════════════════════════════════════════
// clipboard
// ═════════════════════════════════════════════════════════════════════════════

export interface ClipboardRead {
  path: 'clipboard-api' | 'execCommand-paste' | 'blocked' | 'unavailable';
  text?: string;
  error?: string;
}

/** `set_clipboard`'s read-back verdict. Never records either text (D11). */
export function decideClipboardVerdict(written: string, r: ClipboardRead): BuiltInVerdict {
  const c = (outcome: EvidenceOutcome, observed: string | number, detail?: string): EvidenceCheck => ({
    check: 'set_clipboard.read-back',
    outcome,
    expected: written.length,
    observed,
    ...(detail ? { detail: capString(detail, 250) } : {}),
  });
  if (r.path === 'blocked') {
    const reason =
      "the clipboard couldn't be read back (the clipboard-read permission isn't granted for this origin; " +
      'grant it with browser.grant_permissions to get a verified result). The write itself may have succeeded';
    return { outcome: 'not-run', reason, checks: [c('not-run', 'blocked', 'clipboard-read permission not granted')] };
  }
  if (r.path === 'unavailable' || r.text === undefined) {
    const reason = `the isolated-world read-back couldn't run (${r.error ?? 'no answer'})`;
    return { outcome: 'not-run', reason, checks: [c('not-run', 'unavailable', reason)] };
  }
  if (r.text === written) {
    const reason = `the clipboard was read back from an isolated world and matches (length ${written.length})`;
    return { outcome: 'pass', reason, checks: [c('pass', r.text.length)] };
  }
  const reason =
    `the clipboard was read back from an isolated world and does not match what was written (read length ${r.text.length}, ` +
    `wrote ${written.length}); the write may have been intercepted by the page`;
  return { outcome: 'fail', reason, checks: [c('fail', r.text.length, reason)] };
}

/**
 * Evaluates `expression` in a CDP isolated world of the main frame: it shares the DOM but NOT the
 * page's JS globals, so a page that monkey-patches `navigator.clipboard` (or anything else) in its
 * own world can't spoof the read. Same session for create and evaluate; detached in `finally`.
 */
export async function evaluateInIsolatedWorld<T>(page: Page, expression: string, timeoutMs: number): Promise<BoundedResult<T>> {
  const run = async (): Promise<T> => {
    const s = (await page.createCDPSession()) as unknown as CdpLike;
    try {
      const tree = await s.send('Page.getFrameTree');
      const frameId = tree.frameTree.frame.id as string;
      const world = await s.send('Page.createIsolatedWorld', {
        frameId,
        worldName: 'sutradhar-verify',
        grantUniveralAccess: false,
      });
      const res = await s.send('Runtime.evaluate', {
        expression,
        contextId: world.executionContextId,
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'evaluation failed');
      }
      return res.result.value as T;
    } finally {
      await s.detach().catch(() => {});
    }
  };
  return bounded(run(), timeoutMs);
}

/** The expression {@link readClipboardIsolated} evaluates (a string literal: it is not serialised from a function). */
export const CLIPBOARD_READ_EXPRESSION = `(async () => {
  try {
    const t = await navigator.clipboard.readText();
    return { path: 'clipboard-api', text: t };
  } catch (e) {
    const firstError = String((e && e.message) || e);
    try {
      const ta = document.createElement('textarea');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      const ok = document.execCommand('paste');
      const v = ta.value;
      document.body.removeChild(ta);
      return ok ? { path: 'execCommand-paste', text: v } : { path: 'blocked', error: firstError };
    } catch (e2) {
      return { path: 'blocked', error: firstError };
    }
  }
})()`;

export async function readClipboardIsolated(page: Page): Promise<ClipboardRead> {
  if (!page || typeof page.createCDPSession !== 'function') return { path: 'unavailable', error: 'the page exposes no CDP session' };
  const r = await evaluateInIsolatedWorld<ClipboardRead>(page, CLIPBOARD_READ_EXPRESSION, CLIPBOARD_READBACK_TIMEOUT_MS);
  if (r.ok && r.value && typeof r.value.path === 'string') return r.value;
  return { path: 'unavailable', error: r.ok ? 'no result' : r.timedOut ? `no answer within ${CLIPBOARD_READBACK_TIMEOUT_MS}ms` : r.error };
}

// ═════════════════════════════════════════════════════════════════════════════
// screenshot / wait_for_selector
// ═════════════════════════════════════════════════════════════════════════════

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Signature, IHDR chunk type at bytes 12..15, and a non-zero big-endian width/height. */
export function inspectPng(buf: Uint8Array): { ok: true; width: number; height: number } | { ok: false; why: string } {
  if (!buf || buf.length < 24) return { ok: false, why: `only ${buf?.length ?? 0} bytes` };
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return { ok: false, why: 'missing PNG signature' };
  }
  if (String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!) !== 'IHDR') return { ok: false, why: 'missing IHDR chunk' };
  const u32 = (o: number): number => ((buf[o]! << 24) | (buf[o + 1]! << 16) | (buf[o + 2]! << 8) | buf[o + 3]!) >>> 0;
  const width = u32(16);
  const height = u32(20);
  if (width === 0 || height === 0) return { ok: false, why: `zero dimension (${width}x${height})` };
  return { ok: true, width, height };
}

/** Records the screenshot check: unverifiable by design unless the capture itself is broken. */
export function recordScreenshotEvidence(base64: string, rec: PostConditionRecorder): void {
  let buf: Uint8Array;
  try {
    buf = Uint8Array.from(Buffer.from(base64, 'base64'));
  } catch {
    buf = new Uint8Array(0);
  }
  const r = inspectPng(buf);
  if (r.ok) {
    const dims = `${r.width}x${r.height}`;
    rec.check({ check: 'screenshot.png-well-formed', outcome: 'pass', observed: dims });
    rec.verdict(
      'not-run',
      'a screenshot does not change the page, so there is no post-condition to verify; the capture was checked to be ' +
        `a well-formed ${dims} PNG, but its content was not inspected`,
    );
    return;
  }
  rec.check({ check: 'screenshot.png-well-formed', outcome: 'fail', observed: r.why });
  rec.verdict('fail', `the capture is not a valid PNG (${r.why})`);
}

/** D14: evidence for `wait_for_selector`, derived from its own output keys after dispatch. */
export function recordWaitForSelectorEvidence(rec: PostConditionRecorder, out: Record<string, unknown> | undefined): void {
  const state = String(out?.state ?? 'visible');
  const selector = fmt(out?.foundSelector ?? '');
  if (state === 'hidden' && out?.matchedAtStart === false) {
    rec.check({
      check: 'wait_for_selector.state-matched',
      outcome: 'not-run',
      expected: 'hidden',
      observed: 'no-match-at-start',
      detail: 'nothing matched the selector when the wait started, so "hidden" was satisfied vacuously',
    });
    rec.verdict(
      'not-run',
      `nothing matched "${selector}" at any point, so state "hidden" was satisfied vacuously — a wrong selector and an element that already disappeared look the same`,
    );
    return;
  }
  const others = typeof out?.otherVisibleMatches === 'number' ? out.otherVisibleMatches : 0;
  rec.check({
    check: 'wait_for_selector.state-matched',
    outcome: 'pass',
    expected: state,
    observed: state,
    ...(others > 0
      ? { detail: `${others} later match(es) of the selector are still visible (visibility is judged on the first match)` }
      : {}),
  });
  rec.verdict('pass', `the element was observed in state "${state}"`);
}
