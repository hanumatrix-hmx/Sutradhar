/**
 * @file packages/capability-runtime/src/audit/site-audit.ts
 * @description Single-page audit: screenshot, console/page/network errors, basic accessibility
 * checks, and Core Web Vitals — the pieces real Sutradhar's `sutradhar audit <url>` bundles
 * together, built here from SutradharRuntime's existing primitives (getConsoleLogs/getPageErrors/
 * getNetworkLog were already there; this adds accessibility checks, vitals, and the report
 * shape tying them together).
 *
 * FR2-12: gained `requestedUrl`/`observation`/`baseline`, a rewritten Web Vitals capture (see
 * the comment above AUDIT_PAGE_SCRIPT — Step 0's live experiment (E2, headless Chrome,
 * `evidence/FR2-12/run-1/step0-decision.md`) confirmed Branch B: a buffered PerformanceObserver
 * read AFTER the fact returns the same LCP/CLS as the old before-navigation-injection approach,
 * so the injection (VITALS_OBSERVER_SCRIPT, and the two real bugs it caused — B1 cross-document
 * contamination and B2 CLS multiplied per audit — see runtime.ts's `audit`) is gone entirely),
 * and the pure `scopeToDocument`/`computeObservation` helpers used by `SutradharRuntime.audit`.
 */

export interface A11yIssue {
  readonly rule: string;
  readonly description: string;
  readonly count: number;
}

export interface WebVitals {
  /** Largest Contentful Paint, ms — null if no LCP candidate was recorded (e.g. the page was
   *  hidden while loading, or the browser doesn't support the entry type). */
  readonly lcpMs: number | null;
  /** Cumulative Layout Shift score — the legacy total of every non-input layout-shift entry's
   *  value (NOT Core Web Vitals' session-windowed CLS). null if unsupported. */
  readonly cls: number | null;
  /** First Contentful Paint, ms — from the Paint Timing API (always available post-load). */
  readonly fcpMs: number | null;
  /** Time to first byte, ms — from Navigation Timing (always available post-load). */
  readonly ttfbMs: number | null;
}

/**
 * What this audit could actually observe, so a caller can tell a genuinely clean page from one
 * whose errors/requests just weren't visible to this process. See `computeObservation` for how
 * this is built and `SutradharRuntime.audit`'s D9 scoping.
 */
export interface AuditObservation {
  /** 'navigated' = audit loaded `requestedUrl` itself; 'current-page' = audited the tab as-is. */
  readonly mode: 'navigated' | 'current-page';
  /** The audited document's navigation start (performance.timeOrigin), ISO. null if unreadable. */
  readonly documentStartedAt: string | null;
  /** When this process began recording the tab's console/page-error/network events
   *  (BrowserTab.observingSince). null if the tab implementation doesn't expose it. */
  readonly observingSince: string | null;
  /** true when observingSince <= the scoping instant: every console/page error and response of
   *  THIS document reached the ring buffers (subject to their 200/50/200 caps). false means
   *  earlier activity was not observed (typical for a CLI audit of the current page in a new
   *  process, since each CLI command is a fresh process that only starts observing on attach). */
  readonly coversWholeDocument: boolean;
  /** true if the page was hidden (a background tab) at any point during its life so far
   *  (visibility-state entries); a hidden load can record no FCP/LCP at all. null if the browser
   *  doesn't expose visibility-state entries. */
  readonly pageWasHidden: boolean | null;
}

/** A `baselineUrl` comparison's outcome, folded into `AuditResult`/`AuditReport`. */
export type AuditBaselineOutcome =
  | ({ readonly url: string } & import('./visual-compare.js').VisualCompareResult) // includes diffImageBase64
  | { readonly url: string; readonly error: string };

export interface AuditResult {
  readonly url: string;
  readonly title: string;
  readonly timestamp: string;
  readonly screenshotBase64: string;
  readonly consoleErrors: readonly { readonly text: string; readonly timestamp: string }[];
  readonly pageErrors: readonly { readonly message: string; readonly timestamp: string }[];
  readonly brokenRequests: readonly { readonly url: string; readonly status: number }[];
  readonly accessibilityIssues: readonly A11yIssue[];
  readonly webVitals: WebVitals;
  /** The `url` option as given, or null in current-page mode. */
  readonly requestedUrl: string | null;
  readonly observation: AuditObservation;
  /** null unless `baselineUrl` was given. */
  readonly baseline: AuditBaselineOutcome | null;
}

/** In-page accessibility + Web Vitals collection — runs inside the browser via `page.evaluate`.
 *
 * Web Vitals (Branch B, confirmed live by Step 0's E2 experiment): a LATE
 * `PerformanceObserver.observe({type, buffered:true})` synchronously appends that entry type's
 * already-recorded entries to the observer (per the W3C Performance Timeline spec's `observe()`
 * algorithm; `largest-contentful-paint`/`layout-shift` both have a 150-entry buffer). This means
 * a post-hoc read — no injection before navigation needed — gets the same LCP/CLS a live
 * observer would have collected, in BOTH url and current-page mode, with one code path. The old
 * approach (inject a listener via `evaluateOnNewDocument` before every navigation) is gone: it
 * caused two real bugs — cross-document contamination when it leaked into later navigations of
 * the same tab, and CLS being multiplied by the number of URL audits run in one tab, since each
 * injection added its own live-summing listener and nothing ever removed the previous one. */
export const AUDIT_PAGE_SCRIPT = `(() => {
  const issues = [];
  const push = (rule, description, count) => { if (count > 0) issues.push({ rule, description, count }); };

  push('img-alt', 'Images missing an alt attribute', document.querySelectorAll('img:not([alt])').length);
  push(
    'input-label',
    'Form inputs with no accessible label (no <label>, aria-label, or aria-labelledby)',
    Array.from(document.querySelectorAll('input, select, textarea')).filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return false;
      if (el.closest('label')) return false;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset'].includes(type)) return false;
      return true;
    }).length,
  );
  push('missing-title', 'Page has no <title>', document.title.trim() ? 0 : 1);
  push('missing-lang', 'Root <html> has no lang attribute', document.documentElement.hasAttribute('lang') ? 0 : 1);
  push(
    'button-name',
    'Buttons/links with no accessible name (no text content, aria-label, or title)',
    Array.from(document.querySelectorAll('button, a[href]')).filter(
      (el) => !el.textContent.trim() && !el.getAttribute('aria-label') && !el.getAttribute('title'),
    ).length,
  );

  const nav = performance.getEntriesByType('navigation')[0];
  const paintEntries = performance.getEntriesByType('paint');
  const fcp = paintEntries.find((e) => e.name === 'first-contentful-paint');

  // Branch B (see the doc comment above): a buffered observe() synchronously returns past
  // entries via takeRecords(), so no before-navigation injection is needed.
  const readBuffered = (type) => {
    try {
      const po = new PerformanceObserver(() => {});
      po.observe({ type, buffered: true });
      const recs = po.takeRecords();
      po.disconnect();
      return recs;
    } catch {
      return null; // entry type unsupported in this browser
    }
  };
  const lcp = readBuffered('largest-contentful-paint');
  const shifts = readBuffered('layout-shift');

  let pageWasHidden = null;
  try {
    if (PerformanceObserver.supportedEntryTypes.includes('visibility-state')) {
      const vis = performance.getEntriesByType('visibility-state');
      pageWasHidden = vis.some((e) => e.name === 'hidden');
    }
  } catch {}

  return {
    issues,
    timeOrigin: performance.timeOrigin,
    pageWasHidden,
    webVitals: {
      lcpMs: lcp && lcp.length ? Math.round(lcp[lcp.length - 1].startTime) : null,
      cls: shifts ? shifts.reduce((s, e) => (e.hadRecentInput ? s : s + e.value), 0) : null,
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
    },
  };
})()`;

/** Keep only entries at or after `sinceIso` (ISO strings compare lexicographically since they're
 *  all `toISOString()`, i.e. fixed-width UTC). `sinceIso: null` keeps everything (nothing to
 *  scope against — e.g. `observingSince`/`timeOrigin` were both unreadable). Pure. */
export function scopeToDocument<T extends { readonly timestamp: string }>(
  entries: readonly T[],
  sinceIso: string | null,
): T[] {
  if (sinceIso === null) return [...entries];
  return entries.filter((e) => e.timestamp >= sinceIso);
}

/** Pure: builds the `AuditObservation` and the scoping instant `since` from the raw pieces
 *  (see `SutradharRuntime.audit`'s D9 comment for the exact rule). */
export function computeObservation(input: {
  readonly mode: 'navigated' | 'current-page';
  /** GAP-262 fix-1 / GAP-266+GAP-267 fix-2: Node ISO time of the new page's main-frame REAL
   *  (cross-document) COMMIT, navigated mode only — NOT when `navigate()` was merely called, and
   *  NOT updated by a same-document navigation (hash change / pushState / replaceState). Scoping
   *  by call time left a contamination window open (the old page keeps running until the new one
   *  actually commits, GAP-262); tracking Puppeteer's merged `framenavigated` event (fix-1) closed
   *  that but then moved `since` on same-document navigations too, silently dropping the new
   *  page's own early errors (GAP-266) and sometimes its own broken-request status (GAP-267). See
   *  `SutradharRuntime.audit`'s doc comment for exactly how fix-2 sources this value (a dedicated
   *  CDPSession's `Page.frameNavigated`, filtered to the main frame, with no listener at all on
   *  `Page.navigatedWithinDocument`). */
  readonly navCommittedAt: string | null;
  /** `performance.timeOrigin` (epoch ms) read from the page, or null if unavailable. */
  readonly timeOrigin: number | null;
  /** `BrowserTab.observingSince`, or null if the tab implementation doesn't expose it. */
  readonly observingSince: string | null;
  readonly pageWasHidden: boolean | null;
}): { readonly observation: AuditObservation; readonly since: string | null } {
  const documentStartedAt =
    typeof input.timeOrigin === 'number' && Number.isFinite(input.timeOrigin)
      ? new Date(Math.floor(input.timeOrigin)).toISOString()
      : null;

  let since: string | null;
  if (input.mode === 'navigated') {
    // GAP-262 fix-1 (audit-1) / GAP-266+GAP-267 fix-2 (audit-2): `since` is `navCommittedAt`
    // directly when available -- NOT `min()`'d against `documentStartedAt` (the original B1 fix
    // did that, and it silently reopened the leak: `performance.timeOrigin` is close to when the
    // navigation merely STARTED, so for any response with real network latency, `min()` kept
    // re-picking that too-early value over the real commit instant). `navCommittedAt` is now
    // sourced from a REAL cross-document commit only (fix-2, see `SutradharRuntime.audit`) -- a
    // same-document navigation (hash change / pushState / replaceState) during the page's own
    // load never updates it, so it can no longer push `since` later than that document's own
    // early console errors / broken requests (GAP-266), and the audited page's own response
    // status is additionally always captured regardless of this boundary (GAP-267, done in
    // `SutradharRuntime.audit` directly, not here).
    since = input.navCommittedAt ?? documentStartedAt;
  } else {
    since = documentStartedAt;
  }

  const coversWholeDocument =
    input.observingSince !== null && since !== null && input.observingSince <= since;

  return {
    observation: {
      mode: input.mode,
      documentStartedAt,
      observingSince: input.observingSince,
      coversWholeDocument,
      pageWasHidden: input.pageWasHidden,
    },
    since,
  };
}
