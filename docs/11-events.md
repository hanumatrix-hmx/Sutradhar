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
  - '@sutradhar/events'
  - '@sutradhar/observability'
---

# Event Bus & Streaming Taxonomy

## 1. Naming Convention

All system events follow the explicit namespace format:
$$\text{<domain>:<entity>:<action>}$$

## 2. Event Catalog

- `browser:session:created`: Triggered when a new browser context is allocated.
- `browser:session:closed`: Triggered when a browser context is terminated.
- `browser:page:navigated`: Triggered when a tab completes page navigation.
- `agent:goal:started`: Triggered when an agent accepts a new goal.
- `agent:step:executed`: Triggered after a ReAct step completes execution.
- `llm:stream:chunk`: Real-time streaming chunk emitted during LLM generation.
- `tool:execution:started`: Triggered when a tool action is dispatched.
- `tool:execution:completed`: Triggered when a tool action yields a result.

## 3. Streaming Protocol

Live UI feeds consume events via Server-Sent Events (SSE) or WebSockets managed by `apps/server`.
