/**
 * @file packages/agent/tests/unit/executor.spec.ts
 * @description Unit tests for StepExecutor, ReflectionEngine, and stuck loop detection.
 */

import { StepExecutor, ReflectionEngine } from '../../src/index.js';
import { createAgentId, createTaskId, createStepId, AgentStepDto } from '@sutradhar/contracts';
import { EventBus } from '@sutradhar/events';
import { BrowserSession } from '@sutradhar/browser';
import { createSessionId } from '@sutradhar/contracts';

describe('@sutradhar/agent Task Step Executor & Reflection Engine', () => {
  it('should evaluate step success and detect stuck state loops in ReflectionEngine', () => {
    const engine = new ReflectionEngine();

    const step1: AgentStepDto = {
      id: createStepId('step_1'),
      stepNumber: 1,
      reasoning: 'Click button',
      actionName: 'click',
      observation: 'Button clicked',
      isVerified: true,
      timestamp: new Date().toISOString(),
    };

    const result1 = engine.evaluateStep(step1, []);
    expect(result1.isSuccessful).toBe(true);
    expect(result1.isStuck).toBe(false);

    // Identical repeated steps
    const history = [step1, step1];
    const resultStuck = engine.evaluateStep(step1, history);
    expect(resultStuck.isStuck).toBe(true);
    expect(resultStuck.suggestedAction).toBe('replan_or_refresh');
  });

  it('should execute step on active browser tab and publish domain events', async () => {
    const bus = new EventBus();
    const executedSteps: string[] = [];

    bus.subscribe('agent:step:executed', (e) => {
      executedSteps.push(e.payload.stepId);
    });

    const executor = new StepExecutor(bus);
    const session = new BrowserSession(createSessionId('sess_99'));
    await session.createTab('https://sutradhar.dev');

    const step: AgentStepDto = {
      id: createStepId('step_100'),
      stepNumber: 1,
      reasoning: 'Navigate to docs',
      actionName: 'navigate',
      actionPayload: { url: 'https://sutradhar.dev/docs' },
      isVerified: false,
      timestamp: new Date().toISOString(),
    };

    const completed = await executor.executeStep(
      createAgentId('ag_1'),
      createTaskId('task_1'),
      step,
      session,
    );

    expect(completed.isVerified).toBe(true);
    expect(completed.observation).toContain('succeeded on https://sutradhar.dev/docs');
    expect(executedSteps.length).toBe(1);
  });
});
