---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Related ADRs:
  - 0003-provider-contract
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/browser'
  - '@pinchtab/llm'
  - '@pinchtab/storage'
  - '@pinchtab/config'
---

# Provider Contracts Specification

## 1. Executive Summary

This document defines the core interfaces for all infrastructure provider adapters in the system. The platform strictly enforces Hexagonal Architecture; business logic in `@pinchtab/orchestrator` and `@pinchtab/runtime` NEVER interacts directly with vendor SDKs (such as Playwright, OpenRouter, or Redis). All interactions occur strictly through pure TypeScript contracts exported by `@pinchtab/contracts`.

---

## 2. Browser Provider Contract (`IBrowserProvider`)

```typescript
import {
  SessionId,
  TabId,
  BrowserSessionDto,
  BrowserSnapshotDto,
  BrowserActionDto,
  BrowserActionResultDto,
} from '@pinchtab/contracts';

export interface IBrowserProvider {
  createSession(options: CreateSessionOptions): Promise<BrowserSessionDto>;
  closeSession(sessionId: SessionId): Promise<void>;
  createTab(sessionId: SessionId, url?: string): Promise<TabId>;
  closeTab(sessionId: SessionId, tabId: TabId): Promise<void>;
  takeSnapshot(sessionId: SessionId, tabId: TabId): Promise<BrowserSnapshotDto>;
  executeAction(
    sessionId: SessionId,
    tabId: TabId,
    action: BrowserActionDto,
  ): Promise<BrowserActionResultDto>;
}
```

---

## 3. LLM Provider Contract (`ILLMProvider`)

```typescript
import {
  CompletionRequestDto,
  CompletionResponseDto,
  StreamChunkDto,
  ModelDiscoveryDto,
} from '@pinchtab/contracts';

export interface ILLMProvider {
  readonly providerId: string;
  discoverModels(): Promise<ModelDiscoveryDto[]>;
  generateCompletion(request: CompletionRequestDto): Promise<CompletionResponseDto>;
  generateStream(request: CompletionRequestDto): AsyncIterable<StreamChunkDto>;
}
```

---

## 4. Memory Provider Contract (`IMemoryProvider`)

```typescript
import { MemoryRecordDto, MemorySearchQueryDto, MemorySearchResultDto } from '@pinchtab/contracts';

export interface IMemoryProvider {
  storeMemory(record: MemoryRecordDto): Promise<void>;
  searchMemory(query: MemorySearchQueryDto): Promise<MemorySearchResultDto[]>;
  clearMemory(sessionId: string): Promise<void>;
}
```
