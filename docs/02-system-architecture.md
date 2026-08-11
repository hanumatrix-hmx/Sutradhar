---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Related ADRs:
  - 0001-monorepo
  - 0003-provider-contract
  - 0004-runtime-architecture
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/orchestrator'
  - '@pinchtab/runtime'
---

# System Architecture & Bounded Contexts

## 1. Hexagonal Monorepo Architecture

The system is designed as a strict Hexagonal Architecture split into 7 distinct Bounded Contexts comprising 24 packages (`packages/`) and 2 application entry points (`apps/`).

```
┌─────────────────────────────────────────────────────────────┐
│                      APPLICATIONS                           │
│        apps/server (Fastify)        apps/web (Next.js)      │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BOUNDED CONTEXTS                         │
│ 1. Foundational Context    (@pinchtab/contracts, utils, etc)│
│ 2. Core Domain Context     (@pinchtab/agent, browser, llm)  │
│ 3. Governance Context      (@pinchtab/policy)               │
│ 4. Infrastructure Context  (@pinchtab/tools, storage, etc)  │
│ 5. Memory & Workflow       (@pinchtab/memory, workflow)     │
│ 6. Orchestration Context   (@pinchtab/orchestrator, runtime)│
│ 7. Presentation Context    (@pinchtab/ui, sdk)              │
└─────────────────────────────────────────────────────────────┘
```

## 2. Layering & Dependency Rules

1. **Strict Hexagonal Boundaries**: Domain logic (`@pinchtab/agent`, `@pinchtab/browser`) relies strictly on contracts in `@pinchtab/contracts` and never imports directly from infrastructure implementations or presentation apps.
2. **Dependency Direction**: Lower-level packages NEVER import from higher-level packages. Dependencies flow unidirectionally downwards.
3. **Provider Isolation**: Third-party SDKs (PinchTab, Playwright, OpenRouter, Ollama) are encapsulated within adapter implementations in their respective provider packages.
