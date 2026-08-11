/**
 * @file packages/contracts/tests/unit/shared.spec.ts
 * @description Unit tests for shared branded identifiers and primitives.
 */

import {
  createSessionId,
  createAgentId,
  createTabId,
  createGoalId,
  createTaskId,
  createStepId,
  createToolId,
  createModelId,
  createMemoryId,
  createWorkflowId,
  createPluginId,
  createPolicyId,
} from '../../src/shared/index.js';

describe('Shared Primitives & Branded Identifiers', () => {
  it('should create valid branded identifiers', () => {
    const sessionId = createSessionId('sess_123');
    const agentId = createAgentId('agent_456');
    const tabId = createTabId('tab_789');
    const goalId = createGoalId('goal_101');
    const taskId = createTaskId('task_102');
    const stepId = createStepId('step_103');
    const toolId = createToolId('tool_104');
    const modelId = createModelId('model_105');
    const memoryId = createMemoryId('mem_106');
    const workflowId = createWorkflowId('wf_107');
    const pluginId = createPluginId('plug_108');
    const policyId = createPolicyId('pol_109');

    expect(sessionId).toBe('sess_123');
    expect(agentId).toBe('agent_456');
    expect(tabId).toBe('tab_789');
    expect(goalId).toBe('goal_101');
    expect(taskId).toBe('task_102');
    expect(stepId).toBe('step_103');
    expect(toolId).toBe('tool_104');
    expect(modelId).toBe('model_105');
    expect(memoryId).toBe('mem_106');
    expect(workflowId).toBe('wf_107');
    expect(pluginId).toBe('plug_108');
    expect(policyId).toBe('pol_109');
  });
});
