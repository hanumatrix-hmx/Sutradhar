/**
 * @file packages/workflow/tests/unit/runner.spec.ts
 * @description Unit tests for WorkflowRunner, graph execution, AgentCore task delegation, and event bus publishing.
 */

import { WorkflowGraph, WorkflowRunner } from '../../src/index.js';
import { createWorkflowId } from '@sutradhar/contracts';
import { EventBus } from '@sutradhar/events';
import { AgentCore } from '@sutradhar/agent';

describe('@sutradhar/workflow Multi-Agent Execution Engine', () => {
  it('should traverse a valid DAG and emit lifecycle domain events', async () => {
    const bus = new EventBus();
    const workflowEvents: string[] = [];

    bus.subscribe('workflow:execution:started', () => {
      workflowEvents.push('started');
    });

    bus.subscribe('workflow:execution:completed', () => {
      workflowEvents.push('completed');
    });

    const agent = new AgentCore();
    const runner = new WorkflowRunner({ agentCore: agent, eventBus: bus });

    // Start -> Passthrough -> End. Uses no 'task' nodes so the graph traversal
    // and event publishing are exercised deterministically without requiring a
    // real LLM/browser (task-node delegation is covered by the e2e script).
    const graph = new WorkflowGraph(createWorkflowId('wf_run_1'), 'Passthrough Workflow');
    graph.addNode({ id: 'start', name: 'Start Node', type: 'start', nextNodes: ['mid'] });
    graph.addNode({ id: 'mid', name: 'Passthrough', type: 'decision', nextNodes: ['end'] });
    graph.addNode({ id: 'end', name: 'End Node', type: 'end' });

    const result = await runner.runWorkflow(graph);

    expect(result.state).toBe('completed');
    expect(result.executedNodes).toEqual(['start', 'mid', 'end']);
    expect(result.nodeOutputs['mid']).toBeDefined();
    expect(workflowEvents).toEqual(['started', 'completed']);
  });

  it('should return failed result for invalid graph topology', async () => {
    const runner = new WorkflowRunner();
    const graph = new WorkflowGraph(createWorkflowId('wf_invalid'), 'Invalid Graph');

    const result = await runner.runWorkflow(graph);

    expect(result.state).toBe('failed');
    expect(result.error).toContain('has no nodes');
  });
});
