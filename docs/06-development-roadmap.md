---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Related ADRs:
  - 0001-monorepo
  - 0002-browser-runtime
  - 0003-provider-contract
  - 0004-runtime-architecture
  - 0005-tool-system
  - 0006-memory
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/orchestrator'
  - '@pinchtab/runtime'
---

# Development Roadmap & Epics

## Roadmap Overview

Development is executed according to the approved 10-Epic Hierarchical Execution Roadmap:

- **Epic 1**: Repository Foundation & Core Governance (`apps/`, `packages/`, `docs/`, `.ai/`)
- **Epic 2**: Foundation Contracts & Core Utilities (`contracts`, `capability`, `utils`)
- **Epic 3**: Configuration, Telemetry & Event Infrastructure (`config`, `observability`, `events`)
- **Epic 4**: Persistence & Core Domain (`storage`, `agent`, `prompt`)
- **Epic 5**: Infrastructure Providers (`browser`, `llm`, `knowledge`)
- **Epic 6**: Governance, Tools & Registries (`policy`, `tools`, `registry`, `plugin`)
- **Epic 7**: Memory & Workflow Systems (`memory`, `workflow`)
- **Epic 8**: Orchestration & Execution Runtime (`orchestrator`, `queue`, `runtime`)
- **Epic 9**: Presentation Layers & Applications (`ui`, `sdk`, `apps/server`, `apps/web`)
- **Epic 10**: Production Hardening, E2E Verification & Release
