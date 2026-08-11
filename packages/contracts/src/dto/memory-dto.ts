/**
 * @file packages/contracts/src/dto/memory-dto.ts
 * @description Canonical DTOs for Multi-Tier Memory Store.
 */

import { MemoryId, SessionId } from '../shared/identifiers.js';
import { Timestamp } from '../shared/primitives.js';

export interface MemoryRecordDto {
  readonly id: MemoryId;
  readonly sessionId?: SessionId;
  readonly tier: 'working' | 'short_term' | 'episodic' | 'semantic' | 'procedural';
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly embedding?: readonly number[];
  readonly timestamp: Timestamp;
}

export interface MemorySearchQueryDto {
  readonly query: string;
  readonly tier?: 'semantic' | 'procedural' | 'episodic';
  readonly limit?: number;
  readonly minScore?: number;
}

export interface MemorySearchResultDto {
  readonly record: MemoryRecordDto;
  readonly score: number;
}
