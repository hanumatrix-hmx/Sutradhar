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
  - '@sutradhar/contracts'
  - 'apps/server'
---

# Fastify API Server Design & Endpoints

## 1. REST Endpoint Topology

- `POST /api/v1/sessions`: Create a new browser session context.
- `GET /api/v1/sessions/:id`: Get active session state and tabs.
- `DELETE /api/v1/sessions/:id`: Terminate a browser session context.
- `POST /api/v1/agents/execute`: Dispatch a high-level goal to an agent.
- `GET /api/v1/agents/:id/state`: Query live agent execution state.

## 2. WebSocket & SSE Protocol

- `GET /ws/inspector`: Real-time WebSocket stream carrying page screenshots, DOM accessibility trees, and agent execution events.
- `GET /api/v1/streams/agent/:id`: SSE stream delivering real-time LLM reasoning tokens and action notifications.
