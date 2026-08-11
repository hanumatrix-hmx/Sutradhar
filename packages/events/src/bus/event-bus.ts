/**
 * @file packages/events/src/bus/event-bus.ts
 * @description Strongly typed in-memory EventBus with async handler dispatch and error isolation.
 */

import { IDomainEvent, DomainEventMap, createDomainEvent } from '@pinchtab/contracts';
import { StructuredLogger } from '@pinchtab/observability';
import { EventHandler, SubscriptionToken } from './event-handler.js';

export interface IEventBus<TEventMap = DomainEventMap> {
  publish<K extends keyof TEventMap & string>(
    type: K,
    payload: TEventMap[K],
    correlationId?: string,
    causationId?: string,
  ): Promise<void>;

  publishEvent(event: IDomainEvent): Promise<void>;

  subscribe<K extends keyof TEventMap & string>(
    type: K,
    handler: EventHandler<TEventMap[K]>,
  ): SubscriptionToken;

  subscribeAll(handler: EventHandler<unknown>): SubscriptionToken;
}

export class EventBus implements IEventBus<DomainEventMap> {
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();
  private readonly wildcardHandlers = new Set<EventHandler<unknown>>();
  private readonly logger: StructuredLogger;

  public constructor(logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async publish<K extends keyof DomainEventMap & string>(
    type: K,
    payload: DomainEventMap[K],
    correlationId?: string,
    causationId?: string,
  ): Promise<void> {
    const event = createDomainEvent(type, payload, correlationId, causationId);
    await this.publishEvent(event);
  }

  public async publishEvent(event: IDomainEvent): Promise<void> {
    this.logger.debug(`[EventBus] Publishing event ${event.type}`, {
      eventId: event.id,
      correlationId: event.correlationId,
      causationId: event.causationId,
    });

    const specificHandlers = this.handlers.get(event.type);
    const promises: Promise<void>[] = [];

    if (specificHandlers) {
      for (const handler of specificHandlers) {
        promises.push(this.invokeHandlerSafely(handler, event));
      }
    }

    for (const handler of this.wildcardHandlers) {
      promises.push(this.invokeHandlerSafely(handler, event));
    }

    await Promise.all(promises);
  }

  private async invokeHandlerSafely(
    handler: EventHandler<unknown>,
    event: IDomainEvent,
  ): Promise<void> {
    try {
      await handler(event);
    } catch (error: unknown) {
      this.logger.error(
        `[EventBus] Error in event subscriber for ${event.type}`,
        { eventId: event.id },
        error,
      );
    }
  }

  public subscribe<K extends keyof DomainEventMap & string>(
    type: K,
    handler: EventHandler<DomainEventMap[K]>,
  ): SubscriptionToken {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const set = this.handlers.get(type)!;
    const genericHandler = handler as EventHandler<unknown>;
    set.add(genericHandler);

    return {
      unsubscribe: (): void => {
        set.delete(genericHandler);
      },
    };
  }

  public subscribeAll(handler: EventHandler<unknown>): SubscriptionToken {
    this.wildcardHandlers.add(handler);
    return {
      unsubscribe: (): void => {
        this.wildcardHandlers.delete(handler);
      },
    };
  }

  public getSubscriberCount(type?: string): number {
    if (type) {
      return (this.handlers.get(type)?.size ?? 0) + this.wildcardHandlers.size;
    }
    let total = this.wildcardHandlers.size;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }
}
