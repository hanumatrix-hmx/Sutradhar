/**
 * @file packages/browser/src/dom/element-candidate.ts
 * @description ElementCandidate model and CandidateMatchResult definitions for confidence-aware matching.
 */

import { SemanticNode } from './semantic-element-graph.js';

export type MatchingStrategy =
  | 'exact_accessible_name'
  | 'partial_text'
  | 'role_match'
  | 'label_attribute'
  | 'placeholder_match'
  | 'nearby_text_match';

export interface ElementCandidate {
  readonly node: SemanticNode;
  readonly selector: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly confidence: number;
  readonly evidence: string;
  readonly matchingStrategy: MatchingStrategy;
}

export interface CandidateMatchResult {
  readonly candidate?: ElementCandidate;
  readonly alternatives: readonly ElementCandidate[];
  readonly confidence: number;
  readonly reasoning: string;
}
