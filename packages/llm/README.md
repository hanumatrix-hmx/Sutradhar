---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-002 (Core Domain Context - LLM Gateway Subsystem)
Depends on ADRs:
  - 0001-monorepo
  - 0003-provider-contract
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/capability'
  - '@pinchtab/utils'
  - '@pinchtab/config'
  - '@pinchtab/observability'
  - '@pinchtab/events'
---

# @pinchtab/llm

> Unified LLM provider gateway interface, OpenRouter/Ollama provider adapters, streaming pipeline, and prompt engineering engine for PinchTab.

## Package Architectural Invariants

1. **Core Domain Isolation (`CTX-002`)**: Depends on foundational infrastructure packages (`CTX-001`). Must NEVER import from application or presentation packages (`apps/server`, `apps/web`).
2. **Provider Contract Neutrality**: Unified `ILlmProvider` interface abstracts vendor-specific API differences (OpenRouter, Ollama, OpenAI) behind canonical DTOs (`CompletionRequestDto`, `CompletionResponseDto`).
3. **Resilient Rate Limiting & Retry**: Interacts with `@pinchtab/utils` for exponential backoff retries and token bucket throttling.

## Sub-Module Layout

- `src/gateway/`: `ILlmProvider`, `OpenRouterAdapter`, provider gateway interfaces.
- `src/local/`: `OllamaAdapter` for local offline LLM model inference.
- `src/prompt/`: `PromptTemplate`, system prompt compilation, context formatting.
- `src/stream/`: Async SSE stream processor and token chunk handler.
