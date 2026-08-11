---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-001 (Foundational Context)
Depends on ADRs:
  - 0001-monorepo
  - 0003-provider-contract
---

# @sutradhar/contracts

> Canonical TypeScript DTOs, domain primitives, error definitions, and event schemas for the Sutradhar Platform.

## Package Architectural Invariants

1. **Zero External Runtime Dependencies**: `@sutradhar/contracts` contains pure TypeScript types and zero external runtime dependencies.
2. **Foundational Layer Boundary (`CTX-001`)**: Lower-level foundation package. Must NEVER import from domain, infrastructure, or application packages (`packages/browser`, `packages/orchestrator`, `apps/*`).
3. **Immutability**: Shared contract interfaces are the sole source of truth across all system packages.

## Sub-Module Structure

- `src/shared/`: Primitive value objects, branded types, and identifiers (`SessionId`, `AgentId`, `TabId`).
- `src/errors/`: Standard domain error hierarchy extending `BaseDomainError`.
- `src/events/`: Strongly typed event payload schemas.
- `src/dto/`: Data Transfer Objects for Browser, LLM, Agent, Memory, and Tool domains.
- `src/requests/`: Request payload schemas.
- `src/responses/`: Response payload schemas.
