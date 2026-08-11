---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Quarterly
Bounded Context: CTX-002 (Core Domain Context - Browser Subsystem)
Depends on ADRs:
  - 0001-monorepo
  - 0002-browser-control
  - 0005-stealth-evasion
Related Packages:
  - '@sutradhar/contracts'
  - '@sutradhar/capability'
  - '@sutradhar/utils'
  - '@sutradhar/config'
  - '@sutradhar/observability'
  - '@sutradhar/events'
---

# @sutradhar/browser

> Headless browser automation wrapper engine, stealth launcher, session pool manager, and semantic DOM snapshot generator for Sutradhar.

## Package Architectural Invariants

1. **Core Domain Isolation (`CTX-002`)**: Depends on foundational infrastructure packages (`CTX-001`). Must NEVER import from application or presentation packages (`apps/server`, `apps/web`).
2. **Stealth Launch Policy**: All browser instances launched MUST apply stealth configuration flags (`--disable-blink-features=AutomationControlled`) and User-Agent spoofing to bypass bot detection software (ADR-0005).
3. **Session Resource Management**: Every launched browser session MUST be explicitly tracked and closed upon completion to eliminate orphaned Chromium processes.

## Sub-Module Layout

- `src/launcher/`: `BrowserLauncher`, stealth launch flags, launcher interfaces.
- `src/session/`: `BrowserSession`, multi-tab navigation, tab lifecycle.
- `src/snapshot/`: Accessibility tree generator, semantic DOM pruner.
- `src/stealth/`: Anti-detection evasion scripts (navigator.webdriver override).
