---
Number: '0004'
Title: Decoupled Cognitive Orchestrator & Execution Lifecycle Runtime
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Date: 2026-07-28
Superseded Versions: None
Related Packages:
  - '@pinchtab/orchestrator'
  - '@pinchtab/runtime'
---

# ADR 0004: Decoupled Cognitive Orchestrator & Execution Lifecycle Runtime

## 1. Context

Managing autonomous AI agents requires two distinct responsibilities:

1. **Cognitive Strategy**: Goal decomposition, task planning, ReAct reasoning, and verification checks.
2. **Execution Lifecycle**: Process management, timeout controls, context window fitting, and error recovery.

## 2. Decision

We decide to split these responsibilities into two separate dedicated packages:

- `@pinchtab/orchestrator`: Provider-independent cognitive engines (`Planner`, `Reasoner`, `Executor`, `Verifier`).
- `@pinchtab/runtime`: Lifecycle managers (`AgentRuntime`, `BrowserRuntime`, `WorkflowRuntime`).

## 3. Alternatives Considered

- **Option A (Combined Monolithic Agent Class)**: Managing process lifecycle, LLM prompt formatting, and step verification inside a single `Agent` class.
  - _Rejected due to God-object antipattern, violation of Single Responsibility Principle, and untestable code._

## 4. Consequences

### Positive

- Clear separation between cognitive decision-making and operational process execution.
- Enables pluggable reasoning strategies (ReAct, Chain-of-Thought, Reflection) without altering runtime lifecycle code.

### Negative

- Requires event bus and state machine coordination between runtime and orchestrator.
