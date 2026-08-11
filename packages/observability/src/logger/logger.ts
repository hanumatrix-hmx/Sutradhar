/**
 * @file packages/observability/src/logger/logger.ts
 * @description StructuredLogger class with minLevel filtering, child contextual loggers, and transport dispatch.
 */

import { LogLevel, LOG_LEVEL_PRIORITY } from './log-level.js';
import { LogEntry } from './log-entry.js';
import { ILogTransport } from './log-transport.js';
import { ConsoleLogTransport } from './console-transport.js';

export interface LoggerOptions {
  readonly minLevel?: LogLevel;
  readonly transports?: readonly ILogTransport[];
  readonly defaultContext?: Record<string, unknown>;
  readonly correlationId?: string;
}

export class StructuredLogger {
  private readonly minLevel: LogLevel;
  private readonly transports: readonly ILogTransport[];
  private readonly defaultContext: Record<string, unknown>;
  private readonly correlationId?: string;

  public constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? 'info';
    this.transports = options.transports ?? [new ConsoleLogTransport()];
    this.defaultContext = options.defaultContext ?? {};
    this.correlationId = options.correlationId;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    let parsedError: LogEntry['error'] | undefined = undefined;
    if (error instanceof Error) {
      parsedError = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as { code?: string }).code,
      };
    } else if (error) {
      parsedError = {
        name: 'UnknownError',
        message: String(error),
      };
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(this.correlationId ? { correlationId: this.correlationId } : {}),
      context: { ...this.defaultContext, ...context },
      ...(parsedError ? { error: parsedError } : {}),
    };

    for (const transport of this.transports) {
      transport.log(entry);
    }
  }

  public trace(message: string, context?: Record<string, unknown>): void {
    this.emit('trace', message, context);
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.emit('debug', message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.emit('warn', message, context, error);
  }

  public error(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.emit('error', message, context, error);
  }

  public fatal(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.emit('fatal', message, context, error);
  }

  /**
   * Creates a child logger with bound contextual properties.
   */
  public child(childContext: Record<string, unknown>, correlationId?: string): StructuredLogger {
    return new StructuredLogger({
      minLevel: this.minLevel,
      transports: this.transports,
      defaultContext: { ...this.defaultContext, ...childContext },
      correlationId: correlationId ?? this.correlationId,
    });
  }
}
