---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-001 (Foundational Context)
Depends on ADRs:
  - 0001-monorepo
Related Packages:
  - '@sutradhar/contracts'
  - '@sutradhar/utils'
---

# @sutradhar/observability

> Structured JSON logging, metrics aggregation, and OpenTelemetry context tracing engine for Sutradhar.

## Package Architectural Invariants

1. **Foundational Layer Boundary (`CTX-001`)**: Depends strictly on `@sutradhar/contracts` and `@sutradhar/utils`. Must NEVER import from domain, infrastructure, or application packages (`packages/browser`, `packages/orchestrator`, `apps/*`).
2. **Zero External Runtime NPM Dependencies**: Core logger and metrics engine are implemented using pure TypeScript without bloated external logger libraries.
3. **Structured JSON Output**: All log entries conform to standardized JSON schema with trace IDs, correlation IDs, timestamps, and contextual attributes.

## Sub-Module Layout

- `src/logger/`: `StructuredLogger`, `ConsoleLogTransport`, child loggers, log levels.
- `src/metrics/`: `MetricsCollector`, counters, histograms, gauges.
- `src/tracing/`: `Tracer`, trace context propagation.
