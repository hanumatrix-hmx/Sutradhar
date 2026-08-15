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

**RESULT (2026-08-16): intermittent race, 2/5 runs reproduced.** Ran the exact flow via
`SutradharRuntime` directly (`node phase0-a1-race-check.mjs`, saucedemo login → cart → checkout →
`type('#first-name', 'Ada')` → read back real `.value`). `reportedSuccess: true` on **all 5**
runs; `landedValue` was `"Ada"` on runs 1/3/4 and `""` on runs 2/5. This confirms both halves of
the hypothesis at once: (a) A1 is a race, not a deterministic no-op — Phase 2's read-back +
native-setter-repair design (2a/2b) is the correct fix, no separate root-cause hunt needed; (b)
the action reports success even on the runs where it silently failed — live proof of the
"confident false positive" verification-payload finding that 2d is designed to fix. Raw run data
kept in this session's scratchpad, not committed (throwaway per the plan).

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

**RESULT (2026-08-16): all 42 scenario-runs executed with zero harness crashes.**
`tools/scenario-suite/{scenarios.mjs, run-sdk.mjs, run-cli.mjs, run-mcp.mjs, report.mjs}` +
`results/{baseline-sdk,baseline-cli,baseline-mcp}.json` + `results/baseline-report.md`. Built by
three parallel agents (one per surface), each blind to the others. Totals: **SDK 11/14, CLI
13/14, MCP 11/14.** Full matrix in `results/baseline-report.md`; note the pass/fail cells there
are a coarse dashboard — agents did not use perfectly identical strictness on UC-01 (see below),
so treat each JSON's `detail` field as the source of truth, not the matrix alone.

**UC-05 (the long checkout flow) failed on all three surfaces** — the strongest possible
cross-surface confirmation of A1: `type()` reported `success:true` while the real DOM value
stayed empty, on SDK, CLI, *and* MCP independently. CLI's failure rate (0/4 attempts landed) was
worse than Phase 0's SDK-direct 2/5, consistent with the CLI driver's own hypothesis that its
per-command process-restart/reattach cycle aggravates the race. **A2's specific "tripled
characters" signature did not reproduce** despite a deliberate attempt under the exact
long-lived-headed-session conditions GLM described — the empty-value failure mode reproduced
instead, every time. This does not change the Phase 2 fix (2c targets the underlying
never-cancelled-retry race regardless of which symptom it produces) but means: don't gate 2c's
verification on reproducing character-tripling specifically, gate it on "no lost/duplicated
keystrokes under a forced-timeout condition," which covers both known symptoms.

**A3 (modal blind spot) and A4 (stale popup) both reproduced on all three surfaces**, with A4
showing real, useful surface-specific nuance the original field report didn't have: SDK's stale
field is `title` only (`url` and body text are live-correct); MCP shows the same stale-`title`
pattern plus a stale `list_tabs` DTO; CLI is genuinely nondeterministic run-to-run (its fresh
`attach()` re-sync sometimes wins the race, sometimes doesn't). Phase 5's fix should verify
against all three patterns, not just SDK's.

**Two new, previously-unknown bugs were found and independently confirmed on two different
surfaces each** — added to this plan as new sub-items below (do not treat as scope creep; they
were found by exactly the methodology this plan calls for, and are already root-caused):

1. **Duplicate-action-guard false-positive on `click_by_role`/`click_by_text`.**
   `checkDuplicateAction`'s key (`browser-action-engine.ts`) is
   `` `${tabId}:${actionType}:${params.selector ?? params.key ?? ''}` `` — but `click_by_role` and
   `click_by_text` carry their target in `role`/`name`/`text`, not `selector`, so the key collapses
   to an empty string for *every* such call. Two genuinely different role/text clicks on the same
   tab within `DUPLICATE_ACTION_WINDOW_MS` (1000ms) are rejected as duplicates of each other.
   Found independently on **SDK** (UC-14, `clickByRole('button','Open Actions Menu')` then
   `clickByRole('menuitem','Archive Item')` — the second one rejected) and **MCP** (same scenario;
   precisely timed: a 200ms gap between the two calls fails, a 1100ms gap succeeds — nails the
   1000ms window as the exact cause). **CLI did not hit this** — its own per-command process
   overhead (~1.7–4s) already exceeds the window, an accidental immunity worth noting, not relying
   on. **Added as Phase 2f below.**
2. **Download-directory resolution has a real Windows case-sensitivity bug.** Found on MCP (UC-08):
   a legitimate nonexistent subdirectory of the allowed download root is rejected as "outside the
   allowed download directories." Root-caused live: `resolveDownloadDir()`
   (`browser-action-engine.ts`) `realpath()`-normalizes the *allowed root* to its on-disk case
   (`C:\Windows\Temp`), but a requested path that doesn't exist yet can't be `realpath`'d and falls
   back to the caller's literal case (`C:\WINDOWS\TEMP`, from `process.env.TEMP`) — the subsequent
   case-sensitive `.startsWith()` check then fails despite the paths being the same real directory.
   Confirmed by pre-creating the directory: it then succeeds. A second, separate issue on the same
   scenario: downloading straight to the bare OS temp root (no subdirectory) fails with "Download
   was canceled" on this environment. **Added as a Phase 4 prerequisite below** (Phase 4 adds the
   CLI `download` command that would otherwise ship surfacing this same bug).

**One more real, MCP-specific gap, not previously known**: MCP's `browser.launch` tool schema has
**no `profileName` parameter at all**, unlike `SutradharRuntime.launch()` itself — named profiles
are structurally unreachable from the MCP surface as currently exposed. **Added as a Phase 5
prerequisite below.**

**UC-01 (bot detection) surfaced real rows beyond the deliberate UA leak**: WebGL Vendor/Renderer
reads as failed in headless (no WebGL context — a real headless-Chrome rendering-mode limitation,
not obviously a Sutradhar code issue), plus `HEADCHR_UA` and `CHR_MEMORY`. **Recorded, not
actioned** — chasing more bot.sannysoft.com rows is exactly the "improve a benchmark number via
the excluded category" trap the Scope decisions section already warns against for the UA row
specifically; the same discipline applies to these. If a *non-detection* reason to fix headless
WebGL support ever surfaces (e.g. a real page's functionality depends on it, not just a detection
panel), revisit then — not as a reaction to this benchmark.

**Also recorded, not actioned**: the CLI driver observed `nav` intermittently reporting success
while the page silently drifted to `chrome://new-tab-page/` before the next command ran (hit
twice while building the harness, not standalone-reproducible) — logged here for future
investigation, not chased now given low reproducibility and that the harness already has a
retry/validation safety net around it.

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

**2f. Fix the duplicate-action-guard false-positive on `click_by_role`/`click_by_text` (new,
found in Phase 1's baseline, independently confirmed on SDK and MCP — see Phase 1 results
above).** `checkDuplicateAction`'s key omits `role`/`name`/`text` entirely, so any two
`click_by_role`/`click_by_text` calls on the same tab within `DUPLICATE_ACTION_WINDOW_MS`
(1000ms) collide regardless of what they actually target. Fix the key construction to include
whichever of `role`/`name`/`text` is present, matching the existing fallback chain style:
`` const target = params.selector ?? params.role ? `${params.role}:${params.name ?? ''}` : params.text ?? params.key ?? ''; `` (adjust to real param shapes — check `ActionParams` in
`action-types.ts` for the exact field names before writing this literally).

**Acceptance:**
| # | Criterion |
|---|---|
| 2a | New unit test: `type` whose `handle.type` silently leaves the value empty now **throws** with an error naming expected vs actual — it must not return `success: true`. Follow the existing `mockHandle()` pattern at `browser-action-engine.spec.ts` L52-65 and the lock-in test at L570-602. |
| 2b | New unit test asserting the native-setter path fires `input` **and** `change` events, and is only attempted after the normal type path fails. |
| 2c | New unit test: a `type` that times out on attempt 1 does **not** produce concatenated/duplicated text or lose data; assert the second attempt starts only after the first settles. Acceptance is "no lost/duplicated keystrokes under a forced-timeout condition" — Phase 1 found the character-tripling signature does not reliably reproduce, but the underlying race (and its empty-value symptom) does, every time; gate on the latter. |
| 2c | Live: the CLI headed-session repro from GLM's UC-03 no longer loses or corrupts typed values. |
| 2d | Existing tests that assert `verification.verified === true` for unverified actions are updated deliberately (not deleted), with the change noted. |
| 2e | Live: click a stale `[#id]` after a real navigation → the error explicitly tells the agent to re-snapshot. Unit test for both branches (gen absent vs present). |
| 2f | New unit test: two different `click_by_role` calls (different role/name) on the same tab within 1000ms both succeed — no false "duplicate" rejection. A true duplicate (same role/name, within window) still correctly rejects. |
| all | `npx vitest run` green in `packages/browser` **and** `packages/capability-runtime`; both packages typecheck. |
| all | Phase 1 harness re-run: UC-05 and UC-03 flip to pass on **all three** surfaces; UC-14 flips to pass on SDK and MCP (was already passing on CLI). |

---

**RESULT (2026-08-16): all six fixes (2a-2f) implemented, unit-tested, and live-verified against real Chrome.**
`packages/browser/src/actions/browser-action-engine.ts` + `verifier/execution-verifier.ts`.
`npx vitest run` green in both `packages/browser` (151/151) and `packages/capability-runtime`
(77/77); both typecheck clean (`capability-runtime`'s pre-existing, unrelated `pngjs` type-decl
gap in `visual-compare.ts` is untouched by this work — confirmed via `git status` on that file).

**Correction to the acceptance table above: the actual pre-fix baseline never had UC-03 failing
on any surface** (`results/baseline-report.md` shows UC-03 passing SDK/CLI/MCP already) — that
line in the acceptance table was written before Phase 1's baseline was captured and never
updated. The real Phase 2 targets, per the actual baseline, were **UC-05 (failed all 3 surfaces)
and UC-14 (failed SDK + MCP)**. Re-ran both, filtered, post-fix:

| Scenario | SDK | CLI | MCP |
|---|---|---|---|
| UC-05 (long checkout flow, A1's `type()` race) | ❌→✅ **flipped** | ❌ still fails, **different cause** | ❌→✅ **flipped** |
| UC-14 (duplicate-guard false-positive on click_by_role) | ❌→✅ **flipped** | ✅ (already passing) | ❌→✅ **flipped** |

SDK UC-05 now completes the full saucedemo checkout end-to-end (`"confirmationText": "Thank you
for your order!"`, cart math verified: `subtotal 7.99 + tax 0.64 = total 8.63`). MCP UC-05 also
completes cleanly. **CLI's UC-05 failure is unchanged and NOT a Phase 2 regression** — its error
changed from the old type-race symptom to `could not find "Sauce Labs Backpack" product link in
snap`, because the CLI driver's `detail.inventorySnap` shows it's attached to
`chrome://new-tab-page/` ("Adopted Tab") instead of the real saucedemo tab, a consequence of
having no `select` CLI command yet (Phase 4's scope, not Phase 2's) forcing a workaround that
mis-attaches. Confirmed by diffing against the pre-fix `results/baseline-cli.json`, which shows
the exact same root cause already documented there.

Live verification (script run directly against a freshly-rebuilt `capability-runtime` dist, since
the connected MCP session goes stale after any rebuild — see the plan's standing rules):
- **2a/2b**: `type()` on a real `<input type="number">` at the-internet.herokuapp.com/inputs
  landed `"42"` exactly, with an honest verification payload: `verified:true`, reason `'type' has
  a built-in post-condition check (verified inside the action itself before it could report
  success) — confidence 0.90`.
- **2f**: two different `clickByRole` calls (`link "A/B Testing"` then, after `goBack`, `link
  "Checkboxes"`) both reported `success:true` back-to-back — no false duplicate rejection.
- **2e**: a `[data-sd-node-id]` click issued after a real navigation away from the snapshotted
  page failed with the new message verbatim: *"No visible element found for selector:
  [data-sd-node-id="4"] — the page navigated since the last snapshot (or none has been taken yet
  this document). Call browser.snapshot again and use a fresh node id."*

**2d's behavior change is real and intentional** — logged in `.ai/known-problems.md` alongside
the separate, not-fixed-here `click_by_text` non-self-verifying gap (`ExecutionVerifier`'s
`SELF_VERIFYING_ACTION_TYPES` deliberately excludes `click_by_text`, which calls `element.click()`
directly and bypasses `verifiedClickOnHandle`'s occlusion/delivery checks).

**Process note**: `run-mcp.mjs` and `run-cli.mjs` don't implement the `SCENARIO_FILTER` env var
`run-sdk.mjs` has — both always run all 14 scenarios and unconditionally overwrite
`results/baseline-{cli,mcp}.json`. Running them for a targeted UC-05/UC-14 re-check silently
clobbered both pre-fix baselines in the working tree (git history still has the originals). Both
were restored via `git checkout --`, and the resulting full post-fix runs saved instead as
`results/post-fix-{cli,mcp}.json` (not committed as the final Phase 7 post-fix artifact — Phase 7
will do a clean full re-run across all three surfaces once every phase's fixes land). Worth fixing
`run-mcp.mjs`/`run-cli.mjs` to support the same env var before the next targeted re-check, so this
doesn't need manual recovery again.

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

**RESULT (2026-08-16): all four detection/visibility fixes implemented, unit-tested, and
live-verified — including a second, deeper root cause found and fixed mid-phase.**
`packages/browser/src/dom/dom-semantic-engine.ts`. `npx tsc --noEmit` clean; `npx vitest run`
green (153/153, up from 151 — 2 new `formatGraphForLlm` tests added for the role/tag additions).

**`INTERACTIVE_SELECTOR` extended** with `label`, `summary`, `[role="option"]`, `[onclick]`,
`[tabindex]:not([tabindex="-1"])`, `[contenteditable]:not([contenteditable="false"])` (the
negation matters — `contenteditable="false"` is a real, valid, explicitly-non-editable state,
not the absence of the attribute). **`cursor:pointer` fallback added**, folded into the existing
shadow-root-piercing traversal (no extra full-DOM pass) with inheritance-aware pruning — `cursor`
is an inherited CSS property, so every descendant of a clickable container computes
`cursor:pointer` too; only the outermost such element in a subtree is kept, and any nested inside
an already-selector-matched element is dropped. **`isVisible` now consults `getComputedStyle`**
(`display`, `visibility`, `opacity`) alongside the bounding rect, catching `visibility:hidden`/
`opacity:0` false positives the rect-only check missed.

**A second root cause, found only by live-testing the actual GLM UC-06a repro, not anticipated in
the original plan**: the-internet.herokuapp.com/entry_ad's real "Close" control is a bare `<p>`
tag styled with `cursor:pointer`. `INTERACTIVE_SELECTOR` already includes bare `h1/h2/h3/p` (for
page-structure *context*, not as click targets), so the element WAS being scraped and stamped —
but `formatGraphForLlm`'s tag/role allowlist deliberately excludes plain paragraphs as prose, so
it was scraped and then silently filtered back out, reproducing the exact same "modal blind spot"
bug one layer down from where the plan assumed it lived (a selector gap). Fixed by making the
role-assignment logic tag-aware: a heading/paragraph WITH an explicit interaction signal
(`onclick`/`tabindex`/`contenteditable`/`cursor:pointer`) now gets the synthetic `clickable` role
instead of its plain tag name, while a genuine context-only heading/paragraph (no such signal)
is unaffected. Native tags (button/a/input/etc.) are untouched by this branch — `cursor:pointer`
is default UA styling for several of them and must not override their real semantic role.

**Live verification, full round trip** (fresh incognito session against real Chrome, via a
rebuilt `capability-runtime` dist):
- Built `tools/engine-comparison/hard-fixtures/interactive-detection.html` — one fixture element
  per new detection/exclusion case (onclick div, tabindex div, tabindex="-1" exclusion,
  contenteditable region, contenteditable="false" exclusion, cursor:pointer card with a nested
  span that must NOT be separately listed, label, summary, role="option", plus
  visibility:hidden/opacity:0/display:none controls that must all stay excluded). **Every case
  matched its expected outcome exactly** — including the cursor-inheritance pruning (the nested
  span inside the cursor:pointer card did not get its own entry).
- **3a, real repro**: navigated to the-internet.herokuapp.com/entry_ad, waited for the modal's
  entrance animation to settle (~1s — a real Chrome rendering-timing detail unrelated to this
  fix, discovered while debugging; `getBoundingClientRect()` reports a stale 0×0 rect for up to
  ~900ms after the DOM node exists). `snap` now shows `[#9] p "Close" role=clickable`. Clicked it
  by that node id — `success:true`, `verified:true` — and confirmed via `getComputedStyle` that
  `#modal`'s `display` genuinely changed to `none`. Full detect → click → real-effect chain
  verified, not just "it appears in the listing."
- **3b**: the fixture's `visibility:hidden`/`opacity:0` buttons are both absent from the listing
  (the `display:none` case was already correctly excluded before this phase, via the rect check).
- Re-ran the actual Phase 1 harness scenario (not just the ad hoc script) —
  `SCENARIO_FILTER=UC-06 node run-sdk.mjs` — and confirmed the scenario's own internal
  `closeInDefaultListing` diagnostic field, which was specifically added to the driver to detect
  this exact gap, flipped **false → true**, with `fallbackUsed: null` (the `clickByText` fallback
  the driver had been silently relying on was never invoked). **Correction to 3e's framing**:
  UC-06 was already reported as passing in the Phase 1 baseline on all three surfaces — the
  driver had a `clickByText('Close')` fallback specifically for this gap, so scenario-level
  pass/fail never actually detected it. The real, honest signal is `closeInDefaultListing`, not
  the scenario's top-level `success`; that field is what this phase actually fixed.

**3c, token-cost guard** — measured `interactiveElements` size before/after on 4 pages (the
exact pages behind the plan's original "166/590/143/104" figures weren't recoverable from
available context, so this establishes a fresh, directly-comparable before/after pair rather than
matching those absolute numbers):

| Page | Before (chars / ~tokens) | After (chars / ~tokens) | Growth |
|---|---|---|---|
| example.com | 93 / 23 | 93 / 23 | 0% |
| saucedemo login | 197 / 49 | 197 / 49 | 0% |
| the-internet homepage | 1206 / 302 | 1206 / 302 | 0% |
| the-internet /login form | 195 / 49 | 239 / 60 | +22.4% |

All within the ≤25% budget; three of four pages had zero new matches at all (no page-specific
`onclick`/`tabindex`/`contenteditable`/`cursor:pointer` elements to find), so real-world growth
looks concentrated on pages that actually have the previously-missed interactivity, not a blanket
tax on every snapshot.

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

**4b-prereq. Fix `resolveDownloadDir()`'s Windows case-sensitivity bug first** (found in Phase 1's
baseline, UC-08 on MCP — see Phase 1 results above). `realpath()` normalizes the *allowed root* to
its on-disk case but a not-yet-existing requested subdirectory falls back to its literal
(potentially differently-cased) input, so the subsequent `.startsWith()` check is case-sensitive
against two different-case forms of the same real path and false-rejects. Fix by comparing paths
case-insensitively on Windows (or normalizing both sides through a consistent casing before
comparing) in `browser-action-engine.ts`. Do this **before** wiring the CLI `download` command,
so the new command doesn't ship reproducing a bug already found. Separately, confirm/fix why
downloading straight to the bare OS temp root fails with "Download was canceled" on this
environment — root-cause before deciding whether it needs a fix or just a clearer error.

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
| 4b-prereq | Live: downloading into a legitimate not-yet-existing subdirectory of the allowed root succeeds (previously false-rejected). Unit test for the case-comparison fix. Phase 1 harness UC-08 flips to pass on MCP. |

---

**RESULT (2026-08-16): all of 4a/4b/4c/4d/4e and the 4b-prereq landed, unit-tested, and
live-verified — plus a second root cause found and fixed for the download-dir prereq beyond
just the case-sensitivity bug.**

**4b-prereq — two real bugs, not one.** Fixed the Windows case-sensitivity bug as planned (new
`isPathWithinRoot` helper in `browser-action-engine.ts`, comparing case-insensitively only on
`win32`, shared by both `resolveDownloadDir` and `assertUploadPathAllowed`). But live-reproducing
the plan's other flagged symptom — "confirm/fix why downloading straight to the bare OS temp root
fails with 'Download was canceled'" — surfaced a **second, unrelated, more consequential bug**:
Chrome's `Browser.downloadProgress` reports `state:'canceled'` for **any** download targeted
directly at the OS temp root (`C:\WINDOWS\TEMP` itself), every single time, while the identical
download into any subdirectory of that same root succeeds — confirmed by isolating every other
variable (same page, same click, same CDP session code) and only changing the target directory.
CDP creates a non-existent target directory automatically, so the fix needed no new `mkdir` logic
— just changed the **default** `allowedDownloadRoots` from the bare OS temp dir to a dedicated
`sutradhar-downloads` subdirectory of it. This is arguably the bigger of the two fixes: the
case-sensitivity bug only ever bit an explicit, differently-cased `downloadDir`, but the
temp-root-cancellation bug silently broke **every download that used the default** (i.e. any
caller that never passed `downloadDir` at all) on this environment.

**4a.** `SnapshotResult.nodes?: readonly SemanticNode[]` added (optional, omitted unless a caller
opts in), `runtime.snapshot()` takes a 4th `{includeNodes}` param, MCP `browser.snapshot` gained
an `includeNodes` boolean input appending a JSON block after the text listing, CLI gained
`snap --json`. Live-verified: `sutradhar snap` output is **byte-identical across two consecutive
calls** (confirmed via `diff`, not just eyeballing); `sutradhar snap --json` produces valid JSON
(parsed programmatically, not just visually) with 4 real per-element fields including a genuine
`boundingBox`.

**4b + 4b-prereq's download command.** All 8 new CLI commands (`select`, `wait`, `eval`, `hover`,
`scroll`, `upload`, `drag`, `download`) were driven live against real the-internet.herokuapp.com
pages, not just typechecked: `select` changed a real `<select>`'s value (confirmed via a
follow-up `eval`); `wait`/`hover`/`scroll` all reported success against a real selector; `upload`
attached a real local file to a real `<input type="file">`; `drag` genuinely swapped
saucedemo-style column content (confirmed via `eval` reading the swapped text back); `download`
succeeded with the **new default** downloadDir, printing a real saved path
(`C:\WINDOWS\TEMP\sutradhar-downloads\...`) — directly confirming the 4b-prereq fix end-to-end,
not just in isolation. Bare `sutradhar` (no args) lists every new command in its help text.

**4c.** `BrowserLaunchOptions.userAgent` added, wired into `BrowserLauncher.prepareLaunchArgs`
(`--user-agent=...` flag), threaded through `spawnDetachedChrome` for the CLI's own
detached-Chrome path (which bypasses `BrowserLauncher` entirely, so needed separate wiring), and
exposed as a top-level `userAgent` param on MCP's `browser.launch`. Live-verified both directions
in the same session: `sutradhar nav <url> --user-agent "SutradharTestBot/1.0"` then
`sutradhar eval navigator.userAgent` → `SutradharTestBot/1.0`; a fresh `nav` with **no** flag →
`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... HeadlessChrome/151.0.0.0 Safari/537.36` — the
neutral default is unchanged, per the plan's scope decision. Locked in with 2 new
`launcher.spec.ts` unit tests (one asserting the override, one asserting no `--user-agent=` arg
is added when unset) so the default can't quietly drift later.

**4d.** `packages/cli/tests/unit/` was genuinely empty going in (confirmed, not assumed) — no
`test` script, no vitest devDependency reference. Rather than test `cli.ts` directly (it runs
`main()` immediately at module load — importing it in a test would spawn/attach to a real Chrome
the moment the test file loaded), extracted the flag/verb-parsing logic into a new pure
`parse-args.ts` module (`parseArgs(argv)`), which `cli.ts` now calls instead of inlining the
same logic at module scope. 13 real tests added covering every flag (including this phase's new
`--json`/`--user-agent`) individually and combined, edge cases (a valued flag with no following
token, a positional arg that collides with a flag name later in argv), and the new multi-arg
commands' positional threading. `npx vitest run` → 13/13, not an empty pass. Command-level
integration (spawning a real runtime, real exit codes end-to-end) is intentionally left to the
Phase 1 scenario-suite's live CLI driver rather than mocked here — consistent with this project's
existing split between fast unit tests for logic and live verification for integration.

**4e.** Updated `tools/scenario-suite/run-cli.mjs`'s UC-05 driver, which had a hardcoded
`sortBlocked` placeholder recording "no `select` CLI command exists" as an honest pre-Phase-4
gap — replaced it with a real `sutradhar select <ref> lohi` call now that the command exists, and
re-snapshots afterward since sorting changes node ids. Re-ran the full Phase 1 harness on the CLI
surface: **14/14 scenarios now pass** (was 13/14 pre-Phase-4), a full clean sweep. UC-05's sort
step genuinely executed (`sortResult: {stdout: 'Selected "lohi" on 8", code: 0}`) and the whole
downstream flow completed to `reachedConfirmation: true`. UC-08 also flips to pass on CLI,
confirming the download-dir default fix from a second independent surface. **Also re-ran the
full MCP surface** (not just the CLI) as a bonus check beyond what 4e strictly asked: 13/14 pass
(was 11/14), UC-08 flips to pass there too; the one remaining failure (UC-06) failed with a plain
30-second navigation timeout unrelated to anything changed this phase, and a direct reachability
check immediately after (`fetch` to the same URL, 200 in 1.4s) confirms the site was fine —
recorded honestly as a transient network blip against the live external site, not re-run again
to avoid the cost of a second full 14-scenario MCP pass for what all available evidence points to
as a one-off.

**Process note**: both `run-mcp.mjs` and `run-cli.mjs` still lack `SCENARIO_FILTER` support
(only `run-sdk.mjs` has it), so every targeted re-check this phase ran the full 14-scenario suite
and unconditionally overwrote `results/baseline-{cli,mcp}.json` again. Recovered the same way as
Phase 2 (save the post-fix run under a distinct filename, `git checkout --` to restore the
pre-fix baseline) — `results/post-fix-{cli,mcp}-phase4.json`. This is now the second phase to hit
this friction; worth fixing before Phase 7's real, final full re-run needs it.

All touched packages typecheck clean and pass their full suites: `packages/browser` 156/156 (2
new launcher tests), `packages/capability-runtime` 77/77, `packages/mcp-server` 22/22,
`packages/cli` 13/13 (new).

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

**5c-prereq. Add `profileName` to the MCP `browser.launch` tool schema (new, found in Phase 1's
baseline — see Phase 1 results above).** Confirmed the parameter is simply absent from
`packages/mcp-server/src/tools.ts`'s `browser.launch` schema even though
`SutradharRuntime.launch()` already accepts it — named profiles are structurally unreachable from
MCP today, independent of 5c's storage-state wiring. Add the schema field and thread it through;
small, do first since 5c's live verification should cover the MCP surface too.

**Acceptance:**
| # | Criterion |
|---|---|
| 5a | Live: SDK opens a popup via click; `popup.snapshot()` returns the popup's **real URL and title** (GLM's UC-09 / their `tests/uc09b.mjs`). Assert on **both** `url` and `title` — `url` may already be correct, `title` is the one frozen at `'New Tab'`. Also verify against MCP's stale-`list_tabs`-DTO variant and CLI's nondeterministic case found in Phase 1 — all three surfaces, not just SDK. |
| 5b | Live: a tab created outside the popup path is registered and appears in `list_tabs`. Unit test for the new listener. |
| 5c | Live: log in to saucedemo (sessionStorage-based) under a named profile, relaunch with that profile, session **survives** — on **all three surfaces**, including MCP once 5c-prereq lands. If genuinely infeasible, ship a documented `storage_state` recipe instead and say so plainly. |
| 5c-prereq | `browser.launch`'s MCP schema accepts `profileName`; live round trip via a real MCP tool call. |
| 5d | SDK exposes profile + storage-state APIs with at least one live-verified round trip. |
| 5e | Phase 1 harness: UC-09 flips to pass (title no longer stale on any surface). UC-03 already "passes" as a reporting scenario pre-fix — the real bar here is that its `detail` field changes from "session lost" to "session survived" on all three surfaces, not just that the scenario's pass/fail flag flips. |

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
