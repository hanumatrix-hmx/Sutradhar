/**
 * @file packages/memory/src/tiers/semantic-memory-store.ts
 * @description SemanticMemoryStore implementation for vector embedding search and cosine similarity retrieval.
 */

import { MemorySearchQueryDto, MemorySearchResultDto } from '@pinchtab/contracts';
import { BaseMemoryStore } from './base-tier-store.js';
import { MemoryTier } from '../store/memory-tier.js';
import { cosineSimilarity } from '../vector/cosine-similarity.js';

export class SemanticMemoryStore extends BaseMemoryStore {
  public readonly tier: MemoryTier = 'semantic';

  /**
   * Performs vector semantic similarity search using query embeddings or text matching fallback.
   */
  public override async search(
    query: MemorySearchQueryDto,
  ): Promise<readonly MemorySearchResultDto[]> {
    return this.mutex.runExclusive(async () => {
      const results: MemorySearchResultDto[] = [];
      const limit = query.limit ?? 10;
      const minScore = query.minScore ?? 0.0;

      // Extract optional query embedding vector from query options if present
      const queryEmbedding = (query as { embedding?: readonly number[] }).embedding;

      for (const record of this.records.values()) {
        let score = 0.0;

        if (queryEmbedding && record.embedding && record.embedding.length > 0) {
          score = cosineSimilarity(queryEmbedding, record.embedding);
        } else {
          // Fallback text match score calculation
          const textMatch = record.content.toLowerCase().includes(query.query.toLowerCase());
          score = textMatch ? 0.8 : 0.0;
        }

        if (score >= minScore) {
          results.push({ record, score });
        }
      }

      // Sort by highest similarity score first
      results.sort((a, b) => b.score - a.score);

      return results.slice(0, limit);
    });
  }
}
