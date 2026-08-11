/**
 * @file packages/capability-runtime/src/audit/site-audit.ts
 * @description Single-page audit: screenshot, console/page/network errors, basic accessibility
 * checks, and Core Web Vitals — the pieces real PinchTab's `pinchtab audit <url>` bundles
 * together, built here from PinchTabRuntime's existing primitives (getConsoleLogs/getPageErrors/
 * getNetworkLog were already there; this adds accessibility checks, vitals, and the report
 * shape tying them together).
 */

export interface A11yIssue {
  readonly rule: string;
  readonly description: string;
  readonly count: number;
}

export interface WebVitals {
  /** Largest Contentful Paint, ms — null if it hadn't fired yet when the audit ran. */
  readonly lcpMs: number | null;
  /** Cumulative Layout Shift score — null if unavailable. */
  readonly cls: number | null;
  /** First Contentful Paint, ms — from the Paint Timing API (always available post-load). */
  readonly fcpMs: number | null;
  /** Time to first byte, ms — from Navigation Timing (always available post-load). */
  readonly ttfbMs: number | null;
}

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
}

/** In-page accessibility + Web Vitals collection — runs inside the browser via `page.evaluate`. */
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
  // LCP/CLS are NOT retroactively buffered by getEntriesByType the way 'paint'/'navigation'
  // entries are — they only show up here if a PerformanceObserver was actively listening
  // BEFORE they occurred. installVitalsObserver() below (injected via evaluateOnNewDocument,
  // so it's running from the very start of the page's life) stashes them on
  // window.__pinchtabVitals for exactly this reason; prefer that when present.
  const stashed = window.__pinchtabVitals;
  const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
  const lastLcp = lcpEntries[lcpEntries.length - 1];

  return {
    issues,
    webVitals: {
      lcpMs: stashed && stashed.lcpMs != null ? stashed.lcpMs : lastLcp ? Math.round(lastLcp.startTime) : null,
      cls: stashed ? stashed.cls : null,
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      ttfbMs: nav ? Math.round(nav.responseStart) : null,
    },
  };
})()`;

/** Injected via `page.evaluateOnNewDocument()` BEFORE navigation, so the observers are live
 *  from the very start of the page's life and actually catch LCP/CLS entries — see the comment
 *  in AUDIT_PAGE_SCRIPT above for why a post-hoc query alone can't. */
export const VITALS_OBSERVER_SCRIPT = `(() => {
  window.__pinchtabVitals = { lcpMs: null, cls: 0 };
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__pinchtabVitals.lcpMs = Math.round(last.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__pinchtabVitals.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
})()`;
