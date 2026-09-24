# Field Report 2 loop — gaps found by Auditors (append-only)

| gap-id | item | severity | description | status | fixed-in |
|---|---|---|---|---|---|
| GAP-001 | FR2-01 (found during planning) | minor | `maxRetries` defaults to 2 in the engine, so a genuine `state:'visible'` timeout now costs ~3x timeoutMs + backoff + a failure screenshot (e.g. ~26s at an 8000ms timeout), which risks tripping a caller's own outer tool-timeout. FR2-01's spec deliberately does not change this (smallest diff for that item). | TODO | - |
| GAP-002 | FR2-01 (found during planning) | minor | `tools/scenario-suite/run-cli.mjs:152,437` contain stale comments claiming "CLI has no wait command" and use fixed sleeps instead, even though `cmdWait` has existed in `cli.ts:447` for a while. Docs/behavior drift, not caused by this loop. Natural home: FR2-08 (condition waits) or FR2-17 (docs sweep). | TODO | - |
| GAP-003 | FR2-01 (found during planning) | minor | Puppeteer's `visible`/`hidden` wait modes force requestAnimationFrame-based polling, which can stall in a background/non-foreground tab. `spawn-chrome.ts` (CLI headed launch) doesn't set `--disable-renderer-backgrounding`/`--disable-backgrounding-occluded-windows`, and `browser.attach` to a user's real Chrome can target a backgrounded tab. Flagged as an adversarial case for FR2-01's Auditor to actually test; not yet confirmed as a real reproduction. | TODO | - |

| GAP-004 | FR2-02 (planning) | minor | No SDK `Page.extract` and no CLI `extract` verb. Deliberately deferred so the field-map syntax gets designed once. Natural home: FR2-13. | TODO | - |
| GAP-005 | FR2-02 (planning) | minor | The live-verify harness helpers (MCP stdio client, observer, rmWithRetry, freshUrl) get copied into each verify-fr2-*.mjs script. Consolidate them into a shared module after Phase 1. | TODO | - |

(Further entries populated as Auditors report gaps during the loop.)
