/**
 * @file packages/observability/tests/unit/studio.spec.ts
 * @description Unit test suite verifying Sutradhar Studio modules (replay, decision diff, failure lab, dataset recorder, profiler).
 */

import {
  ExecutionInspector,
  StudioEngine,
  DecisionDiffer,
  FailureLab,
  DatasetRecorder,
} from '../../src/index.js';

describe('@sutradhar/observability Sutradhar Studio Engineering Suite', () => {
  let inspector: ExecutionInspector;

  beforeEach(() => {
    inspector = new ExecutionInspector();
    inspector.setGoalInspection({
      goalId: 'goal_studio_test_1',
      text: 'Studio test goal',
      priority: 10,
      status: 'COMPLETED',
      childGoalIds: [],
      durationMs: 400,
    });
  });

  it('1. should extract replay frames from full trace export', () => {
    const trace = inspector.generateFullExport();
    const frames = StudioEngine.extractReplayFrames(trace);
    expect(Array.isArray(frames)).toBe(true);
  });

  it('2. should compare two execution traces side-by-side using DecisionDiffer', () => {
    const traceA = inspector.generateFullExport();
    const traceB = inspector.generateFullExport();

    const diff = DecisionDiffer.compareTraces(traceA, traceB);
    expect(diff.planIdentical).toBe(true);
    expect(diff.outcomeMatch).toBe(true);
    expect(diff.diffSummary).toContain('Decision Diff Analysis');
  });

  it('3. should execute failure lab chaos experiments and verify automated recovery', () => {
    const experiment = FailureLab.runChaosExperiment('popup');
    expect(experiment.recoveredSuccessfully).toBe(true);
    expect(experiment.recoveryStrategy).toBe('DismissPopupSkill');
  });

  it('4. should record and export dataset via DatasetRecorder', () => {
    const trace = inspector.generateFullExport();
    const dataset = DatasetRecorder.recordDataset(trace);
    expect(dataset.groundTruthOutcome).toBe('COMPLETED');

    const jsonStr = DatasetRecorder.exportDatasetToJson(dataset);
    expect(jsonStr).toContain('Studio test goal');
  });

  it('5. should generate performance profiles and memory graph views', () => {
    const trace = inspector.generateFullExport();
    const profile = StudioEngine.generatePerformanceProfile(trace);
    expect(profile.totalDurationMs).toBeGreaterThanOrEqual(0);

    const memView = StudioEngine.getMemoryGraphView(trace);
    expect(memView.nodes.length).toBeGreaterThan(0);
  });
});
