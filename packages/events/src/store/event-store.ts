/**
 * @file packages/events/src/store/event-store.ts
 * @description In-memory EventStore for event persistence, correlation filtering, and replay.
 */

import { IDomainEvent, Timestamp } from '@pinchtab/contracts';

export interface EventStoreFilterOptions {
  readonly type?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly fromTimestamp?: Timestamp;
  readonly toTimestamp?: Timestamp;
  readonly limit?: number;
}

export interface IEventStore {
  append(event: IDomainEvent): Promise<void>;
  getEvents(filter?: EventStoreFilterOptions): Promise<readonly IDomainEvent[]>;
  getEventsByCorrelationId(correlationId: string): Promise<readonly IDomainEvent[]>;
  clear(): Promise<void>;
}

export class InMemoryEventStore implements IEventStore {
  private readonly events: IDomainEvent[] = [];
  private readonly maxCapacity: number;

  public constructor(maxCapacity = 10000) {
    this.maxCapacity = maxCapacity;
  }

  public async append(event: IDomainEvent): Promise<void> {
    if (this.events.length >= this.maxCapacity) {
      this.events.shift(); // Evict oldest event when capacity reached
    }
    this.events.push(Object.freeze({ ...event }));
  }

  public async getEvents(filter: EventStoreFilterOptions = {}): Promise<readonly IDomainEvent[]> {
    let result = [...this.events];

    if (filter.type) {
      result = result.filter((e) => e.type === filter.type);
    }

    if (filter.correlationId) {
      result = result.filter((e) => e.correlationId === filter.correlationId);
    }

    if (filter.causationId) {
      result = result.filter((e) => e.causationId === filter.causationId);
    }

    if (filter.fromTimestamp) {
      result = result.filter((e) => e.timestamp >= filter.fromTimestamp!);
    }

    if (filter.toTimestamp) {
      result = result.filter((e) => e.timestamp <= filter.toTimestamp!);
    }

    if (filter.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  public async getEventsByCorrelationId(correlationId: string): Promise<readonly IDomainEvent[]> {
    return this.getEvents({ correlationId });
  }

  public async clear(): Promise<void> {
    this.events.length = 0;
  }

  public getCount(): number {
    return this.events.length;
  }
}
