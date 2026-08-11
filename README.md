# PinchTab — Enterprise AI Browser Runtime Platform

> An enterprise-grade platform enabling autonomous AI agents to execute browser-based tasks with persistent memory, multi-tier reasoning, dynamic LLM provider selection, sandboxed tool execution, and real-time web-based inspection.

---

## 🌟 Key Capabilities

- **Universal Browser Control**: Native integration with PinchTab, Playwright, Chrome DevTools Protocol (CDP), and cloud browser providers.
- **Dynamic LLM Orchestration**: Unified gateway supporting OpenRouter (200+ cloud models), Ollama (local LLMs), OpenAI, and Anthropic with automatic failover and capability matching.
- **Multi-Tier Memory Engine**: Working memory context buffer, episodic action traces, procedural skill scripts, and semantic fact knowledge base.
- **Deterministic Workflows & Tools**: Extensible tool execution system (Browser, Shell, Filesystem, HTTP) guarded by strict security policies and visual DAG workflow graphs.
- **Real-Time Web Inspector**: Next.js dashboard providing live page canvas view, DOM accessibility tree inspection, agent reasoning trace visualization, and real-time WebSocket event streams.

---

## 🏗️ Architecture & Monorepo Structure

PinchTab is a pnpm-workspace monorepo. The list below reflects what **actually
exists and builds** — earlier versions of this file listed many aspirational
packages that were never implemented; those have been removed.

```
apps/
└── server/                    # Node http REST API server (real browser + agent runtime)

packages/
├── contracts/                 # Pure TypeScript DTOs, primitives, branded IDs, domain events
├── utils/                     # Async limiters, retry, crypto, rate limiter
├── config/                    # Environment configuration provider
├── observability/             # Structured logger (+ studio/devtools scaffolding)
├── events/                    # Typed EventBus (in-process; EventStore hooks)
├── capability/                # Capability matrix declarations
├── browser/                   # REAL browser automation: Puppeteer launcher, 19-action
│                              #   engine, DOM semantic engine (data-pt-node-id grounding),
│                              #   snapshot generator, stealth, verifier, skills
├── llm/                       # REAL LLM gateway: OpenAiCompatibleAdapter (works with
│                              #   OpenRouter, Ollama, any /v1/chat/completions endpoint),
│                              #   thin OpenRouter/Ollama wrappers, env auto-detection
├── agent/                     # REAL agent: observe→reason→act→verify loop, JSON action
│                              #   protocol, state machine (planner/kernel are scaffolding)
├── memory/                    # Multi-tier memory stores (compile-clean; not yet consulted
│                              #   by the agent loop — see .ai/known-problems.md)
├── workflow/                  # DAG workflow runner (builds + tests pass; scaffolding)
├── storage/                   # SQLite client + Session/Event/File repositories
├── sdk/                       # External TypeScript client SDK
└── frontend/                  # React (Vite) dashboard — WIRED to the real backend via
                               #   /api REST; no mocks in the production path
```

**Data flow (all real, no mocks):**
`Frontend (React)` → `REST /api/v1/*` → `Server` → `BrowserActionEngine` (Puppeteer/Chrome)
                                          ↘ `AgentCore.runAgentLoop` → `OpenAiCompatibleAdapter` (Ollama/OpenRouter)

---

## 🚀 Quickstart & Development

### Prerequisites

- Node.js `>= 18.0.0`
- pnpm `>= 8.0.0`
- A Chrome/Edge browser installed (auto-detected; set `CHROME_PATH` if not found)
- An LLM backend: either **Ollama** running locally (`ollama serve` + a pulled
  model), **or** an `OPENROUTER_API_KEY` in `.env` (see `.env.example`)

### First-time setup

```bash
pnpm install
cp .env.example .env        # then edit .env to set OPENROUTER_API_KEY if using cloud
```

### Workspace commands

```bash
pnpm install                # install all dependencies across the monorepo
pnpm build                  # build all packages + server (turbo)
pnpm test                   # fast unit suite (no external deps; ~3s)

# Per-package type checks (the source of truth for "does it compile"):
node node_modules/typescript/bin/tsc -p packages/<pkg>/tsconfig.json --noEmit
```

### Run the real agent

```bash
# 1. Backend (REST API + browser + agent runtime) on :8081
node apps/server/dist/runtime/bootstrap.js        # after `pnpm build`
#   or for dev: pnpm --filter @pinchtab/server exec tsc -w

# 2. Frontend (Vite dev server on :3000, proxies /api → :8081)
pnpm --filter @pinchtab/frontend dev

# 3. CLI demo (one-shot real agent run, no UI)
node --experimental-strip-types scripts/run-agent.ts "your goal here"
```

Then open http://localhost:3000, create a session, and click **Run Agent** — it
drives the real Chrome browser via the real LLM and shows the live step trace.

### Live-stack integration tests (opt-in; needs Ollama + Chrome)

```bash
node node_modules/vitest/vitest.mjs run apps/server/tests/benchmark apps/server/tests/integration
```

---

## 📚 Documentation Index

The complete documentation suite lives in the [`docs/`](./docs) directory and serves as the single source of truth:

- [Project Overview](./docs/00-project-overview.md)
- [Product Requirements (PRD)](./docs/01-product-requirements.md)
- [System Architecture](./docs/02-system-architecture.md)
- [Folder Structure & Monorepo Map](./docs/03-folder-structure.md)
- [Technology Stack](./docs/04-tech-stack.md)
- [Coding Standards](./docs/05-coding-standards.md)
- [Development Roadmap](./docs/06-development-roadmap.md)
- [Provider Contracts](./docs/07-provider-contracts.md)
- [Browser Runtime Specification](./docs/08-browser-runtime.md)
- [Agent Runtime & Reasoner Loop](./docs/09-agent-runtime.md)
- [Multi-Tier Memory Specification](./docs/10-memory.md)
- [Event Bus & Streaming Protocol](./docs/11-events.md)
- [Provider Integration Guide](./docs/12-provider-guide.md)
- [API Design (REST/WS/SSE)](./docs/13-api-design.md)
- [UI Guidelines & Inspector Design](./docs/14-ui-guidelines.md)
- [Testing Strategy](./docs/15-testing-strategy.md)
- [Security & Threat Model](./docs/16-security.md)
- [Deployment & Containerization](./docs/17-deployment.md)
- [Architecture Decision Records (ADRs)](./docs/adr)

---

## ⚖️ Governance & License

All development in this repository is strictly governed by the [Project Constitution](./PROJECT_CONSTITUTION.md).

Proprietary & Confidential — All rights reserved.
