/**
 * @file packages/agent/src/recovery/recovery-engine.ts
 * @description RecoveryEngine providing automated candidate fallback and recovery heuristics consuming DecisionEvidence context.
 */

import { StructuredLogger } from '@sutradhar/observability';
import {
  BrowserActionEngine,
  DOMSemanticEngine,
  IBrowserTab,
  BrowserSkillsLibrary,
} from '@sutradhar/browser';
import { DecisionEvidence } from '../evidence/evidence-types.js';

export type FailureReason =
  | 'element_disappeared'
  | 'selector_invalid'
  | 'popup_blocking'
  | 'navigation_timeout'
  | 'stale_element'
  | 'browser_crash'
  | 'low_confidence';

export interface RecoveryStrategyResult {
  readonly recovered: boolean;
  readonly strategyName: string;
  readonly message: string;
  readonly selectedCandidateName?: string;
  readonly candidateConfidence?: number;
  readonly decisionEvidence?: DecisionEvidence;
}

export class RecoveryEngine {
  private readonly actionEngine: BrowserActionEngine;
  private readonly semanticEngine: DOMSemanticEngine;
  private readonly skillsLibrary: BrowserSkillsLibrary;
  private readonly logger: StructuredLogger;

  public constructor(
    actionEngine?: BrowserActionEngine,
    semanticEngine?: DOMSemanticEngine,
    logger?: StructuredLogger,
  ) {
    this.actionEngine = actionEngine ?? new BrowserActionEngine();
    this.semanticEngine = semanticEngine ?? new DOMSemanticEngine();
    this.skillsLibrary = new BrowserSkillsLibrary(this.actionEngine, this.semanticEngine);
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async attemptRecovery(
    failure: FailureReason,
    tab: IBrowserTab,
    targetTextOrSelector?: string,
    evidenceContext?: DecisionEvidence,
  ): Promise<RecoveryStrategyResult> {
    this.logger.warn(`[RecoveryEngine] Attempting recovery for failure reason: ${failure}`, {
      url: tab.url,
      targetTextOrSelector,
      evidenceConfidence: evidenceContext?.confidence,
    });

    switch (failure) {
      case 'element_disappeared':
      case 'selector_invalid':
      case 'low_confidence': {
        const graph = await this.semanticEngine.buildGraph(tab);
        const matchResult = targetTextOrSelector
          ? graph.findCandidatesByText(targetTextOrSelector)
          : undefined;

        if (matchResult && matchResult.candidate) {
          const topCandidate = matchResult.candidate;
          await this.actionEngine.executeAction(tab, {
            actionType: 'click_by_text',
            text: topCandidate.accessibleName ?? targetTextOrSelector!,
          });
          return {
            recovered: true,
            strategyName: 'CandidateFallbackRanking',
            selectedCandidateName: topCandidate.accessibleName,
            candidateConfidence: topCandidate.confidence,
            decisionEvidence: evidenceContext,
            message: `Evaluated ${matchResult.alternatives.length + 1} candidates; selected candidate "${topCandidate.accessibleName}" (confidence: ${topCandidate.confidence.toFixed(2)})`,
          };
        }

        return {
          recovered: false,
          strategyName: 'CandidateFallbackRanking',
          decisionEvidence: evidenceContext,
          message: 'No suitable element candidate found on current page',
        };
      }

      case 'popup_blocking': {
        const res = await this.skillsLibrary.dismissPopup(tab);
        return {
          recovered: res.success,
          strategyName: 'DismissPopupSkill',
          decisionEvidence: evidenceContext,
          message: res.success ? 'Dismissed blocking modal popup' : 'No popup close button found',
        };
      }

      case 'navigation_timeout': {
        await this.actionEngine.executeAction(tab, {
          actionType: 'navigate',
          url: tab.url,
        });
        return {
          recovered: true,
          strategyName: 'PageRefreshRetry',
          decisionEvidence: evidenceContext,
          message: `Refreshed page URL ${tab.url}`,
        };
      }

      case 'stale_element': {
        await this.semanticEngine.buildGraph(tab);
        return {
          recovered: true,
          strategyName: 'RefreshSnapshot',
          decisionEvidence: evidenceContext,
          message: 'Refreshed DOM semantic element graph snapshot',
        };
      }

      case 'browser_crash': {
        return {
          recovered: false,
          strategyName: 'RestartSessionRequired',
          decisionEvidence: evidenceContext,
          message: 'Browser process crashed; session restart required',
        };
      }

      default:
        return {
          recovered: false,
          strategyName: 'Unknown',
          decisionEvidence: evidenceContext,
          message: `No recovery handler for failure ${failure}`,
        };
    }
  }
}
