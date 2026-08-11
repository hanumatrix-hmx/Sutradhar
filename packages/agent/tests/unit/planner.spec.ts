/**
 * @file packages/agent/tests/unit/planner.spec.ts
 * @description Unit tests for GoalPlanner and PromptCompiler.
 */

import { GoalPlanner } from '../../src/planner/goal-planner.js';
import { PromptCompiler } from '../../src/planner/prompt-compiler.js';
import { createGoalId, createAgentId } from '@sutradhar/contracts';
import { ILlmProvider } from '@sutradhar/llm';

describe('@sutradhar/agent Goal Planner & Prompt Compiler', () => {
  it('should compile prompt messages with goal and system instructions', async () => {
    const compiler = new PromptCompiler();
    const messages = await compiler.compilePrompt('Search Wikipedia for Alan Turing');

    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Sutradhar Browser Agent');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('Search Wikipedia for Alan Turing');
  });

  it('should create structured AgentPlanDto via GoalPlanner', async () => {
    const mockLlm: ILlmProvider = {
      providerId: 'mock-llm',
      name: 'Mock LLM Provider',
      generateCompletion: async () => ({
        content: '{"planReasoning": "OpenRouter Response: Navigate to wikipedia"}',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      }),
    };

    const planner = new GoalPlanner(mockLlm);
    const plan = await planner.createPlan(
      createGoalId('goal_123'),
      createAgentId('agent_456'),
      'Search Wikipedia for Alan Turing',
    );

    expect(plan.goalId).toBe('goal_123');
    expect(plan.agentId).toBe('agent_456');
    expect(plan.tasks.length).toBe(1);
    expect(plan.tasks[0]?.steps.length).toBe(3);
  });
});
