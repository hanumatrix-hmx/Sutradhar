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
- `src/session/`: `BrowserSession`, multi-tab navigation, tab lifecycle; `dialog-cdp.ts` / `dialog-warden.ts` (native-dialog observation, and the pre-attached "warden" the CLI runs as a detached helper process).
- `src/actions/`: `BrowserActionEngine` (the 18 action types), `path-containment.ts` (download/upload allow-list containment), `download-lock.ts` (fail-fast, best-effort cross-process guard for one `download_file` per browser), `selector-dialect.ts` (rejects Playwright-style selectors, maps Puppeteer's `pierce/`/`xpath/`/`aria/`/`text/` prefixes).
- `src/dom/`: `DOMSemanticEngine` (interactive-element grounding), `frame-labels.ts` (iframe / shadow-root labels in snapshots), semantic element graph.
- `src/snapshot/`: Accessibility tree generator, semantic DOM pruner.
- `src/page/`, `src/skills/`, `src/verifier/`: page-structure model, composable browser skills, post-action verification.

## Known limitations

- Download/upload path containment is verified, but overlapping `download_file` calls on one browser are only guarded on a best-effort basis (the lock file lives in the process temp directory and is keyed by the exact browser endpoint string, so separate processes may not share it); page-initiated downloads outside `download_file` are not covered by the roots.
- The dialog warden's attribution of a blocking dialog to a tab is heuristic: popups that share a renderer with an opener that has since closed cannot be told apart, and a tab that is busy from birth is indistinguishable from one holding a dialog.
- `wait_for_selector` `state: "hidden"` answers come from a code path that produced false results in several audit rounds; the known ones are fixed, the class is not mechanically prevented.
- See `docs/22-changelog.md` ("0.5.0 (2026-09-29)") for the complete list.
