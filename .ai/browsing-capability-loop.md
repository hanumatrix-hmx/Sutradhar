---
State Category: Operational / Persistent
Machine Readable: true
Update Ownership: AI Agent
Freshness Expectation: Per Loop Iteration
Update Policy: Append-driven (log), change-driven (taxonomy)
Last Updated: 2026-08-13
---

# Browsing capability loop — persistent state

See [CLAUDE.md](../CLAUDE.md) for the standing directive this doc supports: find a real
limitation by using Sutradhar → fix it → verify live → log it here → repeat.

## Capability taxonomy

Status per category. `covered` = exercised live and works. `partial` = works in the common
case, known edges untested/unfixed. `untested` = not yet exercised via real dogfooding this
loop. `excluded` = deliberately out of scope (see CLAUDE.md's scope boundary).

| Category | Status | Notes |
|---|---|---|
| Basic navigation/click/type/snapshot | covered | Exercised repeatedly this session (example.com, TodoMVC, the dashboard itself). |
| DOM-attribute grounding (`data-sd-node-id`) under re-render | covered | Survived 3 independent real re-render tests: TodoMVC filter round-trip, a continuous-stream sibling-churn test, and (Milestone 4) the hardest case — a numeric id captured *before* deleting the item above it in the list, then acted on after the deletion-driven reflow. Correctly still hit the right (surviving) element every time, no misfires. |
| Accessibility-tree grounding (`axSnapshot`) | covered | Milestone 4: used live against TodoMVC exactly as documented — `ax_snapshot` + `type_by_label` to add todos, both landed correctly with no ids involved at all. Works correctly. |
| Hover / `:hover`-revealed UI | covered | Milestone 4: `browser.hover` used live via MCP (not just direct-runtime) to reveal a `:hover`-only destroy button, then clicked it successfully — confirmed synthetic `mouseover` does NOT trigger real `:hover`, but the real tool does. |
| Multi-tab workflows | covered | Milestone 1: created a background tab via `new_tab`, navigated/snapshotted/clicked it independently via `tabId`, confirmed the original tab was completely unaffected. Works correctly. |
| File download | covered | Milestone 1: `runtime.downloadFile` verified end-to-end — real file landed on disk at the expected path with correct content (read back and checked, not just a success flag). |
| File upload | covered | Milestone 2: `browser.upload_file` against a real fixture page (the-internet.herokuapp.com/upload) — set a file input, clicked Upload, confirmed via the server's own response page ("File Uploaded! upload-test.txt") that it actually landed server-side, not just a client-side success flag. |
| iframes / cross-frame interaction (incl. dynamically-injected, cross-origin) | covered | Milestone 1: verified directly against the runtime — `snapshot`/`click` correctly traverse into a cross-origin iframe injected into the page *after* initial load (the hardest realistic case — matches real chat-widget/payment-iframe behavior). Works correctly today. |
| Shadow DOM | covered (open); closed is a known, reasonable limitation | Milestone 3: an injected open shadow root's button was correctly listed by `snapshot` and correctly clicked (verified via the real click handler firing). A *closed* shadow root's content is invisible to both — expected: `mode:'closed'` blocks even `evaluate()`-level JS access by design, and closed shadow roots are rare in practice since most real widgets use open ones. Not treated as a gap worth chasing. |
| PDF handling: export | covered | `browser.export_pdf` verified — returns real, valid `%PDF-1.4` content for the current page. |
| PDF handling: reading one encountered mid-browse | gap found, logged (`PROB-009`) | Navigating directly to a `.pdf` URL correctly enumerates Chrome's native PDF-viewer toolbar via `snapshot`, but `pageText` comes back completely empty even against a PDF with real (compressed) text content. Not fixed — needs real PDF text-layer extraction, nontrivial scope. |
| Real-time/streaming pages (continuous background DOM churn) | partial | Milestone 1: grounding survives ongoing unrelated DOM churn elsewhere on the page (a simulated live-feed stream, numeric id captured then acted on ~8 re-renders later — still hit the right element). True WebSocket/SSE-driven pages and the harder "target itself gets destroyed and id gets reused" case remain untested. |
| Media (video/audio/canvas) | covered | Milestone 3: native `<video controls>` UI is not exposed via `snapshot` (expected — UA-internal shadow DOM; the correct control path is the JS media API, not clicking browser chrome). `video.play()`/`.pause()`/state inspection via `eval` works correctly against a real, well-formed video. One specific external test file failed with a genuine format/codec error (`MEDIA_ELEMENT_ERROR`) — confirmed to be that file's problem, not Sutradhar's, by successfully loading a different real video right after. Canvas: `browser.click`'s `offset` param verified pixel-accurate against a hand-drawn canvas region (239,119 landed correctly inside a 200-280×100-140 target). |
| Mobile/device emulation | covered, 2 bugs fixed | Milestone 2: `set_viewport`'s width/height/deviceScaleFactor/media-query emulation all verified correct against a real site (github.com); found `hasTouch` never got enabled for `isMobile:true`, fixed with a spread-order default. Milestone 6: live MCP testing caught that the Milestone 2 fix didn't actually work through the real call path (an object-spread subtlety hid it from direct-runtime testing) — refixed to resolve the default before construction, re-verified against the exact MCP-handler call shape. Still needs one more reconnect to confirm the corrected version live. |
| Auth/session persistence across runs | covered | Milestone 2: created a named profile via the CLI, logged into a real test fixture (the-internet.herokuapp.com/login), fully closed the session (killed the Chrome process), launched a completely fresh session with the same profile, navigated straight to the auth-gated page — still authenticated, no re-login needed. Works correctly. |
| Network conditions (slow/offline/throttled) | covered, new capability built | Milestone 3: confirmed this was a complete gap (zero code anywhere, not even internal). Built `SutradharRuntime.emulateNetwork` + `browser.set_network_conditions` MCP tool (offline mode + DevTools throttling presets or custom download/upload/latency), mirroring the existing `emulate`/`set_viewport` pattern. Verified live: offline genuinely blocked a real `fetch` ("Failed to fetch"), Slow 3G added ~2046ms to a request that normally takes ~17ms (matches the preset's math), clearing throttling restored the ~17ms baseline. |
| Large-scale extraction / pagination | covered, 1 significant bug found and fixed | Milestone 8: a real Hacker News front page has 227 interactive elements — found that `formatGraphForLlm`'s listing was hardcoded to show only the first 60 with NO way for any caller to ask for more (the parameter existed in the function signature but nothing threaded it through the public API), and the underlying id-stamping cap (150) was itself lower than a single ordinary content page can have. The "More" pagination link was invisible past both caps — undiscoverable by an LLM reading the snapshot. Fixed: exposed `maxElements` through `runtime.snapshot()` and `browser.snapshot`'s MCP schema (default unchanged at 60, no behavior change for existing callers), and raised the stamping cap to 300. Verified live: default snapshot still hides "More" (no regression), `maxElements:250` reveals it with a real, clickable id, and clicking that id genuinely navigated to page 2. Completed a real 3-page, 90-story extraction task end-to-end via `browser.extract_data` + `.morelink` pagination. |
| Cookies (get/set/delete) | covered | Milestone 8: verified against real `document.cookie` state directly, not just each tool's own success report. All three operations correct. |
| localStorage / sessionStorage (get/set/clear) | covered | Milestone 8: verified against real `localStorage`/`sessionStorage` APIs directly. Set, get, and clear all correct. |
| Clipboard (get/set) | covered | Milestone 8: real round-trip via `grant_permissions` + `set_clipboard` + `get_clipboard` — the exact text written was read back. |
| Geolocation | covered | Milestone 8: `set_geolocation` verified against the real `navigator.geolocation.getCurrentPosition()` API — returned the exact overridden coordinates, permission auto-granted as documented. |
| JS framework diversity beyond React | covered | Milestone 3: real TodoMVC implementations in Vue, Angular, and Svelte — add-todo, snapshot, and DOM-state verification all worked correctly in each, matching the earlier React result. Grounding operates on the rendered DOM, not framework internals, so this is expected but now actually confirmed rather than assumed. |
| `agent.runGoal` (Sutradhar's own autonomous loop) | blocked on environment, partially covered | Milestone 7: no LLM provider available in this environment (no Ollama running, no `OPENROUTER_API_KEY`) — the actual reasoning capability is untested and I can't responsibly fix this myself (installing Ollama is a heavier step; won't provision API keys/billing). What DID get verified: the failure mode is honest (no fabricated success) and `session:blocked` event surfacing through the tool — built in an earlier project phase — actually works live, confirmed for the first time. |
| Native dialogs (alert/confirm/prompt) | covered, 1 bug found and fixed | Milestone 7: found a real bug live — the 5s auto-dismiss safety net was too tight for a realistic check-then-act round trip (get_pending_dialog → handle_dialog), silently losing the race and auto-dismissing dialogs the caller intended to handle. Bumped the default to 30s (matches `downloadFile`'s timeout), re-verified with simulated ~4s latency between check and handle — correctly caught and handled now. |
| Drag-and-drop | covered | Milestone 7: real HTML5 `DataTransfer` drag from a source to a target element — drop handler received the correct transferred data. Works correctly. |
| Right-click / context menu | covered | Milestone 7: verified the real `contextmenu` event fires correctly via `browser.right_click`. Works correctly. |
| Network request interception/mocking | covered | Milestone 7: `browser.route` with both `mock` (a real fetch received the exact mocked JSON body) and `block` (a real fetch failed as expected) actions verified against genuine `fetch()` calls, not just the tool's own success report. |
| Console/network/page-error log capture | covered | Milestone 7: `get_console_logs` correctly captured log/warn/error levels plus an incidental real network failure; `get_page_errors` correctly captured a deliberate uncaught exception with message and stack trace; `get_network_log` correctly distinguished a completed (mocked) request from a blocked one (request-only, no response phase). |
| CAPTCHA / bot-detection / stealth evasion | excluded | Deliberately out of scope per CLAUDE.md — not a gap to close. |

## MCP session staleness — resolved 2026-08-13, but re-staleness after every rebuild is a standing gotcha

Milestone 1 hit a stale MCP session that produced a false bug report (iframes looked broken,
weren't). The user reconnected it before Milestone 2, confirmed by `hasTouch`/`data-sd-*` etc.
all resolving correctly. **This isn't a one-time fix** — every future rebuild of `mcp-server`
(or any package it depends on) makes the *currently connected* session stale again until
reconnected. Two fixes landed in Milestone 2 (the double-header bug, the `hasTouch` default)
that the connected session at the time did NOT yet reflect. Standing practice: after any
capability-runtime/mcp-server code change, verify via direct-runtime scripting (import
`SutradharRuntime` from `packages/capability-runtime/dist/index.js`) rather than assuming the
connected MCP session picked it up — and note in the checkpoint report which fixes still need
a reconnect to be live-confirmed end-to-end through MCP itself.

## Iteration log

Append-only. Newest first.

### 2026-08-13 — Milestone 17: real bug found+fixed live — `type` was appending, not clearing

Task 36 of WebBench sample 3 (add a product to cart on AliExpress) surfaced a real bug:
searching a second term right after a first one in the same input produced a garbage
concatenated URL slug instead of a clean new search. Root cause in
`packages/browser/src/actions/browser-action-engine.ts`: `type` and `type_by_label` called
Puppeteer's bare `ElementHandle.type()`, which only appends keystrokes — despite
`browser.type`'s own documented contract ("clears field first if needed"), nothing in the
actual call path cleared the field first.

**Fixed**: added a `clearAndType` helper (triple-click to select existing content, Backspace,
then type — the same motion a real user clearing a field would make) and wired it into both
`type` and `type_by_label` (and therefore `fillForm`, which is built on `type`). Typechecked,
rebuilt, and the full `packages/browser` suite re-run clean (145/145 passing — 2 pre-existing
tests needed their mock `ElementHandle` extended with `press`/`click`, since they'd only ever
exercised the old direct-`.type()` path; added a new test locking in the exact
click→backspace→type call order). Verified live against a real browser outside the test
suite (typing two different values into the same input now correctly replaces, confirmed via
`document.getElementById(...).value`) — not just unit-test-level confidence.

Found via genuine dogfooding (an actual WebBench task), not speculative code review — exactly
the loop's intended find→fix→verify cycle. Note: the standing MCP-session-staleness gotcha
applies here too — the already-connected MCP session won't reflect this fix until it's
rebuilt/reconnected.

### 2026-08-13 — Milestone 15: second WebBench sample — 5/8 completed, a real number at last

Milestone 14's sample was inconclusive on completion rate — all 7 tasks happened to land on
3 domains with unusually aggressive anti-bot/auth walls. Ran a second, deliberately
different 8-task sample (all READ, 8 domains never touched before: alberta.ca,
aljazeera.com, allrecipes.com, apnews.com, berkeley.edu, britannica.com,
collinsdictionary.com, craigslist.org) to get past that confound. **5 of 8 completed
end-to-end with real, verifiable answers.** The 3 blocks were unambiguous external causes
(one flat IP-level deny, two distinct Cloudflare postures), not Sutradhar issues. Full detail:
`tools/webbench/claude-direct-run-2026-08-13-sample2.md`.

**Combined across both samples: 5/15 completed, 10/15 externally blocked, 0 Sutradhar
failures.** This is the headline number the loop was missing — the tool mechanics were never
the limiting factor; the limiting factor is that roughly a third to two-thirds of real
top-1000-web targets (depending on sample) now run anti-bot protection aggressive enough to
stop an unauthenticated automated session outright, and that's a fact about the 2026 web, not
about this tool.

**One more real navigation pattern learned**: when a site's own in-page search-toggle UI
doesn't cleanly reveal a working input in a DOM snapshot (apnews.com's "Show Search" button),
navigating directly to the site's own public `/search?q=...` URL pattern is a legitimate
fallback, not a bypass — it's the same destination the site's own search box would produce.
Used successfully this run; worth reaching for before spending more cycles fighting a
particular widget's rendering quirks.

### 2026-08-13 — Milestone 14: first Claude-direct WebBench run (7/7 real tasks attempted)

Full detail lives in `.ai/competitive-benchmarks.md`'s iteration log and
`tools/webbench/claude-direct-run-2026-08-13.md` — this entry is the capability-loop-relevant
summary. The user corrected the benchmarking approach: primary mode is Claude driving
`browser.*` directly (no LLM provider needed), not `agent.runGoal` + Ollama/OpenRouter. Ran
all 7 curated WebBench tasks live this way.

**Capability-relevant findings**: occlusion detection (`verifiedClickOnHandle`) correctly
refused every blind click into a recurring, repeatedly-reappearing store-locator modal on
acehardware.com — reproduced across two independent fresh sessions, zero silent misclicks.
`browser.get_network_log` + `browser.eval` were sufficient alone to precisely distinguish
three different real external blockers (an HTTP 403 on a backend API, a Cloudflare JS
challenge that never cleared, a hard Cloudflare deny) without guesswork — real diagnostic
capability under adversarial, uncontrolled conditions, not a fixture site. All 7 tasks ended
in an honest, correctly-surfaced external block (anti-bot walls, missing test credentials, or
genuine product-catalog drift) rather than a fabricated success or a Sutradhar-side failure.

**One unresolved, not-yet-a-gap observation**: a `type="button"` React click handler on
acehardware.com's search bar didn't fire via either Sutradhar's click or a raw
`element.click()` through `eval`, while real `<a>` link clicks on the same page worked fine.
Left uninvestigated this round (a working alternate path existed, and there's no strong
signal it's Sutradhar-side) — worth a closer look only if the same pattern recurs elsewhere.

### 2026-08-13 — Milestone 12: ran the actual unit test suites for the first time this session

Every verification so far this session was typecheck (`tsc`) + live scripts (direct-runtime or
MCP) — real functional verification, but never a run of the project's own `vitest` suites, and
never any *new* unit tests for anything built in Milestones 9–11. Ran them (found `vitest` is
locally available even though `pnpm` still isn't):

- **`packages/browser`**: 137 passing, no regressions.
- **`packages/capability-runtime`**: 71 passing, no regressions.
- **`packages/mcp-server`**: found a real, legitimate failure — `tools.spec.ts` asserts the
  exact registered tool count via a hardcoded `EXPECTED_BROWSER_TOOLS` list, still at 59 from
  before this session's work. The real count is now 68 (9 tools added across Milestones 3,
  9, and 11: `set_network_conditions`, `fill_form`, `click_at_point`, `drag_at_points`,
  `get_storage_state`, `set_storage_state`, `lock_tab`, `unlock_tab`, `get_tab_lock`). Fixed
  the fixture; 22/22 pass now.
- **Added real unit test coverage for tab locking** (`browser-tab-observability.spec.ts`) —
  the one new capability from this session's work that's pure logic and genuinely unit-
  testable without a real browser (timestamp/TTL bookkeeping, not Puppeteer calls). 7 new
  tests using `vi.useFakeTimers()` for precise TTL control: default-unlocked, acquire,
  conflicting acquire refused, re-acquire extends TTL, wrong-owner release refused,
  unlocked-release is a no-op, and TTL expiry making the tab acquirable again. All pass.
  The other Milestone 9–11 additions (`fill_form`, `click_at_point`, `drag_at_points`,
  storage-state export/import) remain verified only via live scripts, not durable unit
  tests — they're thin wrappers around real Puppeteer calls (mouse/cookie/storage APIs),
  which is what the project's own convention calls a "smoke script" case, not a "pure-logic,
  needs a real unit test" case; the CLI package also has zero test files at all (pre-existing,
  not new debt from this session).

**Why this matters for the loop**: exactly the kind of debt live-script verification alone
can't catch — a stale test fixture doesn't affect a running script, only a real test run.
Standing practice going forward: run the actual test suite for touched packages, not just
`tsc`, before considering a milestone's verification complete.

### 2026-08-13 — Milestone 9: goal reframed to competitive — researched, closed all 3 gaps

The user reframed the standing goal: not just "no known bugs" but genuinely better than
Playwright, Puppeteer, real `pinchtab/pinchtab`, and AI-company browser tools, with real
benchmarks backing any "best" claim. Full research and comparison now lives in
[.ai/competitive-benchmarks.md](./competitive-benchmarks.md) — summary here:

- Agent-level benchmarks (WebArena, OSWorld, Web Bench, Mind2Web) all need a real LLM driving
  `agent.runGoal` — confirmed blocked on the same no-provider constraint as Milestone 7, not a
  code gap.
- Fetched Microsoft's own Playwright MCP server's real tool list for a precise,
  LLM-independent tool-surface diff. Found 3 real gaps, built and verified all three:
  - **`browser.fill_form`** — bulk multi-field form fill in one call (was: only single-field
    `type`/`type_by_label`). Verified live against a real 2-field login form — both fields
    landed via real DOM inspection; a deliberate partial-failure case correctly isolated
    errors per-field. Incidentally confirmed a pre-existing duplicate-dispatch safety guard
    fires correctly.
  - **`browser.click_at_point`** — click at an absolute viewport `(x, y)` with no element or
    selector involved, matching Playwright MCP's vision-mode click. Verified pixel-exact
    against a hand-drawn canvas target.
  - **`browser.get_storage_state` / `set_storage_state`** — single-blob export/import of all
    cookies+localStorage+sessionStorage, distinct from the per-item tools and from the CLI's
    directory-based profile mechanism. Verified live: a blob captured from one session
    correctly restored a genuinely fresh, separate session's cookie/localStorage/sessionStorage
    together.
- Drive-by cleanup: swept and fixed ~11 remaining "pt-node-id" rename leftovers in doc
  comments across `runtime.ts`/`types.ts`/tests (the actual code/attributes were already
  correctly renamed to `sd-node-id`; only stale prose mentioned the old name).

### 2026-08-13 — Milestone 8: pagination discovery bug, cookies, storage, clipboard, geo

Closed out the last remaining taxonomy row (large-scale extraction/pagination) with a real
task, plus swept several completely untested fundamental tools.

- **Pagination discovery — the milestone's real find.** Ran a genuine extraction task against
  Hacker News (227 real interactive elements on the front page). The "More" link was
  discoverable neither via the default `browser.snapshot` listing (hardcoded to the first 60
  elements) nor by raising it — because nothing in the public API actually let a caller pass a
  different `maxElements` value at all, despite the underlying function already accepting one.
  Worse, the id-*stamping* cap (150) was independently too low for this exact real page. Fixed
  both layers: `maxElements` now threads through `runtime.snapshot()` → `browser.snapshot`'s
  MCP schema (default unchanged, zero behavior change for existing callers), and the stamping
  cap is raised to 300 (now a named constant, was a bare magic number). Verified live end to
  end: default listing still hides "More" (no regression), `maxElements:250` reveals a real
  clickable id for it, and clicking that id genuinely navigated to page 2. Completed the
  underlying task properly too — a real 3-page, 90-story extraction via `browser.extract_data`
  + `.morelink` pagination.
- **Cookies, localStorage/sessionStorage, clipboard, geolocation**: all verified against the
  real browser-side state directly (`document.cookie`, `localStorage`, the actual Clipboard
  and Geolocation APIs), not assumed from each tool's own success report. All correct, no
  gaps found.
- **Small drive-by fix**: `runtime.snapshot()`'s docstring still said "pt-node-id stamped" —
  a rename leftover. Fixed to `data-sd-node-id` while already in that code.

**Net result**: 1 significant, real bug found and fixed (pagination/large-page discoverability
— plausibly the most practically important fix this whole loop, since it blocks a common,
realistic task class rather than an edge case), 4 fundamental capability categories confirmed
already correct.

### 2026-08-13 — Milestone 7: agent.runGoal, dialogs, drag-and-drop, routing, logs

Triggered by the user directly challenging whether the loop's goal was actually complete —
correctly: the taxonomy swept was one I invented, not "all limitations," and I had never once
tested `agent.runGoal` (Sutradhar's own autonomous brain, the actual point of the tool beyond
raw browser control) this entire session. Corrected course rather than treating a self-defined
checklist as a finish line.

- **`agent.runGoal`**: no LLM provider available in this environment. Confirmed via `env`/
  `which ollama`/a direct curl to `localhost:11434` — genuinely nothing to test reasoning
  against, not a code issue. What DID get verified: the failure was honest (clear `failed`
  status, no fabricated answer) and — the actually valuable find — `session:blocked` event
  surfacing through `agent.runGoal` (built in an earlier phase, per `PROJECT_DEEP_DIVE`/prior
  commits) worked correctly live for what appears to be the first time it's been confirmed via
  MCP: `⚠ BLOCKED (stuck): Stuck loop detected...` appeared exactly as designed.
- **Native dialogs**: found and fixed a real bug through live testing. The 5-second dialog
  auto-dismiss safety net (`DEFAULT_DIALOG_TIMEOUT_MS`) is the shortest timeout anywhere in the
  engine, yet dialogs are exactly the case needing a check-then-act round trip
  (`get_pending_dialog` → `handle_dialog`). With realistic latency between those two calls
  (~3-4s, well within what this session had already shown for other actions), the window
  closed before `handle_dialog` could reach the dialog — it silently auto-dismissed instead,
  discarding whatever the caller intended (e.g. `prompt()` returning `null` instead of the
  supplied answer). Bumped the default to 30s (matches `downloadFile`), re-verified with
  ~4s of simulated latency between check and act — correctly handled now.
- **Drag-and-drop, right-click**: both verified against real HTML5 `DataTransfer`/`contextmenu`
  event handlers, not just the tool's own success report. No gaps.
- **Route interception (`mock`/`block`), console/network/page-error log capture**: all
  verified against genuine `fetch()` calls and a deliberate uncaught exception, not assumed
  from the tool's own output. No gaps.

**Net result**: 1 real, live-found bug fixed (dialog timeout); 1 previously-unverified feature
confirmed working for the first time (`session:blocked` surfacing); 5 categories confirmed
already correct; 1 category (the actual LLM reasoning behind `agent.runGoal`) remains
genuinely blocked on this environment lacking a provider — flagged honestly rather than
skipped silently.

### 2026-08-13 — Milestone 6: re-verify pending fixes live — caught a real bug doing it

MCP session reconnected (confirmed: `browser.set_network_conditions` newly present in the
tool list). Went through the 3 standing pending fixes:

- **Double-header bug**: confirmed fixed live — `browser.snapshot` now returns exactly one
  header with the correct count.
- **Network conditions**: confirmed live — `offline:true` genuinely blocked a real `fetch`
  ("Failed to fetch") through the actual MCP tool, not just direct-runtime.
- **`hasTouch` default**: **live testing caught a real regression that direct-runtime testing
  in Milestone 2 completely missed.** `isMobile:true` still produced `hasTouch:false` through
  the actual MCP call. Root cause: `tools.ts`'s handler always builds `{width, height,
  isMobile, deviceScaleFactor, hasTouch}` as an object literal from destructured params — so
  `hasTouch` is always a *present key*, even as `undefined`, when the caller doesn't pass one.
  The fix's `{hasTouch: default, ...viewport}` pattern silently loses to that explicit
  `undefined` during the spread (JS spread copies explicit `undefined` values, unlike a
  genuinely absent key). My Milestone 2 direct-runtime test happened to call the method with
  `hasTouch` truly absent, not explicitly `undefined` — so it never hit this path and falsely
  read as fully verified. Refixed: resolve the default with `??` chaining *before* the object
  is built, not via spread order (`const hasTouch = viewport.hasTouch ?? viewport.isMobile ??
  false; await page.setViewport({...viewport, hasTouch})`). Re-verified against the exact
  MCP-handler call shape (all keys present, `hasTouch: undefined` explicitly) — all 3 cases
  correct now. The corrected version itself still needs one more reconnect to confirm through
  an actual MCP round-trip (this session predates the just-made fix).

**Why this matters for the loop, not just this one bug**: this is the clearest evidence yet
for why CLAUDE.md's verification standard exists — "typechecking is necessary, not
sufficient." Direct-runtime scripting is a reasonable fallback when MCP is stale, but it is
NOT a full substitute for testing through the real call path a caller actually uses — object
construction differences invisible in one calling style can hide real bugs. Prefer live MCP
verification whenever the session is fresh; treat direct-runtime-only verification as
provisional, not final.

### 2026-08-13 — Milestone 5: a genuinely open-ended real task, not a fixture site

With the taxonomy nearly exhausted, this milestone was a change in kind rather than another
category sweep: a real, useful, unscripted research task on a genuinely complex real site
(Wikipedia), the way an actual user/agent would use Sutradhar — not a purpose-built test
fixture.

**Task**: fact-check the etymology claim behind the tool's own name. The `pinchtab_to_
sutradhar_rename` memory asserts "sutradhara" means "holder of the strings," the Sanskrit
equivalent of "puppeteer." Searched Wikipedia, navigated into "Indian classical drama," and
found the exact sentence: `"sutradhara" is "holder of the strings or threads"`, explicitly
compared to a puppeteer, cited to a real scholarly source (Richmond 1998, *Indian Theatre:
Traditions of Performance*) — not a Wikipedia editor's unsourced paraphrase. The naming
rationale documented earlier in this project is genuinely accurate.

**Net result**: no friction, no new gaps found — the whole flow (search → results → click
into an article → extract targeted content from deep inside a long page → find a citation)
worked smoothly end-to-end on a real, complex, unscripted site. That's itself a meaningful
signal: the taxonomy sweep's positive results generalize to genuine real-world use, not just
purpose-built fixtures.

### 2026-08-13 — Milestone 4: axSnapshot, hover, and the id-reuse-after-deletion case

Closed out the taxonomy's last "attempted but unfinished" items, live via MCP:

- **`axSnapshot`**: used exactly as documented — `browser.ax_snapshot` + `type_by_label` to add
  2 todos to a real TodoMVC list. Both landed correctly, no ids anywhere in the flow. Works.
- **`browser.hover` via MCP** (not just direct-runtime, which Milestone 1 already covered):
  hovered a real `:hover`-only destroy button on TodoMVC, then clicked it successfully.
- **Id-reuse-after-deletion** (the case Milestone 1 attempted and couldn't finish due to a bug
  in that test script, not a product issue): captured "Walk dog"'s checkbox numeric id, deleted
  the item above it ("Buy milk", the actual list-reflow trigger), then clicked the *stale*
  pre-deletion id with no re-snapshot in between. Correctly toggled "Walk dog" — the real
  surviving element, not a misfire onto whatever ended up at that DOM position. This was the
  single most realistic stress case for the grounding mechanism and it held up. Also
  incidentally confirms Milestone 1's script bug (todo count stuck at 1) really was my script,
  not Sutradhar — the same add-todo flow worked correctly here via plain MCP tool calls.
- **Re-verifying the 3 pending Milestone 2/3 fixes through an actual MCP round-trip**: still
  blocked. Checked directly — this connected session doesn't even have
  `browser.set_network_conditions` registered, confirming it predates Milestone 3 entirely.
  Needs a reconnect; not something I can force from here.

**Net result**: no code changes this milestone — every remaining taxonomy gap tested turned
out to already work correctly. The capability taxonomy now has no `untested` or `partial` rows
left except the ones explicitly deferred (large-scale extraction/pagination, true WebSocket/
SSE-driven pages) and the standing MCP-reconnect item.

### 2026-08-13 — Milestone 3: shadow DOM, media, network conditions, framework diversity

- **Shadow DOM**: open shadow root — listing and clicking both verified correct. Closed shadow
  root — correctly invisible to both, which is expected JS-level encapsulation, not a bug.
- **Media**: native `<video>` controls not exposed via `snapshot` (expected — UA-internal
  shadow DOM, not something any automation framework interacts with directly); the actual JS
  media API (`play`/`pause`/state) works correctly. One external test video failed with a
  genuine codec/format error — confirmed as that file's problem, not Sutradhar's, by loading a
  different real video successfully right after. Canvas `offset`-based clicking verified
  pixel-accurate against a hand-drawn target region.
- **Network conditions**: confirmed this was a complete gap (no code anywhere, not even
  internal) — built a new capability rather than just logging it, since it's small and follows
  an existing pattern (`emulate`/`set_viewport`). Added `SutradharRuntime.emulateNetwork` +
  `browser.set_network_conditions` (offline mode + DevTools throttling presets or custom
  throughput/latency). Verified live: offline genuinely blocked a real fetch, Slow 3G added
  ~2046ms to a request that normally takes ~17ms (matches the preset's own math), clearing
  throttling restored the baseline. Not yet confirmed through an actual MCP round-trip (same
  standing gotcha as Milestone 2's fixes — needs a reconnect).
- **JS framework diversity**: real TodoMVC apps in Vue, Angular, and Svelte — add-todo,
  snapshot, and DOM verification all worked correctly in each, same as the earlier React
  result. Confirms grounding is genuinely framework-agnostic rather than assumed to be.
- **Minor DX observation, not chased further**: `browser.eval` calls appear to share
  persistent top-level scope across separate invocations within a session (a `const` declared
  in one `eval` call collided with the same name in a later, separate call). Worth understanding
  if it comes up again, but low priority — easy to work around by not reusing identifier names.

**Net result**: 1 new capability built from scratch (network conditions) and verified live; 3
of 4 categories confirmed already correct with no code changes needed (shadow DOM open case,
media, framework diversity); 1 external-file issue correctly identified as not a Sutradhar bug.

### 2026-08-13 — Milestone 2: upload, auth persistence, mobile emulation, PDF

MCP session was reconnected at the start of this milestone (resolved Milestone 1's blocker).
Sanity-checked first (`data-sd-node-id`/`data-sd-gen` live, correct) before proceeding.

- **File upload**: `browser.upload_file` against a real fixture (the-internet.herokuapp.com/
  upload) — verified server-side, not just client success. No gap found.
- **Bonus fix (not part of the plan, found while sanity-checking)**: `browser.snapshot`'s MCP
  response double-printed its own header with two different element counts (4 vs 1, same
  page) — confusing and live. Root cause: `tools.ts` wrapped `snap.interactiveElements` in its
  own redundant header, not realizing the string already embeds one (the CLI's `cmdSnap` has
  an explicit comment warning about exactly this trap). Fixed, rebuilt, typechecked clean.
  Logged as `PROB-008`, resolved.
- **Auth/session persistence**: created a named CLI profile, logged into a real test fixture,
  fully killed the session, launched fresh with the same profile — still authenticated. No
  gap found; this is a genuinely strong capability already.
- **Mobile/device emulation**: `set_viewport` verified against a real site (github.com) —
  dimensions, pixel ratio, and media queries all correct. Found and fixed a real gap:
  `isMobile:true` never enabled touch event support (`hasTouch` wasn't threaded through to
  Puppeteer at all). Fixed with a sensible default (`hasTouch` follows `isMobile` unless
  overridden), verified all 3 cases directly against the runtime, rebuilt, typechecked clean.
- **PDF handling**: `export_pdf` (page → PDF) verified correct. Reading a PDF encountered via
  direct navigation is a real, confirmed gap — the native viewer's toolbar gets enumerated but
  `pageText` is empty even against a PDF with real text content. Logged as `PROB-009`, open —
  correctly not attempted as a quick fix (needs real PDF text-layer extraction).

**Net result**: 2 real product code fixes landed (double-header bug, `hasTouch` default),
both typechecked and verified directly against the runtime; neither yet confirmed end-to-end
through a live MCP round-trip since the connected session predates both changes — needs
another reconnect to close that loop. 1 new real gap found and deliberately not fixed
(`PROB-009`, PDF text extraction — correctly out of "quick fix" scope). 3 of 4 categories
tested turned out to already work correctly with no changes needed.

### 2026-08-13 — Milestone 1: multi-tab, download, iframes, real-time pages

Tested 4 categories not yet touched this session, all via real dogfooding (live browser,
real or realistically-constructed targets, not mocks):

- **Multi-tab**: Hacker News front page + a story's comments page in a background tab.
  `new_tab`/`tabId`-scoped `snapshot`/`click`/`eval` all worked correctly; confirmed the two
  tabs' state stayed fully isolated. No gap found.
- **File download**: injected a real `<a download>` link, called `runtime.downloadFile`
  directly. File landed on disk with the right name and content (verified by reading it back).
  No gap found; also re-confirms the Wave-8 download-path-containment fix still holds.
- **iframes**: found what looked like a real bug via the connected MCP tools (cross-origin,
  dynamically-injected iframe content invisible to both `snapshot` and `click`) — but this
  turned out to be a **false positive caused by the stale MCP session**, not a real defect.
  Verified directly against `SutradharRuntime` (bypassing MCP): both `snapshot` and `click`
  correctly reach into a cross-origin iframe injected after page load. No real gap; the actual
  finding here is the MCP-staleness blocker logged above.
- **Real-time pages**: simulated a live-updating feed (unrelated DOM churning every 150ms)
  next to a target button; captured the button's numeric grounding id, waited through ~8 more
  re-renders, then clicked via that id — correctly hit the real button every time. Grounding
  holds up under this kind of background churn. The harder case (the *target itself* gets
  destroyed/recreated, e.g. via deletion) remains untested — attempted but blocked by an
  unrelated bug in my own test script, not chased further this round.

**Net result**: no code fixes were needed this milestone — every category tested turned out to
already work correctly. The most valuable finding was procedural, not a product bug: the
stale MCP session is unreliable for verification and produced a false bug report. Logged as a
standing blocker above.

### 2026-08-13 — Loop established (Milestone 0)

Set up `CLAUDE.md` and this doc per the user's request to make the find→fix→verify loop the
standing way of working, not a one-off. No capability work done yet in this entry — Milestone
1 (multi-tab, file download, iframe, real-time page) starts next, logged separately below as
it completes.

## Current milestone

**Milestone 17: DONE** (2026-08-13) — third WebBench sample (14 tasks, 14 new domains),
10/14 completed with real answers, 4/14 externally blocked, plus one real Sutradhar bug found
and fixed live (`browser.type`/`type_by_label` were appending instead of clearing — see
iteration log). **Combined across all three samples: 15/29 WebBench tasks completed (52%),
14/29 externally blocked, 0 Sutradhar-attributable failures** — the real benchmark number
this loop set out to get, not just "mechanics work." See
`tools/webbench/claude-direct-run-2026-08-13-sample3.md` and `.ai/competitive-benchmarks.md`.
**Next**: no specific next task queued — resume the standing find→fix→verify loop by picking
real, unexplored surface (candidates: the unresolved click-handler observation from Milestone
14 if it recurs, true WebSocket/SSE pages, confirming the `type`-clear fix through an actual
MCP round-trip once the session is rebuilt/reconnected, or a fourth WebBench sample if an even
tighter completion-rate estimate is wanted).

**Milestone 14: DONE** (2026-08-13) — first Claude-direct WebBench run, 7/7 tasks attempted
live via `browser.*`. All 7 ended in honest, correctly-diagnosed external blocks (anti-bot
walls, missing credentials, catalog drift), not Sutradhar failures — see iteration log above
and `tools/webbench/claude-direct-run-2026-08-13.md`. This is now the primary benchmarking
mode going forward (Claude/host-AI driving `browser.*` directly), not `agent.runGoal` +
external LLM, per the user's correction.

**Milestone 1: DONE. Milestone 2: DONE. Milestone 3: DONE. Milestone 4: DONE** (all
2026-08-13) — see iteration log above.

**Remaining untested rows in the taxonomy**: true WebSocket/SSE-driven pages (vs. the
background-churn case already covered) and large-scale extraction/pagination. Everything else
in the taxonomy is now `covered` or `excluded`.

**Milestone 5: DONE** (2026-08-13) — a real open-ended task on Wikipedia (fact-checking the
tool's own naming etymology), not another fixture-site sweep. No new gaps found; the whole
flow worked smoothly end-to-end on a genuine, complex, unscripted site — see iteration log.

**Milestone 6: DONE** (2026-08-13) — MCP reconnected; re-verified the 3 pending fixes live.
2 of 3 confirmed working through an actual MCP round-trip (double-header bug, network
conditions). The 3rd (`hasTouch`) turned out to still be broken through the real call path —
live testing caught a real bug direct-runtime verification had missed entirely (see iteration
log for the full root cause). Refixed and re-verified against the exact call shape that
exposed it. **Still needs one more reconnect** to confirm the corrected version live — this
standing item persists, now down to 1 of 3 rather than 3 of 3.

**Also learned in Milestone 6→7's gap**: an MCP *client* reconnect and an actual *process*
restart of `mcp-server` are different things. A client can reconnect to the same still-running
node process, which keeps whatever code was in memory when it launched — new code on disk
doesn't take effect until the process itself restarts, not just the client connection. Confirm
which one actually happened (e.g. by checking whether a very recently added tool is present)
before trusting a "reconnected" session reflects the latest build.

**Milestone 7: DONE** (2026-08-13) — see iteration log above. Prompted by direct user pushback
("is our goal completed? do you even remember your goal?") after Milestone 6's checkpoint
wrongly treated an exhausted self-invented taxonomy as if it were the whole goal. Correction,
recorded here so it isn't repeated: the standing directive is a genuinely open-ended,
continuous loop, not a checklist with a finish line — "no more items in the table I made" is
never itself a reason to stop; the right question is always "what haven't I actually tried
yet," and `agent.runGoal` — the tool's actual headline feature — had gone untested all session
despite an exhaustive-looking taxonomy.

**Standing items**: the `hasTouch` fix (Milestone 6) still isn't confirmed through an actual
live MCP round-trip — needs a real process restart, not just a reconnect. The `agent.runGoal`
reasoning path remains genuinely blocked on this environment having no LLM provider (not
something resolvable without the user installing Ollama or supplying an OpenRouter key).

**Milestone 8: DONE** (2026-08-13) — closed the last untested taxonomy row (large-scale
extraction/pagination) with a real task, found and fixed a genuinely significant bug in the
process (element-listing cap had no way to be raised, on top of an independently-too-low
stamping cap — together made pagination links on ordinary content-heavy pages undiscoverable).
Swept cookies/storage/clipboard/geolocation too — all correct. See iteration log.

**Taxonomy status**: every row is now `covered`, `excluded`, or explicitly blocked on an
external constraint (`agent.runGoal`'s reasoning, on an LLM provider). No untested rows remain
that are actually resolvable from inside this environment.

**Standing items, unchanged**: the `hasTouch` fix (Milestone 6) still isn't confirmed through
an actual live MCP round-trip — needs a real process restart, not just a reconnect.
`agent.runGoal`'s reasoning path remains genuinely blocked on no LLM provider being available.

**Milestone 9: DONE** (2026-08-13) — goal reframed to competitive positioning (see
`.ai/competitive-benchmarks.md`); researched the real benchmark/competitor landscape; closed
all 3 tool-surface gaps found against Playwright MCP (`fill_form`, `click_at_point`,
`get_storage_state`/`set_storage_state`). See that doc's own iteration log for ongoing
competitive-comparison work — this doc stays focused on Sutradhar's own capability taxonomy;
the competitive doc tracks positioning against named competitors specifically.

**Milestones 10–11** happened entirely in `.ai/competitive-benchmarks.md` (Puppeteer/real-
PinchTab/AI-company-tools research, tab locking, coordinate-drag) — see that doc's own
iteration log, not repeated here.

**Milestone 12: DONE** (2026-08-13) — ran the actual `vitest` suites for the first time this
session (previously typecheck + live scripts only), found and fixed a real stale-fixture test
failure, added real unit coverage for tab locking. See iteration log above.

**Proposed Milestone 13**: no specific plan. Standing practice reinforced this round: run the
real test suite for any touched package before calling a milestone's verification complete,
not just `tsc`. Otherwise, real usage and real comparisons drive what's next.
