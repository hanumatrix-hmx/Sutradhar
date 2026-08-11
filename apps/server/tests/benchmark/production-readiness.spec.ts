/**
 * @file apps/server/tests/benchmark/production-readiness.spec.ts
 * @description Test suite verifying Sutradhar Production Readiness metrics, scores, and GO decision.
 */

import { ValidationProgramRunner } from '../../src/eval/validation-program-runner.js';

describe('Sutradhar Engineering Validation & Production Readiness Test Suite', () => {
  it('should execute 100 scale testing workflows and satisfy GO readiness criteria', () => {
    const metrics = ValidationProgramRunner.runValidationSuite(100);

    expect(metrics.totalWorkflowsExecuted).toBe(100);
    expect(metrics.overallSuccessRate).toBe(100.0);
    expect(metrics.reliabilityScore).toBeGreaterThanOrEqual(95.0);
    expect(metrics.maintainabilityScore).toBeGreaterThanOrEqual(90.0);
    expect(metrics.performanceScore).toBeGreaterThanOrEqual(90.0);
    expect(metrics.stabilityScore).toBeGreaterThanOrEqual(95.0);
    expect(metrics.criticalBlockers.length).toBe(0);
    expect(metrics.goNoGoDecision).toBe('GO');
  });

  it('should calculate P50 and P95 latency percentiles accurately', () => {
    const metrics = ValidationProgramRunner.runValidationSuite(100);

    expect(metrics.p50LatencyMs).toBeGreaterThan(0);
    expect(metrics.p95LatencyMs).toBeGreaterThanOrEqual(metrics.p50LatencyMs);
  });
});
