/**
 * @file packages/contracts/src/dto/agent-dto.ts
 * @description Canonical DTOs for Agents, Goals, Tasks, and Steps.
 */

import { AgentId, GoalId, TaskId, StepId, PlanId } from '../shared/identifiers.js';
import { Timestamp } from '../shared/primitives.js';

export interface AgentProfileDto {
  readonly id: AgentId;
  readonly name: string;
  readonly role: string;
  readonly systemPromptTemplate: string;
  readonly allowedTools: readonly string[];
}

export interface AgentGoalDto {
  readonly id: GoalId;
  readonly agentId: AgentId;
  readonly objective: string;
  readonly status:
    | 'pending'
    | 'planning'
    | 'executing'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'cancelled';
  readonly createdAt: Timestamp;
  /** Final answer extracted by the real agent loop, when available. */
  readonly answer?: string;
  /** Optional human-readable summary. */
  readonly summary?: string;
  /** Full real execution trace (optional; populated by the real agent loop). */
  readonly steps?: readonly AgentStepTraceDto[];
  /** Real elapsed wall-clock time in ms. */
  readonly durationMs?: number;
  /** Client session that requested this run (echoed for run linkage). */
  readonly sessionId?: string;
}

/** A single real agent-loop step surfaced for UI inspection. */
export interface AgentStepTraceDto {
  readonly stepNumber: number;
  readonly reasoning: string;
  readonly actionName: string;
  readonly observation: string;
  readonly success: boolean;
  readonly errorMessage?: string;
  readonly timestamp: Timestamp;
}

export interface AgentStepDto {
  readonly id: StepId;
  readonly stepNumber: number;
  readonly reasoning: string;
  readonly actionName: string;
  readonly actionPayload: Record<string, unknown>;
  readonly observation: string;
  readonly isVerified: boolean;
  readonly timestamp: Timestamp;
}

export interface AgentTaskDto {
  readonly id: TaskId;
  readonly goalId: GoalId;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly AgentStepDto[];
  readonly isCompleted: boolean;
}

export interface AgentPlanDto {
  readonly id: PlanId;
  readonly goalId: GoalId;
  readonly agentId: AgentId;
  readonly tasks: readonly AgentTaskDto[];
  readonly createdAt: Timestamp;
}
