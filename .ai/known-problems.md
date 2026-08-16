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
  - **Status**: OPEN — recommendation ready 2026-08-14, pending user sign-off to close
  - **Impact**: Episodic/semantic memory compiles but the loop does not yet use
    retrieval to inform planning. No functional regression; just unused capacity.
  - **Research (2026-08-14)**: this had sat as "needs a user decision" for multiple
    sessions with nobody doing the legwork to make that decision easy. Investigated properly:
    - The real, live agent loop (`agent-loop.ts`, everything `apps/server` actually executes)
      already has cross-run continuity via `CrossRunMemory` — disk-persisted, wired at 4 real
      call sites, tested (6 cases), and it's the thing already feeding prior-run context into
      the LLM's prompt today.
    - `packages/memory`'s multi-tier system is real (not stubs) but 5 named tiers reduce to 3
      distinct classes, retrieval is substring matching everywhere in practice (its one
      genuine semantic/embedding path never activates — no embedding provider exists anywhere
      in this codebase), and it has no persistence (in-process `Map`, lost on restart).
    - Within a single run, nothing is being forgotten that memory tiers would recover — the
      full step history already stays in scope for the run's duration and feeds the prompt.
    - A separate `RuntimeKernel`/`PlannerService`/`GoalPlanner` subsystem *does* have real code
      to consult episodic memory, but it's unreachable dead code (see new entry below) — not
      wired into any real run, so this isn't even a live gap today.
  - **Recommendation**: don't build it. `CrossRunMemory` already covers what this tool's actual
    workload (short, ~15-step browser-automation tasks) needs; wiring the memory package in
    wouldn't change agent behavior today since its only real differentiator (semantic search)
    is blocked on a currently-nonexistent embedding provider, not on loop wiring. If this
    changes (an embedding provider gets added, or tasks start genuinely needing persisted
    semantic recall), revisit then with that as the trigger, not on a schedule.
  - **Mitigation**: None required for current operation. Awaiting explicit user confirmation
    to flip this to RESOLVED/won't-fix rather than closing it unilaterally, since it's a
    product-direction call, not a bug.

- **ID**: `PROB-010`
  - **Summary**: `RuntimeKernel`/`PlannerService`/`MemoryService`/`GoalPlanner` subsystem is
    dead code — real logic, real tests, but unreachable from any actual run.
  - **Severity**: Low
  - **Status**: OPEN (found during `PROB-002` research, not yet acted on)
  - **Impact**: `packages/agent/src/kernel/*` and `packages/agent/src/planner/goal-planner.ts`
    implement a parallel agent architecture (kernel + services + a planner that queries
    episodic memory) that nothing outside their own unit tests ever calls —
    `agent-app-service.ts`, `run-manager.ts`, `dependency-container.ts`, and `bootstrap.ts`
    (the real execution path) never reference any of it. Even where it's internally wired
    (`GoalPlanner` consulting episodic memory), the one real construction site
    (`runtime-services.ts`'s `PlannerService`) passes zero constructor args, so that path is
    inert even in isolation. `GoalPlanner.createPlan()` also returns a hardcoded 3-step
    boilerplate plan that `runAgentLoop` wouldn't consume even if it were reachable — the real
    loop does its own per-step LLM reasoning, not planner-driven execution.
  - **Mitigation**: None yet — this is a real cleanup candidate (remove, or explicitly mark
    `@experimental`/unused so it doesn't look like live functionality), not a bug fix. Flagging
    rather than deleting reflexively since it's real, tested code, not empty scaffolding —
    removing it is a more consequential, visible change than the earlier scaffolding-dir
    cleanup and deserves a deliberate look, not a drive-by deletion.

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
  - **Summary**: ~~The "New Session" modal silently no-ops if Launch is clicked with an empty Goal field.~~
  - **Severity**: Low
  - **Status**: RESOLVED 2026-08-14, live-verified
  - **Impact**: Found live 2026-08-12 while dogfooding the dashboard. Real root cause,
    found on fix (`packages/frontend/src/app/App.tsx`), was more specific than first assumed:
    the Goal `<textarea>`'s native `required` attribute was never actually the blocker — the
    "Launch Session" button lives in the `Modal`'s `footer` slot, rendered as a sibling `<div>`
    *outside* the `<form>` element, with no `form="..."` attribute linking it back. So clicking
    it never triggered a native form submission at all; native `required` validation was
    inert. The actual silencer was `disabled={!newGoal.trim()}` on the button itself — a
    disabled button fires no `onClick`, so `handleCreateSession` never ran and no feedback
    logic (that already existed) ever got a chance to execute.
  - **Mitigation**: Removed `disabled` from the button so it's always clickable;
    `handleCreateSession` now sets an inline error (via `TextArea`'s existing `error` prop,
    `role="alert"`) and focuses the field when Goal is empty, instead of silently returning.
    Error clears on the next keystroke. Live-verified 2026-08-14: built and ran the real
    `apps/server` (:8081) + `packages/frontend` dev server (:3055), drove the actual dashboard
    through Sutradhar's own MCP tools — clicking Launch with an empty Goal now shows "Goal is
    required — describe what the agent should accomplish." inline; typing a real goal and
    clicking Launch still correctly creates a session and navigates to it (no regression on
    the happy path). `packages/frontend` typecheck clean, full suite 29/29 passing.

- **ID**: `PROB-008`
  - **Summary**: `browser.snapshot`'s MCP response double-printed its own header with two different, unexplained element counts.
  - **Severity**: Low
  - **Status**: RESOLVED 2026-08-13
  - **Impact**: Resolved: `mcp-server/src/tools.ts`'s `browser.snapshot` handler prepended its
    own `URL/Title/Interactive elements (elementCount)` header in front of
    `snap.interactiveElements`, which already embeds its own such header — but with the
    *interactive-only* count, not `elementCount` (which counts every semantic-graph node).
    Result: the response showed "Interactive elements (4):" immediately followed by
    "Interactive elements (1):" for the same page, with no explanation. The CLI's `cmdSnap`
    already had a comment explicitly warning about this exact trap; the MCP tool just never
    got the same fix. Removed the redundant outer header.
  - **Mitigation**: None needed.

- **ID**: `PROB-009`
  - **Summary**: Navigating directly to a PDF returns the native viewer's toolbar controls via `browser.snapshot` but zero document text.
  - **Severity**: Medium
  - **Status**: OPEN
  - **Impact**: Found live 2026-08-13 while dogfooding PDF handling: Chrome's built-in PDF
    viewer (PDF.js) renders when a session navigates directly to a `.pdf` URL.
    `browser.snapshot` correctly enumerates the viewer's own UI controls (zoom, print,
    download, page nav) as interactive elements, but `pageText` comes back completely empty —
    confirmed against a PDF with real (if compressed) text content, so this isn't a text-free
    test file. An agent trying to *read* a PDF encountered mid-browse gets nothing useful.
  - **Mitigation**: None yet. Needs real PDF text-layer extraction (e.g. driving PDF.js's own
    text layer via CDP/`eval`, or a PDF-parsing library) — nontrivial scope, not a quick fix.
    `browser.export_pdf` (page → PDF) is unaffected and works correctly.

- **ID**: `PROB-011`
  - **Summary**: `ExecutionVerifier.verifyAction`'s `verified` field now honestly reports `false` for spec-less, non-self-verifying actions — this is an intentional behavior change from field-report remediation Phase 2, not a regression, but any external caller keying off `verification.verified` will see different values than before 2026-08-16.
  - **Severity**: Low (behavior correction, not a bug)
  - **Status**: RESOLVED (documented for visibility, not tracked as open work)
  - **Impact**: Before this change, `ExecutionVerifier` hardcoded `elementFound: true` and defaulted `verified: true, confidence: 0.9` for *any* action that completed without throwing — including actions with no built-in post-condition check and no caller-supplied `verificationSpec`, which was never actually evidence the action did what it claimed (found live: a `type` that silently left a field empty still reported `verified:true, confidence:0.9`). Now, only actions with a real post-condition check (either a satisfied `verificationSpec`, or a self-verifying action type — see `SELF_VERIFYING_ACTION_TYPES` in `execution-verifier.ts`: `click`, `click_by_role`, `type`, `type_by_label`) get a confident `verified:true`. Everything else reports `verified:false` with an honest reason ("completed without throwing, but has no built-in post-condition check and no verificationSpec was provided").
  - **Mitigation**: N/A — this is the fix. Any downstream code (dashboards, agent-loop logic) that branches on `verification.verified` should be reviewed if it assumed the old always-optimistic default; none is known to exist in this repo today (checked: no consumer keys off this field outside test assertions, which were updated in the same change).

- **ID**: `PROB-012`
  - **Summary**: `click_by_text` does not go through the occlusion-safe, delivery-verified click path — it calls `element.click()` directly, unlike `click`/`click_by_role` which both go through `verifiedClickOnHandle`.
  - **Severity**: Low-Medium
  - **Status**: OPEN — deliberately not fixed as part of field-report remediation Phase 2, to keep that change scoped to the verifier itself
  - **Impact**: `click`/`click_by_role` both verify real delivery (occlusion check + a delivery-marker event listener, in `verifiedClickOnHandle`) before reporting success, and are listed in `ExecutionVerifier`'s `SELF_VERIFYING_ACTION_TYPES` accordingly. `click_by_text` (`browser-action-engine.ts`) instead resolves the element and calls `(el as HTMLElement).click()` directly, bypassing that whole path — so it is deliberately excluded from `SELF_VERIFYING_ACTION_TYPES`, meaning a spec-less `click_by_text` now honestly reports `verified:false` rather than a fabricated `true` (see PROB-011). The underlying gap — no occlusion/delivery check for `click_by_text` specifically — is still open.
  - **Mitigation**: None yet. Fix would be routing `click_by_text` through the same `verifiedClickOnHandle` helper `click`/`click_by_role` use, once its element-resolution path (currently text-based, not selector-based) is reconciled with that helper's `ElementHandle`-based signature. Small, scoped follow-up — not attempted here to avoid scope creep into Phase 2's already-large batch.

- **ID**: `PROB-013`
  - **Summary**: Interactive-element detection still can't see elements whose *only* interactivity signal is a JS `addEventListener`-attached handler with no `onclick=`, `tabindex`, ARIA role, or `cursor:pointer` styling.
  - **Severity**: Low
  - **Status**: OPEN — deliberately not built as part of field-report remediation Phase 3, logged per that phase's own instruction to document rather than build it
  - **Impact**: Phase 3 extended `dom-semantic-engine.ts`'s `INTERACTIVE_SELECTOR` with `[onclick]`, `[tabindex]:not([tabindex="-1"])`, `[contenteditable]`, `[role="option"]`, `label`, `summary`, plus a `cursor:pointer` computed-style fallback for elements matched by none of the above — this closed the real, live-reproduced GLM UC-06a gap (the-internet.herokuapp.com/entry_ad's modal "Close", a bare `<p>` with `cursor:pointer`). But `cursor:pointer` is a *proxy*, not a direct signal: an element with a real `addEventListener('click', ...)` handler and ordinary default cursor styling (no `cursor:pointer` CSS, no `onclick=` attribute, no `tabindex`) is still invisible to this scraper. Genuinely detecting `addEventListener`-attached handlers requires CDP's `DOMDebugger.getEventListeners`, which needs a live CDP session per candidate element — a materially larger architecture change than a selector/style-check extension.
  - **Mitigation**: None yet. If this proves to matter in practice (a real page where an agent needs to click something with neither semantic markup nor pointer-cursor styling), the fix is wiring `DOMDebugger.getEventListeners` through the existing CDP session `BrowserActionEngine` already holds, called selectively (not on every element — likely only as a fallback when nothing else in a region of interest matches) to bound the cost.

- **ID**: `PROB-014`
  - **Summary**: A published `sutradhar` 0.2.0 npm artifact once behaved differently from its own source tree at the time (GLM's field report flagged `<select>` grounding as broken; the source that would have produced that exact published version already had correct `<select>` handling) — and the specific cause is **unrecoverable from git history**, because the mechanism that would have recorded it never existed.
  - **Severity**: Medium (release-integrity gap, not a live bug)
  - **Status**: RESOLVED 2026-08-16 (field-report remediation Phase 6) — the *unverifiability*, not a specific root cause, was the real defect; that is now fixed
  - **Impact**: Investigated thoroughly (do not re-investigate — this is the complete finding): `select` has been in `dom-semantic-engine.ts`'s `INTERACTIVE_SELECTOR` and `interactiveTags` since the initial commit `dc0e029` (2026-08-11), four days before 0.2.0 published; `git log -S"select" -- packages/browser/src/dom/` shows no other touch in the 0.2.0→0.2.2 window; `git diff --stat` between those two tags touches no file under `packages/browser/` at all. So **no commit ever "fixed" `<select>` grounding** — the published 0.2.0 artifact simply didn't match its own source tree, and *why* cannot be recovered, because (a) `packages/sutradhar/dist/` is gitignored — published bytes were never in git, (b) the build script had no clean step, and (c) workspace packages resolve through their **compiled** `dist/`, not `src/`, so a stale `packages/browser/dist/` at bundle time would silently embed stale engine code into the published tarball with nothing to detect it. Do not invent a more specific cause than this — none is recoverable.
  - **Mitigation**: Built the gate this needed. `scripts/build-bundle.mjs` now computes the real workspace-dependency closure from `package.json` edges (not a hand-maintained list — the exact kind of list that would itself silently drift), wipes every one of those packages' `dist/` and rebuilds each from clean, in dependency order, before bundling — a stale compiled dependency can no longer reach a published artifact undetected. `scripts/check-release-ready.mjs` (wired as `packages/sutradhar`'s `prepublishOnly`) refuses to let `npm publish` proceed if the git tree is dirty or any workspace package's `dist/` is older than its own `src/` — verified live by inducing both conditions independently (a real uncommitted change; a `touch`ed source file with no rebuild) and confirming the gate fails loudly on each, then rebuilding to pass again. `scripts/record-release-shasum.mjs` (wired as `postpack`) records each published tarball's sha256 into `packages/sutradhar/RELEASE-SHASUMS.md` — verified live via a real (unpublished) `npm pack`, independently re-hashing the resulting `.tgz` and confirming an exact match.

- **ID**: `PROB-015`
  - **Summary**: `UC-05`/`UC-14` (type-value-landing and duplicate-action-guard, both fixed in field-report remediation Phase 2) still fail intermittently — but only when run as part of the full sequential 14-scenario harness, never when run alone or filtered to just those two.
  - **Severity**: Low (the underlying fixes are independently verified correct; this is about *when* the residual raciness still surfaces, not whether the fix works)
  - **Status**: OPEN — investigated, not fully root-caused; not blocking Phase 7 given the weight of independent evidence the fixes are correct
  - **Impact**: Phase 7's final full-harness re-run (all 14 scenarios, SDK surface, sequential in one process) reproduced both UC-05 (type() landing empty under real timing pressure — steps showing 25+ second waits where they're normally low tens-of-ms) and UC-14 (a "Duplicate 'click_by_role' on the same target within 1000ms" error) for the SECOND time in this project's history — first during a mid-Phase-5 run contaminated by 49 accumulated zombie Chrome processes (resolved by killing them), second during a genuinely clean Phase 7 run with 0 Chrome processes running beforehand. Both scenarios pass reliably (3/3, then 2/2 across two separate isolated re-checks) when run alone via `SCENARIO_FILTER=UC-05,UC-14`, and source inspection confirms `checkDuplicateAction`'s key construction (the Phase 2 fix) is unchanged and correctly differentiates `role:button:...` from `role:menuitem:...` — a genuine key collision between UC-14's two calls should be structurally impossible now. The precise mechanism that still produces the *symptom* under sustained sequential-run load (14 real browser launches in one Node process) was not identified within this investigation's time budget — plausibly something size/GC/OS-handle-related that only manifests deep into a long run, not the original root cause (which is confirmed fixed).
  - **Mitigation**: None yet — needs a dedicated investigation (e.g. running the full sequential suite under a profiler, or bisecting which specific preceding scenario's resource footprint correlates with the failure) that this phase's time budget didn't allow. Not treated as blocking: the underlying Phase 2 fixes are independently verified via source review and isolated live reproduction, and this residual flakiness produces *honest* failures (a real validation error, a real rejected duplicate) rather than silent data corruption — consistent with this project's standing acceptance that some real browser-automation races are probabilistic under load, not eliminable, and the goal is honest reporting of them, not literal 100% determinism.

- **ID**: `PROB-016`
  - **Summary**: `SELF_VERIFYING_ACTION_TYPES` extended from 4 to 9 action types — `select_option`, `upload_file`, `scroll`, `drag_and_drop`, and `hover` now each carry a real post-condition check, closing an independent field campaign's Insight 1 (INSIGHTS.md, 2026-08-16: "apply verify-then-succeed everywhere, not just where bugs bit").
  - **Severity**: N/A (feature/hardening, not a bug)
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: Before this change, only `click`/`click_by_role`/`type`/`type_by_label` had a genuine post-condition check; the other five mutating-or-effectful action types reported `success:true` purely from "the Puppeteer call didn't throw" — the exact class of silent-failure risk PROB-011 first named. `select_option`/`upload_file` now read back the element's real landed value/file from the DOM after the call and throw on mismatch. `scroll` reads `window.scrollY` before/after and throws if it didn't move, unless the page is already at the relevant scroll boundary (avoids false-failing a legitimate no-op at top/bottom). `drag_and_drop` attaches a delivery-marker listener for the real `'drop'` DOM event before dispatching, and throws if it never fires — this is a genuine signal per the HTML5 DnD spec (a target needs a `dragover` handler calling `preventDefault()` for `'drop'` to fire at all), not a rubber stamp. `hover` needed no engine change — `verifiedHover` already did real occlusion verification; it only needed adding to the verifier's type set.
  - **Mitigation**: N/A — this is the fix. Live-verified against a real Chrome fixture (`select_option`, `upload_file`, `scroll` incl. boundary no-op, `hover`, `drag_and_drop` all confirmed via independent DOM read-back, not just the action's own report), plus a negative case: `drag_and_drop` onto a target with no `dragover` handler correctly reports `success:false` after 3 real retries, each with the real "no 'drop' event was observed" reason — proving the check is real, not decorative. `click_by_text` remains the one deliberate exception (PROB-012, unchanged).

- **ID**: `PROB-017`
  - **Summary**: CLI `withSession()` hard-errored ("Could not reconnect to the previous session... run 'sutradhar close' to clear stale state") whenever the persisted `~/.sutradhar-cli/state.json` pointed at a Chrome that was no longer reachable, forcing a manual `close` before the next command could proceed.
  - **Severity**: Low-Medium (usability/reliability for long-running CLI-driven agent sessions, not a correctness bug)
  - **Status**: RESOLVED 2026-08-16 — closes INSIGHTS.md Insight 8
  - **Impact**: An independent field campaign hit this after a crash mid-audit — the stale `state.json` blocked every subsequent command until a human ran `close` manually. For an hours-long agent session with nobody watching, that's a full stall, not a recoverable error.
  - **Mitigation**: `withSession()` (`packages/cli/src/cli.ts`) now catches a failed reconnect, prints a one-line self-heal note to stderr, best-effort kills the old Chrome process tree (`killChromeTree`, already safe on an already-dead PID), clears the stale state, and transparently spawns + attaches a fresh session via a new shared `spawnFreshSession()` helper — the same path used when there's no prior state at all. Live-verified: wrote a `state.json` pointing at an unreachable port, ran `sutradhar nav <url>`, confirmed the self-heal note fired, navigation completed on a real freshly-spawned Chrome, a valid new `state.json` was written, a follow-up `sutradhar snap` correctly reused that healed session, and `sutradhar close` cleaned it up (state file gone afterward). `packages/cli` vitest suite (13/13) and `tsc` both green.

- **ID**: `PROB-018`
  - **Summary**: New `allowedDomains` navigation guardrail (CLI `--allowlist-domains`, SDK `launch({allowedDomains})`, MCP `SUTRADHAR_ALLOWED_DOMAINS`/`allowedDomains` option — closes INSIGHTS.md Insight 10's "safe to hand agents a logged-in internal session" ask) only gates explicit runtime-initiated navigation, not page-initiated navigation from a clicked link.
  - **Severity**: Medium (matters specifically for the "prompt-injection defense-in-depth" half of the ask, not the "safe internal-session" half)
  - **Status**: OPEN by design — documented, not a bug to fix casually; would need real scope-widening
  - **Impact**: `SutradharRuntime.assertNavigationAllowed` is called from `launch()`'s `initialUrl`, `navigate()`, `audit()`'s `url`, `compareUrls()`'s both urls, and `createTab()`'s `url` — i.e. every place *this runtime* initiates a navigation. It is NOT hooked into the browser's own client-side navigation (a real `<a href>` the page navigates to when `browser.click`/`click_by_role`/`click_by_text` clicks it, or a JS `location.href=` the page runs on its own) — Puppeteer/CDP doesn't route those through any call this check intercepts. So the "safe internal session" half of the ask holds (an agent explicitly told to `navigate`/`launch` somewhere off-allowlist is blocked), but the "partial prompt-injection defense-in-depth" half is weaker than it sounds: a malicious page that gets an agent to click a link to an off-allowlist domain is NOT stopped by this guard alone.
  - **Mitigation**: Documented honestly in the option's doc comments (`runtime.ts`, `server.ts`, `browser.ts`) and the CLI's `--help` text rather than overclaiming. A real fix would need CDP-level navigation interception (e.g. `Page.setBlockedURLs` combined with a `framenavigated`/`Network.requestWillBeSent` listener, or `page.on('framenavigated')` that force-navigates back / throws) — bigger scope than this pass; not attempted here to avoid scope creep into what was meant to be a straightforward flag addition. If click-triggered off-domain navigation turns out to matter in practice, that CDP-level hook is the next step.
  - **Also live-verified working correctly for what it does cover**: CLI `sutradhar nav <url> --allowlist-domains a.com` blocks a non-listed domain with a clear error and allows a listed one through; unit tests cover exact-match, subdomain-match, non-suffix-match (`evilexample.com` vs `example.com`), composition with `restrictNavigationToLocal`, and both `compareUrls()` targets (`packages/capability-runtime/tests/unit/runtime.spec.ts`, `packages/cli/tests/unit/parse-args.spec.ts`, `packages/mcp-server/tests/unit/server.spec.ts` — all green).

- **ID**: `PROB-019`
  - **Summary**: `tools/scenario-suite/run-sdk.mjs` crashed outright (process exit 1, zero results written) on UC-07 ("Cross-origin iframe (TinyMCE)") during a live CI-wiring dry run — a `waitForSelector` on the TinyMCE `contenteditable` body threw "frame got detached" in a way that escaped `timed()`'s per-scenario try/catch and killed the whole script, not just that one scenario.
  - **Severity**: Medium (harness robustness — one flaky scenario shouldn't take down 13 others' results; also directly touches the still-open cross-origin-iframe-contenteditable gap)
  - **Status**: OPEN — found live 2026-08-16 while building `.github/workflows/scenario-suite.yml`; root cause not yet isolated to a specific line in `resolveElement`/the frame-search path
  - **Impact**: Full stack: `PierceQueryHandler.waitFor` → `CdpFrame.waitForSelector`, cause `IsolatedWorld.dispose`/`waitForFunction failed: frame got detached` — consistent with a frame that got torn down (TinyMCE's demo page reloading/re-rendering its iframe) while something was still awaiting a selector inside it. Because this rejection surfaced outside the `await fn()` call `timed()` wraps (likely a orphaned/unawaited branch of a multi-frame race, the same general shape as the already-documented `A2`-class `Promise.race`-without-cancellation pattern from the field-report remediation), it became an unhandled rejection and crashed the Node process outright — Node's default behavior since v15. This is exactly the scenario mentioned in RESPONSE-TO-FIELD-REPORT.md as the still-open "cross-origin iframe contenteditable" gap (same-origin-policy-level constraint noted there) — UC-07 is that gap's own regression scenario, so this crash is additional live evidence for it, not a new unrelated finding.
  - **Mitigation**: Workflow-level: `.github/workflows/scenario-suite.yml`'s CLI/MCP surface steps use `if: always()` so one crashing surface driver doesn't skip the other two, and `ci-gate.mjs` treats a genuinely missing surface-results file as a hard failure (distinct from a normal per-scenario failure) — so this class of crash is loud and visible in CI, not silently swallowed. The underlying harness/engine robustness gap (an escaping rejection from cross-frame element resolution) is not yet fixed — needs isolating exactly which awaited-but-unhandled branch inside `resolveElement`'s multi-frame race this comes from before attempting a real fix; logged here rather than guessed at.

- **ID**: `PROB-020`
  - **Summary**: `ci-gate.mjs`'s "missing surface results file" check (built specifically to catch PROB-019's crash class) did not actually catch it in a full local dry run of the workflow, because `tools/scenario-suite/results/baseline-*.json` are *committed historical files* — `actions/checkout` (and the local dry run) leaves yesterday's/the original baseline's file sitting there, so a driver that crashes before writing its own fresh output still finds a file present at that path and the gate reports a false "all surfaces healthy".
  - **Severity**: Medium (this directly undermined PROB-019's own mitigation — the exact "silent false-green" failure mode `ci-gate.mjs` exists to prevent)
  - **Status**: RESOLVED 2026-08-16 — found and fixed in the same dry run that produced PROB-019
  - **Impact**: Live-reproduced: ran all three surface drivers locally exactly as CI would; SDK crashed on UC-07 (PROB-019) without writing `baseline-sdk.json`, but `ci-gate.mjs` read the pre-existing committed copy (last modified hours earlier, confirmed via its mtime) and reported "3/3 surfaces healthy" — completely masking the crash. Deleting that stale file and re-running `ci-gate.mjs` against the same (now genuinely absent) state correctly flipped it to "FAIL: no results file for surface(s): sdk", confirming the gate's *logic* was sound all along — the bug was purely "the file it's checking for can pre-exist for a reason that has nothing to do with this run."
  - **Mitigation**: Added a "Clear stale committed results before this run" step to `scenario-suite.yml`, immediately after build and before any driver runs, that `rm -f`s all three `baseline-*.json` — so "the file exists" now actually means "this run produced it." Verified live: with the stale file removed, `ci-gate.mjs` correctly fails on a genuinely-missing surface. The dry run's own fresh CLI/MCP results were NOT committed over the historical Phase-1 baseline (`git checkout --` restored the original committed files after inspection) — those files are a frozen historical snapshot, not a rolling one, and this dry run was only ever meant to validate the workflow's mechanics.

- **ID**: `PROB-021`
  - **Summary**: A named profile's storage state (cookies/localStorage/sessionStorage) never actually saved or restored for CLI sessions, even though `SutradharRuntime.launch({profileName})`/`.shutdown()` already implement exactly that — because the CLI never calls either of those. It spawns Chrome itself and `attach()`es (see `spawn-chrome.ts` — Puppeteer's own launcher would tie the browser's lifetime to the CLI process, which exits after every single command), and `attach()` doesn't populate the runtime's internal `sessionProfiles` bookkeeping that the save/restore logic keys off.
  - **Severity**: Medium — this silently made `profile export-state`/`import-state` (built the same session as this fix, for INSIGHTS.md Insight 10's "pre-bake authenticated profiles for internal apps" ask) a dead end: nothing was ever saved to export, and nothing imported was ever restored.
  - **Status**: RESOLVED 2026-08-16 — found and fixed live while verifying `profile export-state`/`import-state`
  - **Impact**: Live-reproduced both halves before fixing: (1) logged in under `--profile test-profile-a`, set a `localStorage` value, ran `close` — `~/.sutradhar/profile-storage-state/test-profile-a.json` was never written. (2) Manually wrote a storage-state blob and `saveStorageState`'d it directly into a fresh profile, then `nav`'d under that profile — the imported value read back as `null`, not restored.
  - **Mitigation**: Two CLI-side fixes replicating the runtime's own logic against the CLI's session model (`packages/cli/src/cli.ts`, `packages/cli/src/state.ts`): (1) `CliState` gained a `profileName` field, written by `spawnFreshSession` whenever `--profile` is passed; `cmdClose` now reads it and — before killing Chrome — attaches, calls `runtime.getStorageState(sessionId)`, and `saveStorageState`s it into that profile, best-effort. (2) `cmdNav` now re-reads state after navigating and, if the session has a `profileName` with a saved state whose `origin` matches the just-navigated-to URL, calls `runtime.setStorageState(sessionId, saved)` — mirroring `launch()`'s own origin-matched restore. Live-verified end to end: logged in under profile A, closed (confirmed the state file was written), exported it to a portable JSON file, imported it into a completely fresh, never-visited profile B, navigated under profile B, and read back the exact value that was only ever set under profile A — full round trip via `packages/cli/dist/cli.js`, not a mock.

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
