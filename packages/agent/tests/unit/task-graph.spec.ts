/**
 * @file packages/agent/tests/unit/task-graph.spec.ts
 * @description Unit test suite verifying TaskGraph DAG operations, cycle detection, dependency resolution, and resumable state.
 */

import { TaskGraph, TaskNode } from '../../src/graph/task-graph-models.js';
import { TaskGraphEngine } from '../../src/graph/task-graph-engine.js';

describe('Engineering Iteration 5 — Task Graph Engine Unit Tests', () => {
  let graph: TaskGraph;
  let engine: TaskGraphEngine;

  beforeEach(() => {
    graph = new TaskGraph('graph_1', 'goal_1');
    engine = new TaskGraphEngine();
  });

  it('1. should add nodes and update READY statuses based on dependencies', () => {
    const node1: TaskNode = {
      id: 'n1',
      name: 'Navigate Login',
      goal: 'Login',
      status: 'NOT_STARTED',
      priority: 10,
      dependencies: [],
      actionName: 'navigate',
      retryCount: 0,
      maxRetries: 2,
    };

    const node2: TaskNode = {
      id: 'n2',
      name: 'Fill Credentials',
      goal: 'Login',
      status: 'NOT_STARTED',
      priority: 8,
      dependencies: ['n1'],
      actionName: 'type',
      retryCount: 0,
      maxRetries: 2,
    };

    graph.addNode(node1);
    graph.addNode(node2);
    graph.addEdge('n1', 'n2');

    expect(graph.getNode('n1')?.status).toBe('READY');
    expect(graph.getNode('n2')?.status).toBe('WAITING');

    const readyNodes = graph.getReadyNodes();
    expect(readyNodes.length).toBe(1);
    expect(readyNodes[0]?.id).toBe('n1');
  });

  it('2. should resolve dependencies when parent node transitions to COMPLETED', () => {
    const node1: TaskNode = {
      id: 'n1',
      name: 'Navigate',
      goal: 'Test',
      status: 'NOT_STARTED',
      priority: 10,
      dependencies: [],
      actionName: 'navigate',
      retryCount: 0,
      maxRetries: 2,
    };

    const node2: TaskNode = {
      id: 'n2',
      name: 'Action',
      goal: 'Test',
      status: 'NOT_STARTED',
      priority: 5,
      dependencies: ['n1'],
      actionName: 'click',
      retryCount: 0,
      maxRetries: 2,
    };

    graph.addNode(node1);
    graph.addNode(node2);
    graph.addEdge('n1', 'n2');

    engine.startNodeExecution(graph, 'n1');
    expect(graph.getNode('n1')?.status).toBe('RUNNING');

    engine.completeNodeExecution(graph, 'n1');
    expect(graph.getNode('n1')?.status).toBe('COMPLETED');
    expect(graph.getNode('n2')?.status).toBe('READY');
  });

  it('3. should reject cyclic dependency additions with an exception', () => {
    const node1: TaskNode = {
      id: 'n1',
      name: 'N1',
      goal: 'G',
      status: 'NOT_STARTED',
      priority: 1,
      dependencies: [],
      actionName: 'act',
      retryCount: 0,
      maxRetries: 1,
    };
    const node2: TaskNode = {
      id: 'n2',
      name: 'N2',
      goal: 'G',
      status: 'NOT_STARTED',
      priority: 1,
      dependencies: [],
      actionName: 'act',
      retryCount: 0,
      maxRetries: 1,
    };

    graph.addNode(node1);
    graph.addNode(node2);
    graph.addEdge('n1', 'n2');

    expect(() => graph.addEdge('n2', 'n1')).toThrow('Cyclic dependency detected');
  });

  it('4. should handle partial completion and support state serialization/deserialization', () => {
    const node1: TaskNode = {
      id: 'n1',
      name: 'Step 1',
      goal: 'G',
      status: 'NOT_STARTED',
      priority: 10,
      dependencies: [],
      actionName: 'act',
      retryCount: 0,
      maxRetries: 2,
    };
    const node2: TaskNode = {
      id: 'n2',
      name: 'Step 2',
      goal: 'G',
      status: 'NOT_STARTED',
      priority: 5,
      dependencies: ['n1'],
      actionName: 'act',
      retryCount: 0,
      maxRetries: 2,
    };

    graph.addNode(node1);
    graph.addNode(node2);
    graph.addEdge('n1', 'n2');

    engine.startNodeExecution(graph, 'n1');
    engine.completeNodeExecution(graph, 'n1', { token: 'auth_success' });

    const serialized = graph.serialize();
    const restoredGraph = TaskGraph.deserialize(serialized);

    expect(restoredGraph.getNode('n1')?.status).toBe('COMPLETED');
    expect(restoredGraph.getNode('n1')?.outputData?.['token']).toBe('auth_success');
    expect(restoredGraph.getNode('n2')?.status).toBe('READY');
  });

  it('5. should increment node retries and mark FAILED when maxRetries exceeded', () => {
    const node1: TaskNode = {
      id: 'n1',
      name: 'Failing Node',
      goal: 'G',
      status: 'NOT_STARTED',
      priority: 10,
      dependencies: [],
      actionName: 'act',
      retryCount: 0,
      maxRetries: 1,
    };
    graph.addNode(node1);

    engine.failNodeExecution(graph, 'n1', 'First timeout');
    expect(graph.getNode('n1')?.status).toBe('READY');
    expect(graph.getNode('n1')?.retryCount).toBe(1);

    engine.failNodeExecution(graph, 'n1', 'Second timeout');
    expect(graph.getNode('n1')?.status).toBe('FAILED');
    expect(graph.isFailed()).toBe(true);
  });
});
