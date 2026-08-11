---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Depends on ADRs:
  - 0005-tool-system
References ADRs:
  - 0001-monorepo
Related Packages:
  - '@sutradhar/policy'
  - '@sutradhar/config'
  - '@sutradhar/tools'
---

# Security Architecture & Threat Model

## 1. Executive Summary

This document specifies the security architecture, threat model, and defense mechanisms for the Sutradhar AI Browser Runtime Platform.

---

## 2. Threat Model & Risk Vectors

1. **Indirect Prompt Injection**: Untrusted web page text containing malicious LLM instructions targeting agent context.
   - _Defense_: `packages/browser` prunes untrusted HTML and `packages/policy` sanitizes text inputs before injecting into Working Memory.
2. **Tool Execution Escalation**: Unauthorized tool calls trying to access local filesystems or execute shell commands.
   - _Defense_: All tool actions pass through `@sutradhar/policy` guardrails enforcing strict path constraints and permission masks.
3. **Secret & Credential Exposure**: API keys or session cookies leaking into logs or client UI views.
   - _Defense_: `@sutradhar/config` loads secrets into encrypted memory; `@sutradhar/observability` automatically redacts sensitive patterns in Pino logs.

---

## 3. Sandboxing & Permission Model

- **Child Process Isolation**: Shell and tool execution instances run inside sandboxed child processes with restricted environment variables and execution timeout limits (max 30s).
- **Network Boundaries**: Outbound HTTP requests from tools are filtered against an explicit domain allowlist/denylist configured in `packages/policy`.
