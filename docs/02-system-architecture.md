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
  - '@sutradhar/contracts'
  - '@sutradhar/orchestrator'
  - '@sutradhar/runtime'
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
│ 1. Foundational Context    (@sutradhar/contracts, utils, etc)│
│ 2. Core Domain Context     (@sutradhar/agent, browser, llm)  │
│ 3. Governance Context      (@sutradhar/policy)               │
│ 4. Infrastructure Context  (@sutradhar/tools, storage, etc)  │
│ 5. Memory & Workflow       (@sutradhar/memory, workflow)     │
│ 6. Orchestration Context   (@sutradhar/orchestrator, runtime)│
│ 7. Presentation Context    (@sutradhar/ui, sdk)              │
└─────────────────────────────────────────────────────────────┘
```

## 2. Layering & Dependency Rules

1. **Strict Hexagonal Boundaries**: Domain logic (`@sutradhar/agent`, `@sutradhar/browser`) relies strictly on contracts in `@sutradhar/contracts` and never imports directly from infrastructure implementations or presentation apps.
2. **Dependency Direction**: Lower-level packages NEVER import from higher-level packages. Dependencies flow unidirectionally downwards.
3. **Provider Isolation**: Third-party SDKs (Sutradhar, Playwright, OpenRouter, Ollama) are encapsulated within adapter implementations in their respective provider packages.
