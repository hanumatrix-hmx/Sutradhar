/**
 * @file packages/capability-runtime/tests/unit/audit-report.spec.ts
 * @description FR2-12: unit tests for the pure audit-report shaping module — buildAuditReport,
 * pngDimensions, prepareAuditOutDir, writeAuditArtifacts, and the schema drift guards
 * (AUDIT_REPORT_EXAMPLE vs the committed JSON Schema), plus the pure scopeToDocument/
 * computeObservation helpers from site-audit.ts.
 */
import { PNG } from 'pngjs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AUDIT_REPORT_SCHEMA_VERSION,
  AUDIT_REPORT_EXAMPLE,
  buildAuditReport,
  prepareAuditOutDir,
  writeAuditArtifacts,
  pngDimensions,
  type AuditReportBaseline,
} from '../../src/audit/audit-report.js';
import { scopeToDocument, computeObservation, type AuditResult } from '../../src/audit/site-audit.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas', 'audit-report.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

function png(w: number, h: number): string {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    p.data[i * 4] = 5;
    p.data[i * 4 + 1] = 6;
    p.data[i * 4 + 2] = 7;
    p.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(p).toString('base64');
}

function fakeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    url: 'http://127.0.0.1:1/audit',
    title: 'T',
    timestamp: '2026-01-01T00:00:00.000Z',
    screenshotBase64: png(3, 2),
    consoleErrors: [],
    pageErrors: [],
    brokenRequests: [],
    accessibilityIssues: [],
    webVitals: { lcpMs: 10, cls: 0, fcpMs: 5, ttfbMs: 1 },
    requestedUrl: 'http://127.0.0.1:1/audit',
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

async function mktemp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fr212-ar-'));
}

describe('@sutradhar/capability-runtime audit-report (FR2-12)', () => {
  describe('AR1: buildAuditReport', () => {
    it('copies every field by value, shapes the screenshot, and never leaks base64', () => {
      const r = fakeResult();
      const report = buildAuditReport(r, { screenshotPath: '/x/s.png', diffPath: null });

      expect(report.schemaVersion).toBe(1);
      expect(report.url).toBe(r.url);
      expect(report.requestedUrl).toBe(r.requestedUrl);
      expect(report.title).toBe(r.title);
      expect(report.timestamp).toBe(r.timestamp);
      expect(report.consoleErrors).toEqual(r.consoleErrors);
      expect(report.pageErrors).toEqual(r.pageErrors);
      expect(report.brokenRequests).toEqual(r.brokenRequests);
      expect(report.accessibilityIssues).toEqual(r.accessibilityIssues);
      expect(report.webVitals).toEqual(r.webVitals);
      expect(report.observation).toEqual(r.observation);

      const decodedLen = Buffer.from(r.screenshotBase64, 'base64').length;
      expect(report.screenshot).toEqual({ path: '/x/s.png', width: 3, height: 2, bytes: decodedLen, fullPage: true });

      const serialized = JSON.stringify(report);
      expect(serialized).not.toContain(r.screenshotBase64);
      expect('screenshotBase64' in report).toBe(false);
    });
  });

  describe('AR2: baseline mapping', () => {
    it('maps a success baseline exactly (no diffImageBase64), an error baseline exactly, and null to null', () => {
      const success = buildAuditReport(
        fakeResult({
          baseline: { url: 'http://b/', width: 3, height: 2, diffPixelCount: 1, totalPixels: 6, diffPercentage: 16.67, diffImageBase64: png(3, 2) },
        }),
        { screenshotPath: null, diffPath: '/x/diff.png' },
      );
      expect(success.baseline).toEqual({ url: 'http://b/', diffPath: '/x/diff.png', width: 3, height: 2, diffPixelCount: 1, totalPixels: 6, diffPercentage: 16.67 });
      expect('diffImageBase64' in (success.baseline as object)).toBe(false);

      const errored = buildAuditReport(fakeResult({ baseline: { url: 'http://b/', error: 'boom' } }), { screenshotPath: null, diffPath: null });
      expect(errored.baseline).toEqual({ url: 'http://b/', error: 'boom' });

      const none = buildAuditReport(fakeResult({ baseline: null }), { screenshotPath: null, diffPath: null });
      expect(none.baseline).toBeNull();
    });
  });

  describe('AR3: pngDimensions', () => {
    it('reads width/height from a real PNG, and throws on garbage or a truncated signature', () => {
      const buf = Buffer.from(png(3, 2), 'base64');
      expect(pngDimensions(buf)).toEqual({ width: 3, height: 2 });

      expect(() => pngDimensions(Buffer.from('hello'))).toThrow(/not a PNG/);

      const truncated = buf.subarray(0, 10);
      expect(() => pngDimensions(truncated)).toThrow(/not a PNG/);
    });
  });

  describe('AR4: prepareAuditOutDir', () => {
    it('creates a nested directory tree and is idempotent', async () => {
      const tmp = await mktemp();
      const nested = path.join(tmp, 'a', 'b', 'c');
      try {
        const abs = await prepareAuditOutDir(nested);
        expect(abs).toBe(path.resolve(nested));
        const stat = await fs.stat(abs);
        expect(stat.isDirectory()).toBe(true);

        const abs2 = await prepareAuditOutDir(nested);
        expect(abs2).toBe(abs);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('AR5: prepareAuditOutDir on an existing file', () => {
    it('rejects with the exact message shape', async () => {
      const tmp = await mktemp();
      const filePath = path.join(tmp, 'not-a-dir');
      await fs.writeFile(filePath, 'x');
      try {
        await expect(prepareAuditOutDir(filePath)).rejects.toThrow(/^Cannot create audit output directory ".*"/);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('AR6: writeAuditArtifacts', () => {
    it('writes the screenshot into a non-existent nested dir with matching bytes', async () => {
      const tmp = await mktemp();
      const nested = path.join(tmp, 'x', 'y');
      try {
        const r = fakeResult();
        const report = await writeAuditArtifacts(r, nested);
        expect(path.isAbsolute(report.screenshot.path!)).toBe(true);
        const bytes = await fs.readFile(report.screenshot.path!);
        expect(bytes.equals(Buffer.from(r.screenshotBase64, 'base64'))).toBe(true);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('writes the diff file when the baseline succeeded', async () => {
      const tmp = await mktemp();
      try {
        const diffB64 = png(3, 2);
        const r = fakeResult({ baseline: { url: 'http://b/', width: 3, height: 2, diffPixelCount: 1, totalPixels: 6, diffPercentage: 16.67, diffImageBase64: diffB64 } });
        const report = await writeAuditArtifacts(r, tmp);
        const baseline = report.baseline as Exclude<AuditReportBaseline, { error: string }>;
        expect(baseline.diffPath).not.toBeNull();
        const bytes = await fs.readFile(baseline.diffPath!);
        expect(bytes.equals(Buffer.from(diffB64, 'base64'))).toBe(true);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it('does not create audit-baseline-diff.png in a fresh dir when the baseline errored', async () => {
      const tmp = await mktemp();
      try {
        const r = fakeResult({ baseline: { url: 'http://b/', error: 'boom' } });
        const report = await writeAuditArtifacts(r, tmp);
        expect((report.baseline as { error: string }).error).toBe('boom');
        const exists = await fs
          .access(path.join(tmp, 'audit-baseline-diff.png'))
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(false);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('AR7: relative outDir', () => {
    // vitest runs tests in worker threads, where process.chdir() throws
    // ERR_WORKER_UNSUPPORTED_OPERATION — so this asserts the relative-path resolution contract
    // (path.resolve against the CURRENT process.cwd(), the same thing a real chdir'd process
    // would exercise) without actually changing directories.
    it('resolves to an absolute path inside the current cwd, not left relative', async () => {
      const relName = `fr212-ar7-rel-out-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        const r = fakeResult();
        const report = await writeAuditArtifacts(r, relName);
        expect(path.isAbsolute(report.screenshot.path!)).toBe(true);
        expect(report.screenshot.path!).toBe(path.resolve(process.cwd(), relName, 'audit-screenshot.png'));
      } finally {
        await fs.rm(path.resolve(process.cwd(), relName), { recursive: true, force: true });
      }
    });
  });

  describe('AR8: the schema file is well formed', () => {
    it('has the expected $schema/$id and schemaVersion const', () => {
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema.$id).toBe('urn:sutradhar:audit-report:1');
      expect(schema.properties.schemaVersion.const).toBe(AUDIT_REPORT_SCHEMA_VERSION);
    });
  });

  describe('AR9: schema/example key-set drift guard', () => {
    it('top-level keys match', () => {
      expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE).sort());
      expect([...schema.required].sort()).toEqual(
        Object.keys(AUDIT_REPORT_EXAMPLE)
          .filter((k) => k !== 'dialogPending' && k !== 'dialogsHandled')
          .sort(),
      );
    });

    it('nested object key sets match', () => {
      expect(Object.keys(schema.properties.screenshot.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE.screenshot).sort());
      expect(Object.keys(schema.properties.webVitals.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE.webVitals).sort());
      expect(Object.keys(schema.properties.observation.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE.observation).sort());
      expect(Object.keys(schema.properties.consoleErrors.items.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE.consoleErrors[0]).sort());
      expect(Object.keys(schema.properties.pageErrors.items.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE.pageErrors[0]).sort());
      expect(Object.keys(schema.properties.brokenRequests.items.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE.brokenRequests[0]).sort());
      expect(Object.keys(schema.properties.accessibilityIssues.items.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE.accessibilityIssues[0]).sort());
    });

    it('baseline union arms match the example and the error arm requires exactly url/error', () => {
      const successArm = schema.properties.baseline.oneOf[1];
      expect(Object.keys(successArm.properties).sort()).toEqual(Object.keys(AUDIT_REPORT_EXAMPLE.baseline as object).sort());
      const errorArm = schema.properties.baseline.oneOf[2];
      expect([...errorArm.required].sort()).toEqual(['error', 'url']);
    });
  });

  describe('AR10: scopeToDocument', () => {
    const entries = [
      { timestamp: '2026-01-01T00:00:00.000Z', v: 'a' },
      { timestamp: '2026-01-01T00:00:01.000Z', v: 'b' },
      { timestamp: '2026-01-01T00:00:02.000Z', v: 'c' },
    ];

    it('keeps entries at or after since, keeps all for null, and passes through empty', () => {
      expect(scopeToDocument(entries, '2026-01-01T00:00:01.000Z').map((e) => e.v)).toEqual(['b', 'c']);
      expect(scopeToDocument(entries, null).map((e) => e.v)).toEqual(['a', 'b', 'c']);
      expect(scopeToDocument([], '2026-01-01T00:00:01.000Z')).toEqual([]);
    });
  });

  describe('AR11: computeObservation', () => {
    const T = '2026-01-01T00:00:10.000Z';
    const Tplus100 = new Date(Date.parse(T) + 100).toISOString();
    const Tminus60000 = new Date(Date.parse(T) - 60000).toISOString();
    const Tminus5000 = new Date(Date.parse(T) - 5000).toISOString();

    it('(a) navigated: since = navStartedAt (the min), coversWholeDocument true', () => {
      const { observation, since } = computeObservation({
        mode: 'navigated',
        navStartedAt: T,
        timeOrigin: Date.parse(T) + 100,
        observingSince: Tminus5000,
        pageWasHidden: false,
      });
      expect(since).toBe(T);
      expect(observation.coversWholeDocument).toBe(true);
      expect(observation.documentStartedAt).toBe(Tplus100);
    });

    it('(b) navigated same-document: since = documentStartedAt (the earlier one)', () => {
      const { since } = computeObservation({
        mode: 'navigated',
        navStartedAt: T,
        timeOrigin: Date.parse(T) - 60000,
        observingSince: Tminus5000,
        pageWasHidden: null,
      });
      expect(since).toBe(Tminus60000);
    });

    it('(c) current-page: observingSince later than timeOrigin -> coversWholeDocument false, since = timeOrigin ISO', () => {
      const timeOrigin = Date.parse(T);
      const { observation, since } = computeObservation({
        mode: 'current-page',
        navStartedAt: null,
        timeOrigin,
        observingSince: new Date(timeOrigin + 1000).toISOString(),
        pageWasHidden: false,
      });
      expect(since).toBe(new Date(timeOrigin).toISOString());
      expect(observation.coversWholeDocument).toBe(false);
    });

    it('(d) observingSince null -> coversWholeDocument false', () => {
      const { observation } = computeObservation({
        mode: 'current-page',
        navStartedAt: null,
        timeOrigin: Date.parse(T),
        observingSince: null,
        pageWasHidden: false,
      });
      expect(observation.coversWholeDocument).toBe(false);
    });

    it('(e) timeOrigin null in current-page mode -> since null, coversWholeDocument false', () => {
      const { observation, since } = computeObservation({
        mode: 'current-page',
        navStartedAt: null,
        timeOrigin: null,
        observingSince: Tminus5000,
        pageWasHidden: null,
      });
      expect(since).toBeNull();
      expect(observation.coversWholeDocument).toBe(false);
    });

    it('(f) pageWasHidden passes through true/false/null', () => {
      for (const v of [true, false, null] as const) {
        const { observation } = computeObservation({ mode: 'current-page', navStartedAt: null, timeOrigin: Date.parse(T), observingSince: null, pageWasHidden: v });
        expect(observation.pageWasHidden).toBe(v);
      }
    });
  });
});
