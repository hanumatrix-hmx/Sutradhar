---
State Category: Operational / Session
Version: 1.1.0
Last Updated: 2026-08-08
Active Epic: Real Intelligent Agent Loop
Active Work Package: Agent loop verified live against local LLM + Chrome
Overall Progress: Core loop functional
---

# Project Operational State

> This file is maintained to reflect GROUND TRUTH, verified empirically by
> build, typecheck, and test runs. Previous versions of this file claimed many
> milestones "100% COMPLETE & VERIFIED" that were not actually true; those claims
> have been removed. Only verified capabilities are listed here.

## Current Context & Execution Phase

- **Active Status**: The agent runtime now runs a REAL observe→reason→act→verify
  loop. A live end-to-end demo (Wikipedia factual extraction) completes correctly
  in ~8s against a local Ollama 9B model and real headless Chrome.

## What Actually Works (verified 2026-08-08)

- **Build & Tests**: `tsc --noEmit` passes with 0 errors across all packages
  and the server (frontend UI has pre-existing unrelated type errors; not on the
  runtime path). The default `vitest run` passes **186/186** fast unit tests.
  The live-stack integration/benchmark tests (excluded from the default run)
  pass against a real Ollama + Chrome — e.g. the Wikipedia birth-date scenario
  completes correctly via the real agent loop.
- **Real LLM layer** (`packages/llm`): `OpenAiCompatibleAdapter` performs genuine
  HTTP calls to any OpenAI-compatible endpoint. Auto-detects OpenRouter (when
  `OPENROUTER_API_KEY` set) or local Ollama (`http://localhost:11434/v1`).
  The old fake string-returning adapters are gone.
- **Real browser automation** (`packages/browser`): launches real Chrome via
  `puppeteer-core`; `BrowserActionEngine` executes 19 real actions;
  `DOMSemanticEngine` stamps elements with `data-sd-node-id` so the agent can
  target elements by id.
- **Real agent loop** (`packages/agent` `agent-loop.ts`): genuine ReAct loop —
  builds a DOM observation (including visible page text), asks the real LLM for
  one JSON action, executes it, and repeats until `done`. The old scripted
  `if(goal.includes('github'))` theater is removed.
- **Server wiring**: `dependency-container.ts` wires the real auto-detected LLM
  provider into `AgentCore`; `POST /api/v1/agents/goals` runs the real loop.
- **End-to-end proof**: `scripts/run-agent.ts` + `.sutradhar-eval/real-world-evidence.json`
  capture a REAL run (Alan Turing birth date → "23 June 1912", correct).

## What Is Still Stub / Not Yet Real (honest gaps)

- **Memory tiers** (`packages/memory`): the episodic/semantic stores are in-memory
  bookkeeping; they are NOT consulted by the agent loop yet (no retrieval-augmented
  planning). The loop compiles and is decoupled, but unused at runtime.
- **Workflow engine** (`packages/workflow`): builds and tests pass, but it is
  scaffolding — task-node execution delegates to the real agent loop, but the
  DAG orchestration is not exercised by any production path.
- **Frontend inspector** (`packages/frontend`): a React dashboard exists and
  typechecks, but it is a mock-backed demo UI, not wired to the real backend.
- **Eval framework** (`apps/server/src/eval`): the benchmark runner exists and
  the regression test is gated on a live stack; success-rate numbers are real
  when run with the stack, not asserted at a fixed 90% bar.
- **Capability/knowledge/prompt/registry/plugin packages**: empty or not present
  despite being listed in the README. They are aspirational, not implemented.

## How To Verify

```bash
# Green build + fast unit suite (default; ~17s, no external deps needed)
pnpm build && pnpm test
# Equivalent direct invocation:
#   node node_modules/typescript/bin/tsc -p <each package>/tsconfig.json --noEmit
#   node node_modules/vitest/vitest.mjs run

# Live-stack integration & benchmark tests (opt-in; needs Ollama + Chrome,
# takes several minutes — drives the REAL agent on each task):
node node_modules/vitest/vitest.mjs run apps/server/tests/benchmark apps/server/tests/integration

# Real end-to-end agent run (needs local Ollama running + Chrome installed)
node --experimental-strip-types scripts/run-agent.ts
```
