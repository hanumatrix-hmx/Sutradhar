/**
 * @file apps/server/tests/benchmark/v1-launch.spec.ts
 * @description Acceptance test suite for PinchTab Version 1.0 Launch Program.
 */

import { LaunchManager } from '../../src/launch/launch-manager.js';

describe('PinchTab Version 1.0 Launch Program Quality Gate', () => {
  it('should verify all 6 Workstreams (A-F) are 100% complete and criteria met', () => {
    const workstreams = LaunchManager.getWorkstreamsStatus();
    expect(workstreams.length).toBe(6);

    for (const ws of workstreams) {
      expect(ws.isComplete).toBe(true);
      expect(ws.successCriteriaMet).toBe(true);
      expect(ws.highlights.length).toBeGreaterThan(0);
    }
  });

  it('should generate Release Candidate report certifying GO FOR V1.0 GA RELEASE', () => {
    const report = LaunchManager.generateReleaseCandidateReport();

    expect(report.releaseVersion).toBe('v1.0.0-GA');
    expect(report.overallStatus).toBe('READY_FOR_GA');
    expect(report.qualityGateResults.typeErrorsCount).toBe(0);
    expect(report.goNoGoRecommendation).toBe('GO FOR V1.0 GA RELEASE');
  });
});
