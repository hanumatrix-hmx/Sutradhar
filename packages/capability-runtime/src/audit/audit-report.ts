/**
 * @file packages/capability-runtime/src/audit/audit-report.ts
 * @description FR2-12: converts the in-memory `AuditResult` (which holds screenshot/diff base64)
 * into the portable, machine-readable `AuditReport` shape — the exact JSON the CLI's `--json`
 * mode, MCP's `browser.audit` (content[0]) and the SDK's `page.audit().report` all return. No
 * key of `AuditReport` ever holds base64: a screenshot is either written to a file (`path`) or
 * (MCP without `outDir`) delivered as a separate binary content item; `AuditReport` only ever
 * records its path (or null) plus width/height/bytes read from the PNG itself.
 *
 * The companion JSON Schema is `packages/capability-runtime/schemas/audit-report.schema.json`
 * (draft-07, `$id: "urn:sutradhar:audit-report:1"`). It's hand-written, not generated from this
 * file, because generating it would need a new `zod` runtime dependency this package doesn't
 * have (see decisions.md's 2026-09-25 FR2-12 entry, point 3). Drift between the two is guarded
 * three ways: `AUDIT_REPORT_EXAMPLE` below is typed `DeepRequired<AuditReport>`, so `tsc` fails
 * the moment the interface gains a key this example doesn't also populate; a unit test
 * (`audit-report.spec.ts`, AR9) asserts the schema's own key sets match this example's; and
 * more unit/live tests validate real audit output against the schema with the JSON Schema
 * validator the MCP SDK already ships (`@modelcontextprotocol/sdk/validation/ajv`).
 */
import path from 'node:path';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import type { AuditResult, AuditObservation, WebVitals, A11yIssue } from './site-audit.js';

export const AUDIT_REPORT_SCHEMA_VERSION = 1 as const;
export const AUDIT_SCREENSHOT_FILE = 'audit-screenshot.png';
export const AUDIT_BASELINE_DIFF_FILE = 'audit-baseline-diff.png';

export interface AuditReportScreenshot {
  /** Absolute OS path of the written PNG; null when not written to disk (MCP delivers it as an
   *  image content item after the JSON; the SDK without `outDir` returns it as screenshotBase64
   *  instead). */
  readonly path: string | null;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly fullPage: true;
}

export type AuditReportBaseline =
  | {
      readonly url: string;
      /** Absolute path of the diff PNG, or null when not written to disk (MCP delivers it as an
       *  image content item). */
      readonly diffPath: string | null;
      readonly width: number;
      readonly height: number;
      readonly diffPixelCount: number;
      readonly totalPixels: number;
      readonly diffPercentage: number;
    }
  | { readonly url: string; readonly error: string };

export interface AuditReport {
  readonly schemaVersion: 1;
  readonly url: string;
  readonly requestedUrl: string | null;
  readonly title: string;
  readonly timestamp: string;
  readonly screenshot: AuditReportScreenshot;
  readonly consoleErrors: AuditResult['consoleErrors'];
  readonly pageErrors: AuditResult['pageErrors'];
  readonly brokenRequests: AuditResult['brokenRequests'];
  readonly accessibilityIssues: readonly A11yIssue[];
  readonly webVitals: WebVitals;
  readonly observation: AuditObservation;
  readonly baseline: AuditReportBaseline | null;
  /** CLI only, present only when FR2-04's dialog reporting has data to add (D2.4). */
  readonly dialogPending?: Record<string, unknown> | null;
  readonly dialogsHandled?: readonly Record<string, unknown>[];
}

/** Recursively makes every property (including nested/array element properties) required —
 *  used only to force `AUDIT_REPORT_EXAMPLE` to populate every key of `AuditReport`, including
 *  its two optional CLI-only keys, so `tsc` catches the moment the interface gains a key this
 *  example doesn't. */
type DeepRequired<T> = T extends readonly (infer U)[]
  ? DeepRequired<U>[]
  : T extends object
    ? { [K in keyof Required<T>]: DeepRequired<T[K]> }
    : T;

/** One fully populated success-baseline example — the drift guard described in the file doc
 *  comment. Not used at runtime except by tests. */
export const AUDIT_REPORT_EXAMPLE: DeepRequired<AuditReport> = {
  schemaVersion: 1,
  url: 'http://127.0.0.1:4173/audit?n=1',
  requestedUrl: 'http://127.0.0.1:4173/audit?n=1',
  title: 'FR2-12 audit example',
  timestamp: '2026-01-01T00:00:00.000Z',
  screenshot: {
    path: 'C:\\tmp\\fr212\\audit-screenshot.png',
    width: 800,
    height: 600,
    bytes: 1024,
    fullPage: true,
  },
  consoleErrors: [{ text: 'example console error', timestamp: '2026-01-01T00:00:00.100Z' }],
  pageErrors: [{ message: 'example page error', timestamp: '2026-01-01T00:00:00.200Z' }],
  brokenRequests: [{ url: 'http://127.0.0.1:4173/missing.png', status: 404 }],
  accessibilityIssues: [{ rule: 'img-alt', description: 'Images missing an alt attribute', count: 1 }],
  webVitals: { lcpMs: 120, cls: 0.02, fcpMs: 90, ttfbMs: 4 },
  observation: {
    mode: 'navigated',
    documentStartedAt: '2026-01-01T00:00:00.050Z',
    observingSince: '2026-01-01T00:00:00.000Z',
    coversWholeDocument: true,
    pageWasHidden: false,
  },
  baseline: {
    url: 'http://127.0.0.1:4173/clean?n=1',
    diffPath: 'C:\\tmp\\fr212\\audit-baseline-diff.png',
    width: 800,
    height: 600,
    diffPixelCount: 10,
    totalPixels: 480000,
    diffPercentage: 0.0021,
  },
  dialogPending: null,
  dialogsHandled: [{}],
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reads a PNG's IHDR chunk for its width/height. Throws `Error('audit screenshot is not a
 *  PNG')` unless bytes 0-7 are the PNG signature and the buffer is at least 24 bytes (8-byte
 *  signature + 4-byte chunk length + 4-byte "IHDR" + 4-byte width + 4-byte height). This makes a
 *  broken capture throw loudly instead of silently reporting `width:0, height:0`. */
export function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24) throw new Error('audit screenshot is not a PNG');
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error('audit screenshot is not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Pure: converts an in-memory `AuditResult` (base64) into the portable `AuditReport` (file
 *  paths or null; never base64). `files.screenshotPath`/`files.diffPath` are supplied by the
 *  caller — `null` when the binary isn't being written to disk (MCP), or the absolute path it
 *  was (or will be) written to (CLI/SDK via `writeAuditArtifacts`). */
export function buildAuditReport(
  r: AuditResult,
  files: { readonly screenshotPath: string | null; readonly diffPath: string | null },
): AuditReport {
  const screenshotBuf = Buffer.from(r.screenshotBase64, 'base64');
  const { width, height } = pngDimensions(screenshotBuf);

  let baseline: AuditReportBaseline | null = null;
  if (r.baseline) {
    if ('error' in r.baseline) {
      baseline = { url: r.baseline.url, error: r.baseline.error };
    } else {
      baseline = {
        url: r.baseline.url,
        diffPath: files.diffPath,
        width: r.baseline.width,
        height: r.baseline.height,
        diffPixelCount: r.baseline.diffPixelCount,
        totalPixels: r.baseline.totalPixels,
        diffPercentage: r.baseline.diffPercentage,
      };
    }
  }

  return {
    schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
    url: r.url,
    requestedUrl: r.requestedUrl,
    title: r.title,
    timestamp: r.timestamp,
    screenshot: { path: files.screenshotPath, width, height, bytes: screenshotBuf.length, fullPage: true },
    consoleErrors: r.consoleErrors,
    pageErrors: r.pageErrors,
    brokenRequests: r.brokenRequests,
    accessibilityIssues: r.accessibilityIssues,
    webVitals: r.webVitals,
    observation: r.observation,
    baseline,
  };
}

/** `mkdir -p outDir`; returns its absolute path. D2.7: called BEFORE any browser session work
 *  (CLI/SDK), so a bad outDir fails fast instead of wasting a whole audit. Throws
 *  `Error('Cannot create audit output directory "<abs>": <reason>')` when `outDir` already
 *  exists as a non-directory (e.g. a plain file), or the underlying `mkdir` fails for any other
 *  reason (e.g. permissions). Idempotent: calling it again on the same, already-created path
 *  succeeds. */
export async function prepareAuditOutDir(outDir: string): Promise<string> {
  const abs = path.resolve(outDir);
  const existing = await stat(abs).catch(() => undefined);
  if (existing && !existing.isDirectory()) {
    throw new Error(`Cannot create audit output directory "${abs}": path exists and is not a directory`);
  }
  try {
    await mkdir(abs, { recursive: true });
  } catch (e) {
    const reason = (e as NodeJS.ErrnoException).code ?? (e as Error).message ?? String(e);
    throw new Error(`Cannot create audit output directory "${abs}": ${reason}`);
  }
  return abs;
}

/** `prepareAuditOutDir` + writes the screenshot (and, when the baseline succeeded, the diff PNG)
 *  into it; returns the report with absolute file paths. Used by the CLI and the SDK's
 *  `page.audit({outDir})` — MCP never calls this (no filesystem guarantee on a stdio server; see
 *  decisions.md's FR2-12 entry, point 2). */
export async function writeAuditArtifacts(r: AuditResult, outDir: string): Promise<AuditReport> {
  const dir = await prepareAuditOutDir(outDir);
  const screenshotPath = path.join(dir, AUDIT_SCREENSHOT_FILE);
  await writeFile(screenshotPath, Buffer.from(r.screenshotBase64, 'base64'));

  let diffPath: string | null = null;
  if (r.baseline && 'diffImageBase64' in r.baseline) {
    diffPath = path.join(dir, AUDIT_BASELINE_DIFF_FILE);
    await writeFile(diffPath, Buffer.from(r.baseline.diffImageBase64, 'base64'));
  }

  return buildAuditReport(r, { screenshotPath, diffPath });
}
