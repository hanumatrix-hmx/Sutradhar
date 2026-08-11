/**
 * @file packages/workflow/src/graph/workflow-node.ts
 * @description Node type and DTO definitions for workflow DAG graphs.
 */

export type WorkflowNodeType = 'start' | 'task' | 'condition' | 'parallel' | 'end';

export interface WorkflowNodeDto {
  readonly id: string;
  readonly name: string;
  readonly type: WorkflowNodeType;
  readonly action?: string;
  readonly payload?: Record<string, unknown>;
  readonly nextNodes?: readonly string[];
}
