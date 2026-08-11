/**
 * @file packages/agent/src/core/agent-core.ts
 * @description AgentCore — public façade that runs the REAL observe→reason→act→verify loop.
 *
 * executeGoal() now delegates to {@link runAgentLoop}, which drives a genuine LLM
 * against a genuine browser. There is no goal→URL scripting and no hardcoded
 * skill call here anymore; every decision is made by the model.
 */

import { AgentId, createAgentId, AgentGoalDto, GoalId } from '@pinchtab/contracts';
import { EventBus } from '@pinchtab/events';
import { StructuredLogger } from '@pinchtab/observability';
import { ILlmProvider } from '@pinchtab/llm';
import { BrowserSessionManager } from '@pinchtab/browser';
import { AgentOptions } from './agent-options.js';
import { AgentState, AgentStateMachine } from './agent-state.js';
import { runAgentLoop, AgentLoopStep } from './agent-loop.js';

export interface IAgentCore {
  readonly agentId: AgentId;
  readonly name: string;
  readonly state: AgentState;
  executeGoal(goalText: string): Promise<AgentGoalDto>;
}

/** Live-execution controls for a goal run (server run manager plumbing). */
export interface ExecuteGoalOptions {
  /** Server-assigned run id — the loop uses it as its goalId so the run,
   *  its events, and its result all share one identifier. */
  readonly goalId?: GoalId;
  /** External cancellation, honored at step boundaries. */
  readonly signal?: AbortSignal;
  /** Real-time step sink for live SSE progress (never synthesized steps). */
  readonly onStep?: (step: AgentLoopStep) => void;
}

export class AgentCore implements IAgentCore {
  public readonly agentId: AgentId;
  public readonly name: string;
  public readonly role: string;
  private readonly maxSteps: number;
  private readonly llmProvider?: ILlmProvider;
  private readonly llmProviderAccessor?: () => ILlmProvider;
  private readonly sessionManager?: BrowserSessionManager;
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;
  private readonly stateMachine: AgentStateMachine;

  public constructor(options: AgentOptions = {}) {
    this.agentId = options.agentId ?? createAgentId(`agent_${Date.now()}`);
    this.name = options.name ?? 'Autonomous Agent';
    this.role = options.role ?? 'General Assistant';
    this.maxSteps = options.maxSteps ?? 15;
    this.llmProvider = options.llmProvider;
    this.llmProviderAccessor = options.llmProviderAccessor;
    this.sessionManager = options.sessionManager;
    this.eventBus = options.eventBus;
    this.logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });
    this.stateMachine = new AgentStateMachine(this.agentId, this.eventBus, this.logger);
  }

  private getActiveLlmProvider(): ILlmProvider | undefined {
    return this.llmProviderAccessor ? this.llmProviderAccessor() : this.llmProvider;
  }

  public get state(): AgentState {
    return this.stateMachine.getState();
  }

  public async executeGoal(
    goalText: string,
    sessionId?: string,
    options?: ExecuteGoalOptions,
  ): Promise<AgentGoalDto> {
    const activeProvider = this.getActiveLlmProvider();
    if (!activeProvider) {
      throw new Error('[AgentCore] no LLM provider configured — cannot run intelligent loop');
    }
    if (!this.sessionManager) {
      throw new Error(
        '[AgentCore] no browser session manager configured — cannot run intelligent loop',
      );
    }

    // Try to recover a starting URL from the goal text; otherwise let the loop
    // begin on a blank page and ask the model to navigate.
    const initialUrl = extractUrl(goalText);

    await this.stateMachine.transitionTo('planning');
    await this.stateMachine.transitionTo('executing');

    const result = await runAgentLoop({
      agentId: this.agentId,
      objective: goalText,
      llmProvider: activeProvider,
      sessionManager: this.sessionManager,
      initialUrl,
      // Drive the caller's browser session when given one — the user's
      // viewport and the agent must share the same live browser.
      ...(sessionId ? { sessionId } : {}),
      // Run-manager plumbing: server-assigned run id, cancellation, live steps.
      ...(options?.goalId ? { goalId: options.goalId } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.onStep ? { onStep: options.onStep } : {}),
      maxSteps: this.maxSteps,
      eventBus: this.eventBus,
      logger: this.logger,
    });

    // Reset to idle before transitioning to terminal state (fixes
    // "completed → verifying" invalid transition on subsequent runs).
    if (this.stateMachine.getState() === 'completed' || this.stateMachine.getState() === 'failed') {
      await this.stateMachine.transitionTo('idle');
    }

    await this.stateMachine.transitionTo('verifying');
    await this.stateMachine.transitionTo(result.status === 'failed' ? 'failed' : 'completed');
    // A cancelled run leaves the agent back at idle — the machine has no
    // cancelled state; the honest cancelled status lives on the result itself.
    // (completed → idle is the only legal hop; never re-enter completed.)
    if (result.status === 'cancelled') {
      await this.stateMachine.transitionTo('idle');
    }

    return {
      id: result.goalId,
      agentId: this.agentId,
      objective: goalText,
      status: result.status,
      createdAt: result.createdAt,
      answer: result.answer,
      summary: result.summary,
      durationMs: result.durationMs,
      steps: result.steps.map((s) => ({
        stepNumber: s.stepNumber,
        reasoning: s.reasoning,
        actionName: s.actionName,
        observation: s.observation,
        success: s.success,
        ...(s.errorMessage ? { errorMessage: s.errorMessage } : {}),
        timestamp: s.timestamp,
      })),
    };
  }
}

/** Extracts the first http(s) URL mentioned in the goal, if any. */
function extractUrl(goal: string): string | undefined {
  const match = goal.match(/https?:\/\/[^\s)"']+/i);
  return match ? match[0] : undefined;
}
