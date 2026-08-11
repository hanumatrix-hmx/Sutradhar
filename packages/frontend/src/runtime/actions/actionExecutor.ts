/**
 * @file packages/frontend/src/runtime/actions/actionExecutor.ts
 * @description ActionExecutor managing action lifecycles, retries, timeouts, and events.
 */

import { BrowserAction } from './browserPageAction.js';
import { ActionContext } from './actionContext.js';
import { ActionResult, ActionLifecycleEvent } from './actionTypes.js';

export type ActionLifecycleListener = (event: ActionLifecycleEvent) => void;

export class ActionExecutor {
  private readonly listeners = new Set<ActionLifecycleListener>();

  public onEvent(listener: ActionLifecycleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ActionLifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener failures
      }
    }
  }

  public async execute<TOutput>(
    action: BrowserAction<any, TOutput>,
    context: ActionContext,
  ): Promise<ActionResult<TOutput>> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    context.logger.info(`Starting execution of action [${action.type}] ${action.name}`);
    this.emit({
      type: 'ActionStarted',
      actionId: action.id,
      actionType: action.type,
      sessionId: context.sessionId,
      timestamp: startedAt,
      attempt: 1,
    });

    // 1. Validation phase
    const validation = await action.validate(context).catch((err) => ({
      valid: false,
      reason: (err as Error).message,
    }));

    if (!validation.valid) {
      const finishedAt = new Date().toISOString();
      const result: ActionResult<TOutput> = {
        actionId: action.id,
        actionType: action.type,
        success: false,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startTime,
        logs:
          context.logger instanceof Object && 'logs' in context.logger
            ? (context.logger as any).logs
            : [],
        artifacts: [],
        metadata: action.metadata as any,
        warnings: [],
        error: {
          code: 'VALIDATION_FAILED',
          message: validation.reason || 'Action validation failed',
        },
      };

      this.emit({
        type: 'ActionFailed',
        actionId: action.id,
        actionType: action.type,
        sessionId: context.sessionId,
        timestamp: finishedAt,
        error: result.error?.message,
        result,
      });

      return result;
    }

    // 2. Execution phase with retries
    const maxAttempts = action.retryPolicy.maxAttempts || 1;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxAttempts) {
      attempt++;

      if (context.cancellationToken?.isCancelled) {
        const finishedAt = new Date().toISOString();
        const result: ActionResult<TOutput> = {
          actionId: action.id,
          actionType: action.type,
          success: false,
          startedAt,
          finishedAt,
          durationMs: Date.now() - startTime,
          logs:
            context.logger instanceof Object && 'logs' in context.logger
              ? (context.logger as any).logs
              : [],
          artifacts: [],
          metadata: action.metadata as any,
          warnings: [],
          error: {
            code: 'ACTION_CANCELLED',
            message: 'Action execution was cancelled by user request',
          },
        };

        this.emit({
          type: 'ActionCancelled',
          actionId: action.id,
          actionType: action.type,
          sessionId: context.sessionId,
          timestamp: finishedAt,
          result,
        });

        return result;
      }

      if (attempt > 1) {
        this.emit({
          type: 'ActionRetried',
          actionId: action.id,
          actionType: action.type,
          sessionId: context.sessionId,
          timestamp: new Date().toISOString(),
          attempt,
        });

        // Compute delay
        let delayMs = action.retryPolicy.initialDelayMs || 50;
        if (action.retryPolicy.strategy === 'ExponentialBackoff') {
          const factor = action.retryPolicy.backoffFactor || 2;
          delayMs = delayMs * Math.pow(factor, attempt - 2);
        }
        await new Promise((r) => setTimeout(r, Math.min(delayMs, 500)));
      }

      try {
        // Enforce timeout via Promise.race
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Action timed out after ${action.timeoutMs}ms`)),
            action.timeoutMs,
          ),
        );

        const executionRes = await Promise.race([action.execute(context), timeoutPromise]);

        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startTime;

        context.logger.info(`Completed action [${action.type}] in ${durationMs}ms`);

        const result: ActionResult<TOutput> = {
          actionId: action.id,
          actionType: action.type,
          success: true,
          startedAt,
          finishedAt,
          durationMs,
          output: executionRes.output,
          artifacts: executionRes.artifacts || [],
          logs:
            context.logger instanceof Object && 'logs' in context.logger
              ? (context.logger as any).logs
              : [],
          metadata: action.metadata as any,
          warnings: [],
        };

        this.emit({
          type: 'ActionCompleted',
          actionId: action.id,
          actionType: action.type,
          sessionId: context.sessionId,
          timestamp: finishedAt,
          result,
        });

        return result;
      } catch (err) {
        lastError = err as Error;
        context.logger.warn(`Action attempt ${attempt} failed: ${lastError.message}`);
      }
    }

    // 3. Execution failed all retries
    const finishedAt = new Date().toISOString();
    const result: ActionResult<TOutput> = {
      actionId: action.id,
      actionType: action.type,
      success: false,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startTime,
      logs:
        context.logger instanceof Object && 'logs' in context.logger
          ? (context.logger as any).logs
          : [],
      artifacts: [],
      metadata: action.metadata as any,
      warnings: [],
      error: {
        code: 'EXECUTION_FAILED',
        message: lastError?.message || 'Unknown execution error',
        stack: lastError?.stack,
      },
    };

    this.emit({
      type: 'ActionFailed',
      actionId: action.id,
      actionType: action.type,
      sessionId: context.sessionId,
      timestamp: finishedAt,
      error: result.error?.message,
      result,
    });

    return result;
  }
}
