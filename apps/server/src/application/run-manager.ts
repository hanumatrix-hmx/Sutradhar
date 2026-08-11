/**
 * @file apps/server/src/application/run-manager.ts
 * @description RunManager — async agent runs with live event frames and cancellation.
 *
 * Phase 4 (live progress & cancel). The manager:
 *   - starts a run with a SERVER-assigned runId (the client never invents ids),
 *   - executes the real agent loop asynchronously, capturing every real step
 *     via the loop's onStep sink into an ordered, replayable frame buffer,
 *   - streams frames to SSE subscribers (replay on (re)connect, then live),
 *   - cancels runs end-to-end by aborting the loop's AbortSignal.
 *
 * Phase 5 (multi-day history). Every run is ALSO persisted through the
 * RunRepository — written at START and updated at END (including
 * failed/cancelled). Retention is indefinite; the in-memory frame buffer is
 * still evicted after a grace period, but the file-backed record survives
 * restarts and serves GET/list/delete once the live run is gone.
 *
 * Honesty doctrine: frames are only ever produced by the real loop. Nothing
 * here synthesizes progress, and a cancelled run reports exactly the steps
 * that executed before Stop.
 */

import { AgentGoalDto, AgentStepTraceDto, RunRecordDto, createGoalId } from '@sutradhar/contracts';
import { AgentCore, AgentLoopStep } from '@sutradhar/agent';
import { FallbackLlmProvider } from '@sutradhar/llm';
import { StructuredLogger } from '@sutradhar/observability';
import { RunRepository } from './run-repository.js';

/** One SSE frame for a run: real lifecycle data, ordered and replayable. */
export interface RunFrame {
  readonly id: number;
  readonly event: 'started' | 'step' | 'result';
  readonly data: unknown;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ManagedRun {
  readonly runId: string;
  readonly goal: string;
  readonly sessionId?: string;
  readonly startedAt: string;
  status: RunStatus;
  endedAt?: string;
  result?: AgentGoalDto;
  error?: string;
  frames: RunFrame[];
  controller: AbortController;
}

export interface StartRunCommand {
  readonly goal: string;
  /** Client session id — binds the loop to the client's backend browser session. */
  readonly sessionId?: string;
}

/** How long a finished run's LIVE frames stay in memory. The persisted
 *  record is kept INDEFINITELY in storage — this only bounds memory. */
const FINISHED_RUN_TTL_MS = 10 * 60 * 1000;

export interface RunManagerOptions {
  readonly repository: RunRepository;
  /** Exposes which provider actually served the run (honest history metadata). */
  readonly llmProvider?: FallbackLlmProvider;
  /** Optional accessor for runtime-reconfigurable provider (Phase 6 fix). */
  readonly llmProviderAccessor?: () => FallbackLlmProvider;
  readonly logger?: StructuredLogger;
}

export class RunManager {
  private readonly agentCore: AgentCore;
  private readonly repository: RunRepository;
  private readonly llmProvider?: FallbackLlmProvider;
  private readonly llmProviderAccessor?: () => FallbackLlmProvider;
  private readonly logger: StructuredLogger;
  private readonly runs = new Map<string, ManagedRun>();
  private readonly listeners = new Map<string, Set<(frame: RunFrame) => void>>();
  private frameSeq = 0;

  public constructor(agentCore: AgentCore, options: RunManagerOptions) {
    this.agentCore = agentCore;
    this.repository = options.repository;
    this.llmProvider = options.llmProvider;
    this.llmProviderAccessor = options.llmProviderAccessor;
    this.logger = options.logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  private getActiveLlmProvider(): FallbackLlmProvider | undefined {
    return this.llmProviderAccessor ? this.llmProviderAccessor() : this.llmProvider;
  }

  /**
   * Starts a run and returns the server-assigned runId immediately. The goal
   * executes asynchronously; progress is observable via subscribe()/frames.
   */
  public startRun(command: StartRunCommand): string {
    const runId = `run_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const run: ManagedRun = {
      runId,
      goal: command.goal,
      ...(command.sessionId ? { sessionId: command.sessionId } : {}),
      startedAt: new Date().toISOString(),
      status: 'running',
      frames: [],
      controller: new AbortController(),
    };
    this.runs.set(runId, run);
    this.logger.info('[RunManager] Run started', { runId, goal: command.goal });

    // Write-through at START: the record exists from the first moment, so a
    // crash mid-run still leaves an honest 'running' record behind.
    void this.repository.save(this.toRecord(run));

    this.pushFrame(run, 'started', {
      runId,
      goal: command.goal,
      ...(command.sessionId ? { sessionId: command.sessionId } : {}),
      startedAt: run.startedAt,
    });

    // Fire and track: the loop runs async; the frame buffer + result make it
    // observable. The runId doubles as the loop's goalId so run, events, and
    // result all share one identifier.
    void this.agentCore
      .executeGoal(command.goal, command.sessionId, {
        goalId: createGoalId(runId),
        signal: run.controller.signal,
        onStep: (step: AgentLoopStep) => this.pushFrame(run, 'step', step),
      })
      .then((dto) => {
        run.status = this.mapStatus(dto.status);
        run.result = dto;
        run.endedAt = new Date().toISOString();
        this.pushFrame(run, 'result', dto);
        // Update at END — every terminal state lands in storage.
        void this.repository.save(this.toRecord(run));
        this.logger.info('[RunManager] Run finished', { runId, status: run.status });
        this.scheduleEviction(runId);
      })
      .catch((err: unknown) => {
        // An abort that surfaced as a rejection is still a user cancel —
        // report it honestly instead of dressing it up as a failure.
        const wasCancelled = run.controller.signal.aborted;
        run.status = wasCancelled ? 'cancelled' : 'failed';
        run.error = wasCancelled ? undefined : (err as Error).message ?? 'Unknown agent failure';
        run.endedAt = new Date().toISOString();
        this.pushFrame(run, 'result', {
          status: run.status,
          ...(run.error ? { error: run.error } : { summary: 'Run cancelled by user.' }),
        });
        // Failed/cancelled runs are persisted too — history must be honest.
        void this.repository.save(this.toRecord(run));
        this.logger.error('[RunManager] Run failed', { runId, status: run.status }, err);
        this.scheduleEviction(runId);
      });

    return runId;
  }

  /**
   * Cancels a running run. The loop honors the abort at the next step
   * boundary — an in-flight LLM call finishes first, which is reported
   * honestly: the terminal frame arrives with status 'cancelled'.
   * Returns false when the run is unknown or already finished.
   */
  public cancelRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') return false;
    this.logger.info('[RunManager] Run cancel requested', { runId });
    run.controller.abort();
    return true;
  }

  public getRun(runId: string): ManagedRun | undefined {
    return this.runs.get(runId);
  }

  /**
   * The persisted record for a run: live memory first (authoritative while
   * the run is in-flight or freshly finished), then the storage file. This
   * is what survives restarts — the backbone of multi-day history.
   */
  public async getRunRecord(runId: string): Promise<RunRecordDto | undefined> {
    const live = this.runs.get(runId);
    if (live) return this.toRecord(live);
    return this.repository.get(runId);
  }

  /**
   * History listing: storage records merged with any live runs (memory wins
   * on id collisions), newest first, with optional filters.
   */
  public async listRuns(filter: {
    sessionId?: string;
    status?: string;
    from?: string;
    to?: string;
  } = {}): Promise<readonly RunRecordDto[]> {
    const stored = await this.repository.list();
    const byId = new Map<string, RunRecordDto>(stored.map((r) => [r.runId, r]));
    for (const live of this.runs.values()) {
      byId.set(live.runId, this.toRecord(live));
    }
    const all = [...byId.values()].filter((r) => {
      if (filter.sessionId && r.sessionId !== filter.sessionId) return false;
      if (filter.status && r.status !== filter.status) return false;
      if (filter.from && r.startedAt < filter.from) return false;
      if (filter.to && r.startedAt > filter.to) return false;
      return true;
    });
    return all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  /**
   * Explicit, user-driven deletion (the UI always confirms first). Running
   * runs cannot be deleted — cancel them instead. Returns 'not-found' |
   * 'running' | 'deleted'.
   */
  public async deleteRun(runId: string): Promise<'not-found' | 'running' | 'deleted'> {
    const live = this.runs.get(runId);
    if (live?.status === 'running') return 'running';
    const existed = await this.repository.delete(runId);
    this.runs.delete(runId);
    this.listeners.delete(runId);
    return existed ? 'deleted' : 'not-found';
  }

  /**
   * Subscribes to a run's frames. All buffered frames are replayed
   * synchronously first (so reconnects lose nothing), then live frames
   * follow. Returns an unsubscribe function, or undefined for unknown runs.
   */
  public subscribe(runId: string, listener: (frame: RunFrame) => void): (() => void) | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;

    for (const frame of run.frames) {
      listener(frame);
    }

    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
    };
  }

  private pushFrame(run: ManagedRun, event: RunFrame['event'], data: unknown): void {
    const frame: RunFrame = { id: ++this.frameSeq, event, data };
    run.frames.push(frame);
    const set = this.listeners.get(run.runId);
    if (set) {
      for (const listener of set) {
        try {
          listener(frame);
        } catch {
          // A dead listener must never break the fan-out to live subscribers.
        }
      }
    }
  }

  private mapStatus(status: AgentGoalDto['status']): RunStatus {
    if (status === 'cancelled') return 'cancelled';
    if (status === 'failed') return 'failed';
    if (status === 'completed') return 'completed';
    return 'running';
  }

  /**
   * Maps the in-memory run to the canonical persisted record. Steps come
   * from the terminal result when present; otherwise they are recovered
   * from the real step frames (the transport-failure path still keeps an
   * honest trace).
   */
  private toRecord(run: ManagedRun): RunRecordDto {
    const resultSteps = run.result?.steps;
    const steps: readonly AgentStepTraceDto[] =
      resultSteps ??
      run.frames
        .filter((f) => f.event === 'step')
        .map((f) => f.data as AgentStepTraceDto);
    const durationMs = run.endedAt
      ? Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt))
      : undefined;
    return {
      runId: run.runId,
      ...(run.sessionId ? { sessionId: run.sessionId } : {}),
      goal: run.goal,
      status: run.status,
      startedAt: run.startedAt,
      ...(run.endedAt ? { endedAt: run.endedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      // Honest provider attribution: whichever link of the fallback chain
      // actually served the run (never the chain's own id).
      ...(this.getActiveLlmProvider() ? { provider: this.getActiveLlmProvider()!.activeProviderId } : {}),
      steps,
      ...(run.result?.answer ? { answer: run.result.answer } : {}),
      ...(run.result?.summary ? { summary: run.result.summary } : {}),
      ...(run.error ? { error: run.error } : {}),
      ...(run.result ? { result: run.result } : {}),
    };
  }

  /**
   * Bounds memory only: live frames/listeners for finished runs are dropped
   * after the grace period. The persisted record stays INDEFINITELY in
   * storage — history queries fall through to the file.
   */
  private scheduleEviction(runId: string): void {
    setTimeout(() => {
      this.runs.delete(runId);
      this.listeners.delete(runId);
    }, FINISHED_RUN_TTL_MS).unref?.();
  }
}
