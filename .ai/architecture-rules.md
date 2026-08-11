---
State Category: Operational / Persistent
Schema Version: 1.0.0
Machine Readable: true
Update Ownership: Principal Software Architect
Freshness Expectation: Per Change
Update Policy: Change-driven
Last Updated: 2026-07-28
---

# AI Architecture Enforcement Rules

## Stable Bounded Context Identifiers (`CTX-xxx`)

- **`CTX-001` (Foundational Context)**: `@sutradhar/contracts`, `@sutradhar/capability`, `@sutradhar/utils`, `@sutradhar/config`, `@sutradhar/observability`, `@sutradhar/events`.
- **`CTX-002` (Core Domain Context)**: `@sutradhar/agent`, `@sutradhar/browser`, `@sutradhar/llm`, `@sutradhar/memory`, `@sutradhar/knowledge`, `@sutradhar/prompt`, `@sutradhar/workflow`.
- **`CTX-003` (Governance Context)**: `@sutradhar/policy`.
- **`CTX-004` (Infrastructure Context)**: `@sutradhar/tools`, `@sutradhar/storage`, `@sutradhar/queue`, `@sutradhar/registry`, `@sutradhar/plugin`.
- **`CTX-005` (Orchestration & Runtime Context)**: `@sutradhar/orchestrator`, `@sutradhar/runtime`.
- **`CTX-006` (Presentation Context)**: `@sutradhar/ui`, `@sutradhar/sdk`.
- **`CTX-007` (Application Context)**: `apps/server`, `apps/web`.

## Layer Isolation Invariants

1. `CTX-001` packages MUST NOT import from any higher-numbered context (`CTX-002` through `CTX-007`).
2. `CTX-002` domain packages MUST depend strictly on interfaces in `CTX-001` (`@sutradhar/contracts`) and NEVER directly import infrastructure adapters in `CTX-004`.
3. `CTX-007` applications MUST NOT execute direct database or vector store queries; all operations must pass through domain repositories.
