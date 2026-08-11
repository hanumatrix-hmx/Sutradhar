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
  - '@pinchtab/observability'
---

# @pinchtab/events

> Strongly typed EventBus, handler registry, and event replay store for PinchTab.

## Package Architectural Invariants

1. **Foundational Layer Boundary (`CTX-001`)**: Depends strictly on `@pinchtab/contracts`, `@pinchtab/utils`, and `@pinchtab/observability`. Must NEVER import from domain, infrastructure, or application packages (`packages/browser`, `packages/orchestrator`, `apps/*`).
2. **Zero External Runtime NPM Dependencies**: EventBus and subscriber dispatching are implemented in pure TypeScript.
3. **Error Isolation**: An unhandled exception in an event subscriber MUST NEVER crash the EventBus or prevent other subscribers from receiving the event.

## Sub-Module Layout

- `src/bus/`: `EventBus`, `IEventBus`, `EventHandler`, subscription tokens.
- `src/store/`: `EventStore` in-memory replay buffer.
