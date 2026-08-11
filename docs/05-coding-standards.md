---
Version: 1.0.0
Status: APPROVED
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Related ADRs:
  - 0001-monorepo
Related Packages:
  - '@sutradhar/contracts'
  - '@sutradhar/utils'
---

# Coding Standards & Best Practices

## 1. Code Formatting & Style Rules

- **Formatter**: Prettier with `printWidth: 100`, `tabWidth: 2`, `singleQuote: true`, `semi: true`, `trailingComma: 'all'`.
- **Linter**: ESLint with TypeScript-ESLint strict rules enabled (`--max-warnings 0`).

## 2. File & Naming Conventions

- **Files**: `kebab-case.ts`. Target <300 lines of code per file (max 500).
- **Classes**: `PascalCase`.
- **Interfaces**: `PascalCase` prefixed with `I` (e.g. `IBrowserProvider`).
- **Types**: `PascalCase`.
- **Enums**: `PascalCase`.
- **Constants**: `UPPER_SNAKE_CASE`.

## 3. Strict Quality Guardrails

- **Zero Debt**: No untyped `any`, no placeholder implementations, no commented-out code, no `console.log`.
- **Error Handling**: All domain errors must extend `BaseDomainError`. Swallowing exceptions in empty `catch` blocks is forbidden.
- **Logging**: Use structured Pino logging with automatic secret redaction.
