/**
 * @file packages/memory/tests/unit/tiers-manager.spec.ts
 * @description Unit tests for WorkingMemoryStore, SemanticMemoryStore, CosineSimilarity, and MultiTierMemoryManager.
 */

import {
  MultiTierMemoryManager,
  SemanticMemoryStore,
  WorkingMemoryStore,
  cosineSimilarity,
} from '../../src/index.js';
import { createMemoryId, MemoryRecordDto } from '@sutradhar/contracts';

describe('@sutradhar/memory Tiers & Vector Engine', () => {
  it('should compute vector cosine similarity correctly', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];

    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
    expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0);
  });

  it('should perform vector search in SemanticMemoryStore', async () => {
    const store = new SemanticMemoryStore();
    const id1 = createMemoryId('mem_vec_1');
    const id2 = createMemoryId('mem_vec_2');

    const rec1: MemoryRecordDto = {
      id: id1,
      tier: 'semantic',
      content: 'AI research paper',
      metadata: {},
      embedding: [1, 0, 0],
      timestamp: new Date().toISOString(),
    };

    const rec2: MemoryRecordDto = {
      id: id2,
      tier: 'semantic',
      content: 'Baking recipe',
      metadata: {},
      embedding: [0, 1, 0],
      timestamp: new Date().toISOString(),
    };

    await store.store(rec1);
    await store.store(rec2);

    const results = await store.search({
      query: 'AI research',
      embedding: [0.9, 0.1, 0],
      minScore: 0.5,
    } as any);

    expect(results.length).toBe(1);
    expect(results[0]?.record.id).toBe(id1);
    expect(results[0]?.score).toBeGreaterThan(0.8);
  });

  it('should route multi-tier storage and search via MultiTierMemoryManager', async () => {
    const manager = new MultiTierMemoryManager();
    const id1 = createMemoryId('mem_work_1');

    const rec: MemoryRecordDto = {
      id: id1,
      tier: 'working',
      content: 'Active user goal: navigate to github',
      metadata: {},
      timestamp: new Date().toISOString(),
    };

    await manager.storeRecord(rec);

    const searchResults = await manager.searchMultiTier({
      query: 'navigate',
    });

    expect(searchResults.length).toBe(1);
    expect(searchResults[0]?.record.content).toContain('navigate to github');

    await manager.clearAllTiers();
    const emptyResults = await manager.searchMultiTier({ query: 'navigate' });
    expect(emptyResults.length).toBe(0);
  });
});
