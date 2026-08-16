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
  - **Summary**: `click_by_text` did not go through the occlusion-safe, delivery-verified click path — it called `element.click()` directly, unlike `click`/`click_by_role` which both go through `verifiedClickOnHandle`.
  - **Severity**: Low-Medium
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: `click`/`click_by_role` both verify real delivery (occlusion check + a delivery-marker event listener, in `verifiedClickOnHandle`) before reporting success, and were listed in `ExecutionVerifier`'s `SELF_VERIFYING_ACTION_TYPES` accordingly. `click_by_text` (`browser-action-engine.ts`) instead resolved the element and called `(el as HTMLElement).click()` directly, bypassing that whole path entirely — an occluding overlay would never be detected, and the action would report success even though the real click landed on whatever was actually on top.
  - **Mitigation**: `click_by_text`'s `case` now calls `assertNotStale` + `verifiedClickOnHandle` — the exact same path `click_by_role` already used — and is added to `SELF_VERIFYING_ACTION_TYPES`. Live-verified against a real Chrome fixture: an unobstructed `click_by_text` succeeds and the real click handler fires; the identical call against the same element with a full-viewport overlay now correctly fails with an "occluded" error and the click handler does NOT fire (previously it would have fired regardless). 2 new unit tests (the occlusion-refusal case, and the verifier now reporting `verified:true` for a spec-less `click_by_text`) — `packages/browser` at 170/170, green.

- **ID**: `PROB-013`
  - **Summary**: Interactive-element detection couldn't see elements whose *only* interactivity signal is a JS `addEventListener`-attached handler with no `onclick=`, `tabindex`, ARIA role, or `cursor:pointer` styling — a real, live example: SortableJS-based drag lists (a real, common pattern behind admin dashboards, kanban boards) attach raw `pointerdown`/`mousedown` handlers with zero CSS/ARIA signal, `cursor:auto`.
  - **Severity**: Low-Medium (real, hard, common pattern — not a hypothetical)
  - **Status**: RESOLVED 2026-08-16 — the materially-larger fix this entry deferred was built, as an opt-in fallback, once a real live example (not a hypothetical) justified the scope
  - **Impact**: Phase 3 (earlier) extended `dom-semantic-engine.ts`'s `INTERACTIVE_SELECTOR` with `[onclick]`, `[tabindex]`, `[contenteditable]`, `[role="option"]`, `label`, `summary`, plus a `cursor:pointer` fallback — real progress, but `cursor:pointer` is a proxy, not a direct signal, and genuinely misses handler-only elements. Found live (2026-08-16, hunting hard real-world use cases): `sortablejs.github.io/Sortable/`'s draggable list items are plain `<div class="list-group-item">` — no `draggable` attribute (SortableJS implements its own pointer-event dragging, not native HTML5 DnD), `cursor: auto`, `user-select: auto` — completely invisible to every existing heuristic, confirmed by inspecting the live computed styles directly, not assumed.
  - **Mitigation**: Built `DOMSemanticEngine.scanForEventListenerElements` — an opt-in (`scanEventListeners`/`--scan-listeners`/`scanEventListeners` param on `snapshot`/`browser.snapshot`/`snap`, off by default since each candidate costs a real CDP round trip) pass using real `DOMDebugger.getEventListeners` introspection, entirely within one CDP session (`DOM.getDocument({pierce:true})` + `DOM.querySelectorAll` finds candidates across frames/shadow roots in one call, `DOM.resolveNode` + `DOMDebugger.getEventListeners` checks each for a genuine `click`/`mousedown`/`pointerdown`/`touchstart`/`dragstart` listener, `Runtime.callFunctionOn` stamps + extracts real matches — all CDP-native, since a Puppeteer `ElementHandle`'s `objectId` belongs to a different session and wouldn't resolve here). Bounded to 150 candidates. Live-verified against the real SortableJS page: default snapshot finds 0 of the 6 draggable items (confirmed); with the new flag, the scan correctly found and stamped the real container in 129ms. **Found and documented an honest nuance along the way**: SortableJS attaches its listener to the *container* via event delegation, not each item, so the scan surfaces the container, not individual items — but `browser.drag_and_drop` targeting a real child selector (e.g. `:nth-child(N)` on that container) still works, since the delegated handler receives the bubbled event regardless — live-verified end to end: a real `drag_and_drop` call genuinely reordered the list (`Item 1` moved from position 1 to position 3, confirmed via the real DOM order before/after, not just the action's own success report).

## Documented technique — filling a group of related masked payment fields (Stripe Elements and similar)

Found live (2026-08-16), see `PROB-025`. When filling several related masked/actively-validated
iframe fields in the same group (a card number + expiry + CVC set is the canonical real-world
case), do **not** trust each field's own individually-reported `type` success in isolation —
typing into a *later* field in the group can retroactively corrupt an *earlier* field's
already-verified value (Stripe's shared internal Card Element state re-derives a sibling field's
display from its own internal model, which can lag behind fast synthetic keystrokes). Take one
final `browser.snapshot` covering the whole group after all fields are filled, and re-check every
field's value together before proceeding (e.g. before clicking Pay) — this reliably surfaces the
corruption where a per-field check cannot.

## Documented technique — modern editors that don't use a plain `<textarea>`/`<input>` (Monaco/`EditContext` API)

Found live (2026-08-16) testing Monaco Editor (VS Code's web editor) — not a bug, a real technique worth recording since it isn't obvious. Modern Monaco doesn't use a plain `<textarea>` for input — it uses the `EditContext` Web API, whose real focus target is an invisible, zero-box `<div class="native-edit-context">`. `click`/`type` correctly REFUSE to act on it ("Node is either not clickable or not an Element" — no box model to click, a correct refusal, not a bug). The working technique: target the visible rendered surface (`.monaco-editor .view-lines`, a real, sizable, clickable div) for both `click` and `type` — Puppeteer's real synthetic keyboard events reach Monaco's model correctly through it once focus is established (verified via `monaco.editor.getEditors()[0].getValue()` genuinely containing typed text, not a fabricated success report). Separately: a `snap` taken immediately after navigation surfaced a `<textarea aria-label="Editor content">` that looked like the obvious target but was a transitional element from Monaco's pre-`EditContext`-init state, gone moments later — a concrete, real example of why the `settle` option (Milestone 38) matters when acting on a heavy JS framework right after navigation.

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
  - **Status**: RESOLVED 2026-08-16 — root-caused and fixed at the source; see `PROB-022` for the full investigation
  - **Impact**: Full stack: `PierceQueryHandler.waitFor` → `CdpFrame.waitForSelector`, cause `IsolatedWorld.dispose`/`waitForFunction failed: frame got detached` — consistent with a frame that got torn down (TinyMCE's own init sequence tearing down and recreating its edit-area iframe) while something was still awaiting a selector inside it. Root-caused (see `PROB-022`): the scenario's own selector, `'body#tinymce, iframe.tox-edit-area__iframe body'`, included an alternative (`iframe.tox-edit-area__iframe body`) that is invalid CSS for reaching cross-frame content in the first place — a descendant combinator can't pierce an iframe boundary — and racing that never-matchable alternative across frames via `resolveElement`'s per-frame `waitForSelector`, while the target iframe itself gets recreated mid-wait, is what produced the escaping rejection.
  - **Mitigation**: Root cause fixed directly: `tools/scenario-suite/run-sdk.mjs`'s UC-07 now uses `body#tinymce` alone (the single valid, working selector), not the broken comma-list. Live-verified via `SCENARIO_FILTER=UC-07 node tools/scenario-suite/run-sdk.mjs`: no crash, `typeReportedSuccess: true`, `genuinelyTypeable: true`, real landed text confirmed via independent DOM read-back. Workflow-level defenses from the original mitigation (CLI/MCP steps' `if: always()`, `ci-gate.mjs`'s missing-file check) are kept regardless, since a future flaky/crashing scenario is still a real possibility this harness should stay resilient to — but the specific crash this entry describes is fixed, not just contained.

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

- **ID**: `PROB-022`
  - **Summary**: The long-standing "cross-origin iframe contenteditable typing doesn't work" gap (GLM's original C4, `RESPONSE-TO-FIELD-REPORT.md`'s "not addressed this round", this project's own backlog framing) was based on a misdiagnosis. Investigated live end to end: it works correctly today, and never had a same-origin-policy-level constraint — the TinyMCE iframe this was always tested against is same-origin, not cross-origin.
  - **Severity**: N/A — corrected finding, not a defect
  - **Status**: RESOLVED / CLOSED 2026-08-16 — this is now considered a covered capability, not an open gap
  - **Impact**: Full investigation, live against `https://www.tiny.cloud/docs/tinymce/latest/basic-example/`:
    1. **Not actually cross-origin.** `document.getElementById('basic-example_ifr').src` is empty — Chrome creates this as a same-origin iframe (the browser's normal behavior for a `src`-less/`about:blank` iframe). Confirmed `iframe.contentDocument` is fully readable from the parent page's own JS (`hasContentDocument: true`, real `body.id: "tinymce"` returned) — same-origin policy was never actually blocking anything here.
    2. **Already groundable.** `snap` lists it today: `[#301] body "Rich Text Area. Press ALT-0 for help." role=textbox` — no engine change needed (this actually already followed from Phase 3's `[contenteditable]` selector extension; nobody had re-verified this specific real-world case against it until now).
    3. **Typing already works.** `sutradhar type 301 "..."` (the snapshot node id) and `sutradhar type "body#tinymce" "..."` (the same element's real CSS selector) both succeed, and — critically — an independent read-back (`iframe.contentDocument.body.innerText`, not trusting the action's own success report) confirms the exact typed text genuinely landed inside the iframe both times.
    4. **What was actually broken**: `tools/scenario-suite/run-sdk.mjs`'s own UC-07 scenario used `runtime.type(sid, 'body#tinymce, iframe.tox-edit-area__iframe body', ...)` — a comma-separated CSS selector whose second alternative, `iframe.tox-edit-area__iframe body`, is invalid for reaching cross-frame content: a plain descendant combinator (`X Y`) can never match a `Y` that lives inside a DIFFERENT document (an iframe's content document), only a `Y` that's a literal DOM descendant of `X` in the SAME document. Confirmed live: this exact substring alone, passed to `type`, fails cleanly with "No element found for selector" — it never matches anything, in any frame. But raced across frames via `resolveElement`'s per-frame `waitForSelector`, while TinyMCE's own initialization sequence tears down and recreates that exact iframe, this invalid-and-therefore-perpetually-waiting alternative is what produced the real "frame got detached" crash logged as `PROB-019` — not a capability gap, a bad selector in this project's own test code interacting badly with a frame lifecycle event.
    5. **Cross-checked against the other two surfaces**: the MCP driver's UC-07 (`run-mcp.mjs`, using `.tox-edit-area iframe` as its `browser.type` target) already independently reports `typedIntoContentEditableBody: true` with a full, real readback showing the typed text landed — corroborating this finding from a completely separate code path.
  - **Mitigation**: N/A — no engine or product code needed to change; this was a test-harness bug, not a Sutradhar defect. Fixed at `tools/scenario-suite/run-sdk.mjs` (see `PROB-019`'s updated status). `RESPONSE-TO-FIELD-REPORT.md`'s C4 row updated to reflect the corrected finding instead of "not addressed this round" — leaving that framing uncorrected would have kept a real, working capability mislabeled as a known gap indefinitely.

- **ID**: `PROB-023`
  - **Summary**: A fresh `/docs-audit` pass (2026-08-16, checking Milestones 30-41's new features against user-facing docs) found real staleness in three places, and one genuine feature-parity gap it surfaced along the way — the recurring pattern PROB-004's history already named: real capability ships without a matching doc pass.
  - **Severity**: Low-Medium (docs staleness is low severity on its own; the parity gap it surfaced was a real, if minor, SDK feature gap)
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: `packages/cli/README.md`'s command table predated even the Phase 4 CLI batch (`select`/`wait`/`eval`/`hover`/`scroll`/`upload`/`drag`/`download` were never listed) and was missing this session's `profile export-state`/`import-state`, `audit --baseline`, and the `--settle`/`--no-text`/`--ids-only`/`--allowlist-domains`/`--user-agent`/`--json` flags entirely — a real user reading only this file would have no idea most of the CLI existed. `AGENT_SETUP.md`'s CLI section (explicitly the "full tool catalog" doc for AI agents) had the same gap. `packages/sutradhar/README.md`'s SDK `launch()` options table was missing `profileName`, `userAgent`, and the brand-new `allowedDomains` entirely. Auditing the SDK's `launch()`/`Page` surface against the CLI/MCP surfaces for consistency (not just doc text) surfaced a genuine, unrelated gap: `Page.click`/`Page.type` never had `settle` wired in at all — the CLI and MCP tool got it (Milestone 38), the SDK silently didn't, breaking the "three surfaces, one engine" parity principle.
  - **Mitigation**: All three docs corrected against the real current `cli.ts` help text / `LaunchOptions` interface (verified by reading the actual source, not inferred). `ElementOptions.settle` added to the SDK's `Page.click`/`Page.type`, threading through to `runtime.click`/`runtime.type`'s existing `settle` param — `SettleSpec` re-exported from `@sutradhar/capability-runtime` (it was importable internally but never re-exported for external consumers, a second small gap in the same fix). Live-verified: an SDK-driven `page.click('#trigger', {settle: true})` against a fixture whose click handler renders new content 400ms later correctly waits for and observes that content before returning — confirmed via `page.snapshot()`'s real `pageText`, not just the call not throwing. 2 new unit tests (`packages/sutradhar` 11/11); `packages/capability-runtime` typecheck clean.

- **ID**: `PROB-024`
  - **Summary**: `scroll` only ever called `window.scrollBy()` — a real gap for the common pattern of a page having its OWN independent `overflow:auto`/`scroll` container (virtualized data grids, chat panes, modal bodies, code blocks) that window-scrolling does nothing to. Found live while hunting hard real-world use cases (user directive, 2026-08-16) against MUI's `DataGrid` demo, which renders three grids on one page — only one of which actually overflows.
  - **Severity**: Medium (a real, common UI pattern was entirely unreachable by `scroll`; the only workaround was `eval` with manual `el.scrollBy()`, which is a documented capability but strictly worse UX than a first-class action)
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: Before the fix, `scroll` on a page like the MUI grid demo silently did nothing to the actual scrollable content (window-level `scrollBy` has no effect when the grid itself owns the overflow), with no error — a silent no-op indistinguishable from success. Investigating this also surfaced a second, related timing gap: MUI's `DataGrid` virtualization re-renders **asynchronously** after a scroll (not synchronously with the scroll event), so even a correctly-targeted element scroll could read back stale (pre-scroll) row content if read immediately — exactly the class of flake the `settle` option (Milestone 38) exists to solve, just not yet wired into `scroll`.
  - **Mitigation**: `scroll` gained an optional `selector`/`target` param — when given, resolves the element via `resolveElement`, calls `el.scrollBy()` directly on it (not `window`), with its own before/after `scrollTop` read-back and boundary-aware verification (throws a clear, element-specific error only when genuinely stuck and not already at the scroll boundary). Falls through to the existing unchanged `window.scrollBy` path when no target is given (regression-tested). `settle` support (boolean or `SettleSpec`) extended to `scroll` to resolve the async-virtualization-re-render timing gap. Wired through all four layers: `browser-action-engine.ts` (engine), `capability-runtime`'s `scroll()` (5th/6th params), MCP `browser.scroll` tool (`target`, `settle`), CLI `scroll [dir] [amountPx] [targetRef] [--settle]`. 4 new unit tests in `browser-action-engine.spec.ts` (target-scroll success, stuck-error, boundary-no-false-fail, default-fallback-regression) — full suite 176/176. Live-verified end-to-end through the **actual CLI binary** (not just a `SutradharRuntime` script) against the real MUI grid: correctly identified the one grid (of three) with real overflow, `scroll down 500 [data-test-scroller="true"] --settle` moved `scrollTop` 0→500 and the rendered row content genuinely changed (`"Adzuki bean (4)106,726"` → `"Milk (3)128,346"` — real virtualized re-render, confirmed by independent `eval` read-back, not the command's own success report); confirmed the default no-target path still only moves the window and leaves the grid's `scrollTop` untouched (regression check).

- **ID**: `PROB-025`
  - **Summary**: Live-tested a real, hard multi-step checkout with Stripe Elements (cross-origin, actively-masked/validated iframe payment fields) against the official `stripe-payments-demo.appspot.com`. Found and fixed a genuine verification false-negative (masked fields correctly rejected as failures), then found a second, deeper, only-partially-fixable bug: typing into one masked field in a related group can **retroactively corrupt an earlier, already-verified field's value**, with no local per-field check able to catch it.
  - **Severity**: High for the retroactive-corruption half — it's a real, consequential bug (confirmed the corrupted value actually blocks payment: Stripe's own "Your card number is incomplete" error, not just a cosmetic display glitch) that a naive per-field "type succeeded" check cannot detect. Medium for the formatting false-negative half (annoying, but fails loud, not silent).
  - **Status**: PARTIALLY RESOLVED 2026-08-16 — the false-negative is fixed; the retroactive-corruption bug is a genuine, documented, open limitation with a real mitigation, not silently claimed fixed.
  - **Impact**:
    1. **False negative (fixed)**: `clearAndType`'s read-back verification (added during the field-report remediation, see `PROB-019`'s era) did raw string equality. Real masked/formatted fields legitimately reformat as you type — Stripe's card-number field groups digits with spaces ("4242424242424242" lands as "4242 4242 4242 4242"), its expiry field inserts a slash ("1230" lands as "12 / 30"). Raw equality treated these genuine successes as failures, throwing "type did not land the expected value" for input that had actually landed correctly.
    2. **Retroactive cross-field corruption (open, mitigated, not fixed)**: precisely diagnosed live via `SutradharRuntime` scripting (isolated the variable across 5 separate controlled repros, ruling out red herrings along the way — Stripe's own "collapse to last-4-digits" summary UI after a valid card number, which is *legitimate* UX, not a bug, was initially misread as data loss until a targeted timed-snapshot test disproved it). The real mechanism: typing "1230" into the expiry field reads back correctly as "12 / 30" immediately afterward — verification passes, honestly. The value then stays stable and correct for 15+ seconds in isolation (disproving a naive elapsed-time race), and even survives a plain click focusing a different field. But the moment the **CVC field is typed into** (not merely focused — a bare click-away with no typing leaves expiry untouched), Stripe's shared internal Card Element state re-renders the expiry field's display from its own (out-of-sync, still missing the last keystroke) internal model, truncating it to "12 / 3" — after our verification had already, correctly at the time, reported success. No local, single-field check can catch this: the corruption is caused by a *sibling* field's later action, not anything that happens to the field itself.
  - **Mitigation**:
    1. False negative: `clearAndType`'s comparison now strips all non-alphanumeric characters from both sides before comparing (tolerates inserted spaces/slashes/dashes from live masking) while still catching genuine truncation/wrong-digit/reorder failures (alphanumeric sequence still has to match exactly). Additionally, whenever masking is detected (raw value differs from typed value but normalizes to a match), `clearAndType` now forces a real `blur()` then re-reads before trusting the value, then restores focus via `focus()` — catches the class of masked-field bug where a field only canonicalizes/truncates its own display on its own blur (a real, general pattern beyond just this specific Stripe case, though it did not turn out to be the mechanism behind PROB-025's specific repro — see below). 6 new unit tests (`packages/browser` 180/180); live-verified against the real Stripe card-number and expiry fields via the actual CLI binary and direct `SutradharRuntime` scripts.
    2. Retroactive corruption: **not fixed at the engine level** — a per-field `clearAndType` call has no visibility into sibling fields in the same masked-input group, and forcing a blur+refocus cycle on the field being typed does not reproduce or catch the failure (confirmed live: the bug is triggered specifically by *typing into a different field*, not by this field's own blur). The real, verified mitigation is procedural: after filling a **group of related masked fields** (a payment form's card number + expiry + CVC, or any similar multi-field masked-input group), take one final `browser.snapshot` covering the whole group and re-check every field's value together, rather than trusting each field's own individually-reported success. Live-verified this mitigation actually catches the corruption: after filling all three Stripe fields, a final snapshot correctly showed the expiry field's truncated "12 / 3" value, exposing the corruption before a real payment submission would have hit it. This is now the documented technique for any masked-field-group scenario (see the "Documented technique" section above) — added to the taxonomy and iteration log rather than left as an implicit assumption.

- **ID**: `PROB-026`
  - **Summary**: The CLI's `press` command re-focused its target via `runtime.click()` before every single keypress — a real click resets the text cursor to the click point, silently discarding cursor/selection state built by a *previous* `press` call in the same logical keyboard sequence (e.g. `press ref Home` then `press ref ArrowRight --modifiers Control,Shift` to select the first word). Found live testing a real rich-text-editor (Quill) toolbar-formatting workflow: word-select-then-bold worked correctly when scripted directly against `SutradharRuntime` in one continuous session, but silently did nothing when driven through the actual CLI binary (separate process per command) — the second `press` call's own auto-click undid the first call's `Home`.
  - **Severity**: Medium (a real, common keyboard-navigation pattern silently failed with no error — the commands all reported success, but the resulting selection was empty)
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: Any multi-step keyboard sequence issued via the CLI's `press` command (select-a-word-then-format, Home/End-then-Shift-select, arrow-key navigation building up a selection) was broken, because each `press` call clicked the target again first — collapsing any selection/cursor position from the previous step back to wherever the click landed. This is CLI-specific: the underlying engine's `focus` action (a real `.focus()` call, added earlier but never wired to `capability-runtime`) doesn't have this problem, but nothing used it — `click` was the only "focus a field" primitive available anywhere in the stack.
  - **Mitigation**: Added `SutradharRuntime.focus()` (wraps the engine's existing `focus` action, previously reachable from `browser-action-engine.ts` but not exposed anywhere above it) and a matching `browser.focus` MCP tool for surface parity. `cli.ts`'s `cmdPress` now calls `runtime.focus()` instead of `runtime.click()` to focus its target — `.focus()` doesn't move the cursor, so a prior `press` call's cursor position survives. Also added a `--modifiers Control,Shift`-style flag to the CLI's `press` command (the engine/runtime already supported modifier keys via `pressKey`'s `modifiers` param; only the CLI had no way to pass them — the same "capability exists, CLI verb doesn't expose it" pattern this project has hit before). `packages/capability-runtime` 90/90, `packages/mcp-server` 25/25 (updated the tool-count assertion — the exact drift pattern `PROB-004`'s history already named, caught immediately by the real test run rather than left stale), `packages/cli` 27/27 (3 new `--modifiers` parse tests). Live-verified end-to-end through the actual CLI binary against the real Quill playground: `press ref Home` then `press ref ArrowRight --modifiers Control,Shift` now visibly highlights "CLI" (confirmed via screenshot before AND after the fix — before: no highlight, selection silently empty; after: real blue selection highlight), and clicking the Bold toolbar button then genuinely renders it bold (confirmed visually, toolbar B icon shows active state).

- **ID**: `PROB-027`
  - **Summary**: `scroll`'s `direction: 'bottom'`/`'top'` didn't jump to the actual scroll boundary at all — they silently fell through to the same code path as `'up'` (anything not exactly `=== 'down'`), so `scroll bottom` actually scrolled the page **upward** by `amount` (500px default) instead of to the true bottom. Found live testing a real infinite-scroll page (a hard use case: content that loads more as you scroll to the bottom, the common "load more" pattern distinct from a virtualized grid).
  - **Severity**: High — a real, common, documented action silently did the *opposite* of what its name says, and the existing boundary-aware error-suppression logic actively masked it: starting from `scrollY=0`, scrolling "up" by 500px is a no-op (can't go negative), and the boundary check (`before <= 1` for anything not `'down'`) then read that no-op as "already at the boundary, nothing to report" — so no error ever surfaced. `scroll bottom` reported success on every single call while never moving the page.
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: Any agent using `scroll bottom` to trigger lazy-loaded/infinite-scroll content, jump past a long page, or reach a "Load More" trigger got silent, confident-looking success with zero actual effect — a worse failure mode than an error, since nothing signals anything went wrong. `scroll top` had the same latent bug (fell through to the `'up'`-shaped branch, which happens to move in the right *direction* but only by a relative `amount`, not an actual jump to `scrollTop`/`scrollY` 0 — so `scroll top` from partway down a long page would land somewhere short of the real top, not at it). Affected both the window-scroll path and the element-targeted scroll container path (`packages/browser/src/actions/browser-action-engine.ts`'s `case 'scroll'`), added in Milestone 44 — the earlier `PROB-024` fix built element-targeted scrolling but inherited this pre-existing `'top'`/`'bottom'` gap from the original window-scroll code without noticing it, and no test ever covered either direction (confirmed: zero prior test references to `direction: 'top'` or `direction: 'bottom'` anywhere in the suite).
  - **Mitigation**: `'top'` now sets `scrollTop`/scrolls to `(0, 0)` directly; `'bottom'` now sets `scrollTop = scrollHeight` / scrolls to `(0, document.documentElement.scrollHeight)` directly — real jumps to the actual boundary, not a relative `scrollBy`. The boundary-check logic (used to distinguish "genuinely stuck" from "legitimately already there, nothing to report") now correctly groups `'bottom'` with `'down'` for the "at max" check. 3 new unit tests (`packages/browser` 182/182) covering `'bottom'` on the window-scroll path and `'top'` on the element-targeted path. Live-verified end-to-end through the actual CLI binary against the real infinite-scroll demo (`infinite-scroll.com/demo/full-page/`): before the fix, `scroll bottom` reported success while `window.scrollY` stayed at exactly 0 across repeated calls; after the fix, `scroll bottom` correctly moved `scrollY` from 0 to the real bottom (2652) **and** this genuinely triggered the page's infinite-scroll library to load more content (post count went 2 → 5, confirmed via independent `eval` read-back) — the actual real-world use case this action exists for. `scroll top` correctly confirmed to return to `scrollY` 0.

- **ID**: `PROB-028`
  - **Summary**: A `browser.click` with `button: 'middle'` on a `target="_blank"` link opened **two** new tabs instead of one — the real native middle-click correctly opened one (a genuine `auxclick` event fired), but the delivery-detection logic, which only distinguished `'right'` from everything else, misjudged the middle-click as undelivered and fired the JS-click fallback too, and `element.click()` always simulates a plain *left* click — itself opening a second, duplicate tab. Found while sweeping for other instances of the same "binary branch on a 3+-value enum" bug shape that had just caused `PROB-027` (`scroll`'s `'top'`/`'bottom'`).
  - **Severity**: High — a real, silent duplicate side effect (an extra open tab) from a single documented action, with no error to signal anything went wrong.
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: `verifiedClick`'s delivery marker listened for the `'click'` DOM event to confirm a click landed, and its fallback (when delivery wasn't detected) always called `element.click()` — both of these were only ever button-aware for `'right'` (via a ternary that treated anything not `'right'` as needing the `'click'`-listening, left-click-fallback path), so `'middle'` silently inherited the `'left'` behavior on both sides. A real middle-click's actual DOM signal is `'auxclick'`, not `'click'` (per spec — `'click'` is reserved for the primary button) — live-confirmed the browser correctly fires `auxclick:1` for a middle-click and nothing else. Listening for the wrong event meant the delivery check would (at least sometimes — live-reproduced consistently in this environment) read as "not delivered," triggering the fallback `element.click()`, which is unconditionally a left-click simulation — for a `target="_blank"` link, that's a **second, genuinely duplicate** tab-open, live-confirmed via `listTabs()` (3 tabs total instead of 2 before the fix).
  - **Mitigation**: The delivery-event selection is now three-way button-aware (`'right'` → `contextmenu`, `'middle'` → `auxclick`, else → `click`), matching the exact pattern already used correctly for `'right'`. The fallback dispatch is now three-way too: `'right'` dispatches a synthetic `contextmenu` (unchanged), `'middle'` now dispatches a synthetic `auxclick` (`button: 1`, bubbles/cancelable) instead of falling through to `element.click()`, `'left'` (or unset) keeps the existing `element.click()` path. 2 new unit tests mirroring the existing right-click coverage exactly (`packages/browser` 184/184). Live-verified end-to-end via a direct `SutradharRuntime` script against a real `target="_blank"` link on a live page: before the fix, a middle-click produced 3 tabs total (1 original + 2 new — the real middle-click's tab plus the buggy fallback's duplicate) and both `auxclick` and a spurious `click` fired; after the fix, exactly 2 tabs (1 original + 1 real new tab) and only the genuine `auxclick` event fired — no fallback triggered at all for a cleanly-delivered middle-click.

- **ID**: `PROB-029`
  - **Summary**: A `grant`-ed browser permission (e.g. `clipboard-read`) was invisible to every CLI command after the one that granted it — `grant` would report success, but the very next separate CLI invocation (e.g. `getclipboard`) would fail with a real `NotAllowedError: Read permission denied`, even though the same browser and session persisted across both commands. Found live while testing clipboard-paste into a real rich-text editor (a hard use case: setting the clipboard, then Ctrl+V into a Quill editor).
  - **Severity**: High — made `grant` effectively useless for the CLI's own architecture (this project's own earlier design doc explicitly named `clipboard-read`/`clipboard-write` as the canonical `grant` use case), since no single CLI command both grants a permission and needs it in the same process.
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: Root-caused precisely via a purpose-built repro rather than assumed: a script mirroring the CLI's exact architecture (`spawnDetachedChrome`, then a separate `SutradharRuntime`/`attach()` cycle per "command", explicitly `disconnect()`-ing the Puppeteer client between each — exactly what `cli.ts`'s `main().finally()` does) reproduced the failure exactly; the same script WITHOUT the explicit `disconnect()` between steps did NOT reproduce it. This isolates the cause precisely: Puppeteer's `overridePermissions()` (which CDP's `Browser.grantPermissions` backs) does not survive a full CDP client disconnect/reconnect cycle, even to the same browser and browsing context — the grant is effectively scoped to the connection that issued it, not durably applied browser-side as CDP's documented semantics would suggest. Since the CLI is architected as one short-lived OS process per command (explicitly disconnecting at the end of each to let Node's event loop drain — see `state.ts`'s own doc comment on why), any permission granted by one command was silently gone by the next.
  - **Mitigation**: `CliState` gained a `grantedPermissions` field; `grant` now persists `{origin, permissions}` into `~/.sutradhar-cli/state.json` (merging by origin) in addition to applying it immediately, and `withSession`'s reattach path now re-applies every persisted grant right after each fresh `attach()`, before running the command — transparently working around the underlying CDP/Puppeteer limitation rather than requiring every caller to know about it. Live-verified end-to-end through the actual CLI binary across multiple separate process invocations: `grant` → `setclipboard` → `getclipboard` (in 3 separate `node cli.js` processes) now correctly reads back the set value, confirmed stable across further additional separate invocations; the full real-world workflow (grant → setclipboard → click a real Quill editor → `press v --modifiers Control` → paste) was independently confirmed to land real text in the editor via a fresh snapshot, not just each step's own success report.

- **ID**: `PROB-030`
  - **Summary**: A real page throwing a non-`Error` value (e.g. `throw null`) crashed the entire CLI process with `TypeError: Cannot read properties of null (reading 'message')`, taking out an otherwise-healthy session mid-benchmark run. Found live during a full 47-task WebBench rerun against the current local build (2026-08-16) — a real site's page genuinely threw something the `pageerror` handler didn't expect.
  - **Severity**: High — a single page's own broken JS could crash the driving CLI process outright, not just fail that one action.
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: `browser-tab.ts`'s `page.on('pageerror', ...)` handler cast the event payload to `Error` and immediately accessed `.message` before any null check — `error.message ?? String(err)` only guards against `.message` being `undefined`, not against `error` itself being `null`/`undefined`. Puppeteer's typings promise an `Error`, but a real page can `throw null`/`throw undefined`/throw a non-Error value, and CDP forwards it as-is.
  - **Mitigation**: Changed to `error?.message ?? String(err)` (and `error?.stack`), guarding the property access itself, not just the fallback. Typecheck clean; no existing test exercised this path (a genuine gap — a non-Error `pageerror` throw is a real but narrow case). Live-verified indirectly: the same CLI session that crashed continued working normally for the rest of the 47-task run after the fix + rebuild.

- **ID**: `PROB-031`
  - **Summary**: The CLI had zero tab-management commands at all (no way to list, switch, or close tabs), even though the underlying runtime/MCP layer fully supported it (`list_tabs`/`new_tab`/`focus_tab`/`close_tab`). Adding them surfaced two real, previously-latent bugs in the CLI's per-process reattach architecture: (1) `attach()` only ever adopted the single most-recently-opened real page, silently orphaning any other open tabs from every subsequent command; (2) `focustab`'s effect on the active-tab pointer was in-memory only and reverted the instant that CLI process exited.
  - **Severity**: High for both underlying bugs — a real, common scenario (a page opening `target="_blank"`, or an agent deliberately managing multiple tabs) was silently broken across the CLI's whole command surface, not just the new tab commands.
  - **Status**: RESOLVED 2026-08-16
  - **Impact**: Found live testing the newly-added `tabs`/`newtab`/`focustab`/`closetab` commands against a real two-tab scenario: after `newtab` opened a genuine second real tab, the very next `tabs` command (a fresh CLI process, fresh `attach()`) listed only **one** tab — and it was the wrong one, since `attach()`'s tab-discovery (`tryFindMostRecentPage`) only ever looked at the single most-recently-opened page via `browser.pages()`, discarding the rest. Separately, `focustab tab_1` correctly reported success, but the very next command's fresh `attach()` reverted to its own default (most-recently-opened) rather than honoring the just-made focus choice — because `setActiveTab`'s effect lives only in the now-discarded in-memory `BrowserSession` object.
  - **Mitigation**: `attach()` now enumerates and adopts **every** open non-blank page (`findAllOpenPages`, replacing the old single-page `tryFindMostRecentPage`), preserving the most-recently-opened page as the default active tab — matching prior single-tab behavior exactly when only one tab exists. `CliState` gained an `activeTabId` field (same persistence pattern as `PROB-029`'s `grantedPermissions`): `focustab`/`newtab` persist their choice, and `withSession`'s reattach path restores it via `runtime.focusTab()` right after re-adopting all tabs. `packages/capability-runtime` 90/90, `packages/cli` 27/27. Live-verified end-to-end through the actual CLI binary across multiple separate processes: `newtab` → `tabs` now correctly lists both real tabs; `focustab` → a separate `tabs` call now correctly shows the `*` marker on the focused tab, and a separate `eval` call correctly operates on that tab's real page (confirmed via `location.href` matching); `closetab` correctly removes a tab from the listing.

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
