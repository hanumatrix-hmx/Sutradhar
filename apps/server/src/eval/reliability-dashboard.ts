/**
 * @file apps/server/src/eval/reliability-dashboard.ts
 * @description Reliability Dashboard generator formatting benchmark evaluation statistics into reports.
 */

import { TaskEvaluationResult } from './evaluation-framework.js';

export interface CategoryMetric {
  readonly category: string;
  readonly total: number;
  readonly passed: number;
  readonly successRate: number;
}

export interface ReliabilityReportData {
  readonly totalTasks: number;
  readonly passedTasks: number;
  readonly failedTasks: number;
  readonly overallSuccessRate: number;
  readonly avgDurationMs: number;
  readonly avgPlanningTimeMs: number;
  readonly avgLlmLatencyMs: number;
  readonly categoryMetrics: readonly CategoryMetric[];
  readonly failureDistribution: Record<string, number>;
  readonly topFailures: readonly { taskId: string; title: string; reason: string }[];
}

export class ReliabilityDashboard {
  public static computeReport(results: readonly TaskEvaluationResult[]): ReliabilityReportData {
    const totalTasks = results.length;
    const passedTasks = results.filter((r) => r.success).length;
    const failedTasks = totalTasks - passedTasks;
    const overallSuccessRate = totalTasks > 0 ? (passedTasks / totalTasks) * 100 : 0;

    const totalDuration = results.reduce((acc, r) => acc + r.durationMs, 0);
    const avgDurationMs = totalTasks > 0 ? totalDuration / totalTasks : 0;

    const totalPlanning = results.reduce((acc, r) => acc + r.planningTimeMs, 0);
    const avgPlanningTimeMs = totalTasks > 0 ? totalPlanning / totalTasks : 0;

    const totalLlm = results.reduce((acc, r) => acc + r.llmLatencyMs, 0);
    const avgLlmLatencyMs = totalTasks > 0 ? totalLlm / totalTasks : 0;

    // Per-category metrics
    const categoryMap = new Map<string, { total: number; passed: number }>();
    for (const r of results) {
      const stats = categoryMap.get(r.category) ?? { total: 0, passed: 0 };
      stats.total++;
      if (r.success) stats.passed++;
      categoryMap.set(r.category, stats);
    }

    const categoryMetrics: CategoryMetric[] = Array.from(categoryMap.entries()).map(
      ([cat, stats]) => ({
        category: cat,
        total: stats.total,
        passed: stats.passed,
        successRate: (stats.passed / stats.total) * 100,
      }),
    );

    // Failure distribution
    const failureDistribution: Record<string, number> = {};
    const topFailures: { taskId: string; title: string; reason: string }[] = [];

    for (const r of results) {
      if (!r.success && r.failureCategory) {
        failureDistribution[r.failureCategory] = (failureDistribution[r.failureCategory] ?? 0) + 1;
        topFailures.push({
          taskId: r.taskId,
          title: r.title,
          reason: r.failureReason ?? 'Unknown error',
        });
      }
    }

    return {
      totalTasks,
      passedTasks,
      failedTasks,
      overallSuccessRate,
      avgDurationMs,
      avgPlanningTimeMs,
      avgLlmLatencyMs,
      categoryMetrics,
      failureDistribution,
      topFailures: topFailures.slice(0, 20),
    };
  }

  public static renderMarkdownReport(data: ReliabilityReportData): string {
    return `
# PinchTab Agent Evaluation & Reliability Report

## Overall Autonomous Task Execution Metric
- **Total Tasks Evaluated**: ${data.totalTasks}
- **Passed Tasks**: ${data.passedTasks}
- **Failed Tasks**: ${data.failedTasks}
- **Autonomous Success Rate**: **${data.overallSuccessRate.toFixed(1)}%**
- **Average Task Duration**: ${(data.avgDurationMs / 1000).toFixed(2)} seconds
- **Average Planning Latency**: ${data.avgPlanningTimeMs.toFixed(0)} ms
- **Average LLM Latency**: ${data.avgLlmLatencyMs.toFixed(0)} ms

---

## Category Success Breakdown

| Category | Tasks Evaluated | Passed | Success Rate |
| :--- | :--- | :--- | :--- |
${data.categoryMetrics.map((m) => `| **${m.category}** | ${m.total} | ${m.passed} | **${m.successRate.toFixed(1)}%** |`).join('\n')}

---

## Failure Distribution

${
  Object.entries(data.failureDistribution)
    .map(([cat, count]) => `- **${cat}**: ${count} failures`)
    .join('\n') || 'No task failures recorded! 100% clean benchmark run.'
}

---

## Top Failure Records

${
  data.topFailures.length > 0
    ? data.topFailures
        .map((f, i) => `${i + 1}. **[${f.taskId}] ${f.title}**: ${f.reason}`)
        .join('\n')
    : 'None.'
}

---

## Strategic Recommendations for Next Benchmark Iteration

1. **LLM Reasoning Optimization**: Fine-tune prompt compiler context truncation to reduce latency on complex 4-step goals.
2. **DOM Ambiguity Heuristics**: Expand element graph confidence scoring for pages with dense interactive controls.
`;
  }
}
