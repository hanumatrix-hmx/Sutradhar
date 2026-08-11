/**
 * @file apps/server/src/application/memory-app-service.ts
 * @description Application service for multi-tier memory record storage and vector retrieval use cases.
 */

import {
  MemoryId,
  MemoryRecordDto,
  MemorySearchQueryDto,
  MemorySearchResultDto,
} from '@sutradhar/contracts';
import { MultiTierMemoryManager } from '@sutradhar/memory';
import { StructuredLogger } from '@sutradhar/observability';

export class MemoryApplicationService {
  private readonly memoryManager: MultiTierMemoryManager;
  private readonly logger: StructuredLogger;

  public constructor(memoryManager: MultiTierMemoryManager, logger?: StructuredLogger) {
    this.memoryManager = memoryManager;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public async storeRecord(record: MemoryRecordDto): Promise<MemoryId> {
    this.logger.info(
      `[MemoryApplicationService] Storing memory record ${record.id} in tier ${record.tier}`,
    );
    return this.memoryManager.storeRecord(record);
  }

  public async search(query: MemorySearchQueryDto): Promise<readonly MemorySearchResultDto[]> {
    this.logger.info(`[MemoryApplicationService] Querying memory store for: "${query.query}"`);
    return this.memoryManager.searchMultiTier(query);
  }
}
