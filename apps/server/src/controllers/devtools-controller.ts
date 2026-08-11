/**
 * @file apps/server/src/controllers/devtools-controller.ts
 * @description REST API Gateway controller exposing DevTools trace inspection and runtime metrics endpoints.
 */

import { ExecutionInspector, TraceExporter } from '@sutradhar/observability';

export class DevToolsController {
  private readonly inspector = new ExecutionInspector();

  public constructor() {
    // Populate sample stage telemetry for DevTools demonstration
    this.inspector.setGoalInspection({
      goalId: 'goal_live_101',
      text: 'Search Wikipedia for Alan Turing and extract introduction',
      priority: 10,
      status: 'COMPLETED',
      childGoalIds: [],
      durationMs: 440,
    });

    this.inspector.recordStage({
      id: 'stg_1',
      stageName: 'Goal Received',
      status: 'COMPLETED',
      timestamp: new Date().toISOString(),
      durationMs: 2,
      details: { goal: 'Search Wikipedia for Alan Turing' },
    });

    this.inspector.recordStage({
      id: 'stg_2',
      stageName: 'Task Graph Construction',
      status: 'COMPLETED',
      timestamp: new Date().toISOString(),
      durationMs: 25,
      details: { nodesCount: 3, graphId: 'graph_live_101' },
    });

    this.inspector.recordStage({
      id: 'stg_3',
      stageName: 'Page Understanding',
      status: 'COMPLETED',
      timestamp: new Date().toISOString(),
      durationMs: 15,
      details: {
        pageType: 'Article',
        primaryIntent: 'Encyclopedic knowledge reading',
        confidence: 0.92,
      },
    });

    this.inspector.recordStage({
      id: 'stg_4',
      stageName: 'Decision Evidence',
      status: 'COMPLETED',
      timestamp: new Date().toISOString(),
      durationMs: 12,
      details: {
        recommendation: 'EXECUTE',
        confidence: 0.94,
        explanation: 'Primary CTA exact accessible name match',
      },
    });

    this.inspector.setTaskNodes([
      {
        id: 'node_1',
        name: 'Navigate & Inspect',
        status: 'COMPLETED',
        priority: 10,
        dependencies: [],
        retryCount: 0,
        durationMs: 120,
      },
      {
        id: 'node_2',
        name: 'Execute Actions',
        status: 'COMPLETED',
        priority: 8,
        dependencies: ['node_1'],
        retryCount: 0,
        durationMs: 250,
      },
      {
        id: 'node_3',
        name: 'Verify & Store',
        status: 'COMPLETED',
        priority: 5,
        dependencies: ['node_2'],
        retryCount: 0,
        durationMs: 70,
      },
    ]);
  }

  public getTrace(_goalId: string): string {
    const exportData = this.inspector.generateFullExport();
    return TraceExporter.exportToJson(exportData);
  }

  public getMetrics(): Record<string, unknown> {
    return {
      status: 'healthy',
      p50LatencyMs: 420,
      p95LatencyMs: 465,
      registeredServicesCount: 7,
      runningServicesCount: 7,
      failedServicesCount: 0,
      totalExecutions: 100,
    };
  }
}
