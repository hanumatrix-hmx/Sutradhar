/**
 * @file packages/workflow/src/runner/workflow-runner-options.ts
 * @description Configuration options and execution result DTO definitions for WorkflowRunner.
 */

import { WorkflowId } from '@sutradhar/contracts';
import { EventBus } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';
import { IAgentCore } from '@sutradhar/agent';

export type WorkflowExecutionState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowExecutionResultDto {
  readonly executionId: string;
  readonly workflowId: WorkflowId;
  readonly state: WorkflowExecutionState;
  readonly executedNodes: readonly string[];
  readonly nodeOutputs: Record<string, unknown>;
  readonly durationMs: number;
  readonly error?: string;
}

export interface WorkflowRunnerOptions {
  readonly agentCore?: IAgentCore;
  readonly eventBus?: EventBus;
  readonly logger?: StructuredLogger;
}
