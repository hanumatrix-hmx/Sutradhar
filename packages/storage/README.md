---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-001 / CTX-003 (Infrastructure Context - Storage Subsystem)
Depends on ADRs:
  - 0001-monorepo
  - 0007-storage-sqlite
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/capability'
  - '@pinchtab/utils'
  - '@pinchtab/config'
  - '@pinchtab/observability'
  - '@pinchtab/events'
---

# @pinchtab/storage

> File storage abstraction, local filesystem repository, artifact persistence, and SQLite database persistence layer for PinchTab.

## Package Architectural Invariants

1. **Infrastructure Layer Isolation**: Infrastructure persistence package providing storage capabilities to higher-level domain services. Must NEVER import from application or orchestration packages (`packages/orchestrator`, `apps/*`).
2. **Key Path Sanitization**: All file storage keys are strictly validated and path-sanitized to prevent directory traversal (`..`) security vulnerabilities.

## Sub-Module Layout

- `src/file/`: `IFileStorage`, `LocalFileStorage`, local filesystem operations.
- `src/db/`: SQLite database client, repository abstractions, schema migrations.
