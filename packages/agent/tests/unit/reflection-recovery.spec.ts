/**
 * @file packages/agent/tests/unit/reflection-recovery.spec.ts
 * @description Unit test suite verifying ReflectionEngine stuck loop detection and RecoveryEngine resolution integration.
 */

import { ReflectionEngine } from '../../src/executor/reflection-engine.js';
import { RecoveryEngine } from '../../src/recovery/recovery-engine.js';
import { AgentStepDto, createStepId } from '@pinchtab/contracts';

describe('Engineering Iteration 1 — ReflectionEngine & RecoveryEngine Integration', () => {
  it('should detect stuck state loops when consecutive identical actions occur', () => {
    const reflection = new ReflectionEngine();
    const step1: AgentStepDto = {
      id: createStepId('step_1'),
      stepNumber: 1,
      reasoning: 'Inspect element',
      actionName: 'navigate_and_inspect',
      observation: 'Page loaded',
      isVerified: true,
      timestamp: new Date().toISOString(),
    };

    const step2: AgentStepDto = {
      id: createStepId('step_2'),
      stepNumber: 2,
      reasoning: 'Inspect element',
      actionName: 'navigate_and_inspect',
      observation: 'Page loaded',
      isVerified: true,
      timestamp: new Date().toISOString(),
    };

    const step3: AgentStepDto = {
      id: createStepId('step_3'),
      stepNumber: 3,
      reasoning: 'Inspect element',
      actionName: 'navigate_and_inspect',
      observation: 'Page loaded',
      isVerified: true,
      timestamp: new Date().toISOString(),
    };

    const res1 = reflection.evaluateStep(step1, []);
    expect(res1.isStuck).toBe(false);

    const res2 = reflection.evaluateStep(step2, [step1]);
    expect(res2.isStuck).toBe(false);

    const res3 = reflection.evaluateStep(step3, [step1, step2]);
    expect(res3.isStuck).toBe(true);
    expect(res3.suggestedAction).toBe('replan_or_refresh');
  });

  it('should trigger RecoveryEngine strategy when stuck loop detected', async () => {
    const recovery = new RecoveryEngine();
    const mockTab: any = {
      url: 'https://example.com',
      title: 'Example Domain',
    };

    const recoveryRes = await recovery.attemptRecovery('stale_element', mockTab);
    expect(recoveryRes.recovered).toBe(true);
    expect(recoveryRes.strategyName).toBe('RefreshSnapshot');
  });
});
