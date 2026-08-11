/**
 * @file packages/memory/src/tiers/base-tier-store.ts
 * @description Abstract BaseMemoryStore providing thread-safe storage primitives via Mutex locks.
 */

import {
  MemoryId,
  MemoryRecordDto,
  MemorySearchQueryDto,
  MemorySearchResultDto,
} from '@sutradhar/contracts';
import { Mutex } from '@sutradhar/utils';
import { IMemoryStore } from '../store/memory-store-interfaces.js';
import { MemoryTier } from '../store/memory-tier.js';

export abstract class BaseMemoryStore implements IMemoryStore {
  public abstract readonly tier: MemoryTier;
  protected readonly records = new Map<MemoryId, MemoryRecordDto>();
  protected readonly mutex = new Mutex();

  public async store(record: MemoryRecordDto): Promise<MemoryId> {
    return this.mutex.runExclusive(async () => {
      this.records.set(record.id, Object.freeze({ ...record, tier: this.tier }));
      return record.id;
    });
  }

  public async retrieve(id: MemoryId): Promise<MemoryRecordDto | undefined> {
    return this.mutex.runExclusive(async () => {
      return this.records.get(id);
    });
  }

  public async search(query: MemorySearchQueryDto): Promise<readonly MemorySearchResultDto[]> {
    return this.mutex.runExclusive(async () => {
      const results: MemorySearchResultDto[] = [];
      const term = query.query.toLowerCase();
      const limit = query.limit ?? 10;

      for (const record of this.records.values()) {
        if (record.content.toLowerCase().includes(term)) {
          results.push({
            record,
            score: 1.0,
          });
        }
        if (results.length >= limit) {
          break;
        }
      }

      return results;
    });
  }

  public async delete(id: MemoryId): Promise<boolean> {
    return this.mutex.runExclusive(async () => {
      return this.records.delete(id);
    });
  }

  public async clear(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.records.clear();
    });
  }

  public getCount(): number {
    return this.records.size;
  }
}
