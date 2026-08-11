/**
 * @file packages/frontend/src/runtime/workflow/workflowGraph.ts
 * @description Workflow and WorkflowNode execution graph models.
 */

import {
  NodeType,
  WorkflowNodeData,
  WorkflowSnapshot,
  WorkflowNodeSnapshot,
  WorkflowStatus,
} from './workflowTypes.js';

export class WorkflowNode {
  public id: string;
  public name: string;
  public type: NodeType;
  public nextId?: string;
  public elseId?: string;
  public data: WorkflowNodeData;
  public status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' = 'pending';
  public error?: string;

  public constructor(config: {
    id?: string;
    name: string;
    type: NodeType;
    nextId?: string;
    elseId?: string;
    data?: WorkflowNodeData;
  }) {
    this.id = config.id || `node_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.name = config.name;
    this.type = config.type;
    this.nextId = config.nextId;
    this.elseId = config.elseId;
    this.data = config.data || {};
  }

  public toSnapshot(): WorkflowNodeSnapshot {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      status: this.status,
      nextId: this.nextId,
      elseId: this.elseId,
      data: this.data,
      error: this.error,
    };
  }

  public static fromSnapshot(snap: WorkflowNodeSnapshot): WorkflowNode {
    const node = new WorkflowNode({
      id: snap.id,
      name: snap.name,
      type: snap.type,
      nextId: snap.nextId,
      elseId: snap.elseId,
      data: snap.data,
    });
    node.status = snap.status;
    node.error = snap.error;
    return node;
  }
}

export class Workflow {
  public id: string;
  public name: string;
  public description: string;
  public version: string;
  public status: WorkflowStatus = 'idle';
  public startNodeId: string | null = null;
  public readonly nodesMap = new Map<string, WorkflowNode>();

  public constructor(config: {
    id?: string;
    name: string;
    description?: string;
    version?: string;
  }) {
    this.id = config.id || `wf_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.name = config.name;
    this.description = config.description || '';
    this.version = config.version || '1.0.0';
  }

  public addNode(node: WorkflowNode): WorkflowNode {
    this.nodesMap.set(node.id, node);
    if (!this.startNodeId) {
      this.startNodeId = node.id;
    }
    return node;
  }

  public getNode(id: string): WorkflowNode | undefined {
    return this.nodesMap.get(id);
  }

  public validate(): { valid: boolean; reason?: string } {
    if (this.nodesMap.size === 0) return { valid: false, reason: 'Workflow has no nodes' };
    if (!this.startNodeId || !this.nodesMap.has(this.startNodeId)) {
      return { valid: false, reason: 'Start node is missing or invalid' };
    }
    return { valid: true };
  }

  public createSnapshot(
    currentNodeId: string | null,
    variables: Record<string, unknown>,
  ): WorkflowSnapshot {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      version: this.version,
      status: this.status,
      currentNodeId,
      nodes: Array.from(this.nodesMap.values()).map((n) => n.toSnapshot()),
      variables,
    };
  }

  public static fromSnapshot(snapshot: WorkflowSnapshot): Workflow {
    const wf = new Workflow({
      id: snapshot.id,
      name: snapshot.name,
      description: snapshot.description,
      version: snapshot.version,
    });
    wf.status = snapshot.status;
    snapshot.nodes.forEach((nSnap) => {
      const node = WorkflowNode.fromSnapshot(nSnap);
      wf.addNode(node);
    });
    if (snapshot.nodes[0]) {
      wf.startNodeId = snapshot.nodes[0].id;
    }
    return wf;
  }
}
