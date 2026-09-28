---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Related ADRs:
  - 0002-browser-runtime
Related Packages:
  - '@sutradhar/browser'
  - '@sutradhar/runtime'
---

# Browser Runtime & Lifecycle Architecture

> **Status note (2026-09-29):** this is the original design target. In the shipped code the per-tab memory limit (500 MB) described below is not enforced, and the idle-session reaper is off by default in the runtime (the MCP server turns it on with a 30-minute default, `SUTRADHAR_IDLE_TIMEOUT_MS`). For current behavior see [ARCHITECTURE.md](./ARCHITECTURE.md), `packages/browser/README.md` and `packages/capability-runtime`.

## 1. Overview

The Browser Runtime manages browser instances, context isolation, tab navigation, DOM snapshot extraction, and element interaction lifecycles.

## 2. Session Isolation & Context Rules

- **Incognito Contexts**: Every `BrowserSession` is allocated a clean, isolated browser context.
- **Resource Limits**: Strict memory limits (max 500MB RAM per tab) and execution timeouts (max 30s per page action) are enforced.
- **Teardown Hooks**: Automatic session cleanup occurs when sessions idle for over 15 minutes or upon process shutdown.

## 3. DOM Snapshot Extraction Pipeline

```
Raw HTML DOM ──► Prune Hidden Nodes ──► Clean CSS/Scripts ──► Map Element IDs ──► Semantic Snapshot DTO
```

The snapshot pipeline reduces raw DOM sizes by up to 90%, optimizing context window usage for LLM prompts.
