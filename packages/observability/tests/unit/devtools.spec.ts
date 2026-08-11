/**
 * @file packages/observability/tests/unit/devtools.spec.ts
 * @description Unit test suite verifying ExecutionInspector and TraceExporter.
 */

import { ExecutionInspector, TraceExporter } from '../../src/devtools/index.js';

describe('@sutradhar/observability DevTools & Execution Inspector', () => {
  let inspector: ExecutionInspector;

  beforeEach(() => {
    inspector = new ExecutionInspector();
  });

  it('1. should record timeline stages and retrieve timeline list', () => {
    inspector.recordStage({
      id: 's1',
      stageName: 'Goal Received',
      status: 'COMPLETED',
      timestamp: new Date().toISOString(),
      durationMs: 5,
      details: {},
    });

    const timeline = inspector.getTimeline();
    expect(timeline.length).toBe(1);
    expect(timeline[0]?.stageName).toBe('Goal Received');
  });

  it('2. should set goal, planner, task nodes, page, decision, and generate full trace export', () => {
    inspector.setGoalInspection({
      goalId: 'goal_789',
      text: 'Navigate to Docs',
      priority: 10,
      status: 'COMPLETED',
      childGoalIds: [],
      durationMs: 300,
    });

    inspector.setPageInspection({
      pageType: 'Documentation',
      primaryIntent: 'API Reference',
      regionsCount: 2,
      formsCount: 0,
      navigationCount: 1,
      confidence: 0.95,
    });

    const fullExport = inspector.generateFullExport();
    expect(fullExport.goal.goalId).toBe('goal_789');
    expect(fullExport.page.pageType).toBe('Documentation');
    expect(fullExport.decision.recommendation).toBe('EXECUTE');
  });

  it('3. should serialize and deserialize full trace via TraceExporter', () => {
    inspector.setGoalInspection({
      goalId: 'goal_json_1',
      text: 'Json test goal',
      priority: 5,
      status: 'COMPLETED',
      childGoalIds: [],
      durationMs: 200,
    });

    const trace = inspector.generateFullExport();
    const jsonStr = TraceExporter.exportToJson(trace);
    expect(jsonStr).toContain('goal_json_1');

    const restored = TraceExporter.importFromJson(jsonStr);
    expect(restored.goal.text).toBe('Json test goal');
  });
});
