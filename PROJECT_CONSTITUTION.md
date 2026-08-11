# THE PROJECT CONSTITUTION

## Preamble

We are building an enterprise-grade AI Browser Runtime Platform. This document represents the supreme authority governing the codebase, engineering practices, architectural boundaries, and contribution standards. Nothing in this repository may violate this constitution.

---

## Article I: Engineering Supremacy

1. **Quality Over Speed**: We prioritize long-term maintainability, reliability, and readability over rapid execution.
2. **Zero Debt Tolerance**: Placeholder implementations, fake mocks in production code, untyped `any` casts, commented-out code, and TODO comments are strictly prohibited.
3. **Strict Typing**: All code must be written in strict TypeScript. Implicit `any`, loose casts, or unsafely suppressed type checks are forbidden.

---

## Article II: Architectural Sovereignty

1. **Hexagonal Integrity**: Core domain logic MUST remain pure TypeScript, decoupled from concrete databases, web frameworks, browser automation tools, or third-party APIs.
2. **Interface-First Design**: All major components MUST depend on explicitly defined interfaces (`IBrowserProvider`, `ILLMProvider`, `IMemoryProvider`, `IStorageProvider`, `IConfigurationProvider`).
3. **No Unapproved Structural Modifications**: Architectural changes require a formal Architecture Decision Record (ADR) approved in `docs/adr/`.

---

## Article III: Documentation as Truth

1. **Repository as Source of Truth**: The repository documentation (`docs/` and `.ai/`) IS the single source of truth.
2. **Persistence**: Conversation history is transient; code and repository markdown files are permanent.
3. **Self-Documenting Codebase**: Every implementation MUST update human documentation in `docs/` and AI operational context in `.ai/`.

---

## Article IV: Quality & Security Guardrails

1. **Quality Gates**: No code reaches production without 100% clean builds, zero lint warnings (`--max-warnings 0`), passing typechecks (`tsc --noEmit`), passing unit tests, and security reviews.
2. **Security Sandboxing**: All executable actions, filesystem accesses, shell commands, and LLM context entries MUST be guarded by strict policy sandboxing (`packages/policy`).
3. **Secret Isolation**: Secrets and API keys must never be committed, logged, or exposed to the client UI.

---

## Article V: AI Agent Operational Limits

1. **Hierarchical Pipeline**: AI assistants MUST strictly follow the execution pipeline: Epic → Work Package → Checkpoint → Task → Verification → Completion Report.
2. **No Unsolicited File Creation**: AI assistants MUST NOT create or modify files during Design or Architecture phases without explicit user authorization.
3. **Mandatory Verification**: AI assistants MUST verify all changes empirically via build, test, and typecheck commands before submitting completion reports.
