---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Related ADRs:
  - 0001-monorepo
Related Packages:
  - '@sutradhar/contracts'
  - '@sutradhar/orchestrator'
  - '@sutradhar/runtime'
---

# Folder Structure & Monorepo Map

## Workspace Layout

```
.
├── apps/
│   ├── server/               # Fastify API Server (REST, WebSocket, SSE)
│   └── web/                  # Next.js Web Dashboard & Inspector
│
├── packages/
│   ├── contracts/            # Pure TypeScript DTOs, Primitives, Errors, Events
│   ├── capability/           # Feature discovery & capability matrices
│   ├── utils/                # Async limiters, crypto, DOM formatters
│   ├── config/               # Zod schemas & configuration provider
│   ├── observability/        # Structured Pino logger, OpenTelemetry, Metrics
│   ├── events/               # EventBus interfaces, EventEmitter2, Redis streams
│   ├── agent/                # Agent entities, goals, states, execution policies
│   ├── browser/              # BrowserSession/Tab domain entities & Sutradhar/CDP providers
│   ├── llm/                  # Model/Completion domain entities & OpenRouter/Ollama providers
│   ├── memory/               # Working, Short-term, Episodic, Semantic memory stores
│   ├── knowledge/            # Ingested docs, chunks, vector/graph indexes
│   ├── prompt/               # Versioned templates, rendering, prompt registry
│   ├── workflow/             # DAG nodes, execution graph, workflow compiler
│   ├── policy/               # Permissions, guardrails, rate limits, approvals
│   ├── tools/                # Standard ITool interface (Browser, Shell, FS, HTTP)
│   ├── storage/              # Relational repositories, SQLite, PostgreSQL, Redis
│   ├── queue/                # Background job queues (BullMQ) & cron schedulers
│   ├── registry/             # Dynamic service discovery (Provider/Tool/Model)
│   ├── plugin/               # Plugin manifests, sandbox, permission manager
│   ├── orchestrator/         # Planner, Reasoner (ReAct), Executor, Verifier
│   ├── runtime/              # AgentRuntime, BrowserRuntime, WorkflowRuntime
│   ├── ui/                   # Reusable React component library & inspector UI
│   └── sdk/                  # External TypeScript client SDK
│
├── docs/                     # Human Documentation Suite
│   └── adr/                  # Architecture Decision Records
└── .ai/                      # AI Operational State Management
```
