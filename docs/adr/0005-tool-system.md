---
Number: '0005'
Title: Extensible Typed Tool System & Policy Guardrails
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Date: 2026-07-28
Superseded Versions: None
Related Packages:
  - '@sutradhar/tools'
  - '@sutradhar/policy'
---

# ADR 0005: Extensible Typed Tool System & Policy Guardrails

## 1. Context

AI agents interact with browsers, filesystems, HTTP endpoints, and shell instances by executing tools. Invoking unvalidated or unrestricted tools creates severe security risks (indirect prompt injection, arbitrary command execution, unauthorized filesystem access).

## 2. Decision

We decide to build a **Standardized Tool Interface** (`@sutradhar/tools`) governed by an intercepting **Policy Guardrail Layer** (`@sutradhar/policy`).

- Every tool implements `ITool<TInput, TOutput>` with Zod input validation schemas.
- Every tool execution passes through `@sutradhar/policy` interceptors enforcing permission masks, path constraints, and rate limits.
- Tool actions run inside isolated child processes with 30-second timeout limits.

## 3. Alternatives Considered

- **Option A (Unrestricted Function Calling)**: Allowing LLMs to execute raw shell commands or arbitrary JS code.
  - _Rejected due to unacceptable security vulnerability._

## 4. Consequences

### Positive

- Strict security isolation; zero unauthorized filesystem or shell access.
- Easy addition of new tools (Browser, Git, HTTP, Clipboard) via unified `ITool` interface.

### Negative

- Slight execution overhead (sub-5ms) during policy interception checks.
