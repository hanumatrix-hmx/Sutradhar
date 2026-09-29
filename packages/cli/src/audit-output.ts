/**
 * @file packages/cli/src/audit-output.ts
 * @description FR2-12: pure formatting/exit-code helpers for `sutradhar audit`, split out from
 * cli.ts (which runs `main()` at import time) so they're unit-testable without spawning Chrome.
 * `formatAuditText` reproduces the CLI's pre-FR2-12 text output line-for-line (same order, same
 * blank-line placement) from the new `AuditReport` shape, with one cosmetic fix (T26: `n/a`
 * instead of `n/ams`) and one behavior fix (a failed baseline prints a line instead of dying with
 * `Fatal:`).
 */
import type { AuditReport } from '@sutradhar/capability-runtime';

/** Today's exact line order/labels (cli.ts's old `cmdAudit`), rebuilt from an `AuditReport`. */
export function formatAuditText(report: AuditReport): string[] {
  const lines: string[] = [];
  lines.push(`URL: ${report.url}`);
  lines.push(`Title: ${report.title}`);
  lines.push(`Screenshot: ${report.screenshot.path ?? '(not written to disk)'}`);
  lines.push('');
  lines.push('Web Vitals:');
  lines.push(`  LCP: ${report.webVitals.lcpMs === null ? 'n/a' : `${report.webVitals.lcpMs}ms`}`);
  lines.push(`  CLS: ${report.webVitals.cls ?? 'n/a'}`);
  lines.push(`  FCP: ${report.webVitals.fcpMs === null ? 'n/a' : `${report.webVitals.fcpMs}ms`}`);
  lines.push(`  TTFB: ${report.webVitals.ttfbMs === null ? 'n/a' : `${report.webVitals.ttfbMs}ms`}`);
  lines.push('');
  lines.push(`Console errors: ${report.consoleErrors.length}`);
  for (const e of report.consoleErrors) lines.push(`  - ${e.text}`);
  lines.push(`Page errors: ${report.pageErrors.length}`);
  for (const e of report.pageErrors) lines.push(`  - ${e.message}`);
  lines.push(`Broken requests (4xx/5xx): ${report.brokenRequests.length}`);
  for (const r of report.brokenRequests) lines.push(`  - [${r.status}] ${r.url}`);
  lines.push('');
  lines.push(`Accessibility issues: ${report.accessibilityIssues.length}`);
  for (const issue of report.accessibilityIssues) lines.push(`  - ${issue.description} (${issue.count})`);

  if (report.baseline) {
    if ('error' in report.baseline) {
      lines.push('');
      lines.push(`Visual diff vs baseline (${report.baseline.url}) failed: ${report.baseline.error}`);
    } else {
      lines.push('');
      lines.push(`Visual diff vs baseline (${report.baseline.url}):`);
      lines.push(`  ${report.baseline.diffPixelCount} / ${report.baseline.totalPixels} pixels (${report.baseline.diffPercentage.toFixed(2)}%)`);
      lines.push(`  Diff image: ${report.baseline.diffPath ?? '(not written to disk)'}`);
    }
  }
  return lines;
}

/** D9/T13: the honest-coverage notes printed to stderr in both text and `--json` mode, so they
 *  never pollute a `--json` stdout document. */
export function auditNotes(report: AuditReport): string[] {
  const notes: string[] = [];
  if (!report.observation.coversWholeDocument) {
    notes.push(
      'Note: console/page errors and broken requests cover only activity since ' +
        `${report.observation.observingSince ?? 'unknown'}; this command attached after the page loaded ` +
        `(${report.observation.documentStartedAt ?? 'unknown'}). Pass the URL ("sutradhar audit <url>") to load ` +
        'and audit the page in one command.',
    );
  }
  if (report.observation.pageWasHidden) {
    notes.push('Note: the page was hidden (a background tab) at some point, so LCP/FCP may be missing or incomplete.');
  }
  return notes;
}

/** D2.6: the CLI's audit-specific exit-code gate. */
export function auditExitCode(report: AuditReport, failOnDiff: boolean): 0 | 1 {
  if (report.baseline && 'error' in report.baseline) return 1;
  if (!failOnDiff) return 0;
  const diffPct = report.baseline && !('error' in report.baseline) ? report.baseline.diffPercentage : 0;
  if (report.consoleErrors.length > 0 || report.pageErrors.length > 0 || report.brokenRequests.length > 0 || diffPct > 0) {
    return 1;
  }
  return 0;
}
