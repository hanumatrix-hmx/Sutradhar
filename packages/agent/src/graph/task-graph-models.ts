/**
 * @file packages/agent/src/graph/task-graph-models.ts
 * @description TaskGraph, TaskNode, TaskEdge, and TaskStatus models for directed graph execution.
 */

export type TaskStatus =
  | 'NOT_STARTED'
  | 'READY'
  | 'RUNNING'
  | 'WAITING'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABANDONED';

export interface TaskNode {
  readonly id: string;
  readonly name: string;
  readonly goal: string;
  status: TaskStatus;
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly actionName: string;
  readonly actionPayload?: Record<string, unknown>;
  retryCount: number;
  readonly maxRetries: number;
  outputData?: Record<string, unknown>;
  error?: string;
}

export interface TaskEdge {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly condition?: string;
}

export interface TaskContext {
  readonly graphId: string;
  readonly goalId: string;
  readonly activeNodeId?: string;
  readonly completedNodeIds: readonly string[];
  readonly failedNodeIds: readonly string[];
}

export class TaskGraph {
  public readonly id: string;
  public readonly goalId: string;
  private readonly nodesMap = new Map<string, TaskNode>();
  private readonly edgesList: TaskEdge[] = [];

  public constructor(id: string, goalId: string) {
    this.id = id;
    this.goalId = goalId;
  }

  public addNode(node: TaskNode): void {
    if (this.nodesMap.has(node.id)) {
      throw new Error(`TaskNode ${node.id} already exists in graph ${this.id}`);
    }
    this.nodesMap.set(node.id, { ...node });
    this.updateNodeStatuses();
  }

  public addEdge(fromNodeId: string, toNodeId: string, condition?: string): void {
    if (!this.nodesMap.has(fromNodeId) || !this.nodesMap.has(toNodeId)) {
      throw new Error(`Invalid edge: missing node ${fromNodeId} or ${toNodeId}`);
    }

    this.edgesList.push({ fromNodeId, toNodeId, condition });

    if (this.hasCycle()) {
      this.edgesList.pop();
      throw new Error(`Cyclic dependency detected between ${fromNodeId} and ${toNodeId}`);
    }

    this.updateNodeStatuses();
  }

  public getNode(id: string): TaskNode | undefined {
    return this.nodesMap.get(id);
  }

  public getAllNodes(): readonly TaskNode[] {
    return Array.from(this.nodesMap.values());
  }

  public getReadyNodes(): readonly TaskNode[] {
    return Array.from(this.nodesMap.values())
      .filter((n) => n.status === 'READY')
      .sort((a, b) => b.priority - a.priority);
  }

  public setNodeStatus(
    id: string,
    status: TaskStatus,
    outputData?: Record<string, unknown>,
    error?: string,
  ): void {
    const node = this.nodesMap.get(id);
    if (!node) throw new Error(`Node ${id} not found in graph`);

    node.status = status;
    if (outputData) node.outputData = outputData;
    if (error) node.error = error;

    this.updateNodeStatuses();
  }

  public isCompleted(): boolean {
    const nodes = Array.from(this.nodesMap.values());
    if (nodes.length === 0) return false;
    return nodes.every((n) => n.status === 'COMPLETED' || n.status === 'ABANDONED');
  }

  public isFailed(): boolean {
    const nodes = Array.from(this.nodesMap.values());
    return nodes.some((n) => n.status === 'FAILED');
  }

  public hasCycle(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const outgoing = this.edgesList.filter((e) => e.fromNodeId === nodeId);
      for (const edge of outgoing) {
        if (!visited.has(edge.toNodeId)) {
          if (dfs(edge.toNodeId)) return true;
        } else if (recStack.has(edge.toNodeId)) {
          return true;
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodesMap.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }

  public updateNodeStatuses(): void {
    for (const node of this.nodesMap.values()) {
      if (
        node.status === 'COMPLETED' ||
        node.status === 'FAILED' ||
        node.status === 'RUNNING' ||
        node.status === 'ABANDONED'
      ) {
        continue;
      }

      const deps = node.dependencies;
      if (deps.length === 0) {
        node.status = 'READY';
        continue;
      }

      const depNodes = deps.map((d) => this.nodesMap.get(d)).filter(Boolean);
      const anyFailed = depNodes.some((d) => d?.status === 'FAILED' || d?.status === 'ABANDONED');
      const allCompleted = depNodes.every((d) => d?.status === 'COMPLETED');

      if (anyFailed) {
        node.status = 'BLOCKED';
      } else if (allCompleted) {
        node.status = 'READY';
      } else {
        node.status = 'WAITING';
      }
    }
  }

  public serialize(): string {
    return JSON.stringify({
      id: this.id,
      goalId: this.goalId,
      nodes: Array.from(this.nodesMap.values()),
      edges: this.edgesList,
    });
  }

  public static deserialize(jsonStr: string): TaskGraph {
    const data = JSON.parse(jsonStr);
    const graph = new TaskGraph(data.id, data.goalId);
    for (const node of data.nodes) {
      graph.nodesMap.set(node.id, node);
    }
    for (const edge of data.edges) {
      graph.edgesList.push(edge);
    }
    graph.updateNodeStatuses();
    return graph;
  }
}
