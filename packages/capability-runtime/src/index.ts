/**
 * @file packages/capability-runtime/src/index.ts
 * @description Package entry point for @sutradhar/capability-runtime.
 *
 * The single high-level façade over the Sutradhar browser engine. Every integration
 * surface (MCP server, npm SDK, plugins, extension) composes {@link SutradharRuntime}
 * rather than duplicating browser logic.
 */

export const CAPABILITY_RUNTIME_VERSION = '0.1.0';

export * from './types.js';
export * from './runtime.js';
export { ProfileManager, type ProfileInfo } from './profiles/profile-manager.js';
export type { AuditResult, A11yIssue, WebVitals, AuditObservation, AuditBaselineOutcome } from './audit/site-audit.js';
export { compareScreenshots, type VisualCompareResult } from './audit/visual-compare.js';
export {
  AUDIT_REPORT_SCHEMA_VERSION,
  AUDIT_SCREENSHOT_FILE,
  AUDIT_BASELINE_DIFF_FILE,
  buildAuditReport,
  prepareAuditOutDir,
  writeAuditArtifacts,
  pngDimensions,
  AUDIT_REPORT_EXAMPLE,
  type AuditReport,
  type AuditReportScreenshot,
  type AuditReportBaseline,
} from './audit/audit-report.js';
export { type AxNode, type AxSnapshotResult } from './snapshot/ax-snapshot.js';
export type { SettleSpec, WaitForSelectorState } from '@sutradhar/browser';
