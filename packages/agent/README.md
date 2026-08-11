---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-002 (Core Domain Context - Agent Subsystem)
Depends on ADRs:
  - 0001-monorepo
  - 0004-agent-architecture
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/capability'
  - '@pinchtab/utils'
  - '@pinchtab/config'
  - '@pinchtab/observability'
  - '@pinchtab/events'
  - '@pinchtab/browser'
  - '@pinchtab/llm'
  - '@pinchtab/memory'
---

# @pinchtab/agent

> Autonomous agent execution core, state machine, goal planning engine, step executor, and reflection subsystem for PinchTab.

## Package Architectural Invariants

1. **Core Domain Isolation (`CTX-002`)**: Depends on foundational packages (`CTX-001`) and sibling domain subsystems (`packages/browser`, `packages/llm`, `packages/memory`). Must NEVER import from orchestration or presentation packages (`packages/orchestrator`, `apps/*`).
2. **State Machine Integrity**: State transitions MUST follow strict allowed state transition rules (`idle` -> `planning` -> `executing` -> `verifying` -> `completed` / `failed`). Unvalidated state jumps are prohibited.
3. **Event Transparency**: State transitions, goal progress, step executions, and failures MUST emit domain events (`agent:state:changed`, `agent:goal:started`, `agent:step:executed`) over `EventBus`.

## Sub-Module Layout

- `src/core/`: `AgentCore`, `AgentStateMachine`, state transition validation.
- `src/planner/`: Goal decomposition, task step planning, prompt compilation.
- `src/executor/`: Browser action tool caller, step verification, reflection loop.
