/**
 * @file packages/agent/src/evidence/decision-evidence-engine.ts
 * @description DecisionEvidenceEngine aggregating positive evidence, applying penalties, and recommending actions consuming PageModel context.
 */

import { CandidateMatchResult, PageModel } from '@pinchtab/browser';
import {
  DecisionEvidence,
  DecisionRecommendation,
  EvidenceFactor,
  PenaltyFactor,
} from './evidence-types.js';

export interface DecisionOptions {
  readonly recoveryAttemptsCount?: number;
  readonly previousVerificationSuccess?: boolean;
  readonly pageModel?: PageModel;
}

export class DecisionEvidenceEngine {
  public evaluateCandidate(
    matchResult: CandidateMatchResult,
    options: DecisionOptions = {},
  ): DecisionEvidence {
    const candidate = matchResult.candidate;

    if (!candidate) {
      return {
        confidence: 0,
        evidence: [],
        penalties: [
          {
            type: 'ambiguous_candidate_penalty',
            penaltyDeduction: 1.0,
            description: 'No candidate element found for target query',
          },
        ],
        recommendation: 'REPLAN',
        explanation: 'Confidence 0.00: No element candidate found. Recommended action: REPLAN.',
      };
    }

    const evidence: EvidenceFactor[] = [];
    const penalties: PenaltyFactor[] = [];
    let score = 0;

    // 1. Evaluate positive evidence factors
    if (candidate.matchingStrategy === 'exact_accessible_name') {
      score += 0.45;
      evidence.push({
        type: 'accessible_name',
        scoreContribution: 0.45,
        description: `Exact accessible name match: "${candidate.accessibleName}"`,
      });
    } else if (candidate.matchingStrategy === 'partial_text') {
      score += 0.28;
      evidence.push({
        type: 'semantic_similarity',
        scoreContribution: 0.28,
        description: `Partial text match: "${candidate.accessibleName}"`,
      });
    } else if (candidate.matchingStrategy === 'label_attribute') {
      score += 0.38;
      evidence.push({
        type: 'label_matching',
        scoreContribution: 0.38,
        description: `Input label match`,
      });
    }

    if (candidate.role) {
      score += 0.18;
      evidence.push({
        type: 'role_matching',
        scoreContribution: 0.18,
        description: `Role match: ${candidate.role}`,
      });
    }

    if (candidate.node.isVisible) {
      score += 0.22;
      evidence.push({
        type: 'visibility',
        scoreContribution: 0.22,
        description: 'Element is visible in layout bounding box',
      });
    }

    if (candidate.node.isEnabled) {
      score += 0.08;
      evidence.push({
        type: 'enabled_state',
        scoreContribution: 0.08,
        description: 'Element control is enabled',
      });
    }

    if (options.previousVerificationSuccess) {
      score += 0.04;
      evidence.push({
        type: 'verification_history',
        scoreContribution: 0.04,
        description: 'Previous step verification succeeded',
      });
    }

    // PageModel contextual evidence boost
    if (options.pageModel) {
      if (options.pageModel.primaryAction?.accessibleName === candidate.accessibleName) {
        score += 0.15;
        evidence.push({
          type: 'role_matching',
          scoreContribution: 0.15,
          description: `Candidate matches primary CTA for page type "${options.pageModel.pageType}"`,
        });
      }
    }

    // 2. Evaluate negative penalty factors
    if (!candidate.node.isVisible) {
      score -= 0.5;
      penalties.push({
        type: 'hidden_element_penalty',
        penaltyDeduction: 0.5,
        description: 'Element is hidden (0 width/height bounding box)',
      });
    }

    if (!candidate.node.isEnabled) {
      score -= 0.3;
      penalties.push({
        type: 'disabled_element_penalty',
        penaltyDeduction: 0.3,
        description: 'Element control is disabled',
      });
    }

    if (options.recoveryAttemptsCount && options.recoveryAttemptsCount > 0) {
      const deduction = Math.min(0.25, options.recoveryAttemptsCount * 0.1);
      score -= deduction;
      penalties.push({
        type: 'recovery_attempt_penalty',
        penaltyDeduction: deduction,
        description: `Recovery penalty applied (${options.recoveryAttemptsCount} prior recovery attempts)`,
      });
    }

    if (matchResult.alternatives.length > 3) {
      score -= 0.15;
      penalties.push({
        type: 'ambiguous_candidate_penalty',
        penaltyDeduction: 0.15,
        description: `Ambiguity penalty (${matchResult.alternatives.length} competing candidates)`,
      });
    }

    const confidence = Math.max(0, Math.min(1.0, score));

    // 3. Determine recommendation
    let recommendation: DecisionRecommendation = 'EXECUTE';
    if (!candidate.node.isVisible || !candidate.node.isEnabled) {
      recommendation = 'RECOVER';
    } else if (confidence >= 0.88) {
      recommendation = 'EXECUTE';
    } else if (confidence >= 0.7) {
      recommendation = 'VERIFY_FIRST';
    } else if (confidence >= 0.45) {
      recommendation = 'COLLECT_MORE_INFORMATION';
    } else {
      recommendation = 'REJECT';
    }

    // 4. Generate explainability output
    const posLines = evidence.map(
      (e) => `  + [${e.type}] +${e.scoreContribution.toFixed(2)}: ${e.description}`,
    );
    const negLines = penalties.map(
      (p) => `  - [${p.type}] -${p.penaltyDeduction.toFixed(2)}: ${p.description}`,
    );

    const explanation = [
      `Decision Evidence Confidence: ${confidence.toFixed(2)} -> Recommendation: ${recommendation}`,
      `Positive Factors (${evidence.length}):`,
      ...posLines,
      `Penalties (${penalties.length}):`,
      ...negLines,
    ].join('\n');

    return {
      candidate,
      confidence,
      evidence,
      penalties,
      recommendation,
      explanation,
    };
  }
}
