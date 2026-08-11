/**
 * @file packages/frontend/src/runtime/actions/browserPageAction.ts
 * @description Abstract BrowserAction base class contract.
 */

import { ActionMetadata, RetryPolicy } from './actionTypes.js';
import { ActionContext } from './actionContext.js';

export abstract class BrowserAction<TInput = unknown, TOutput = unknown> {
  public readonly id: string;
  public readonly type: string;
  public readonly name: string;
  public readonly description: string;
  public timeoutMs: number;
  public retryPolicy: RetryPolicy;
  public metadata: ActionMetadata;
  public input: TInput;

  public constructor(config: {
    id?: string;
    type: string;
    name: string;
    description: string;
    input: TInput;
    timeoutMs?: number;
    retryPolicy?: RetryPolicy;
    metadata?: ActionMetadata;
  }) {
    this.id = config.id || `act_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    this.type = config.type;
    this.name = config.name;
    this.description = config.description;
    this.input = config.input;
    this.timeoutMs = config.timeoutMs || 30000;
    this.retryPolicy = config.retryPolicy || {
      strategy: 'NoRetry',
      maxAttempts: 1,
      initialDelayMs: 0,
    };
    this.metadata = config.metadata || { category: 'interaction', requiresBrowserRunning: true };
  }

  public abstract validate(context: ActionContext): Promise<{ valid: boolean; reason?: string }>;

  public abstract execute(context: ActionContext): Promise<{ output: TOutput; artifacts?: any[] }>;

  public estimateDuration(): number {
    return this.timeoutMs / 2;
  }

  public serialize(): Record<string, unknown> {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      description: this.description,
      input: this.input,
      timeoutMs: this.timeoutMs,
      retryPolicy: this.retryPolicy,
      metadata: this.metadata,
    };
  }

  public deserialize(data: Record<string, unknown>): void {
    if (data.input) this.input = data.input as TInput;
    if (data.timeoutMs) this.timeoutMs = Number(data.timeoutMs);
  }
}
