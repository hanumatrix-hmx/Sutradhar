/**
 * @file packages/contracts/tests/unit/events.spec.ts
 * @description Unit tests for system event taxonomy and domain event creators.
 */

import {
  createDomainEvent,
  EVENT_PROTOCOL_VERSION,
  BrowserSessionCreatedEventPayload,
} from '../../src/events/index.js';
import { createSessionId } from '../../src/shared/index.js';

describe('System Event Taxonomy', () => {
  it('should instantiate a strongly typed IDomainEvent using createDomainEvent factory', () => {
    const payload: BrowserSessionCreatedEventPayload = {
      sessionId: createSessionId('sess_999'),
      createdAt: new Date().toISOString(),
    };

    const event = createDomainEvent('browser:session:created', payload, 'corr_123');

    expect(event.id).toMatch(/^evt_/);
    expect(event.type).toBe('browser:session:created');
    expect(event.version).toBe(EVENT_PROTOCOL_VERSION);
    expect(event.payload.sessionId).toBe('sess_999');
    expect(event.correlationId).toBe('corr_123');
    expect(typeof event.timestamp).toBe('string');
  });
});
