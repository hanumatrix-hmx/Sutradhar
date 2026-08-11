/**
 * @file packages/contracts/src/dto/run-dto.ts
 * @description Canonical persisted run record — the single schema for multi-day
 * execution history (UX overhaul §5.1). The server is the source of truth;
 * every run (including failed/cancelled) is written at START and updated
 * at END. Retention is indefinite.
 */

import { AgentGoalDto, AgentStepTraceDto } from './agent-dto.js';

export type RunRecordStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunRecordDto {
  readonly runId: string;
  /** UI session the run belongs to (optional — ad-hoc runs have none). */
  readonly sessionId?: string;
  readonly goal: string;
  readonly status: RunRecordStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  /** Real elapsed wall-clock time in ms, computed from start/end. */
  readonly durationMs?: number;
  /** LLM provider that actually served the run (honest, from the fallback chain). */
  readonly provider?: string;
  /** Model identifier, when the provider exposes one. */
  readonly model?: string;
  /** Full real step trace — never synthesized. */
  readonly steps: readonly AgentStepTraceDto[];
  readonly answer?: string;
  readonly summary?: string;
  /** Failure reason for failed runs. */
  readonly error?: string;
  /** Full terminal goal DTO, when available (steps/answer/summary mirror it). */
  readonly result?: AgentGoalDto;
  /** Set when the user exports the run from the History page. */
  readonly exportedAt?: string;
}
