---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Related ADRs:
  - 0001-monorepo
Related Packages:
  - '@pinchtab/config'
  - '@pinchtab/observability'
---

# Tech Stack & Decision Rationale

## Core Technologies

- **Runtime & Language**: Node.js `>=18.0.0`, TypeScript `>=5.4.0` (Strict Mode).
- **Monorepo Manager**: pnpm Workspaces, Turborepo v2 (`turbo`).
- **Backend API**: Fastify (REST, WebSocket, Server-Sent Events).
- **Frontend App**: Next.js (App Router), React, TailwindCSS, shadcn/ui.
- **Browser Automation**: PinchTab API, Chrome DevTools Protocol (CDP), Playwright.
- **LLM Integrations**: OpenRouter Gateway, Ollama (Local), OpenAI SDK, Anthropic SDK.
- **Database & Storage**: Drizzle ORM / SQLite (Local), PostgreSQL (Enterprise), Redis (Cache/Events).
- **Vector Search**: Qdrant / SQLite-vector hybrid search engine.
- **Observability**: Pino (Structured Logging), OpenTelemetry, Prometheus.
