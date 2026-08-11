---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-002 (Core Domain Context - Workflow Engine Subsystem)
Depends on ADRs:
  - 0001-monorepo
  - 0004-agent-architecture
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
---

# @sutradhar/workflow

> Multi-agent workflow graph orchestrator, DAG node graph topology manager, step router, and workflow execution engine for Sutradhar.

## Package Architectural Invariants

1. **Core Domain Isolation (`CTX-002`)**: Depends on foundational packages (`CTX-001`) and domain packages (`@sutradhar/agent`, `@sutradhar/browser`, `@sutradhar/llm`, `@sutradhar/memory`). Must NEVER import from application layer (`apps/*`).
2. **DAG Graph Topology Validation**: Workflows MUST form valid Directed Acyclic Graphs (DAGs) with a single `start` node and at least one `end` node. Graph validation detects isolated nodes and cycles before execution.

## Sub-Module Layout

- `src/graph/`: `WorkflowGraph`, `WorkflowNodeDto`, DAG node validation.
- `src/runner/`: `WorkflowRunner`, graph step execution, state transitions.
