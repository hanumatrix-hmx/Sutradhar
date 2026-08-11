---
State Category: Operational / Persistent
Schema Version: 1.0.0
Machine Readable: true
Update Ownership: QA Lead / AI Agent
Freshness Expectation: Per Checkpoint
Update Policy: Change-driven
Last Updated: 2026-07-28
---

# AI Completion Verification Checklist

## Mandatory Verification Pipeline

Before producing a Completion Report for any checkpoint, the AI Agent MUST verify:

1. **Compilation Check**: `npx -p typescript tsc --noEmit` returns exit code 0.
2. **Formatting Check**: `npx -p prettier prettier --check <files>` returns exit code 0.
3. **Linter Check**: `pnpm lint --max-warnings 0` returns exit code 0 (when packages exist).
4. **Unit Test Check**: `pnpm test` returns 100% passing tests (when packages exist).
5. **Monorepo Build Check**: `pnpm build` builds cleanly across Turborepo pipelines.
6. **Documentation Integrity**: All frontmatter headers complete; zero broken markdown links.
