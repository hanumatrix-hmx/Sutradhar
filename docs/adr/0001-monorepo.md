---
Number: '0001'
Title: Monorepo Architecture with Turborepo & pnpm Workspaces
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Date: 2026-07-28
Superseded Versions: None
Related Packages:
  - '@sutradhar/contracts'
  - 'apps/server'
  - 'apps/web'
---

# ADR 0001: Monorepo Architecture with Turborepo & pnpm Workspaces

## 1. Context

We require a repository structure capable of supporting an enterprise-grade AI Browser Runtime Platform with decoupled domain packages, shared contract definitions, multiple provider implementations, a Fastify API server, and a Next.js web application.

## 2. Decision

We decide to adopt a **Strict Monorepo Topology** using `pnpm` workspaces and `Turborepo v2` as the build system orchestrator.

The repository is partitioned strictly into:

- `apps/`: Deployable, runnable applications (`apps/server`, `apps/web`).
- `packages/`: 24 reusable domain, provider, engine, and infrastructure libraries.

## 3. Alternatives Considered

- **Option A (Multi-Repo)**: Splitting frontend, backend, and core libraries into separate git repositories.
  - _Rejected due to high cross-repository release friction, duplicated contract interfaces, and dependency desynchronization._
- **Option B (Monolithic Single Application)**: Combining backend and frontend into one monolithic Next.js/Node app.
  - _Rejected due to tight coupling, inability to run headless server runtimes independently, and poor hexagonal layer isolation._

## 4. Consequences

### Positive

- Strict hexagonal layer isolation enforced across package boundaries.
- Unified build pipelines (`turbo build`, `turbo test`) with remote caching and parallel execution.
- Single source of truth for contracts (`@sutradhar/contracts`) across apps and libraries.

### Negative

- Requires strict dependency governance and pnpm workspace setup.
