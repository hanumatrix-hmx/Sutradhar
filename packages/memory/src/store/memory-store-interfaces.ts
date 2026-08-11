/**
 * @file packages/memory/src/store/memory-store-interfaces.ts
 * @description Standard interfaces for single-tier memory stores and multi-tier memory management.
 */

import {
  MemoryId,
  MemoryRecordDto,
  MemorySearchQueryDto,
  MemorySearchResultDto,
} from '@pinchtab/contracts';
import { MemoryTier } from './memory-tier.js';

export interface IMemoryStore {
  readonly tier: MemoryTier;
  store(record: MemoryRecordDto): Promise<MemoryId>;
  retrieve(id: MemoryId): Promise<MemoryRecordDto | undefined>;
  search(query: MemorySearchQueryDto): Promise<readonly MemorySearchResultDto[]>;
  delete(id: MemoryId): Promise<boolean>;
  clear(): Promise<void>;
}

export interface IMultiTierMemoryManager {
  getTierStore(tier: MemoryTier): IMemoryStore;
  storeRecord(record: MemoryRecordDto): Promise<MemoryId>;
  searchMultiTier(query: MemorySearchQueryDto): Promise<readonly MemorySearchResultDto[]>;
  clearAllTiers(): Promise<void>;
}
