/**
 * @file packages/agent/src/executor/reflection-engine.ts
 * @description ReflectionEngine evaluating step execution outcomes, detecting stuck loops, and offering feedback.
 */

import { AgentStepDto } from '@pinchtab/contracts';
import { StructuredLogger } from '@pinchtab/observability';

export interface ReflectionResult {
  readonly isSuccessful: boolean;
  readonly isStuck: boolean;
  readonly feedback: string;
  readonly suggestedAction?: string;
}

export class ReflectionEngine {
  private readonly logger: StructuredLogger;

  public constructor(logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  /**
   * Evaluates executed step and step history to determine success or loop detection.
   */
  public evaluateStep(
    currentStep: AgentStepDto,
    history: readonly AgentStepDto[] = [],
  ): ReflectionResult {
    // Detect repeated identical actions
    const recentIdentical = history.filter(
      (s) => s.actionName === currentStep.actionName && s.observation === currentStep.observation,
    );

    const isStuck = recentIdentical.length >= 2;

    if (isStuck) {
      this.logger.warn(
        `[ReflectionEngine] Detected stuck state loop for action ${currentStep.actionName}`,
      );
      return {
        isSuccessful: false,
        isStuck: true,
        feedback: `Stuck loop detected: action ${currentStep.actionName} executed repeatedly without progress`,
        suggestedAction: 'replan_or_refresh',
      };
    }

    const isSuccessful = currentStep.isVerified ?? true;
    return {
      isSuccessful,
      isStuck: false,
      feedback: isSuccessful
        ? `Step ${currentStep.stepNumber} verified successfully`
        : `Step ${currentStep.stepNumber} execution unverified`,
    };
  }
}
