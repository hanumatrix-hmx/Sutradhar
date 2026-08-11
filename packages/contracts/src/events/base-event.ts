/**
 * @file packages/contracts/src/events/base-event.ts
 * @description Base interface and factory for strongly typed domain events.
 */

import { Timestamp } from '../shared/primitives.js';

export const EVENT_PROTOCOL_VERSION = '1.0.0';

export interface IDomainEvent<TType extends string = string, TPayload = unknown> {
  readonly id: string;
  readonly type: TType;
  readonly timestamp: Timestamp;
  readonly version: string;
  readonly payload: TPayload;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export function createDomainEvent<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  correlationId?: string,
  causationId?: string,
): IDomainEvent<TType, TPayload> {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    type,
    timestamp: new Date().toISOString(),
    version: EVENT_PROTOCOL_VERSION,
    payload,
    ...(correlationId ? { correlationId } : {}),
    ...(causationId ? { causationId } : {}),
  };
}
