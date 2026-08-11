/**
 * @file packages/memory/src/tiers/episodic-memory-store.ts
 * @description EpisodicMemoryStore implementation for agent execution history and temporal queries.
 */

import { MemorySearchQueryDto, MemorySearchResultDto } from '@sutradhar/contracts';
import { BaseMemoryStore } from './base-tier-store.js';
import { MemoryTier } from '../store/memory-tier.js';

export class EpisodicMemoryStore extends BaseMemoryStore {
  public readonly tier: MemoryTier = 'episodic';

  public override async search(
    query: MemorySearchQueryDto,
  ): Promise<readonly MemorySearchResultDto[]> {
    return this.mutex.runExclusive(async () => {
      const results: MemorySearchResultDto[] = [];
      const term = query.query.toLowerCase();
      const limit = query.limit ?? 10;

      // Sort by newest timestamp first for episodic history
      const sortedRecords = Array.from(this.records.values()).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      for (const record of sortedRecords) {
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
}
