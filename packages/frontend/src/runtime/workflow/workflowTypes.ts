/**
 * @file packages/frontend/src/runtime/workflow/workflowTypes.ts
 * @description Domain interfaces for Workflow Engine, WorkflowNode, WorkflowStatus, and WorkflowSnapshot.
 */

export type NodeType =
  | 'action'
  | 'condition'
  | 'loop'
  | 'parallel'
  | 'delay'
  | 'approval'
  | 'subworkflow';

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowNodeData {
  actionType?: string;
  actionInput?: Record<string, unknown>;
  conditionExpression?: string;
  loopItemsVariable?: string;
  loopItemAlias?: string;
  parallelBranchIds?: string[];
  delayMs?: number;
  approvalDescription?: string;
  subWorkflowId?: string;
}

export interface WorkflowNodeSnapshot {
  id: string;
  name: string;
  type: NodeType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  nextId?: string;
  elseId?: string;
  data: WorkflowNodeData;
  error?: string;
}

export interface WorkflowSnapshot {
  id: string;
  name: string;
  description: string;
  version: string;
  status: WorkflowStatus;
  currentNodeId: string | null;
  nodes: WorkflowNodeSnapshot[];
  variables: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkflowResult {
  workflowId: string;
  status: WorkflowStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeResults: Record<string, unknown>;
  variables: Record<string, unknown>;
  error?: string;
}

export type WorkflowLifecycleEventType =
  | 'WorkflowStarted'
  | 'WorkflowPaused'
  | 'WorkflowResumed'
  | 'WorkflowCompleted'
  | 'WorkflowFailed'
  | 'WorkflowCancelled'
  | 'NodeStarted'
  | 'NodeCompleted'
  | 'NodeFailed';

export interface WorkflowLifecycleEvent {
  type: WorkflowLifecycleEventType;
  workflowId: string;
  sessionId: string;
  nodeId?: string;
  timestamp: string;
  payload?: any;
}
