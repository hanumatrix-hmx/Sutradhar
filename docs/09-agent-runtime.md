---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Related ADRs:
  - 0004-runtime-architecture
Related Packages:
  - '@pinchtab/agent'
  - '@pinchtab/orchestrator'
  - '@pinchtab/runtime'
---

# Agent Runtime & Cognitive Loop Architecture

## 1. Overview

The Agent Runtime manages the cognitive ReAct loop (Reasoning + Acting), goal decomposition, task state transitions, and verifier step checks.

## 2. The Cognitive ReAct Loop

```
┌─────────────┐    1. Plan     ┌──────────────┐    2. Reason    ┌─────────────┐
│   Planner   ├───────────────►│   Reasoner   ├────────────────►│  Executor   │
└─────▲───────┘                └──────▲───────┘                 └──────┬──────┘
      │                               │                                │
      │ 5. Re-plan                    │ 4. Observe Feedback            │ 3. Action
      │                               │                                │
┌─────┴───────┐                ┌──────┴───────┐                        ▼
│  Verifier   │◄───────────────┤  Working     │◄───────────────┌─────────────┐
└─────────────┘  State Check   │  Memory      │                │ Tool System │
                               └──────────────┘                └─────────────┘
```

## 3. Cognitive State Transitions

- **UNINITIALIZED**: Agent entity instantiated.
- **PLANNING**: Decomposing high-level Goal into Task DAG.
- **EXECUTING**: Invoking tool action via Reasoner decision.
- **VERIFYING**: Evaluating step outcome against target assertions.
- **COMPLETED**: Goal satisfied.
- **FAILED**: Retry limit exceeded or unrecoverable error encountered.
