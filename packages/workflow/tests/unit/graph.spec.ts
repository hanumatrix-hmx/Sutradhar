/**
 * @file packages/workflow/tests/unit/graph.spec.ts
 * @description Unit tests for WorkflowGraph building, validation, and node references.
 */

import { WorkflowGraph, WORKFLOW_VERSION } from '../../src/index.js';
import { createWorkflowId } from '@pinchtab/contracts';

describe('@pinchtab/workflow Engine Shell & Node Graph', () => {
  it('should export correct package version constant', () => {
    expect(WORKFLOW_VERSION).toBe('0.1.0');
  });

  it('should build and validate valid DAG WorkflowGraph', () => {
    const graph = new WorkflowGraph(createWorkflowId('wf_1'), 'Web Extraction Workflow');

    graph.addNode({
      id: 'node_start',
      name: 'Start',
      type: 'start',
      nextNodes: ['node_task_1'],
    });

    graph.addNode({
      id: 'node_task_1',
      name: 'Navigate and Scrape',
      type: 'task',
      action: 'scrape_page',
      nextNodes: ['node_end'],
    });

    graph.addNode({
      id: 'node_end',
      name: 'End Workflow',
      type: 'end',
    });

    const validation = graph.validate();
    expect(validation.isValid).toBe(true);
    expect(validation.errors.length).toBe(0);
    expect(graph.getStartNode()?.id).toBe('node_start');
  });

  it('should catch missing start node and invalid target node references', () => {
    const graph = new WorkflowGraph(createWorkflowId('wf_bad'), 'Broken Graph');

    graph.addNode({
      id: 'node_task_1',
      name: 'Isolated Task',
      type: 'task',
      nextNodes: ['non_existent_node'],
    });

    const validation = graph.validate();
    expect(validation.isValid).toBe(false);
    expect(validation.errors).toContain(
      'Workflow graph must contain exactly one start node (0 found)',
    );
    expect(validation.errors).toContain(
      'Node node_task_1 references non-existent target node non_existent_node',
    );
  });
});
