---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Depends on ADRs:
  - 0001-monorepo
  - 0004-runtime-architecture
References ADRs:
  - 0002-browser-runtime
  - 0003-provider-contract
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/orchestrator'
  - '@pinchtab/runtime'
---

# Architecture Diagrams & Sequence Flows

## 1. C4 Component Model

```
┌─────────────────────────────────────────────────────────────┐
│                      Fastify API Server                     │
│                        (apps/server)                        │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      Orchestrator Engine     │ │      Execution Runtime     │
│   (@pinchtab/orchestrator)   │ │    (@pinchtab/runtime)     │
└──────────────┬───────────────┘ └────────────┬───────────────┘
               │                              │
               └──────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Infrastructure Providers                  │
│       @pinchtab/browser | @pinchtab/llm | @pinchtab/memory  │
└─────────────────────────────────────────────────────────────┘
```

## 2. ReAct Execution Sequence Flow

```
User -> Fastify Server: POST /api/v1/agents/execute
Fastify Server -> Orchestrator: startAgentGoal(goal)
Orchestrator -> Reasoner: evaluateState(workingMemory)
Reasoner -> LLM Provider: generateCompletion(prompt)
LLM Provider -> Reasoner: ToolCall(browser_click, { elementId: 12 })
Reasoner -> Policy Engine: authorizeAction(toolCall)
Policy Engine -> Tool System: executeTool(browser_click)
Tool System -> Browser Provider: clickElement(12)
Browser Provider -> EventBus: emit(browser:page:navigated)
```
