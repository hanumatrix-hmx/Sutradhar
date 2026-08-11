/**
 * @file packages/events/tests/unit/event-bus.spec.ts
 * @description Unit tests for EventBus, subscriber isolation, and wildcard subscriptions.
 */

import { EventBus, EVENTS_VERSION } from '../../src/index.js';
import { createSessionId } from '@pinchtab/contracts';

describe('@pinchtab/events EventBus', () => {
  it('should export correct package version constant', () => {
    expect(EVENTS_VERSION).toBe('0.1.0');
  });

  it('should publish and receive strongly-typed domain events', async () => {
    const bus = new EventBus();
    const receivedEvents: string[] = [];

    bus.subscribe('browser:session:created', (evt) => {
      receivedEvents.push(evt.payload.sessionId);
    });

    await bus.publish(
      'browser:session:created',
      {
        sessionId: createSessionId('sess_555'),
        createdAt: new Date().toISOString(),
      },
      'corr_111',
    );

    expect(receivedEvents).toEqual(['sess_555']);
  });

  it('should isolate subscriber errors without crashing EventBus or other subscribers', async () => {
    const bus = new EventBus();
    const calls: string[] = [];

    bus.subscribe('agent:state:changed', () => {
      throw new Error('Failing subscriber');
    });

    bus.subscribe('agent:state:changed', () => {
      calls.push('success-subscriber');
    });

    await expect(
      bus.publish('agent:state:changed', {
        agentId: 'ag_1' as any,
        previousState: 'idle',
        newState: 'running',
      }),
    ).resolves.not.toThrow();

    expect(calls).toEqual(['success-subscriber']);
  });

  it('should dispatch events to wildcard subscribeAll handlers', async () => {
    const bus = new EventBus();
    const wildcardEvents: string[] = [];

    bus.subscribeAll((evt) => {
      wildcardEvents.push(evt.type);
    });

    await bus.publish('agent:goal:started', {
      agentId: 'ag_1' as any,
      goalId: 'g_1' as any,
      goal: 'Test goal',
    });

    expect(wildcardEvents).toEqual(['agent:goal:started']);
  });
});
