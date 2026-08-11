/**
 * @file packages/observability/src/logger/log-entry.ts
 * @description Standardized LogEntry interface for structured JSON telemetry.
 */

import { Timestamp } from '@sutradhar/contracts';
import { LogLevel } from './log-level.js';

export interface LogEntry {
  readonly timestamp: Timestamp;
  readonly level: LogLevel;
  readonly message: string;
  readonly correlationId?: string;
  readonly context?: Record<string, unknown>;
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
    readonly code?: string;
  };
}
