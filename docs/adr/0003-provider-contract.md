---
Number: '0003'
Title: Hexagonal Provider Abstraction Layer & Canonical DTOs
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Date: 2026-07-28
Superseded Versions: None
Related Packages:
  - '@sutradhar/contracts'
  - '@sutradhar/llm'
  - '@sutradhar/browser'
---

# ADR 0003: Hexagonal Provider Abstraction Layer & Canonical DTOs

## 1. Context

The platform integrates heterogeneous external providers (OpenRouter cloud gateway, local Ollama server, direct OpenAI/Anthropic APIs, Sutradhar, CDP). Leaking vendor-specific request/response formats into core reasoning engines causes tight coupling and fragile code.

## 2. Decision

We decide to establish a **Hexagonal Provider Abstraction Layer** using pure TypeScript contracts in `@sutradhar/contracts`.

- Business logic depends strictly on contracts (`ILLMProvider`, `IBrowserProvider`, `IMemoryProvider`).
- Every provider adapter maps vendor payload formats to canonical `@sutradhar/contracts` DTOs (`CompletionRequestDto`, `CompletionResponseDto`, `BrowserSnapshotDto`).
- Dynamic model discovery exposes unified `CapabilityMatrix` declarations.

## 3. Alternatives Considered

- **Option A (Direct SDK Consumption)**: Importing `@langchain/openai` or `@google/genai` directly into reasoning loops.
  - _Rejected due to API signature instability, vendor lock-in, and breaking changes in external SDK updates._
- **Option B (Loose Untyped JSON Messages)**: Passing raw JSON maps between providers and agents.
  - _Rejected due to loss of compile-time type safety and high runtime error risk._

## 4. Consequences

### Positive

- Total decoupling of domain logic from vendor API evolution.
- Compile-time verification of provider request/response structures.

### Negative

- Initial development overhead when authoring normalization adapters for new LLM or browser providers.
