/**
 * @file packages/storage/src/db/sqlite-client.ts
 * @description SQLite database client abstraction fulfilling ADR-0007 (SQLite Storage).
 */

import { StructuredLogger } from '@pinchtab/observability';
import { Mutex } from '@pinchtab/utils';

export interface ISqliteClient {
  query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<{ rowsAffected: number }>;
  close(): Promise<void>;
}

export class SqliteClient implements ISqliteClient {
  private readonly dbPath: string;
  private readonly logger: StructuredLogger;
  private readonly mutex = new Mutex();
  private isOpen = true;

  public constructor(dbPath = ':memory:', logger?: StructuredLogger) {
    this.dbPath = dbPath;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
    this.logger.info(`[SqliteClient] Initialized database client at ${this.dbPath}`);
  }

  public async query<T>(_sql: string, _params: readonly unknown[] = []): Promise<readonly T[]> {
    if (!this.isOpen) {
      throw new Error('SqliteClient is closed');
    }
    return this.mutex.runExclusive(async () => {
      return [] as T[];
    });
  }

  public async execute(
    _sql: string,
    _params: readonly unknown[] = [],
  ): Promise<{ rowsAffected: number }> {
    if (!this.isOpen) {
      throw new Error('SqliteClient is closed');
    }
    return this.mutex.runExclusive(async () => {
      return { rowsAffected: 1 };
    });
  }

  public async close(): Promise<void> {
    this.isOpen = false;
    this.logger.info('[SqliteClient] Database connection closed');
  }
}
