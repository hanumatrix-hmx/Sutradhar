---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-002 (Core Domain Context - Memory Subsystem)
Depends on ADRs:
  - 0001-monorepo
  - 0006-memory
Related Packages:
  - '@sutradhar/contracts'
  - '@sutradhar/capability'
  - '@sutradhar/utils'
  - '@sutradhar/config'
  - '@sutradhar/observability'
  - '@sutradhar/events'
---

# @sutradhar/memory

> Multi-tier memory architecture (working, short-term, episodic, semantic, procedural) and vector retrieval engine for Sutradhar Agents.

## Package Architectural Invariants

1. **Core Domain Isolation (`CTX-002`)**: Depends on foundational infrastructure packages (`CTX-001`). Must NEVER import from application or presentation packages (`apps/server`, `apps/web`).
2. **Multi-Tier Separation**: Segregates volatile working memory, session short-term memory, execution episodic history, vector semantic knowledge, and workflow procedural rules (ADR-0006).
3. **Contract Isolation**: Operates exclusively through canonical `MemoryRecordDto` and `MemorySearchQueryDto` data transfer objects defined in `@sutradhar/contracts`.

## Sub-Module Layout

- `src/store/`: `IMemoryStore`, `IMultiTierMemoryManager`, `MemoryTier` definitions.
- `src/tiers/`: Tier-specific store implementations (`WorkingMemoryStore`, `EpisodicMemoryStore`, etc.).
- `src/vector/`: Hybrid semantic search vector store integration.
