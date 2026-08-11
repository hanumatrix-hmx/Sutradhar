/**
 * @file apps/server/src/controllers/studio-controller.ts
 * @description REST API Gateway controller exposing Sutradhar Studio endpoints for replay, diffing, chaos testing, and profiling.
 */

import {
  ExecutionInspector,
  StudioEngine,
  DecisionDiffer,
  FailureLab,
  DatasetRecorder,
} from '@sutradhar/observability';

export class StudioController {
  private readonly inspector = new ExecutionInspector();

  public constructor() {
    this.inspector.setGoalInspection({
      goalId: 'goal_studio_101',
      text: 'Sutradhar Studio Benchmark Session',
      priority: 10,
      status: 'COMPLETED',
      childGoalIds: [],
      durationMs: 420,
    });
  }

  public getReplayFrames(): Record<string, unknown> {
    const trace = this.inspector.generateFullExport();
    const frames = StudioEngine.extractReplayFrames(trace);
    return { goalId: trace.goal.goalId, totalFrames: frames.length, frames };
  }

  public getDecisionDiff(traceBJson?: string): Record<string, unknown> {
    const traceA = this.inspector.generateFullExport();
    const traceB = traceBJson ? JSON.parse(traceBJson) : traceA;
    const diff = DecisionDiffer.compareTraces(traceA, traceB);
    return { diff };
  }

  public runChaosTest(failureType = 'popup'): Record<string, unknown> {
    const result = FailureLab.runChaosExperiment(failureType);
    return { chaosExperiment: result };
  }

  public recordDataset(): Record<string, unknown> {
    const trace = this.inspector.generateFullExport();
    const dataset = DatasetRecorder.recordDataset(trace);
    return { dataset };
  }

  public getPerformanceProfile(): Record<string, unknown> {
    const trace = this.inspector.generateFullExport();
    const profile = StudioEngine.generatePerformanceProfile(trace);
    return { profile };
  }
}
