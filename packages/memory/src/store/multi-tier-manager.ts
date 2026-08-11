/**
 * @file packages/memory/src/store/multi-tier-manager.ts
 * @description Centralized MultiTierMemoryManager coordinating multi-tier storage and query retrieval.
 */

import {
  MemoryId,
  MemoryRecordDto,
  MemorySearchQueryDto,
  MemorySearchResultDto,
} from '@sutradhar/contracts';
import { StructuredLogger } from '@sutradhar/observability';
import { IMemoryStore, IMultiTierMemoryManager } from './memory-store-interfaces.js';
import { MemoryTier } from './memory-tier.js';
import { WorkingMemoryStore } from '../tiers/working-memory-store.js';
import { EpisodicMemoryStore } from '../tiers/episodic-memory-store.js';
import { SemanticMemoryStore } from '../tiers/semantic-memory-store.js';

export class MultiTierMemoryManager implements IMultiTierMemoryManager {
  private readonly tierStores = new Map<MemoryTier, IMemoryStore>();
  private readonly logger: StructuredLogger;

  public constructor(logger?: StructuredLogger) {
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });

    // Initialize all default memory tier stores
    this.tierStores.set('working', new WorkingMemoryStore());
    this.tierStores.set('short_term', new WorkingMemoryStore());
    this.tierStores.set('episodic', new EpisodicMemoryStore());
    this.tierStores.set('semantic', new SemanticMemoryStore());
    this.tierStores.set('procedural', new WorkingMemoryStore());
  }

  public getTierStore(tier: MemoryTier): IMemoryStore {
    const store = this.tierStores.get(tier);
    if (!store) {
      throw new Error(`Memory store for tier ${tier} not found`);
    }
    return store;
  }

  public async storeRecord(record: MemoryRecordDto): Promise<MemoryId> {
    const store = this.getTierStore(record.tier);
    const id = await store.store(record);
    this.logger.debug(`[MultiTierMemoryManager] Stored record ${id} in tier ${record.tier}`);
    return id;
  }

  public async searchMultiTier(
    query: MemorySearchQueryDto,
  ): Promise<readonly MemorySearchResultDto[]> {
    const results: MemorySearchResultDto[] = [];
    const limit = query.limit ?? 10;

    if (query.tier) {
      const store = this.getTierStore(query.tier);
      return store.search(query);
    }

    // Parallel multi-tier query evaluation
    const promises: Promise<readonly MemorySearchResultDto[]>[] = [];
    for (const store of this.tierStores.values()) {
      promises.push(store.search(query));
    }

    const tierResults = await Promise.all(promises);
    for (const batch of tierResults) {
      results.push(...batch);
    }

    // Sort by highest score across all tiers
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  public async clearAllTiers(): Promise<void> {
    for (const store of this.tierStores.values()) {
      await store.clear();
    }
    this.logger.info('[MultiTierMemoryManager] Cleared all memory tiers');
  }
}
