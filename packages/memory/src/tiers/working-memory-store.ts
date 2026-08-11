/**
 * @file packages/memory/src/tiers/working-memory-store.ts
 * @description WorkingMemoryStore implementation for active agent working memory context.
 */

import { BaseMemoryStore } from './base-tier-store.js';
import { MemoryTier } from '../store/memory-tier.js';

export class WorkingMemoryStore extends BaseMemoryStore {
  public readonly tier: MemoryTier = 'working';
}
