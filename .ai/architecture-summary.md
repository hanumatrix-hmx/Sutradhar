---
State Category: Generated / Session
Schema Version: 1.0.0
Machine Readable: true
Update Ownership: AI Agent / Automated Pipeline
Last Updated: 2026-07-28
Owner: Principal Software Architect
---

# AI Architecture Summary (Context Hydration Anchor)

## Quick Context Hydration (<60 Seconds)

Sutradhar is an enterprise AI Browser Runtime Platform designed as a strict **Hexagonal Monorepo**.

```
┌─────────────────────────────────────────────────────────────┐
│                 APPLICATIONS (apps/)                        │
│        apps/server (Fastify)        apps/web (Next.js)      │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│               ORCHESTRATION & RUNTIME                       │
│    packages/orchestrator             packages/runtime       │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│               INFRASTRUCTURE PROVIDERS                      │
│   packages/browser   packages/llm   packages/memory         │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│              CORE DOMAIN & CONTRACT PRIMITIVES              │
│   packages/contracts    packages/capability  packages/config│
└─────────────────────────────────────────────────────────────┘
```

## Key Architectural Invariants

1. **Hexagonal Isolation**: Business logic in `orchestrator` / `runtime` depends exclusively on interfaces in `@sutradhar/contracts`.
2. **Zero Vendor Leaks**: Playwright, Sutradhar, OpenRouter, and Ollama SDK calls are completely encapsulated within `packages/browser` and `packages/llm` adapters.
3. **Multi-Tier Memory**: Working Memory (Prompt buffer) -> Short-Term (Session) -> Episodic (Permanent Traces) -> Semantic (Vector knowledge).
4. **Policy Sandboxing**: All tool executions pass through `@sutradhar/policy` guardrails.
