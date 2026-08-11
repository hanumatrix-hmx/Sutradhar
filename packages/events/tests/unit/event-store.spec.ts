/**
 * @file packages/events/tests/unit/event-store.spec.ts
 * @description Unit tests for InMemoryEventStore, filtering, capacity eviction, and correlation retrieval.
 */

import { InMemoryEventStore } from '../../src/index.js';
import { createDomainEvent, createSessionId } from '@sutradhar/contracts';

describe('InMemoryEventStore', () => {
  it('should append and retrieve events by type and correlationId', async () => {
    const store = new InMemoryEventStore();

    const evt1 = createDomainEvent(
      'browser:session:created',
      { sessionId: createSessionId('sess_1'), createdAt: new Date().toISOString() },
      'corr_abc',
    );

    const evt2 = createDomainEvent(
      'browser:session:closed',
      { sessionId: createSessionId('sess_1'), closedAt: new Date().toISOString() },
      'corr_abc',
    );

    const evt3 = createDomainEvent(
      'agent:state:changed',
      { agentId: 'ag_1' as any, previousState: 'idle', newState: 'running' },
      'corr_xyz',
    );

    await store.append(evt1);
    await store.append(evt2);
    await store.append(evt3);

    const correlationEvents = await store.getEventsByCorrelationId('corr_abc');
    expect(correlationEvents.length).toBe(2);
    expect(correlationEvents[0]?.type).toBe('browser:session:created');
    expect(correlationEvents[1]?.type).toBe('browser:session:closed');

    const agentEvents = await store.getEvents({ type: 'agent:state:changed' });
    expect(agentEvents.length).toBe(1);
    expect(agentEvents[0]?.correlationId).toBe('corr_xyz');
  });

  it('should enforce maxCapacity and evict oldest events', async () => {
    const smallStore = new InMemoryEventStore(2);

    await smallStore.append(createDomainEvent('ev_1', { idx: 1 }));
    await smallStore.append(createDomainEvent('ev_2', { idx: 2 }));
    await smallStore.append(createDomainEvent('ev_3', { idx: 3 }));

    expect(smallStore.getCount()).toBe(2);
    const all = await smallStore.getEvents();
    expect(all[0]?.type).toBe('ev_2');
    expect(all[1]?.type).toBe('ev_3');
  });
});
