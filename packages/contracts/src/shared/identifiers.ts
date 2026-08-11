/**
 * @file packages/contracts/src/shared/identifiers.ts
 * @description Strongly typed branded domain identifiers for Sutradhar.
 */

import { Brand } from './brand.js';

export type SessionId = Brand<string, 'SessionId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type TabId = Brand<string, 'TabId'>;
export type GoalId = Brand<string, 'GoalId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type StepId = Brand<string, 'StepId'>;
export type PlanId = Brand<string, 'PlanId'>;
export type EventId = Brand<string, 'EventId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type ToolId = Brand<string, 'ToolId'>;
export type ModelId = Brand<string, 'ModelId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type PluginId = Brand<string, 'PluginId'>;
export type PolicyId = Brand<string, 'PolicyId'>;

export function createSessionId(id: string): SessionId {
  return id as SessionId;
}

export function createAgentId(id: string): AgentId {
  return id as AgentId;
}

export function createTabId(id: string): TabId {
  return id as TabId;
}

export function createGoalId(id: string): GoalId {
  return id as GoalId;
}

export function createTaskId(id: string): TaskId {
  return id as TaskId;
}

export function createStepId(id: string): StepId {
  return id as StepId;
}

export function createPlanId(id: string): PlanId {
  return id as PlanId;
}

export function createEventId(id: string): EventId {
  return id as EventId;
}

export function createCorrelationId(id: string): CorrelationId {
  return id as CorrelationId;
}

export function createToolId(id: string): ToolId {
  return id as ToolId;
}

export function createModelId(id: string): ModelId {
  return id as ModelId;
}

export function createMemoryId(id: string): MemoryId {
  return id as MemoryId;
}

export function createWorkflowId(id: string): WorkflowId {
  return id as WorkflowId;
}

export function createPluginId(id: string): PluginId {
  return id as PluginId;
}

export function createPolicyId(id: string): PolicyId {
  return id as PolicyId;
}
