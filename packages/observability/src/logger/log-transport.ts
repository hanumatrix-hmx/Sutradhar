/**
 * @file packages/observability/src/logger/log-transport.ts
 * @description Pluggable log transport interface for log aggregators and stdout.
 */

import { LogEntry } from './log-entry.js';

export interface ILogTransport {
  readonly name: string;
  log(entry: LogEntry): void;
}
