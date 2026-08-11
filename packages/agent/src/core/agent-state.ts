/**
 * @file packages/agent/src/core/agent-state.ts
 * @description AgentState type definitions and AgentStateMachine transition validation engine.
 */

import { AgentId } from '@pinchtab/contracts';
import { EventBus } from '@pinchtab/events';
import { StructuredLogger } from '@pinchtab/observability';

export type AgentState =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'reflecting'
  | 'completed'
  | 'failed'
  | 'paused';

const ALLOWED_TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  idle: ['planning', 'executing', 'failed'],
  planning: ['executing', 'failed', 'paused'],
  executing: ['verifying', 'reflecting', 'planning', 'completed', 'failed', 'paused'],
  verifying: ['executing', 'reflecting', 'completed', 'failed', 'planning'],
  reflecting: ['planning', 'executing', 'failed'],
  paused: ['planning', 'executing', 'failed'],
  completed: ['idle', 'planning', 'executing'],
  failed: ['idle', 'planning', 'executing'],
};

export class AgentStateMachine {
  private currentState: AgentState = 'idle';
  private readonly agentId: AgentId;
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;

  public constructor(
    agentId: AgentId,
    eventBus?: EventBus,
    logger?: StructuredLogger,
    initialState: AgentState = 'idle',
  ) {
    this.agentId = agentId;
    this.eventBus = eventBus;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
    this.currentState = initialState;
  }

  public getState(): AgentState {
    return this.currentState;
  }

  public canTransitionTo(targetState: AgentState): boolean {
    const allowed = ALLOWED_TRANSITIONS[this.currentState];
    return allowed.includes(targetState);
  }

  public async transitionTo(targetState: AgentState): Promise<void> {
    if (!this.canTransitionTo(targetState)) {
      throw new Error(
        `Invalid Agent state transition from '${this.currentState}' to '${targetState}' for Agent ${this.agentId}`,
      );
    }

    const previousState = this.currentState;
    this.currentState = targetState;

    this.logger.info(`[AgentStateMachine] Transitioned Agent ${this.agentId}`, {
      previousState,
      newState: targetState,
    });

    if (this.eventBus) {
      await this.eventBus.publish(
        'agent:state:changed',
        {
          agentId: this.agentId,
          previousState,
          newState: targetState,
        },
        `corr_${this.agentId}`,
      );
    }
  }
}
