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
Related Packages:
  - '@sutradhar/contracts'
  - '@sutradhar/capability'
  - '@sutradhar/utils'
  - '@sutradhar/config'
  - '@sutradhar/observability'
  - '@sutradhar/events'
---

# @sutradhar/browser

> Headless browser automation wrapper engine, session pool manager, and semantic DOM snapshot generator for Sutradhar.

## Package Architectural Invariants

1. **Core Domain Isolation (`CTX-002`)**: Depends on foundational infrastructure packages (`CTX-001`). Must NEVER import from application or presentation packages (`apps/server`, `apps/web`).
2. **Detection-Evasion Boundary**: Sutradhar does not attempt to evade bot-detection or solve
   CAPTCHAs, and Cloudflare challenges, CAPTCHA walls, and IP-level blocks stop it exactly as
   they would stop any other automation tool run the same way. The only launch argument here
   with detection-relevant behavior is `--disable-blink-features=AutomationControlled`, which
   hides `navigator.webdriver` from scripts that check for it -- measured directly:
   `navigator.webdriver` is `true` without the flag and `false` with it. It does not defeat
   Cloudflare, CAPTCHA, or any other real bot-detection service, and other simple signals --
   the default headless user agent's `HeadlessChrome` substring and `--enable-automation`
   still being present in the launch command line -- remain unmasked. (In `DEFAULT_LAUNCH_ARGS`
   unconditionally, not gated behind any opt-in.) Chromium's own source (`bad_flags_prompt.cc`)
   classifies `--disable-blink-features` as unsupported, developer-only -- the opposite of a
   Chrome recommendation -- and a live headed launch with this flag present still shows Chrome's
   own "Chrome is being controlled by automated test software" banner.
3. **Session Resource Management**: Every launched browser session MUST be explicitly tracked and closed upon completion to eliminate orphaned Chromium processes.

## Sub-Module Layout

- `src/launcher/`: `BrowserLauncher`, launch argument preparation, launcher interfaces.
- `src/session/`: `BrowserSession`, multi-tab navigation, tab lifecycle.
- `src/snapshot/`: Accessibility tree generator, semantic DOM pruner.
