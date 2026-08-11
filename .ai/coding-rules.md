---
State Category: Operational / Persistent
Schema Version: 1.0.0
Machine Readable: true
Update Ownership: AI Agent / Architect
Freshness Expectation: Per Change
Update Policy: Change-driven
Last Updated: 2026-07-28
---

# AI Coding Rules & Implementation Guardrails

## Immutable Code Generation Rules

1. **Zero `any` Allowance**: All TS code must use explicit types, interfaces, or generics. `any` is strictly prohibited.
2. **File Size Target**: Target <300 lines of code per file (maximum 500 lines). Refactor large modules into small focused sub-files.
3. **Hexagonal Imports**: Always use absolute workspace imports (`@sutradhar/contracts/dto`). Relative imports (`../`) crossing package boundaries are forbidden.
4. **No Swallowed Exceptions**: Every `catch` block MUST either handle, wrap in a domain error extending `BaseDomainError`, or rethrow. Silent `try/catch {}` blocks are forbidden.
5. **No `console.log`**: Use structured Pino logger from `@sutradhar/observability`.
6. **No Placeholders**: Never generate TODO comments, fake mock implementations in production paths, or stubbed methods.
