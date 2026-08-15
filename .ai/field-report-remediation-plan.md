---
State Category: Operational / Plan
Machine Readable: true
Update Ownership: AI Agent
Freshness Expectation: Until all phases complete
Update Policy: Tick phases off as they land; supersede when the loop moves on
Last Updated: 2026-08-16
---

# Remediate the GLM 5.3 field-report findings — fix, verify, and prove improvement with a permanent cross-surface benchmark

> **Status: approved, not yet started.** Planned on Opus 5 (2026-08-16) for execution on Sonnet 5.
> Source findings: `GAPS_AND_SUGGESTIONS.md` and `REPORT.md` at the repo root (an independent
> GLM 5.3 campaign against the published npm package). All root causes below were verified against
> real source during planning — **reuse them, don't re-derive**. Every "already established" claim
> here carries a file/line reference; if one turns out wrong, correct it in this doc rather than
> silently working around it.
>
> Related standing docs: `CLAUDE.md` (scope boundary, ownership),
> `.ai/browsing-capability-loop.md` and `.ai/competitive-benchmarks.md` (iteration logs — next
> milestone is 29, verify before appending), `.ai/known-problems.md` (bug log).

## Context

An independent campaign (GLM 5.3, run from `D:\Test\zcode\sutradhar` against the **published npm
package** — versions 0.2.0 and 0.2.2) produced `GAPS_AND_SUGGESTIONS.md` and `REPORT.md` at the
repo root: 14 scenarios, several reproducible bugs, and a prioritized fix list. This is the
first genuinely *external* validation Sutradhar has had, and it tested surfaces this project's
own testing never touched (CLI in headed mode, long-lived sessions, bot-detection panels,
TinyMCE, prompt injection).

The user's goal is an improvement loop: **find bugs/gaps → build → test → benchmark to prove it
actually got better → then validate in real projects.** This plan covers that whole loop.

**Three corrections to the field report** were verified against source before planning (do not
re-litigate these during execution). Note the pattern in #1 and #1b: GLM tested the CLI, found no
verb, and inferred the *capability* was absent. Treat every remaining "missing X" claim in their
report with that same suspicion — check the runtime before building anything.

1. **Three "missing capability" items are CLI-exposure gaps, not capability gaps.** The runtime
   already has `hover`, `dragAndDrop`, `selectOption`, `uploadFile`, `scroll`, `waitForSelector`,
   `eval`, `extractData`, `downloadFile`, `emulateNetwork`, `route` — none are wired to a CLI
   verb. C10's claim that there is "no network interception/mock/offline throttle" is **factually
   wrong** for the runtime/MCP surface.
1b. **C3 ("no download feedback") is also mis-scoped — and is the third instance of this pattern.**
   `downloadFile` (`browser-action-engine.ts` L530-598) already opens a browser-level CDP session,
   sets `Browser.setDownloadBehavior` with `eventsEnabled:true`, listens to real
   `Browser.downloadWillBegin` + `Browser.downloadProgress`, resolves on `state === 'completed'`,
   rejects on cancel/timeout, and returns `{downloadedFilename, downloadedPath, downloadDir}` —
   a genuine completion event, **not** a fixed sleep. It is exposed as MCP `browser.download_file`.
   GLM saw "no feedback" because **the CLI has no `download` command at all** (0 matches in
   `packages/cli/src`). The fix is a CLI verb surfacing the existing rich return value — it moves
   to Phase 4, not Phase 5.
2. **A1 (`type()` silent no-op) contradicts this project's own evidence.** `tools/engine-comparison/sutradhar-harness.mjs`
   ran the identical saucedemo checkout flow and passed end-to-end to "Thank you for your order!"
   — which saucedemo's own validation would have blocked if the fields were truly empty. So A1 is
   likely **intermittent (a race)**, not the deterministic no-op the report describes. Phase 0
   settles this before the fix is designed.

**Root causes already established** (from source, this session — reuse, don't re-derive):

| Finding | Root cause | Location |
|---|---|---|
| A2 tripled keystrokes + 15s timeout | `performActionWithTimeout` uses `Promise.race`; the timed-out `dispatchAction` **is never cancelled** and keeps emitting keystrokes while the retry loop starts a second concurrent `clearAndType`. `maxRetries=2` → 3 interleaved typings. `checkDuplicateAction` runs *once, before* the loop (its docblock says so explicitly), so it cannot catch internal retries. | `packages/browser/src/actions/browser-action-engine.ts` L320-334 (race), L182-237 (retry loop), L169-170 (defaults), L283-318 (dup guard) |
| A1 `type()` reports success without checking | `type` has **zero post-condition verification** — `dispatchAction` not throwing is the only success signal. There is no `verifiedType` analogue to `verifiedClick`. `clearAndType` (L663-667) does triple-click → Backspace → `handle.type()` and never reads the value back. | same file, `case 'type'` L399-410, `clearAndType` L663-667 |
| Misleading `verification` payload | `ExecutionVerifier.verifyAction` hardcodes `elementFound: true` and defaults `verified: true, confidence: 0.9` on any non-throwing action — so a no-op `type` returns a **confident false positive**. | `packages/browser/src/verifier/execution-verifier.ts` L12-90 (success branch L83-89) |
| A5 unhelpful stale-id error | `assertNotStale` (L996-1011) already emits a good message — but generation is stamped only on **snapshot**, not navigation. After a navigation the new document has **no** `data-sd-current-gen`, so `assertNotStale` short-circuits and the caller falls through to the generic `No element found for selector: [data-sd-node-id="9"]`. | same file L996-1011; attrs in `packages/browser/src/dom/dom-semantic-engine.ts` L30/38/41 |
| A3 modal blind spot | `INTERACTIVE_SELECTOR` (L44-48) is a **fixed tag+role allowlist with no handler awareness** — no `[onclick]`, `[tabindex]`, `contenteditable`, or `cursor:pointer`. A `<div>` with only an `addEventListener` click handler never matches `querySelectorAll` (L169), so it is never stamped or listed. Separately, `isVisible` (L235) is **only** `rect.width>0 && rect.height>0` — no `getComputedStyle`, so `visibility:hidden` / `opacity:0` elements are **false-positives** today. | `packages/browser/src/dom/dom-semantic-engine.ts` |
| C6 no `--json` | `formatGraphForLlm` (L249-278) is already a **pure function over a structured `SemanticElementGraph`** — but `runtime.snapshot()` (L339-354) discards the graph and returns only the formatted string. Cheap to expose. | `dom-semantic-engine.ts` L249-278; `runtime.ts` L339-354; node shape in `semantic-element-graph.ts` L15-28 |

## Scope decisions (settled — do not reopen during execution)

- **Headless UA (`HeadlessChrome/151`), GLM's P3 → build the neutral flag only.** Add a
  `--user-agent` / `userAgent` option across CLI/SDK/MCP with a **neutral default that does NOT
  strip "Headless"**. Rationale: a UA option is table-stakes configurability that Playwright,
  Puppeteer, and every HTTP client expose, and it has legitimate uses (testing UA-conditional
  rendering, working around UA-based content degradation on your own properties). Defaulting to a
  UA that hides headlessness *specifically to defeat detection* is the thing CLAUDE.md excludes,
  and this project has held that line three times (Milestones 16, 25, 26). On where the ecosystem
  is heading: agentic browsing is going mainstream (Playwright MCP, computer-use tools), and the
  durable position is **transparency plus operator-controlled configurability**, not covert
  evasion baked into a default — sites increasingly detect at the TLS/IP/behavioral layer anyway,
  so a UA lie buys little and costs the honest-tool positioning that is genuinely differentiating.
  Consequence to state plainly in docs: **Sutradhar will still "fail" that one row on
  bot.sannysoft.com by default, deliberately.** Do not change the default to improve a benchmark
  number.
- **CLI command batch — evidence-driven subset + the mechanically-identical neighbours.** Build
  `select`, `wait`, `eval`, `snap --json` (what GLM's scenarios actually had to work around),
  `download` (closes C3 by surfacing an already-complete runtime capability — see Context 1b),
  plus `hover`, `scroll`, `upload`, `drag` (same one-line `withSession` wrapper, near-zero
  marginal cost). **Defer** `route`, `emulateNetwork`, and `extractData` from the CLI — richer arg
  shapes (route patterns, network presets, field maps) deserve their own design pass, and no
  evidence anyone needed them from the CLI yet.
- **Out of scope, log don't build**: CAPTCHA/OTP solving (B1/B2 — universal), canvas/WebGL vision
  (B3), prompt-injection sanitization (B4 — note *why*: sanitizing page text would silently
  corrupt legitimate content; the real mitigation is host-LLM discipline, and pinchtab's own
  wrapper approach is a disclosed alternative worth documenting but not copying blindly),
  CLI daemon mode (C5 — real ~1.7s/command cost, but a genuine architectural addition; defer
  with rationale, do not attempt inside this plan).

## Execution phases

Phases are ordered by dependency. **Phase 1 must complete before Phase 2** — without a pre-fix
baseline there is no way to answer "did it actually get better", which is the user's stated goal.

| Phase | What | Findings addressed | Primary files |
|---|---|---|---|
| 0 | Settle whether A1 is deterministic or a race | A1 | scratchpad only |
| 1 | 14-scenario × 3-surface harness + **pre-fix baseline** | C11 + all measurement | `tools/scenario-suite/` (new) |
| 2 | Typed-value verification, retry safety, honest verification, stale-id errors | A1, A2, A5 | `browser-action-engine.ts`, `execution-verifier.ts` |
| 3 | Interactive-element detection + honest visibility | A3 | `dom-semantic-engine.ts` |
| 4 | Structured snapshot, CLI commands, `--user-agent`, CLI tests | C6, C9, C3, C1, A6 | `runtime.ts`, `cli.ts`, `tools.ts` |
| 5 | Popup/tab tracking, non-popup registration, profiles ↔ storage-state | A4, C2 | `browser-session.ts`, `browser-tab.ts`, `profile-manager.ts` |
| 6 | Release hygiene gate (the `<select>` delta's real cause) | release integrity | `scripts/build-bundle.mjs`, `package.json` |
| 7 | Re-run harness, before/after writeup, ship | proves the loop | `tools/scenario-suite/`, `.ai/*` |

Phases 2–5 are independent of each other once Phase 1's baseline exists and may be reordered or
parallelized; 6 must precede any publish in 7.

---

### Phase 0 — Settle A1: deterministic or race? (blocks Phase 2 design)

Write a throwaway script (scratchpad, not committed) that runs the saucedemo login → cart →
checkout flow **5×** via `SutradharRuntime` directly, and after each `type(sid, '#first-name', 'Ada')`
reads back the real value with `eval(sid, "document.querySelector('#first-name').value")`.
Record `reportedSuccess` vs `landedValue` per run.

**Acceptance:** a definitive answer recorded in the Phase 2 notes — deterministic no-op (0/5
landed), intermittent race (1-4/5 landed), or not-reproducible-here (5/5 landed, meaning it is
environment- or version-specific and the verification fix is still correct but the root cause
stays open). Do **not** skip this because the fix "is correct either way" — it determines whether
an additional root-cause fix is needed beyond verification.

---

### Phase 1 — Permanent cross-surface regression harness + PRE-FIX baseline

Build `tools/scenario-suite/` — GLM's 14 scenarios as a reusable harness, runnable against
**all three surfaces** (CLI, SDK, MCP), closing their C11 coverage gap.

- `scenarios.mjs` — the 14 scenario definitions as data (id, title, target URL, steps, success
  criteria), mirroring the existing style of `tools/engine-comparison/extreme-scenarios.mjs`.
- `run-sdk.mjs`, `run-cli.mjs`, `run-mcp.mjs` — one driver per surface. SDK/MCP drivers follow
  `tools/engine-comparison/sutradhar-extreme.mjs`'s `timed()` wrapper and result shape
  (`{id, title, surface, success, ms, detail, error}`). The MCP driver must spawn the real
  stdio server (`packages/mcp-server/dist/cli.js`) and speak JSON-RPC, since that is the surface
  Claude Code actually uses.
- `report.mjs` — aggregates the three result sets into a markdown matrix + JSON.

Then **capture the pre-fix baseline** into `tools/scenario-suite/baseline-pre-fix.json` and commit
it. This is the "before" half of the before/after.

**Acceptance:**
- All 14 scenarios execute on all 3 surfaces without harness-level crashes (individual scenario
  *failures* are expected and are the point — a scenario that fails must record *why*, not throw).
- `baseline-pre-fix.json` committed, containing a real pass/fail + timing per scenario per surface.
- The MCP driver demonstrably drives the real server (a real `initialize` handshake + at least one
  real `browser.*` tool call in the transcript), not a mock.
- Baseline reproduces GLM's headline findings on at least: UC-05 (`type` on checkout), UC-06a
  (modal missing from `snap`), UC-09 (SDK popup `about:blank`). If any does **not** reproduce,
  record that explicitly — it is a real finding about environment-dependence, not a harness bug.

---

### Phase 2 — Correctness core: typed-value verification, retry safety, honest verification payload, actionable stale-id errors

All in `packages/browser/src/actions/browser-action-engine.ts` + `verifier/execution-verifier.ts`.
These four are tightly coupled and share one new primitive — do them as one batch.

**2a. Read-back verification for `type` (fixes A1).**
Add a private `readElementValue(handle)` (`el.value ?? el.textContent ?? ''`, handling
input/textarea/contenteditable). Extend `clearAndType` (L663-667) to: existing click→Backspace→type,
then read back; on mismatch attempt the native-setter fill path (2b); read back again; if it still
mismatches, **throw** a precise error naming both values. Reuse the existing `runHandleOp` wrapper.

**2b. Native-setter `fill` fast path (fixes A1 for controlled components).**
No such code exists anywhere in the repo (verified — no `nativeInputValueSetter`, no
`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')`). Add it inside
`clearAndType`'s repair step:
```
Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
el.dispatchEvent(new Event('input',  { bubbles: true }))
el.dispatchEvent(new Event('change', { bubbles: true }))
```
choosing `HTMLTextAreaElement.prototype` vs `HTMLInputElement.prototype` by element type. This is
the React/Vue-controlled-component-safe path and is exactly what GLM's own `tests/dbg5.mjs`
workaround proved works.

**2c. Retry cannot interleave with an in-flight action (fixes A2).**
Two changes in `executeActionSerialized` (L182-237):
- Keep a handle on the in-flight `dispatchAction` promise. When the timeout fires, `await` its
  settlement (bounded grace, e.g. 2s, via `Promise.allSettled`) **before** starting the next
  attempt, so two `clearAndType` calls can never emit keystrokes concurrently.
- Before re-dispatching a **mutating** action (`MUTATING_ACTIONS`, L26-38, already includes
  `type`) after a *timeout*, re-check the post-condition first — if the field already holds the
  target value, return success instead of retrying. 2a's read-back primitive provides this.

**2d. Stop reporting fabricated verification (`execution-verifier.ts`).**
`elementFound` is hardcoded `true` and the success branch defaults `verified: true, confidence: 0.9`
for actions that verified nothing. Report honestly: only claim `verified: true` where a real
post-condition was checked (click's delivery marker, type's new read-back); otherwise say so in
`reason` and do not inflate `confidence`. **This is an intentional behavior change** — note it in
the commit and in `.ai/known-problems.md`, since a consumer keying on `verification.verified`
will see different (correct) values.

**2e. Navigation-aware stale-id message (fixes A5).**
Add a shared `describeMissingElement(page, selector)` helper. When a `[data-sd-node-id="N"]`
selector fails to resolve, check `document.documentElement`'s `data-sd-current-gen`:
- absent → "the page navigated since the last snapshot — call `browser.snapshot` again and use a
  fresh node id"
- present → "no element with node id N in the current snapshot generation — re-snapshot"
- non-node-id selectors → today's generic message, unchanged.
Apply at every site producing the generic string: L406 (`type`), L455 (`wait_for_selector`),
L468 (`select_option`), L487 (`focus`), and click's variant at L822.

**Acceptance:**
| # | Criterion |
|---|---|
| 2a | New unit test: `type` whose `handle.type` silently leaves the value empty now **throws** with an error naming expected vs actual — it must not return `success: true`. Follow the existing `mockHandle()` pattern at `browser-action-engine.spec.ts` L52-65 and the lock-in test at L570-602. |
| 2b | New unit test asserting the native-setter path fires `input` **and** `change` events, and is only attempted after the normal type path fails. |
| 2c | New unit test: a `type` that times out on attempt 1 does **not** produce concatenated/duplicated text; assert the second attempt starts only after the first settles. Must reproduce-then-prevent the `ssstttaaannndddaaarrrddd___uuussseeerrr` shape. |
| 2c | Live: the CLI headed-session repro from GLM's UC-03 no longer triples characters. |
| 2d | Existing tests that assert `verification.verified === true` for unverified actions are updated deliberately (not deleted), with the change noted. |
| 2e | Live: click a stale `[#id]` after a real navigation → the error explicitly tells the agent to re-snapshot. Unit test for both branches (gen absent vs present). |
| all | `npx vitest run` green in `packages/browser` **and** `packages/capability-runtime`; both packages typecheck. |
| all | Phase 1 harness re-run: UC-05 and UC-03 flip to pass on **all three** surfaces. |

---

### Phase 3 — Grounding accuracy: interactive-element detection + honest visibility

`packages/browser/src/dom/dom-semantic-engine.ts`. Higher blast radius than Phase 2 (it changes
what every snapshot contains), so it is its own phase with an explicit token-cost guard.

- Extend `INTERACTIVE_SELECTOR` (L44-48) with `[onclick]`, `[tabindex]:not([tabindex="-1"])`,
  `[contenteditable]`, `[role="option"]`, `label`, `summary`.
- Add a `cursor: pointer` computed-style fallback for elements not otherwise matched — the
  pragmatic proxy for `addEventListener`-attached handlers. **Document the real limitation**:
  `[onclick]` only catches inline handlers; genuinely detecting `addEventListener` requires CDP
  `DOMDebugger.getEventListeners`, which is a materially larger change — log it, do not build it
  here.
- Fix `isVisible` (L235) to consult `getComputedStyle`: exclude `display:none`,
  `visibility:hidden|collapse`, `opacity:0`. Today's rect-only check produces **false positives**
  for `visibility:hidden` (nonzero rect) — fixing this may *remove* elements from listings, which
  is correct.
- Re-check the second filter in `formatGraphForLlm` (L253-259) so newly-matched elements actually
  surface in the listing rather than being scraped and then filtered out.

**Acceptance:**
| # | Criterion |
|---|---|
| 3a | Live: the-internet.herokuapp.com/entry_ad modal Close button **appears in `snap`** output while the modal is on screen (GLM's UC-06a blind spot), and is clickable by `[#id]`. |
| 3b | Live: an element with `visibility:hidden` is **absent** from the listing (regression the current rect-only check gets wrong). Add a fixture under `tools/engine-comparison/hard-fixtures/`. |
| 3c | **Token-cost guard**: re-measure full-snapshot size on the same 4 pages already baselined this session (login 166 / homepage 590 / saucedemo 143 / example.com 104 approx tokens). Growth must stay **≤25%** on each; if any page exceeds that, narrow the selector rather than accepting the regression. Record the new numbers. |
| 3d | `packages/browser` unit suite green, including existing `dom-semantic-engine.spec.ts`. |
| 3e | Phase 1 harness: UC-06a flips to pass; **no other scenario regresses**. |

---

### Phase 4 — Structured output + CLI surface parity

**4a. `--json` / structured snapshot (C6).** `runtime.snapshot()` (L339-354) currently discards
the graph. Add an opt-in `includeNodes` so `SnapshotResult` can carry the structured
`SemanticNode[]` (shape at `semantic-element-graph.ts` L15-28) alongside today's string. Expose as
`includeNodes` on the MCP `browser.snapshot` tool and `snap --json` in the CLI (the sole branch
point is `cmdSnap`, `cli.ts` L144-153). Backward compatible — default off, existing output byte-identical.

**4b. CLI commands.** Add `select`, `wait`, `eval`, `hover`, `scroll`, `upload`, `drag`, and
`download` following the established pattern exactly: an `async function cmdX(...)`, a `case` in
the switch (L298-366), a help line in the `default` block, all wrapped in `withSession` (L43-85).
Manual flag parsing (`args.includes(...)`), `console.log` output, `process.exitCode = 1` on action
failure — match neighbours, do not introduce an arg-parsing library. `download` must **print the
real `downloadedFilename` / `downloadedPath`** already returned by the runtime (see Context 1b) —
that alone closes GLM's C3 without touching the download implementation.

**4c. `--user-agent` option** per the scope decision above — CLI flag + SDK `launch()` option +
MCP `browser.launch` param. Neutral default; **must not** strip "Headless".

**4d. Stand up CLI test infrastructure.** `packages/cli/tests/unit/` is **empty**, there is no
`test` script, and no vitest devDependency. Add them (mirror `packages/browser`'s vitest setup)
and cover the new commands' arg/flag parsing and exit codes.

**Acceptance:**
| # | Criterion |
|---|---|
| 4a | `sutradhar snap --json` emits valid parseable JSON with a `nodes` array; `sutradhar snap` output is **byte-identical** to before the change. MCP `browser.snapshot` without `includeNodes` returns an unchanged payload. |
| 4b | Each new CLI command works live against a real page, and `sutradhar` with no args lists them in help. |
| 4c | `--user-agent` demonstrably changes `navigator.userAgent` live; **default UA still contains "HeadlessChrome"** (asserted in a test, so nobody "helpfully" changes it later). |
| 4d | `npx vitest run` green in `packages/cli` with real tests present (not an empty pass). |
| 4e | Phase 1 harness re-run on the CLI surface shows scenarios that previously needed `evaluate` workarounds now using first-class commands. |

---

### Phase 5 — Session/SDK correctness (A4, C2)

**5a. Popup tab frozen at `about:blank` / `'New Tab'` (fixes A4).** Root cause found:
`adoptPopupPage` (`packages/browser/src/session/browser-session.ts` L162-188) constructs the tab
at popup-event time — when the popup is still `about:blank` — via
`new BrowserTab(tabId, page.url() || 'about:blank', 'New Tab', …)` (**L171**). Those become
`currentUrl` / `currentTitle` (`browser-tab.ts` L135-136, set L162-163) and **nothing ever
refreshes them**, because only `navigate()` (L212) updates them and an adopted popup is never
navigated through the runtime.

Consumers diverge, which is why this presents inconsistently:
- `get url()` (L174-179) reads **live** `page.url()` → correct.
- `get title()` (L181-183) returns the **cached** `'New Tab'` → stale.
- `toDto()` (L347-359) returns the **cached** `currentUrl` **and** `historyStack: [currentUrl]` →
  stale `about:blank`, and feeds `BrowserSession.toDto()` (L303-311).
- `snapshot()` (`runtime.ts` L339-354) → `url` live, `title` stale.

Fix: refresh the cached `currentUrl`/`currentTitle` for adopted popups (a `framenavigated`/`load`
listener in `adoptPopupPage`, or make `toDto()`/`title` read live like `url` already does). Use
the Phase 1 UC-09 baseline to confirm which consumer GLM actually hit before choosing.

**5b. Also register non-popup tabs.** There is **no `targetcreated` listener anywhere** in `src`
(0 grep hits) — the only new-page hook is `page.on('popup')` (`browser-session.ts` L155-160). A
tab created by any path other than the opener's `window.open`/`target=_blank` is never registered.
Note also why the CLI appears to "auto-adopt correctly": `attach()` (`runtime.ts` L231-273)
re-enumerates `browser.pages()` through `tryFindMostRecentPage` (L261-273) on **every** invocation,
filtering out `about:blank` — a fresh process papering over the same underlying gap. The
long-lived SDK never re-syncs. Add a `targetcreated` listener, or an explicit re-sync, so both
surfaces behave the same.

**5c. Wire profiles to storage-state (fixes C2).** Confirmed: `ProfileManager`
(`packages/capability-runtime/src/profiles/profile-manager.ts`) is **purely** a registry over
Chrome `--user-data-dir` (`create()` L56, `resolveUserDataDir()` L100, wired at `runtime.ts`
L196-198 and `cli.ts` L64-74) — no storage export/import, and `userDataDir` by design does not
persist sessionStorage. Meanwhile `getStorageState` (`runtime.ts` L882-898) **already dumps
sessionStorage** alongside cookies and localStorage. The two mechanisms are entirely unconnected
(the doc comment at L878-880 explicitly contrasts them). So this is **wiring, not new storage
code**: optionally persist a storage-state blob into the profile directory on shutdown and restore
it on launch-with-profile. Also expose profiles **and** storage-state through the SDK — currently
neither exists there (0 grep hits in `packages/sutradhar/src`).

**Acceptance:**
| # | Criterion |
|---|---|
| 5a | Live: SDK opens a popup via click; `popup.snapshot()` returns the popup's **real URL and title** (GLM's UC-09 / their `tests/uc09b.mjs`). Assert on **both** `url` and `title` — `url` may already be correct, `title` is the one frozen at `'New Tab'`. |
| 5b | Live: a tab created outside the popup path is registered and appears in `list_tabs`. Unit test for the new listener. |
| 5c | Live: log in to saucedemo (sessionStorage-based) under a named profile, relaunch with that profile, session **survives**. If genuinely infeasible, ship a documented `storage_state` recipe instead and say so plainly. |
| 5d | SDK exposes profile + storage-state APIs with at least one live-verified round trip. |
| 5e | Phase 1 harness: UC-03 and UC-09 flip to pass. |

---

### Phase 6 — Release hygiene: the `<select>` delta is unexplainable *by design*, and that is the real bug

**Investigation is already done — do not redo it.** Findings:

- `select` is in `INTERACTIVE_SELECTOR` (`dom-semantic-engine.ts` L45) and `'SELECT'` in
  `interactiveTags` (L253). `git blame`: **both unchanged since the initial commit `dc0e029`
  (2026-08-11)** — four days *before* 0.2.0 was published.
- `git log -S"select" -- packages/browser/src/dom/` → only `dc0e029` and `2808f9c` (2026-08-13).
  **Nothing in the 0.2.0 → 0.2.2 window.**
- `git diff --stat 8d8a58a..64af9eb` (v0.2.0 → v0.2.2) touches **no file under `packages/browser/`
  at all**.

So **no commit ever "fixed" `<select>` grounding** — it was correct in source the whole time. The
published 0.2.0 artifact simply did not match its own source tree, and *why* cannot be recovered,
because:

- `packages/sutradhar/dist/` is **gitignored** (`.gitignore` L6) — published bytes are not in git.
- `scripts/build-bundle.mjs` has **no clean step** and **no prepublish hook**.
- Workspace packages resolve through their **compiled `dist/`**, not `src/` — so a stale
  `packages/browser/dist/` at bundle time silently embeds stale engine code into the published
  tarball, with nothing to detect it.

**That unverifiability is the actual defect to fix** — the `<select>` symptom is just how it
surfaced. Build the gate:

- Add a clean step to `scripts/build-bundle.mjs` (remove `dist/` before writing) **and** rebuild
  every workspace dependency's `dist/` from `src/` as part of it, so the bundle can never embed
  stale compiled output.
- Add a `prepublishOnly` script that fails the publish when the working tree is dirty, when any
  workspace `dist/` is older than its `src/`, or when the bundle is stale.
- Record the published tarball's shasum per release in-repo so future artifacts are auditable.

**Acceptance:**
- The finding above written into `.ai/known-problems.md` **as-is** — including the honest
  "root cause unrecoverable from git; here is the mechanism that made it unrecoverable." Do **not**
  invent a specific cause.
- `npm publish` **fails** on (a) a dirty tree and (b) a deliberately-staled workspace `dist/`.
  Verify both by actually inducing them, not by reading the script.
- A rebuild from clean produces a bundle whose behavior matches source — spot-check by asserting
  `<select>` grounding works in the **freshly built bundle**, not just in `src`.

---

### Phase 7 — Prove it got better, then ship

- Re-run the full Phase 1 harness across all 3 surfaces → `results-post-fix.json`.
- Write `tools/scenario-suite/BEFORE-AFTER.md`: per-scenario, per-surface before/after matrix,
  every flip explained, **and every non-flip stated honestly** (a scenario that did not improve
  must be reported as such, per this project's standing rule against reporting only the flattering
  half).
- Update `.ai/competitive-benchmarks.md` and `.ai/browsing-capability-loop.md` iteration logs
  (next milestone number — 29 at time of writing; verify before appending).
- Version-bump, rebuild the bundle, `npm publish` **only after** the Phase 6 gate is in place and
  green. Publishing requires the user's hardware-key 2FA — hand off, do not attempt to automate.
- Reply to GLM's report: a short `RESPONSE-TO-FIELD-REPORT.md` at the repo root noting what was
  fixed, what was corrected in their findings (the CLI-vs-runtime mis-scoping, C10 being factually
  wrong), and what was deliberately not built and why (UA default, CAPTCHA, daemon).

---

## Standing rules for execution

- **Never trust an action's own `success` flag as verification** — read back real state. That is
  literally the bug being fixed in Phase 2; do not reproduce the same mistake while verifying it.
- **Typecheck is necessary, not sufficient.** Every phase needs a live run against a real target,
  plus `npx vitest run` for each touched package (`pnpm` is unavailable in this environment; use
  `npx` per package).
- **The MCP session goes stale after any rebuild** of `mcp-server` or its dependencies. Verify code
  changes by scripting `SutradharRuntime` from `packages/capability-runtime/dist/index.js`
  directly, or reconnect first — do not chase phantom bugs caused by a stale session.
- **Report non-improvements.** If a fix does not move its scenario, say so plainly in the
  before/after doc.
- Commit per phase with the established `Milestone N:` style; **push is routine and pre-authorized**
  for this repo, `npm publish` is not.
