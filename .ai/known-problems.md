---
State Category: Operational / Session
Schema Version: 1.1.0
Machine Readable: true
Update Ownership: AI Agent / Technical Writer
Freshness Expectation: Per Issue
Update Policy: Change-driven
Last Updated: 2026-08-09
---

# Active Technical Debt & Known Problems Log

> Previous version claimed "None currently active." That was inaccurate. This
> list reflects the real state after the 2026-08-08 stabilization + real-agent
> rework.

## Problem Inventory

- **ID**: `PROB-001`
  - **Summary**: Local 9B model quality is task-dependent; reasoning models may emit empty content under tight token budgets.
  - **Severity**: Medium
  - **Status**: MITIGATED (model is swappable via env; tests tolerate empty-content)
  - **Impact**: On extraction-from-text tasks (e.g. Wikipedia infobox) the local
    `qwen3.5:9b` performs well (verified: returns "23 June 1912" correctly).
    On tasks requiring precise element targeting the model can loop, and its
    `<think>` block can consume a small `maxTokens` budget leaving empty content.
  - **Mitigation**: Set `SUTRADHAR_MODEL` (or `OPENROUTER_API_KEY`) to use a
    stronger model. The loop uses a generous `maxTokensPerTurn` (768). The
    default test suite tolerates honest empty-content outcomes from the real
    model rather than asserting fake fixed strings.

- **ID**: `PROB-002`
  - **Summary**: Memory tiers are not consulted by the agent loop.
  - **Severity**: Low
  - **Status**: OPEN
  - **Impact**: Episodic/semantic memory compiles but the loop does not yet use
    retrieval to inform planning. No functional regression; just unused capacity.
  - **Mitigation**: None required for current operation.

- **ID**: `PROB-003`
  - **Summary**: ~~Agent goal execution remains synchronous on the backend.~~
  - **Severity**: Low
  - **Status**: RESOLVED 2026-08-09 (Phase 4)
  - **Impact**: Resolved: the UI now uses the async runs API
    (`POST /api/v1/runs` + `GET /api/v1/runs/:runId/events` SSE +
    `POST .../cancel`) — live real steps stream into the dock/timeline and
    Stop cancels the real loop end-to-end. `POST /api/v1/agents/goals`
    remains available as a synchronous endpoint (tests + compat) but the
    frontend no longer calls it.
  - **Mitigation**: None needed.

- **ID**: `PROB-005`
  - **Summary**: ~~Run history persists client-side only (localStorage session model).~~
  - **Severity**: Medium
  - **Status**: RESOLVED 2026-08-09 (Phase 5)
  - **Impact**: Resolved: runs are storage-backed on the server (one JSON per
    run at `runs/<runId>.json`, written at START, updated at END incl.
    failed/cancelled, indefinite retention, restart-survival verified).
    localStorage is cache only; boot reconciliation settles stale `running`
    records from server truth. History page + run detail served from the
    runs API.
  - **Mitigation**: None needed.

- **ID**: `PROB-006`
  - **Summary**: ~~Session-page screenshot polling can saturate the browser connection pool, leaving a subsequent page's API calls stuck on "Loading…" until reload.~~
  - **Severity**: Medium
  - **Status**: RESOLVED 2026-08-12, live-verified
  - **Impact**: `captureScreenshot` now threads an `AbortSignal` through
    `serverBrowserAdapter` → `browserCapabilityAPI` → `EmbeddedBrowser.tsx`.
    The poll loop aborts the previous in-flight request before starting a
    new one (caps concurrent screenshot requests to 1) and aborts on
    unmount/`browserSession` change (route away), so a hanging request can
    no longer hold a connection-pool slot a subsequent page's API calls
    need. **Live-verified 2026-08-12**: ran the real backend + frontend
    dev stack, drove the actual dashboard through Sutradhar's own MCP
    tools, created a live session, and rapidly bounced between the
    session view (active screenshot polling) and History 3x in a row —
    History loaded instantly every time, no "Loading…" hang, no errors in
    the server log. The existing `MAX_SCREENSHOT_FAILURES` counter
    (unaffected by this change) still separately handles the
    repeated-real-failure back-off case.
  - **Mitigation**: None needed.

- **ID**: `PROB-004`
  - **Summary**: ~~README still lists ~25 packages; several are empty/aspirational.~~
  - **Severity**: Low
  - **Status**: RESOLVED 2026-08-11
  - **Impact**: Resolved: README's monorepo structure section now lists every
    package with real source (was missing `capability-runtime`, `mcp-server`,
    `cli`, `sutradhar`, `dev-runtime`) and explicitly names the empty
    scaffolding dirs (`backend`, `configs`, `core`, `desktop`, `providers`,
    `shared`, `types`) instead of silently omitting or overstating them.
  - **Mitigation**: None needed.

- **ID**: `PROB-007`
  - **Summary**: The "New Session" modal silently no-ops if Launch is clicked with an empty Goal field.
  - **Severity**: Low
  - **Status**: OPEN
  - **Impact**: Found live 2026-08-12 while dogfooding the dashboard: the
    Goal `<textarea>` has a native `required` attribute; clicking "Launch
    Session" with it empty triggers the browser's native constraint
    validation, which blocks the submit — but nothing in the app's own UI
    indicates why (no toast, no inline error, no focus/scroll to the
    field). It just looks like the button did nothing.
  - **Mitigation**: None yet. Fix is small: either surface a visible
    inline error, or replace/report the native validation via
    `onInvalid`/`reportValidity()` so it's obvious what's missing.

## Resolved

- ~~Run history client-side only — lost on site-data clear, no multi-day
  access~~ **RESOLVED 2026-08-09** (Phase 5) — server-persisted runs on
  `LocalFileStorage` (`runs/<runId>.json`), write at START + update at END
  (failed/cancelled included), indefinite retention; records survive server
  restart (verified live). Runs API: list with `sessionId/status/from/to`
  filters, full-record GET, DELETE (404/409/200 — UI confirms before
  calling). Frontend: History page (`/#/history`, day-grouped, search +
  status chips), run detail (`/#/history/:runId`, trace/answer/export/
  open-session/re-run/delete), session "Past runs" strip from the server
  list, boot reconciliation of stale `running` records. Browser-agent
  verified A–E incl. write-through of a fresh UI run.
- ~~Agent goal execution synchronous — no live progress, client-only Stop~~
  **RESOLVED 2026-08-09** (Phase 4) — async runs API + SSE: server-assigned
  runId, `runs/:runId/events` streams real `started`/`step`/`result` frames
  (replayable buffer; reconnect-safe), Stop hits `runs/:runId/cancel` which
  aborts the loop's AbortSignal (step boundary AND mid-turn), honest
  `'cancelled'` terminal status preserving the steps already executed.
  Verified live: steps render while Running; cancel settles as
  "Cancelled · N steps" with no error surface.
- ~~Viewport frame stays stale (start page) after the agent navigates~~
  **RESOLVED 2026-08-09** (Phase 3) — root cause: three separate backend
  browser sessions per UI session (viewport launch, store create, agent
  loop create), plus the frontend guessing tabIds for screenshots. Fix:
  UI session id binds everything (`POST /api/v1/sessions` + `agents/goals`),
  `BrowserSessionManager.createSession` idempotent for caller-supplied ids
  (with in-flight coalescing), agent loop reuses the caller's live session
  and only closes its own, frontend `BrowserSession` auto-launch removed,
  screenshot/eval omit tabId (backend active tab wins), tab strip/omnibar
  sync from `GET /sessions/:id`. Verified live: frame + address bar follow
  agent navigation end-to-end.
- ~~Controls invisible until hover (blank rail icons, faded ink)~~
  **RESOLVED 2026-08-09** (Phase 2.5 hardening) — two root causes:
  (1) `makeIcon` applied stroke via `React.Children.map`, which does not
  descend into fragments, so all multi-path icons rendered `stroke: none`;
  stroke now inherits from the `<svg>`. (2) Ink tokens below WCAG minimums
  (tertiary 2.25:1 light / 2.55:1 dark); ink ladder rebuilt to 12.6/5.5/4.6:1
  light and matching dark values, semantic inks text-safe + white-fill-safe,
  idle dots ≥ 3:1. Verified live in browser: glyphs visible at rest.
- ~~Ad-hoc status strings + invented client run ids~~ **RESOLVED 2026-08-09**
  (Phase 2) — real lifecycle machine (`deriveSessionPhase`: preparing → ready
  → running → completed|failed|cancelled → archived); `agents/goals` accepts
  `sessionId` and returns the server-assigned `runId`, linked into RunRecords;
  first-class Result tab + floating error card + honest run timer. Typecheck
  28/28, frontend 29/29, server unit 4/4 green.
- ~~Flat 2018-era visual language & scattered inline SVG/emoji icons~~
  **RESOLVED 2026-08-09** (Phase 1) — Neumorphic Soft UI design system landed
  via `styles/soft.css` token remap (both themes, light default); floating
  rail/omnibar/dock layout; agent status orb + floating answer delivery card;
  action-first Home goal intake; single `components/ui/icons.tsx` icon module
  (stroke 1.5, round caps, zero emoji in controls). `pnpm typecheck` green;
  frontend tests 29/29 green.
- ~~Phase 0 UX correctness defects~~ **RESOLVED 2026-08-09** — fabricated state
  (fake progress/tasks/timeline/URL guessing) removed; real `error`/`detached`
  session states with relaunch; visible controllable auto-start + Stop +
  settings toggle; runs persisted as RunRecords and rendered after reload;
  hash-based routing (deep links, refresh, back/forward); backend DELETE wired
  with boot reconciliation; viewport errors surfaced with Reconnect; credential
  form removed from auth modal. `pnpm typecheck` green; all frontend + package
  tests green.
- ~~Frontend unit tests never executed (`vitest.config.ts` include missed
  `tests/unit`)~~ **RESOLVED 2026-08-09** — include pattern fixed; 29 tests run.
- ~~`dev-runtime` typecheck broken by unused import~~ **RESOLVED 2026-08-09**.

- ~~`PROB-000`~~: LLM adapters were fake (returned hardcoded strings). **RESOLVED
  2026-08-08** — replaced with the real `OpenAiCompatibleAdapter`.
- ~~Contract drift causing ~130 type errors across packages.~~ **RESOLVED
  2026-08-08** — `BrowserActionDto`, event payloads, and memory types reconciled;
  full monorepo typechecks clean.
- ~~2 failing frontend screenshot tests.~~ **RESOLVED 2026-08-08** — mock adapter
  now returns a real PNG data URI.
- ~~Agent loop was scripted theater (`if(goal.includes('github'))`).~~ **RESOLVED
  2026-08-08** — replaced with a genuine LLM-driven ReAct loop.
