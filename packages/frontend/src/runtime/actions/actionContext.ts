/**
 * @file packages/frontend/src/runtime/actions/actionContext.ts
 * @description ActionContext providing dependencies to BrowserAction.execute().
 */

import { BrowserRuntime } from '../browser/browserRuntime.js';
import { IBrowserAdapter } from '../browser/adapters/browserAdapter.js';
import { CancellationToken } from './actionTypes.js';

export interface ActionLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export class DefaultActionLogger implements ActionLogger {
  public logs: string[] = [];

  public info(message: string, _context?: Record<string, unknown>): void {
    this.logs.push(`[INFO] ${new Date().toISOString()} - ${message}`);
  }

  public warn(message: string, _context?: Record<string, unknown>): void {
    this.logs.push(`[WARN] ${new Date().toISOString()} - ${message}`);
  }

  public error(message: string, _context?: Record<string, unknown>): void {
    this.logs.push(`[ERROR] ${new Date().toISOString()} - ${message}`);
  }
}

export interface ActionContext {
  readonly sessionId: string;
  readonly browserRuntime: BrowserRuntime;
  readonly browserAdapter: IBrowserAdapter;
  readonly logger: ActionLogger;
  readonly cancellationToken?: CancellationToken;
  readonly variables: Record<string, unknown>;
  readonly environment: Record<string, string>;
}
