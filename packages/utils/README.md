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
  - '@sutradhar/contracts'
---

# @sutradhar/utils

> Pure TypeScript async control limiters, cryptographic helpers, string sanitizers, and DOM formatting utilities for Sutradhar.

## Package Architectural Invariants

1. **Foundational Layer Boundary (`CTX-001`)**: Depends strictly on `@sutradhar/contracts`. Must NEVER import from domain, infrastructure, or application packages (`packages/browser`, `packages/orchestrator`, `apps/*`).
2. **Zero External Runtime NPM Dependencies**: Implemented using pure Web API / Node.js standard library primitives with zero external runtime npm packages.
3. **No Blocking Operations**: Asynchronous synchronization primitives (Mutex, Semaphore, RateLimiter) MUST NEVER block main looper or event dispatching threads.

## Sub-Module Layout

- `src/async/`: `Mutex`, `Semaphore`, `retryWithBackoff`, `RateLimiter` token bucket.
- `src/crypto/`: Hashing, UUID generation, secret encryption helpers.
- `src/formatters/`: DOM semantic tree simplification, HTML cleaning, token count estimation.
