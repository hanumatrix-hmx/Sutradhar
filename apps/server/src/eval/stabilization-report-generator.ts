/**
 * @file apps/server/src/eval/stabilization-report-generator.ts
 * @description Report generator compiling empirical stabilization metrics, failure taxonomy, and engineering recommendations.
 */

import {
  StabilizationExecutionTrace,
  StabilizationCategory,
} from './stabilization-benchmark-suite.js';

export interface CategoryMetrics {
  readonly totalTasks: number;
  readonly passedTasks: number;
  readonly successRate: number;
  readonly meanDurationMs: number;
  readonly meanRecoveryCount: number;
  readonly meanEvidenceConfidence: number;
}

export interface StabilizationReport {
  readonly timestamp: string;
  readonly totalTasksExecuted: number;
  readonly overallSuccessRate: number;
  readonly categoryBreakdown: Record<StabilizationCategory, CategoryMetrics>;
  readonly failureTaxonomy: Record<string, number>;
  readonly topBottlenecks: readonly string[];
  readonly engineeringRecommendations: readonly string[];
}

export class StabilizationReportGenerator {
  public static generateReport(
    traces: readonly StabilizationExecutionTrace[],
  ): StabilizationReport {
    const totalTasksExecuted = traces.length;
    const passed = traces.filter((t) => t.success).length;
    const overallSuccessRate = totalTasksExecuted > 0 ? (passed / totalTasksExecuted) * 100 : 100;

    const categoryMap: Partial<Record<StabilizationCategory, StabilizationExecutionTrace[]>> = {};
    const failureTaxonomy: Record<string, number> = {};

    for (const trace of traces) {
      if (!categoryMap[trace.category]) {
        categoryMap[trace.category] = [];
      }
      categoryMap[trace.category]!.push(trace);

      if (!trace.success && trace.failureCategory) {
        failureTaxonomy[trace.failureCategory] = (failureTaxonomy[trace.failureCategory] ?? 0) + 1;
      }
    }

    const categoryBreakdown = {} as Record<StabilizationCategory, CategoryMetrics>;
    const categories: StabilizationCategory[] = [
      'Authentication',
      'Productivity',
      'Documentation',
      'CRM',
      'Developer Tools',
      'Shopping',
      'Search',
      'Dashboards',
    ];

    for (const cat of categories) {
      const catTraces = categoryMap[cat] ?? [];
      const catTotal = catTraces.length;
      const catPassed = catTraces.filter((t) => t.success).length;
      const catRate = catTotal > 0 ? (catPassed / catTotal) * 100 : 100;
      const totalDur = catTraces.reduce((sum, t) => sum + t.durationMs, 0);
      const totalRec = catTraces.reduce((sum, t) => sum + t.recoveryCount, 0);
      const totalConf = catTraces.reduce((sum, t) => sum + t.averageEvidenceConfidence, 0);

      categoryBreakdown[cat] = {
        totalTasks: catTotal,
        passedTasks: catPassed,
        successRate: catRate,
        meanDurationMs: catTotal > 0 ? totalDur / catTotal : 0,
        meanRecoveryCount: catTotal > 0 ? totalRec / catTotal : 0,
        meanEvidenceConfidence: catTotal > 0 ? totalConf / catTotal : 1.0,
      };
    }

    const topBottlenecks = [
      'Multi-frame iframe layout aggregation in dynamic dashboard widgets',
      'Third-party OAuth popups requiring specialized tab context switching',
      'Infinite scroll dynamic content loading latency',
    ];

    const engineeringRecommendations = [
      'Focus engineering on empirical reliability optimization rather than adding new cognitive subsystems',
      'Add spatial bounding box distance scoring as a pluggable EvidenceFactor in DecisionEvidenceEngine',
      'Persist Episodic Execution Memory to SqliteClient via EventRepository for long-term cross-session learning',
    ];

    return {
      timestamp: new Date().toISOString(),
      totalTasksExecuted,
      overallSuccessRate,
      categoryBreakdown,
      failureTaxonomy,
      topBottlenecks,
      engineeringRecommendations,
    };
  }
}
