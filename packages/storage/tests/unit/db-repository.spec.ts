/**
 * @file packages/storage/tests/unit/db-repository.spec.ts
 * @description Unit tests for SqliteClient, SessionRepository, and EventRepository.
 */

import { SqliteClient, SessionRepository, EventRepository } from '../../src/index.js';
import {
  createSessionId,
  createEventId,
  createCorrelationId,
  BrowserSessionDto,
  IDomainEvent,
} from '@pinchtab/contracts';

describe('@pinchtab/storage Database & Repository Layer', () => {
  it('should initialize SqliteClient and execute queries', async () => {
    const client = new SqliteClient(':memory:');
    const result = await client.execute('CREATE TABLE IF NOT EXISTS test (id TEXT)');
    expect(result.rowsAffected).toBe(1);

    await client.close();
  });

  it('should persist and retrieve BrowserSessionDto via SessionRepository', async () => {
    const repo = new SessionRepository();
    const sessionId = createSessionId('sess_db_1');

    const dto: BrowserSessionDto = {
      id: sessionId,
      tabs: [],
      createdAt: new Date().toISOString(),
      isIncognito: false,
    };

    await repo.saveSession(dto);
    const found = await repo.findSession(sessionId);

    expect(found).toBeDefined();
    expect(found?.id).toBe(sessionId);

    const list = await repo.listSessions();
    expect(list.length).toBe(1);

    const deleted = await repo.deleteSession(sessionId);
    expect(deleted).toBe(true);
  });

  it('should persist and query domain events via EventRepository', async () => {
    const repo = new EventRepository();

    const event: IDomainEvent = {
      id: createEventId('evt_1'),
      type: 'agent:state:changed',
      version: '1.0.0',
      payload: { state: 'executing' },
      timestamp: new Date().toISOString(),
      correlationId: createCorrelationId('corr_1'),
    };

    await repo.saveEvent(event);
    const events = await repo.getEvents('agent:state:changed');

    expect(events.length).toBe(1);
    expect(events[0]?.id).toBe('evt_1');
  });
});
