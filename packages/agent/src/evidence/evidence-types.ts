/**
 * @file packages/agent/src/evidence/evidence-types.ts
 * @description Evidence factors, penalty models, and DecisionEvidence recommendations for Decision Evidence Engine.
 */

import { ElementCandidate } from '@pinchtab/browser';

export type EvidenceFactorType =
  | 'semantic_similarity'
  | 'role_matching'
  | 'accessible_name'
  | 'label_matching'
  | 'placeholder_matching'
  | 'visibility'
  | 'enabled_state'
  | 'verification_history';

export type PenaltyFactorType =
  | 'hidden_element_penalty'
  | 'disabled_element_penalty'
  | 'recovery_attempt_penalty'
  | 'ambiguous_candidate_penalty';

export type DecisionRecommendation =
  | 'EXECUTE'
  | 'VERIFY_FIRST'
  | 'COLLECT_MORE_INFORMATION'
  | 'RECOVER'
  | 'REPLAN'
  | 'REJECT';

export interface EvidenceFactor {
  readonly type: EvidenceFactorType;
  readonly scoreContribution: number;
  readonly description: string;
}

export interface PenaltyFactor {
  readonly type: PenaltyFactorType;
  readonly penaltyDeduction: number;
  readonly description: string;
}

export interface DecisionEvidence {
  readonly candidate?: ElementCandidate;
  readonly confidence: number;
  readonly evidence: readonly EvidenceFactor[];
  readonly penalties: readonly PenaltyFactor[];
  readonly recommendation: DecisionRecommendation;
  readonly explanation: string;
}
