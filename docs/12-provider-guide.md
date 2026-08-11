---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Related ADRs:
  - 0003-provider-contract
Related Packages:
  - '@pinchtab/contracts'
  - '@pinchtab/browser'
  - '@pinchtab/llm'
---

# Provider Implementation Guide

## 1. Step-by-Step Guide for New LLM Providers

1. **Locate Target Package**: Open `packages/llm/src/providers/`.
2. **Implement Contract**: Create a new class implementing `ILLMProvider` exported from `@pinchtab/contracts`.
3. **Normalize DTOs**: Map third-party API request and response formats to canonical `@pinchtab/contracts` DTOs (`CompletionRequestDto`, `CompletionResponseDto`).
4. **Register Provider**: Register the provider implementation in `@pinchtab/registry` during system bootstrapping.
5. **Add Unit Tests**: Provide mock API tests verifying streaming and tool calling behavior.
