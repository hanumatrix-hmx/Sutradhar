# Sutradhar Architecture

## Overview

Sutradhar is a browser automation engine built for AI agents: a real Chrome/Edge instance
driven via Puppeteer, with a semantic DOM/accessibility-tree snapshot layer on top so an LLM
can read a page and act on it without screenshots or pixel coordinates. It's a TypeScript
monorepo (pnpm workspaces + Turborepo), not a client/server web app — there is no separate
backend service, database, or hosted deployment; every integration surface is a library or
CLI that runs locally against a real browser process.

## Package layout

```
packages/
├── contracts/            # Pure TS domain types, DTOs, event schemas, error types — no deps
├── utils/                 # Pure utility primitives (async limiters, crypto, formatters)
├── config/                 # Zod environment-schema validation
├── observability/           # Structured logging, metrics, tracing — in-house, no external deps
├── events/                   # In-memory typed EventBus + handler registry
├── capability/                 # Capability/feature-matrix discovery
├── dev-runtime/                 # Generic dev runtime/service registry (shared across the
│                                  wider Hanumatrix ecosystem, not Sutradhar-specific)
│
├── browser/                # The actual browser engine: Puppeteer-core launcher, DOM
│                              semantic snapshot engine, action engine (click/type/scroll/…),
│                              stealth launch flags
├── capability-runtime/     # SutradharRuntime — the single high-level façade every
│                              integration surface below calls (session/tab management,
│                              wraps `browser`)
├── llm/                    # LLM provider gateway (OpenRouter/Ollama adapters)
├── memory/                 # Multi-tier agent memory (working/short-term/episodic/semantic)
├── storage/                 # Storage abstraction — local filesystem persistence, artifacts
├── agent/                   # AgentCore — the autonomous observe→reason→act→verify loop
│                              behind `agent.runGoal` (built on capability-runtime + llm +
│                              memory + storage)
├── workflow/                 # Multi-agent workflow orchestration — DAG node graphs, step
│                                routing, task graph execution (built on `agent`)
│
├── mcp-server/              # MCP server — exposes browser.* tools + agent.runGoal to any
│                               MCP client (Claude Desktop, Cline, custom agents)
├── sutradhar/                # Embeddable npm SDK — Puppeteer-style API over
│                               capability-runtime, for driving Sutradhar directly from code
├── sdk/                      # Plugin/extension SDK — author + host plugins (manifest,
│                               loader, signature verification)
├── cli/                       # Terminal CLI (nav/snap/click/type/screenshot/audit/compare/doctor)
└── frontend/                   # Vite + React web/desktop client, built on `sdk`

apps/
├── server/                 # @sutradhar/server — REST API gateway (custom router, not
│                              Express/Fastify) that `frontend` talks to. Depends on browser,
│                              llm, memory, agent, workflow, storage — effectively the
│                              "backend" for the dashboard UI, distinct from `mcp-server`
│                              (which serves MCP clients, not this REST API)
└── extension/               # Plain browser extension (manifest.json + vanilla JS,
                                intentionally outside the pnpm/TypeScript workspace)
```

`apps/` holds runnable applications composed from `packages/`; `packages/` holds the
libraries themselves. `apps/server` is the one genuine "backend" in this repo — it exists,
but it's a lightweight custom gateway over the same packages every other surface uses, not a
separate service with its own database.

## Core principles

1. **Semantic grounding over pixels** — the whole point of `browser`'s DOM snapshot engine
   is giving an LLM a structured, addressable listing of interactive elements instead of a
   screenshot + coordinates. Two grounding modes exist: DOM-attribute (`browser.snapshot`,
   fast, numeric ids) and accessibility-tree (`browser.ax_snapshot`, no ids to go stale,
   preferred for frequently re-rendering pages).
2. **One façade, many front doors** — `capability-runtime`'s `SutradharRuntime` is the single
   place session/tab/action logic lives. `mcp-server`, `sutradhar` (the SDK), and `cli` are
   all thin front doors onto the same façade, not independent implementations.
3. **Monorepo, strict TypeScript** — pnpm workspaces + Turborepo for the build graph, Vitest
   for unit/integration tests, strict TS across every package.
4. **No hosted infra** — `apps/server` is a real local REST gateway for the `frontend`
   dashboard, but there's no hosted database, queue, or third-party infra behind it or
   anything else here by default; every surface runs locally against a real, locally-launched
   Chrome/Edge process.

## Package dependency shape

Roughly bottom-up (each layer depends only on layers below it):

```
contracts, utils, config, observability, events, dev-runtime    (foundational, few/no deps)
        │
capability
        │
browser  ──────────────┐
        │               │
capability-runtime      llm, memory, storage
        │               │
        └───── agent ───┘
                │
            workflow
```

`mcp-server`, `sutradhar`, `cli`, and `sdk` sit above this graph, composing
`capability-runtime` (and `agent` for `mcp-server`'s `agent.runGoal`) rather than being
depended on by anything below them. `frontend` depends only on `sdk` + `contracts`.

## Two "brain" modes (the actual product surface)

- **Host-AI-driven** (`browser.*` tools, or the `sutradhar` SDK directly): the calling AI
  supplies the reasoning and drives the browser call-by-call — `snapshot` → `click`/`type`/…
  This is the primary way Sutradhar is meant to be used (see `CLAUDE.md`).
- **`agent.runGoal`**: Sutradhar's own `AgentCore` is the brain — hand it a natural-language
  goal, it runs its own observe→reason→act→verify loop using an LLM provider it manages
  itself (Ollama or OpenRouter). A separate, secondary use case from the primary one above.

## Data flow (a single browser action)

```
Caller (MCP tool call / SDK method / CLI command)
    → capability-runtime (SutradharRuntime): resolves session/tab
    → browser: BrowserActionEngine executes the action against the real Puppeteer page
    → DOM semantic engine (for snapshot/grounding calls): stamps/reads data-sd-node-id or
      walks the accessibility tree
    → ActionResult (success, verification, timing) ← returned back up the same path
```

## Security considerations

- Browser processes launch with sandbox flags (`--no-sandbox`/`--disable-setuid-sandbox` are
  used for headless CI/container compatibility, not to disable browser-level sandboxing of
  page content).
- File downloads/uploads are constrained to allow-listed directories.
- Plugin signatures are verified before loading (`sdk`).
- Stealth/bot-detection evasion is deliberately out of scope — see `CLAUDE.md`'s scope
  boundary.

## What this document is not

There is no hosted deployment, no Postgres/Redis/Qdrant, no queueing system, no auth
provider, and no CDN — those would describe a different kind of product (a hosted SaaS)
that this repo does not build. If future work adds a real hosted service, document it here
when it exists, not before.
