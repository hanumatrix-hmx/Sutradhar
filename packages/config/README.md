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
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/utils'
---

# @pinchtab/config

> Strongly typed Zod environment validation, configuration provider, and secrets loading engine for PinchTab.

## Package Architectural Invariants

1. **Foundational Layer Boundary (`CTX-001`)**: Depends strictly on `@pinchtab/contracts` and `@pinchtab/utils`. Must NEVER import from domain, infrastructure, or application packages (`packages/browser`, `packages/orchestrator`, `apps/*`).
2. **Fail-Fast Validation**: System bootstrapping MUST fail fast if environment variables or secrets violate Zod schema definitions.
3. **Secret Isolation**: Secrets (API keys, connection strings) must be masked when serialized or logged.

## Sub-Module Layout

- `src/schema/`: Zod environment schemas for Server, LLM providers, PinchTab, and Storage backends.
- `src/provider/`: `ConfigurationProvider` service implementation.
