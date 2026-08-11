/**
 * @file packages/memory/src/episodic/episodic-types.ts
 * @description Local structural types used by episodic memory.
 *
 * These intentionally break what would otherwise be a circular dependency
 * (memory ↔ agent). They are structurally compatible with the canonical types
 * defined in @pinchtab/browser (PageType) and @pinchtab/agent (DecisionEvidence),
 * so values of those types flow in without any cast, but this package no longer
 * imports those packages to compile.
 */

/** Structural mirror of @pinchtab/browser PageType. */
export type PageType =
  | 'Authentication'
  | 'Search'
  | 'Dashboard'
  | 'Documentation'
  | 'Repository'
  | 'Article'
  | 'News'
  | 'Shopping'
  | 'Checkout'
  | 'Settings'
  | 'Forms'
  | 'Unknown';

/** Minimal structural shape memory needs from agent's DecisionEvidence. */
export interface DecisionEvidenceLike {
  readonly confidence: number;
  readonly recommendation: string;
  readonly explanation: string;
}
