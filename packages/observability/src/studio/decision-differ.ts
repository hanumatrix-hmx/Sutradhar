/**
 * @file packages/observability/src/studio/decision-differ.ts
 * @description DecisionDiffer performing side-by-side comparison of execution traces for regression analysis.
 */

import { FullTraceExport } from '../devtools/devtools-models.js';
import { DecisionDiffResult } from './studio-models.js';

export class DecisionDiffer {
  public static compareTraces(
    traceA: FullTraceExport,
    traceB: FullTraceExport,
  ): DecisionDiffResult {
    const planIdentical = traceA.planner.planId === traceB.planner.planId;
    const confidenceDelta = traceB.decision.confidence - traceA.decision.confidence;

    const totalDurA = traceA.timeline.reduce((sum, t) => sum + t.durationMs, 0);
    const totalDurB = traceB.timeline.reduce((sum, t) => sum + t.durationMs, 0);
    const latencyDeltaMs = totalDurB - totalDurA;

    const recoveryPathsMatch = traceA.recovery.strategyName === traceB.recovery.strategyName;
    const outcomeMatch = traceA.goal.status === traceB.goal.status;

    const diffSummary = [
      `Decision Diff Analysis (${traceA.goal.goalId} vs ${traceB.goal.goalId}):`,
      `- Confidence Delta: ${confidenceDelta >= 0 ? '+' : ''}${confidenceDelta.toFixed(2)}`,
      `- Latency Delta: ${latencyDeltaMs >= 0 ? '+' : ''}${latencyDeltaMs}ms`,
      `- Recovery Strategies Match: ${recoveryPathsMatch}`,
      `- Outcome Match: ${outcomeMatch}`,
    ].join('\n');

    return {
      traceAId: traceA.goal.goalId,
      traceBId: traceB.goal.goalId,
      planIdentical,
      confidenceDelta,
      latencyDeltaMs,
      recoveryPathsMatch,
      outcomeMatch,
      diffSummary,
    };
  }
}
