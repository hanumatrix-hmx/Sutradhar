/**
 * @file packages/memory/src/episodic/episode-model.ts
 * @description Episode and Lesson models for Episodic Execution Memory.
 */

import { PageType, DecisionEvidenceLike } from './episodic-types.js';

export type EpisodeOutcome = 'success' | 'failure' | 'abandoned';

export interface Episode {
  readonly id: string;
  readonly goal: string;
  readonly pageType: PageType;
  readonly taskGraphId: string;
  readonly actions: readonly string[];
  readonly decisionEvidence: readonly DecisionEvidenceLike[];
  readonly recoveries: readonly string[];
  outcome: EpisodeOutcome;
  duration: number;
  readonly timestamp: string;
  lessonsLearned: readonly string[];
}

export interface EpisodeFilter {
  readonly pageType?: PageType;
  readonly goal?: string;
  readonly outcome?: EpisodeOutcome;
}
