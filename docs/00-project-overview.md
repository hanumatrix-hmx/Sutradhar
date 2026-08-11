---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Related ADRs:
  - 0001-monorepo
  - 0002-browser-runtime
  - 0003-provider-contract
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/orchestrator'
  - '@pinchtab/runtime'
---

# Project Overview

## Vision

PinchTab is an enterprise-grade AI Browser Runtime Platform — a desktop and web-based application environment that enables autonomous AI agents to control web browsers, execute complex automation workflows, and maintain persistent multi-tiered memory across sessions. It bridges cloud LLM gateways (OpenRouter), local inference (Ollama), and headless/headed browser engines (PinchTab, CDP, Playwright) within a strictly decoupled, hexagonal monorepo architecture.

## Core Value Proposition

- **Universal AI Browser Orchestration**: Single unified interface and API for controlling web browsers via AI agents.
- **Multi-Provider LLM Gateway**: Seamless dynamic model selection and fallback across OpenRouter (200+ models), Ollama (local), OpenAI, and Anthropic.
- **Multi-Tier Memory System**: Working context buffers, episodic action execution logs, procedural action scripts, and semantic fact knowledge bases.
- **Sandboxed Tool & Plugin System**: Extensible, schema-validated tools guarded by granular execution, rate-limiting, and permission policies.
- **Real-Time Web Inspector**: Interactive Next.js inspection dashboard offering live canvas streaming, DOM accessibility tree visualization, and agent reasoning trace inspection.
- **Production-Ready Governance**: Built strictly according to the [Project Constitution](file:///e:/HMX_Projects/Internal_Projects/PinchTab/PROJECT_CONSTITUTION.md) with 100% type safety, zero lint warnings, and comprehensive telemetry.

## Target Users & Persona Profiles

1. **AI Researchers**: Running reproducible browser automation and multi-step reasoning experiments.
2. **Automation Engineers**: Building resilient, self-healing browser automation pipelines driven by LLM decision-making.
3. **Enterprise Security & Operations**: Running auditable, sandboxed web tasks with complete prompt injection defense and secret isolation.

## Architectural High-Level Topology

```
┌─────────────────────────────────────────────────────────────┐
│                 PRESENTATION LAYER (apps/)                  │
│        apps/server (Fastify)        apps/web (Next.js)      │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 ORCHESTRATION & RUNTIME                     │
│    packages/orchestrator             packages/runtime       │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 INFRASTRUCTURE PROVIDERS                    │
│   packages/browser   packages/llm   packages/memory         │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────┐
│              CORE DOMAIN & CONTRACT PRIMITIVES              │
│   packages/contracts    packages/capability  packages/config│
└─────────────────────────────────────────────────────────────┘
```
