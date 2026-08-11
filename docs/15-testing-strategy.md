---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Related ADRs:
  - 0001-monorepo
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/orchestrator'
---

# Testing Strategy & Quality Assurance

## 1. Testing Pyramid

```
       /  E2E Automation  \       (Playwright E2E against local mock sites)
      / Integration Tests  \      (Contract & provider mock boundary tests)
     /   Unit Test Suite    \     (Vitest / Jest per package, >90% branch coverage)
```

## 2. Quality Enforcement

- **Contract Tests**: Verify that every provider adapter fulfills `@pinchtab/contracts` behavior without breaking.
- **Coverage Budgets**: Core domain logic packages (`@pinchtab/orchestrator`, `@pinchtab/agent`, `@pinchtab/memory`) MUST maintain >90% branch coverage.
