/**
 * @file packages/agent/src/graph/task-graph-engine.ts
 * @description TaskGraphEngine coordinating graph execution scheduling, node state transitions, and partial completion persistence.
 */

import { TaskGraph, TaskNode } from './task-graph-models.js';
import { StructuredLogger } from '@pinchtab/observability';

export interface GraphExecutionResult {
  readonly graphId: string;
  readonly isCompleted: boolean;
  readonly isFailed: boolean;
  readonly executedNodesCount: number;
  readonly failedNodeId?: string;
}

export class TaskGraphEngine {
  private readonly logger: StructuredLogger;

  public constructor(logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public getNextReadyNode(graph: TaskGraph): TaskNode | undefined {
    const readyNodes = graph.getReadyNodes();
    if (readyNodes.length === 0) return undefined;
    return readyNodes[0];
  }

  public startNodeExecution(graph: TaskGraph, nodeId: string): void {
    this.logger.info(`[TaskGraphEngine] Starting node execution ${nodeId} in graph ${graph.id}`);
    graph.setNodeStatus(nodeId, 'RUNNING');
  }

  public completeNodeExecution(
    graph: TaskGraph,
    nodeId: string,
    outputData?: Record<string, unknown>,
  ): void {
    this.logger.info(`[TaskGraphEngine] Completed node execution ${nodeId} in graph ${graph.id}`);
    graph.setNodeStatus(nodeId, 'COMPLETED', outputData);
  }

  public failNodeExecution(graph: TaskGraph, nodeId: string, error: string): void {
    const node = graph.getNode(nodeId);
    if (!node) return;

    node.retryCount++;
    if (node.retryCount <= node.maxRetries) {
      this.logger.warn(
        `[TaskGraphEngine] Node ${nodeId} failed (attempt ${node.retryCount}/${node.maxRetries + 1}); setting READY for retry`,
      );
      graph.setNodeStatus(nodeId, 'READY', undefined, error);
    } else {
      this.logger.error(`[TaskGraphEngine] Node ${nodeId} failed permanently: ${error}`);
      graph.setNodeStatus(nodeId, 'FAILED', undefined, error);
    }
  }

  public evaluateGraphState(graph: TaskGraph): GraphExecutionResult {
    const nodes = graph.getAllNodes();
    const executedNodesCount = nodes.filter((n) => n.status === 'COMPLETED').length;
    const failedNode = nodes.find((n) => n.status === 'FAILED');

    return {
      graphId: graph.id,
      isCompleted: graph.isCompleted(),
      isFailed: graph.isFailed(),
      executedNodesCount,
      failedNodeId: failedNode?.id,
    };
  }
}
