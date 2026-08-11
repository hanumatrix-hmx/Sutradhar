/**
 * @file packages/memory/tests/unit/memory-shell.spec.ts
 * @description Unit tests for MemoryTier types, IMemoryStore interfaces, and version exports.
 */

import { MEMORY_VERSION, MemoryTier, IMemoryStore } from '../../src/index.js';
import { createMemoryId, MemoryRecordDto } from '@pinchtab/contracts';

describe('@pinchtab/memory Shell & Interfaces', () => {
  it('should export correct package version constant', () => {
    expect(MEMORY_VERSION).toBe('0.1.0');
  });

  it('should compile and validate mock IMemoryStore implementation', async () => {
    class MockMemoryStore implements IMemoryStore {
      public readonly tier: MemoryTier = 'working';
      private readonly records = new Map<string, MemoryRecordDto>();

      public async store(record: MemoryRecordDto): Promise<any> {
        this.records.set(record.id, record);
        return record.id;
      }

      public async retrieve(id: any): Promise<MemoryRecordDto | undefined> {
        return this.records.get(id);
      }

      public async search(): Promise<any[]> {
        return [];
      }

      public async delete(id: any): Promise<boolean> {
        return this.records.delete(id);
      }

      public async clear(): Promise<void> {
        this.records.clear();
      }
    }

    const store = new MockMemoryStore();
    const memoryId = createMemoryId('mem_123');

    const record: MemoryRecordDto = {
      id: memoryId,
      tier: 'working',
      content: 'User prefers dark theme',
      metadata: { key: 'theme' },
      timestamp: new Date().toISOString(),
    };

    await store.store(record);
    const retrieved = await store.retrieve(memoryId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.content).toBe('User prefers dark theme');
    expect(store.tier).toBe('working');
  });
});
