/**
 * @file packages/workflow/src/graph/workflow-graph.ts
 * @description WorkflowGraph class managing node topology and DAG graph validation.
 */

import { WorkflowId } from '@sutradhar/contracts';
import { WorkflowNodeDto } from './workflow-node.js';

export interface IWorkflowGraph {
  readonly id: WorkflowId;
  readonly name: string;
  addNode(node: WorkflowNodeDto): void;
  getNode(id: string): WorkflowNodeDto | undefined;
  getStartNode(): WorkflowNodeDto | undefined;
  validate(): { isValid: boolean; errors: readonly string[] };
}

export class WorkflowGraph implements IWorkflowGraph {
  public readonly id: WorkflowId;
  public readonly name: string;
  private readonly nodesMap = new Map<string, WorkflowNodeDto>();

  public constructor(id: WorkflowId, name: string) {
    this.id = id;
    this.name = name;
  }

  public addNode(node: WorkflowNodeDto): void {
    this.nodesMap.set(node.id, Object.freeze({ ...node }));
  }

  public getNode(id: string): WorkflowNodeDto | undefined {
    return this.nodesMap.get(id);
  }

  public getStartNode(): WorkflowNodeDto | undefined {
    for (const node of this.nodesMap.values()) {
      if (node.type === 'start') {
        return node;
      }
    }
    return undefined;
  }

  public getNodes(): readonly WorkflowNodeDto[] {
    return Array.from(this.nodesMap.values());
  }

  public validate(): { isValid: boolean; errors: readonly string[] } {
    const errors: string[] = [];

    if (this.nodesMap.size === 0) {
      return { isValid: false, errors: ['Workflow graph has no nodes'] };
    }

    const startNodes = Array.from(this.nodesMap.values()).filter((n) => n.type === 'start');
    if (startNodes.length === 0) {
      errors.push('Workflow graph must contain exactly one start node (0 found)');
    } else if (startNodes.length > 1) {
      errors.push(
        `Workflow graph must contain exactly one start node (${startNodes.length} found)`,
      );
    }

    const endNodes = Array.from(this.nodesMap.values()).filter((n) => n.type === 'end');
    if (endNodes.length === 0) {
      errors.push('Workflow graph must contain at least one end node');
    }

    // Verify nextNode references exist
    for (const node of this.nodesMap.values()) {
      if (node.nextNodes) {
        for (const nextId of node.nextNodes) {
          if (!this.nodesMap.has(nextId)) {
            errors.push(`Node ${node.id} references non-existent target node ${nextId}`);
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
