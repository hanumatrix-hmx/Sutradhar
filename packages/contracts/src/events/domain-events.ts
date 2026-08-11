/**
 * @file packages/contracts/src/events/domain-events.ts
 * @description Payload schemas and event interfaces for system domains.
 */

import {
  SessionId,
  TabId,
  AgentId,
  GoalId,
  TaskId,
  StepId,
  ToolId,
} from '../shared/identifiers.js';
import { Timestamp } from '../shared/primitives.js';

// --- Browser Domain Events ---
export interface BrowserSessionCreatedEventPayload {
  readonly sessionId: SessionId;
  readonly createdAt: Timestamp;
}

export interface BrowserSessionClosedEventPayload {
  readonly sessionId: SessionId;
  readonly closedAt: Timestamp;
  readonly reason?: string;
}

export interface BrowserPageNavigatedEventPayload {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly url: string;
  readonly title: string;
}

export interface BrowserActionExecutedEventPayload {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly actionType: string;
  readonly success: boolean;
  readonly durationMs: number;
}

export interface BrowserDialogOpenedEventPayload {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly dialogType: string;
  readonly message: string;
  readonly defaultValue?: string;
}

export interface BrowserPopupOpenedEventPayload {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly url: string;
}

/** Fired when the underlying Chrome process disconnects/crashes outside of a normal
 *  `session.close()` — lets a session manager drop the now-dead session instead of it
 *  lingering forever, and lets any other listener (e.g. the agent loop) react immediately
 *  instead of discovering it only when the next action against that session hangs/fails. */
export interface BrowserSessionCrashedEventPayload {
  readonly sessionId: SessionId;
  readonly crashedAt: Timestamp;
}

export interface BrowserConsoleMessageEventPayload {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly logType: string;
  readonly text: string;
}

export interface BrowserPageErrorEventPayload {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly message: string;
  readonly stack?: string;
}

export interface BrowserNetworkRequestEventPayload {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
}

export interface BrowserNetworkResponseEventPayload {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly url: string;
  readonly status: number;
}

// --- Agent Domain Events ---
export interface AgentGoalStartedEventPayload {
  readonly agentId: AgentId;
  readonly goalId: GoalId;
  readonly goal: string;
}

export interface AgentStepExecutedEventPayload {
  readonly agentId: AgentId;
  readonly taskId: TaskId;
  readonly stepId: StepId;
  readonly action: string;
  readonly result: string;
  readonly success: boolean;
}

export interface AgentStateChangedEventPayload {
  readonly agentId: AgentId;
  readonly previousState: string;
  readonly newState: string;
}

/**
 * Fired when an autonomous agent run hits something only a human can resolve — a CAPTCHA,
 * an auth/login wall, or a repeating stuck-loop it cannot break out of on its own. One signal
 * for all three cases (rather than separate ad-hoc events) so a single UI surface (a blocked-
 * session banner) can handle every reason uniformly.
 */
export interface SessionBlockedEventPayload {
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly goalId: GoalId;
  readonly blockReason: 'captcha' | 'auth_wall' | 'stuck';
  readonly message: string;
}

// --- LLM Domain Events ---
export interface LlmStreamChunkEventPayload {
  readonly sessionId: SessionId;
  readonly chunk: string;
  readonly isFinal: boolean;
}

export interface LlmCompletionGeneratedEventPayload {
  readonly modelId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

// --- Tool Domain Events ---
export interface ToolExecutionStartedEventPayload {
  readonly toolId: ToolId;
  readonly toolName: string;
  readonly input: unknown;
}

export interface ToolExecutionCompletedEventPayload {
  readonly toolId: ToolId;
  readonly toolName: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly output?: unknown;
  readonly error?: string;
}

// --- Runtime Kernel Domain Events ---
export interface KernelServiceStartedEventPayload {
  readonly serviceId: string;
}

export interface KernelServiceFailedEventPayload {
  readonly serviceId: string;
  readonly error: string;
}

export interface KernelServiceStoppedEventPayload {
  readonly serviceId: string;
}

// --- Workflow Domain Events ---
export interface WorkflowExecutionStartedEventPayload {
  readonly workflowId: string;
  readonly executionId: string;
  readonly timestamp: string;
}

export interface WorkflowExecutionCompletedEventPayload {
  readonly workflowId: string;
  readonly executionId: string;
  readonly durationMs: number;
}

export interface WorkflowExecutionFailedEventPayload {
  readonly workflowId: string;
  readonly executionId: string;
  readonly error: string;
}
