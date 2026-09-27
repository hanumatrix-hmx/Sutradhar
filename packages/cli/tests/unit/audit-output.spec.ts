/**
 * @file packages/cli/tests/unit/audit-output.spec.ts
 * @description FR2-12: unit tests for the pure CLI audit formatting/exit-code helpers.
 */
import { formatAuditText, auditNotes, auditExitCode } from '../../src/audit-output.js';
import type { AuditReport } from '@sutradhar/capability-runtime';

function baseReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    schemaVersion: 1,
    url: 'http://x/audit?n=7',
    requestedUrl: 'http://x/audit?n=7',
    title: 'T',
    timestamp: '2026-01-01T00:00:00.000Z',
    screenshot: { path: '/tmp/audit-screenshot.png', width: 10, height: 10, bytes: 100, fullPage: true },
    consoleErrors: [{ text: 'fr2-12-console-7', timestamp: '2026-01-01T00:00:00.100Z' }],
    pageErrors: [{ message: 'fr2-12-pageerror-7', timestamp: '2026-01-01T00:00:00.200Z' }],
    brokenRequests: [
      { url: 'http://x/missing-7.png', status: 404 },
      { url: 'http://x/api/fail-7', status: 500 },
    ],
    accessibilityIssues: [{ rule: 'img-alt', description: 'Images missing an alt attribute', count: 1 }],
    webVitals: { lcpMs: 212, cls: 0.09, fcpMs: 180, ttfbMs: 3 },
    observation: {
      mode: 'navigated',
      documentStartedAt: '2026-01-01T00:00:00.000Z',
      observingSince: '2026-01-01T00:00:00.000Z',
      coversWholeDocument: true,
      pageWasHidden: false,
    },
    baseline: null,
    ...overrides,
  };
}

describe('@sutradhar/cli audit-output (FR2-12)', () => {
  describe('C1: formatAuditText', () => {
    it('produces the exact line sequence, in order', () => {
      const lines = formatAuditText(baseReport());
      expect(lines).toEqual([
        'URL: http://x/audit?n=7',
        'Title: T',
        'Screenshot: /tmp/audit-screenshot.png',
        '',
        'Web Vitals:',
        '  LCP: 212ms',
        '  CLS: 0.09',
        '  FCP: 180ms',
        '  TTFB: 3ms',
        '',
        'Console errors: 1',
        '  - fr2-12-console-7',
        'Page errors: 1',
        '  - fr2-12-pageerror-7',
        'Broken requests (4xx/5xx): 2',
        '  - [404] http://x/missing-7.png',
        '  - [500] http://x/api/fail-7',
        '',
        'Accessibility issues: 1',
        '  - Images missing an alt attribute (1)',
      ]);
    });

    it('prints "n/a" (not "n/ams") for a null LCP', () => {
      const lines = formatAuditText(baseReport({ webVitals: { lcpMs: null, cls: null, fcpMs: null, ttfbMs: null } }));
      expect(lines).toContain('  LCP: n/a');
      expect(lines).toContain('  FCP: n/a');
      expect(lines).toContain('  TTFB: n/a');
      expect(lines).toContain('  CLS: n/a');
      expect(lines.some((l) => l.includes('n/ams'))).toBe(false);
    });

    it('appends a success baseline block', () => {
      const lines = formatAuditText(
        baseReport({ baseline: { url: 'http://baseline', diffPath: '/tmp/audit-baseline-diff.png', width: 10, height: 10, diffPixelCount: 1, totalPixels: 12, diffPercentage: 8.33 } }),
      );
      expect(lines.slice(-3)).toEqual([
        'Visual diff vs baseline (http://baseline):',
        '  1 / 12 pixels (8.33%)',
        '  Diff image: /tmp/audit-baseline-diff.png',
      ]);
      expect(lines[lines.length - 4]).toBe('');
    });

    it('appends an error baseline line instead of the block', () => {
      const lines = formatAuditText(baseReport({ baseline: { url: 'http://baseline', error: 'boom' } }));
      expect(lines[lines.length - 1]).toBe('Visual diff vs baseline (http://baseline) failed: boom');
      expect(lines[lines.length - 2]).toBe('');
    });
  });

  describe('C2: auditNotes', () => {
    it('is empty for a fully-covered, not-hidden report', () => {
      expect(auditNotes(baseReport())).toEqual([]);
    });

    it('has exactly one coverage note when coversWholeDocument is false', () => {
      const notes = auditNotes(baseReport({ observation: { ...baseReport().observation, coversWholeDocument: false } }));
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/^Note: console\/page errors and broken requests cover only activity since/);
    });

    it('adds a hidden-page note when pageWasHidden is true', () => {
      const notes = auditNotes(baseReport({ observation: { ...baseReport().observation, pageWasHidden: true } }));
      expect(notes.some((n) => n.includes('the page was hidden'))).toBe(true);
    });
  });

  describe('C3: auditExitCode', () => {
    it('a clean report gives 0 regardless of failOnDiff', () => {
      expect(auditExitCode(baseReport({ consoleErrors: [], pageErrors: [], brokenRequests: [] }), true)).toBe(0);
      expect(auditExitCode(baseReport({ consoleErrors: [], pageErrors: [], brokenRequests: [] }), false)).toBe(0);
    });

    it('a console error only fails the gate when failOnDiff is set', () => {
      const r = baseReport({ pageErrors: [], brokenRequests: [] });
      expect(auditExitCode(r, true)).toBe(1);
      expect(auditExitCode(r, false)).toBe(0);
    });

    it('brokenRequests only + failOnDiff gives 1', () => {
      const r = baseReport({ consoleErrors: [], pageErrors: [] });
      expect(auditExitCode(r, true)).toBe(1);
    });

    it('a baseline diff > 0 + failOnDiff gives 1; without it, 0', () => {
      const r = baseReport({
        consoleErrors: [],
        pageErrors: [],
        brokenRequests: [],
        baseline: { url: 'u', diffPath: null, width: 1, height: 1, diffPixelCount: 1, totalPixels: 2, diffPercentage: 0.5 },
      });
      expect(auditExitCode(r, true)).toBe(1);
      expect(auditExitCode(r, false)).toBe(0);
    });

    it('a baseline error gives 1 even without failOnDiff', () => {
      const r = baseReport({ consoleErrors: [], pageErrors: [], brokenRequests: [], baseline: { url: 'u', error: 'boom' } });
      expect(auditExitCode(r, false)).toBe(1);
    });
  });
});
