/**
 * @file packages/observability/tests/unit/logger.spec.ts
 * @description Unit tests for StructuredLogger, custom transports, minLevel filtering, and child loggers.
 */

import {
  StructuredLogger,
  ILogTransport,
  LogEntry,
  OBSERVABILITY_VERSION,
} from '../../src/index.js';

describe('@pinchtab/observability StructuredLogger', () => {
  class MemoryLogTransport implements ILogTransport {
    public readonly name = 'MemoryLogTransport';
    public readonly entries: LogEntry[] = [];

    public log(entry: LogEntry): void {
      this.entries.push(entry);
    }
  }

  it('should export correct package version constant', () => {
    expect(OBSERVABILITY_VERSION).toBe('0.1.0');
  });

  it('should emit log entries to registered transports when level meets minLevel threshold', () => {
    const memory = new MemoryLogTransport();
    const logger = new StructuredLogger({
      minLevel: 'info',
      transports: [memory],
    });

    logger.debug('This should be ignored');
    logger.info('System initialized', { port: 3000 });
    logger.error('Database connection failed', {}, new Error('ECONNREFUSED'));

    expect(memory.entries.length).toBe(2);
    expect(memory.entries[0]?.level).toBe('info');
    expect(memory.entries[0]?.message).toBe('System initialized');
    expect(memory.entries[0]?.context).toEqual({ port: 3000 });

    expect(memory.entries[1]?.level).toBe('error');
    expect(memory.entries[1]?.error?.name).toBe('Error');
    expect(memory.entries[1]?.error?.message).toBe('ECONNREFUSED');
  });

  it('should create child logger with merged context and correlationId', () => {
    const memory = new MemoryLogTransport();
    const parentLogger = new StructuredLogger({
      minLevel: 'debug',
      transports: [memory],
      defaultContext: { service: 'agent-service' },
    });

    const childLogger = parentLogger.child({ agentId: 'agent_123' }, 'corr_999');
    childLogger.info('Goal execution started');

    expect(memory.entries.length).toBe(1);
    expect(memory.entries[0]?.correlationId).toBe('corr_999');
    expect(memory.entries[0]?.context).toEqual({
      service: 'agent-service',
      agentId: 'agent_123',
    });
  });
});
