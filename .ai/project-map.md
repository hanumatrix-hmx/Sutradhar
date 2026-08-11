---
State Category: Generated / Session
Schema Version: 1.0.0
Machine Readable: true
Update Ownership: AI Agent / Automated Pipeline
Last Updated: 2026-07-28
Owner: Principal Software Architect
---

# AI Project Workspace File & Package Map

## Repository File Layout

```
.
├── package.json               # Root workspace package manifest
├── pnpm-workspace.yaml        # Workspace package inclusion rules
├── turbo.json                 # Turborepo v2 build pipeline config
├── tsconfig.base.json         # Master strict TypeScript options
├── tsconfig.json              # Root tsconfig extending tsconfig.base.json
├── .prettierrc                # Code formatting rules
├── .eslintrc.js               # Strict TypeScript linting rules
├── PROJECT_CONSTITUTION.md    # Supreme repository law
├── README.md                  # Repository entry point & overview
│
├── apps/
│   ├── server/                # Fastify REST/WebSocket server
│   └── web/                   # Next.js web inspector app
│
├── packages/                  # 24 Decoupled domain & infrastructure packages
│   ├── contracts/             # Core TypeScript DTOs, Primitives, Errors, Events
│   ├── capability/            # Feature discovery & capability matrix
│   ├── utils/                 # Async limiters, crypto, DOM formatters
│   ├── config/                # Environment validation & secrets loader
│   ├── observability/         # Structured Pino logger, OTel, metrics
│   ├── events/                # EventBus interfaces & Redis streams
│   ├── agent/                 # Agent entities & goals
│   ├── browser/               # Browser domain & Sutradhar/CDP adapters
│   ├── llm/                   # LLM domain & OpenRouter/Ollama adapters
│   ├── memory/                # Multi-tier memory engines
│   ├── knowledge/             # Document chunking & vector search
│   ├── prompt/                # Versioned templates & prompt registry
│   ├── workflow/              # DAG graph nodes & state machine compiler
│   ├── policy/                # Guardrails, permissions & path bounds
│   ├── tools/                 # Standard ITool interface (Browser, Shell, HTTP)
│   ├── storage/               # Relational Drizzle/SQLite repositories
│   ├── queue/                 # BullMQ background job queues
│   ├── registry/              # Dynamic service registry
│   ├── plugin/                # Plugin manifests & sandbox manager
│   ├── orchestrator/          # Planner, Reasoner ReAct loop, Executor, Verifier
│   ├── runtime/               # Execution lifecycles (AgentRuntime, BrowserRuntime)
│   ├── ui/                    # Shared React UI component library
│   └── sdk/                   # TypeScript client SDK
│
├── docs/                      # Human documentation suite (24 main + 6 ADRs)
└── .ai/                       # AI operational state management
```
