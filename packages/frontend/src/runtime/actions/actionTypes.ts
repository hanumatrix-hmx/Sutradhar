/**
 * @file packages/frontend/src/runtime/actions/actionTypes.ts
 * @description Interfaces for ActionResult, ActionArtifact, RetryPolicy, CancellationToken, and ActionMetadata.
 */

export interface CancellationToken {
  readonly isCancelled: boolean;
  onCancel(callback: () => void): () => void;
}

export class SimpleCancellationToken implements CancellationToken {
  private _isCancelled = false;
  private readonly callbacks = new Set<() => void>();

  public get isCancelled(): boolean {
    return this._isCancelled;
  }

  public cancel(): void {
    if (!this._isCancelled) {
      this._isCancelled = true;
      for (const cb of this.callbacks) {
        cb();
      }
    }
  }

  public onCancel(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
}

export type RetryStrategy = 'NoRetry' | 'FixedRetry' | 'ExponentialBackoff';

export interface RetryPolicy {
  strategy: RetryStrategy;
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor?: number;
}

export interface ActionArtifact {
  id: string;
  name: string;
  type: 'screenshot' | 'download' | 'html' | 'text' | 'log';
  mimeType: string;
  data: string;
  sizeBytes?: number;
}

export interface ActionMetadata {
  category: 'navigation' | 'interaction' | 'data' | 'file';
  author?: string;
  version?: string;
  requiresBrowserRunning?: boolean;
}

export interface ActionResult<T = unknown> {
  actionId: string;
  actionType: string;
  success: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  output?: T;
  logs: string[];
  artifacts: ActionArtifact[];
  metadata: Record<string, unknown>;
  warnings: string[];
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
}

export type ActionLifecycleEventType =
  | 'ActionStarted'
  | 'ActionProgress'
  | 'ActionCompleted'
  | 'ActionFailed'
  | 'ActionCancelled'
  | 'ActionRetried';

export interface ActionLifecycleEvent {
  type: ActionLifecycleEventType;
  actionId: string;
  actionType: string;
  sessionId: string;
  timestamp: string;
  attempt?: number;
  progressPercent?: number;
  result?: ActionResult;
  error?: string;
}
