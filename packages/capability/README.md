---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-001 (Foundational Context)
Depends on ADRs:
  - 0001-monorepo
  - 0003-provider-contract
Related Packages:
  - '@sutradhar/contracts'
---

# @sutradhar/capability

> Standardized capability discovery, requirement matching, and capability matrix engine for Sutradhar.

## Package Architectural Invariants

1. **Foundational Layer Boundary (`CTX-001`)**: Depends strictly on `@sutradhar/contracts`. Must NEVER import from domain, infrastructure, or application packages (`packages/browser`, `packages/orchestrator`, `apps/*`).
2. **Zero External Runtime NPM Dependencies**: Implemented using pure TypeScript and workspace contract primitives.
3. **Feature Discovery**: Standardizes feature detection across LLM models, browser instances, tools, and agents to eliminate hardcoded capability assumptions.

## Capability Types

- `streaming`: Real-time token / SSE streaming.
- `tool_calling`: Structured JSON function/tool calling.
- `vision`: Multi-modal image/screenshot understanding.
- `embeddings`: Vector embedding generation.
- `reasoning`: Extended chain-of-thought or reflection reasoning.
- `browser_automation`: Headless/headed DOM control.
- `memory_search`: Hybrid vector/text semantic retrieval.
