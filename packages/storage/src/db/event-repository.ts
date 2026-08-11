/**
 * @file packages/storage/src/db/event-repository.ts
 * @description Event repository implementation for persisting domain event records.
 */

import { IDomainEvent } from '@sutradhar/contracts';
import { Mutex } from '@sutradhar/utils';
import { StructuredLogger } from '@sutradhar/observability';
import { ISqliteClient } from './sqlite-client.js';

export interface IEventRepository {
  saveEvent(event: IDomainEvent): Promise<void>;
  getEvents(topic?: string): Promise<readonly IDomainEvent[]>;
  clearEvents(): Promise<void>;
}

export class EventRepository implements IEventRepository {
  private readonly eventsList: IDomainEvent[] = [];
  private readonly mutex = new Mutex();
  private readonly logger: StructuredLogger;

  public constructor(_client?: ISqliteClient, logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async saveEvent(event: IDomainEvent): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.eventsList.push(Object.freeze({ ...event }));
      this.logger.debug(`[EventRepository] Persisted domain event ${event.id} (${event.type})`);
    });
  }

  public async getEvents(topic?: string): Promise<readonly IDomainEvent[]> {
    return this.mutex.runExclusive(async () => {
      if (!topic) {
        return [...this.eventsList];
      }
      return this.eventsList.filter((e) => e.type === topic);
    });
  }

  public async clearEvents(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.eventsList.length = 0;
    });
  }
}
