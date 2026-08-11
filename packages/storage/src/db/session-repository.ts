/**
 * @file packages/storage/src/db/session-repository.ts
 * @description Session repository implementation for persisting BrowserSessionDto records.
 */

import { SessionId, BrowserSessionDto } from '@sutradhar/contracts';
import { Mutex } from '@sutradhar/utils';
import { StructuredLogger } from '@sutradhar/observability';
import { ISqliteClient } from './sqlite-client.js';

export interface ISessionRepository {
  saveSession(dto: BrowserSessionDto): Promise<void>;
  findSession(id: SessionId): Promise<BrowserSessionDto | undefined>;
  listSessions(): Promise<readonly BrowserSessionDto[]>;
  deleteSession(id: SessionId): Promise<boolean>;
}

export class SessionRepository implements ISessionRepository {
  private readonly sessionsMap = new Map<SessionId, BrowserSessionDto>();
  private readonly mutex = new Mutex();
  private readonly logger: StructuredLogger;

  public constructor(_client?: ISqliteClient, logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async saveSession(dto: BrowserSessionDto): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.sessionsMap.set(dto.id, Object.freeze({ ...dto }));
      this.logger.debug(`[SessionRepository] Saved session ${dto.id}`);
    });
  }

  public async findSession(id: SessionId): Promise<BrowserSessionDto | undefined> {
    return this.mutex.runExclusive(async () => {
      return this.sessionsMap.get(id);
    });
  }

  public async listSessions(): Promise<readonly BrowserSessionDto[]> {
    return this.mutex.runExclusive(async () => {
      return Array.from(this.sessionsMap.values());
    });
  }

  public async deleteSession(id: SessionId): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      return this.sessionsMap.delete(id);
    });
  }
}
