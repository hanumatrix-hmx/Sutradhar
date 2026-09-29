# Sutradhar — Enterprise AI Browser Runtime Platform

> An enterprise-grade platform enabling autonomous AI agents to execute browser-based tasks with persistent memory, multi-tier reasoning, dynamic LLM provider selection, sandboxed tool execution, and real-time web-based inspection.

---

## Ways to use Sutradhar

**Published on npm as a single package: [`sutradhar`](https://www.npmjs.com/package/sutradhar).**
No local build or repo checkout needed for any of these — `npx` fetches it directly. Pick the
integration surface that matches what you're building; all three share the same engine, so
behavior is identical across them.

| I want to... | Use |
|---|---|
| Let an MCP-compatible AI client (Claude Code, Claude Desktop, Cline, ...) drive a real browser | `npx --package=sutradhar sutradhar-mcp` |
| Drive a browser from a terminal, no scripting | `npx --package=sutradhar sutradhar <command>` |
| Drive a browser from my own Node code (scraping, testing, RPA, agent tooling) | `npm install sutradhar` then `import { launch } from 'sutradhar'` |

**Setting this up in a project, or want an AI coding agent to know how to use it?** See
[AGENT_SETUP.md](./AGENT_SETUP.md) — a self-contained, copy-into-any-project guide
covering setup, the full tool catalog, and usage guidance, written for an LLM to act on
directly, not just a human to read.

Working inside *this* monorepo instead (contributing to Sutradhar itself, not just using it)?
The per-package READMEs cover the pre-bundling, workspace-internal view:
[packages/mcp-server/README.md](./packages/mcp-server/README.md),
[packages/sutradhar/README.md](./packages/sutradhar/README.md),
[packages/cli/README.md](./packages/cli/README.md). Or run the full reference app (REST API +
agent loop + web inspector dashboard) — this monorepo's `apps/server` + `packages/frontend`,
see [Quickstart & Development](#-quickstart--development) below.

### Status of this branch (0.5.0, unreleased) and known limitations

The next release (0.5.0) is not published; `sutradhar` on npm is still 0.4.3. The branch adds, among
other things, an optional MCP `sessionId` (71 `browser.*` tools plus `agent.runGoal`), a machine-readable
`browser.audit` / `audit --json`, `wait_for_selector` states, live-value `extract_data`, iframe/shadow
labels in snapshots, download/upload allow-list env vars, and CLI native-dialog handling. Several of
these did not pass every independent audit and ship with documented limitations: CLI dialogs (a
crashed tab needs `sutradhar tabs` then `closetab <id>`; wrong-popup closes are possible), downloads
(one `download_file` per browser at a time; cross-process protection is best effort), `audit` (it can
miss the first navigation's error status on a brand-new tab), and `wait_for_selector --state hidden`
(best effort). The full list is in [docs/22-changelog.md](./docs/22-changelog.md) under "0.5.0
(Unreleased)" and in [AGENT_SETUP.md](./AGENT_SETUP.md)'s "Known limitations". Sutradhar does no
stealth or bot-detection evasion; Cloudflare, CAPTCHA and IP blocks stop it like any other automation tool.

---

## 🌟 Key Capabilities

- **Real Browser Control**: Puppeteer and the Chrome DevTools Protocol (CDP) driving a local Chrome or Edge (or one you `attach` to over CDP). There is no built-in cloud-browser execution.
- **LLM Gateway (for `agent.runGoal` and the reference app only)**: OpenRouter, Ollama and any other OpenAI-compatible `/v1/chat/completions` endpoint, with a fallback-provider wrapper. There are no dedicated OpenAI or Anthropic adapters, and the `browser.*` tools need no LLM at all.
- **Multi-Tier Memory Engine**: Working, episodic, procedural and semantic memory stores exist and compile, but the agent loop does not consult them yet (see `.ai/known-problems.md`).
- **Workflows**: a DAG workflow runner exists (builds and tests pass) but is scaffolding, not a shipped feature.
- **Real-Time Web Inspector**: Vite + React dashboard providing live page canvas view, DOM accessibility tree inspection, agent reasoning trace visualization, and real-time WebSocket event streams.

---

## 🏗️ Architecture & Monorepo Structure

Sutradhar is a pnpm-workspace monorepo. The list below reflects what **actually
exists and builds** — earlier versions of this file listed many aspirational
packages that were never implemented; those have been removed.

```
apps/
├── server/                    # Node http REST API server (real browser + agent runtime)
└── extension/                 # Browser extension (manifest.json + vanilla JS, intentionally
                                #   outside the pnpm/TypeScript workspace)

packages/
├── contracts/                 # Pure TypeScript DTOs, primitives, branded IDs, domain events
├── utils/                     # Async limiters, retry, crypto, rate limiter
├── config/                    # Environment configuration provider
├── observability/             # Structured logger (+ studio/devtools scaffolding)
├── events/                    # Typed EventBus (in-process; EventStore hooks)
├── capability/                # Capability matrix declarations
├── browser/                   # REAL browser automation: Puppeteer launcher, 18-action
│                              #   engine, DOM semantic engine (data-sd-node-id grounding),
│                              #   snapshot generator, verifier, skills
├── capability-runtime/        # SutradharRuntime facade — the single high-level entry point
│                              #   composed by the MCP server, CLI, and SDK; session/profile
│                              #   management, axSnapshot, site-audit/visual-compare
├── llm/                       # REAL LLM gateway: OpenAiCompatibleAdapter (works with
│                              #   OpenRouter, Ollama, any /v1/chat/completions endpoint),
│                              #   thin OpenRouter/Ollama wrappers, env auto-detection
├── agent/                     # REAL agent: observe→reason→act→verify loop, JSON action
│                              #   protocol, state machine (planner/kernel are scaffolding)
├── memory/                    # Multi-tier memory stores (compile-clean; not yet consulted
│                              #   by the agent loop — see .ai/known-problems.md)
├── workflow/                  # DAG workflow runner (builds + tests pass; scaffolding)
├── storage/                   # SQLite client + Session/Event/File repositories
├── mcp-server/                # MCP server exposing the browser.*/agent.* tool surface
│                              #   over stdio (bin: sutradhar-mcp) — see .mcp.json
├── cli/                       # `sutradhar` CLI — detached-Chrome sessions that survive
│                              #   across separate short-lived CLI invocations
├── sutradhar/                 # Embeddable client SDK: Puppeteer-style API over a real
│                              #   Chrome/Edge, published unscoped as `sutradhar` on npm
├── sdk/                       # Plugin/extension SDK (author + host Sutradhar plugins)
├── dev-runtime/                # Generic dev runtime/service registry shared across the
│                              #   wider Hanumatrix ecosystem, not Sutradhar-specific
└── frontend/                  # React (Vite) dashboard — WIRED to the real backend via
                               #   /api REST; no mocks in the production path
```

The 7 empty scaffolding dirs this section used to name explicitly (`backend`, `configs`,
`core`, `desktop`, `providers`, `shared`, `types`) have since been deleted outright — they
were never git-tracked and nothing referenced them (closes the loop on `PROB-004` in
[`.ai/known-problems.md`](./.ai/known-problems.md) a second time, since the situation changed
after that entry was first resolved).

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
#   or for dev: pnpm --filter @sutradhar/server exec tsc -w

# 2. Frontend (Vite dev server on :3000, proxies /api → :8081)
pnpm --filter @sutradhar/frontend dev

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

Copyright 2026 Hanumatrix. Licensed under the [Functional Source License 1.1 (FSL-1.1-ALv2)](./LICENSE): the source is public, and you may use, modify and redistribute it for any purpose **except** offering a product or service that competes with Sutradhar. Each release converts to the Apache License 2.0 two years after it is published. The same license applies to the published `sutradhar` npm package.
