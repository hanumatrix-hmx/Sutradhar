/**
 * @file packages/events/src/bus/event-handler.ts
 * @description EventHandler type aliases and SubscriptionToken interface.
 */

import { IDomainEvent } from '@sutradhar/contracts';

export type EventHandler<TPayload = unknown> = (
  event: IDomainEvent<string, TPayload>,
) => void | Promise<void>;

export interface SubscriptionToken {
  unsubscribe(): void;
}
