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
export type { AuditResult, A11yIssue, WebVitals } from './audit/site-audit.js';
export { compareScreenshots, type VisualCompareResult } from './audit/visual-compare.js';
export { type AxNode, type AxSnapshotResult } from './snapshot/ax-snapshot.js';
export type { SettleSpec } from '@sutradhar/browser';
