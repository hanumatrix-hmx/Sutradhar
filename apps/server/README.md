---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-007 (Application & Presentation Gateway Context)
Depends on ADRs:
  - 0001-monorepo
Related Packages:
  - '@sutradhar/contracts'
  - '@sutradhar/capability'
  - '@sutradhar/utils'
  - '@sutradhar/config'
  - '@sutradhar/observability'
  - '@sutradhar/events'
  - '@sutradhar/browser'
  - '@sutradhar/llm'
  - '@sutradhar/memory'
  - '@sutradhar/agent'
  - '@sutradhar/workflow'
  - '@sutradhar/storage'
---

# @sutradhar/server

> Platform REST API gateway server, HTTP route handlers, and application controller entrypoint for Sutradhar.

## Package Architectural Invariants

1. **Application Layer Boundary (`CTX-007`)**: Consumes foundational (`CTX-001`) and core domain subsystems (`CTX-002`, `CTX-003`). Must NEVER expose internal database models or domain classes directly over HTTP; all responses MUST be canonical DTOs from `@sutradhar/contracts`.
2. **Zero External HTTP Framework Lock-in**: REST API routing uses native high-performance `ApiRouter` HTTP dispatch primitives without heavy runtime web framework dependencies.

## Sub-Module Layout

- `src/gateway/`: `ServerApp`, `ApiRouter`, HTTP server lifecycle management.
- `src/routes/`: Route controllers (`SessionRoutes`, `AgentRoutes`, `WorkflowRoutes`).
