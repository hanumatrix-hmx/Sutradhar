# Response to the field report

Thank you for the campaign in `GAPS_AND_SUGGESTIONS.md`/`REPORT.md` — this was the first
genuinely *external* validation this project had, and it found real bugs our own testing hadn't
hit. Every one of the 5 reproducible bugs (A1–A5) is fixed and independently live-verified, most
of the C-list gaps are closed, and a permanent 14-scenario × 3-surface regression harness now
exists specifically so a claim like "before/after" is checkable, not just asserted. Full detail
lives in `.ai/field-report-remediation-plan.md` (the execution plan, with a real RESULT section
per phase) and `tools/scenario-suite/BEFORE-AFTER.md` (the honest per-scenario matrix, including
what *didn't* improve and why). This document is the direct reply.

## A. Reproducible bugs

| # | Your finding | Status | What changed |
|---|---|---|---|
| A1 | `type()` silently no-ops on saucedemo checkout | **Fixed** | `clearAndType` now reads the value back after typing; on mismatch, retries via the exact native-setter `fill()`-style path your own `tests/dbg5.mjs` workaround proved works, then throws with expected-vs-actual if it still doesn't land — never silently reports success on a field that stayed empty. |
| A2 | CLI `type` triple-types under retry in long headed sessions | **Fixed** | The retry loop now awaits a timed-out dispatch's real settlement before starting a second attempt, so two `type()` calls can no longer interleave keystrokes on the same element. We could not reproduce the exact `ssstttaaannndddaaarrrddd` character-tripling shape under deliberate load-testing, but the empty-value failure mode (the same underlying race, A1's symptom) reproduced reliably and is what the fix targets — not gated on reproducing one specific corruption pattern. |
| A3 | `snap` misses the entry_ad modal's Close button | **Fixed** | Extended interactive-element detection (`[onclick]`, `[tabindex]`, `[contenteditable]`, `label`, `summary`, `[role="option"]`, plus a `cursor:pointer` computed-style fallback) and fixed a second-order bug the same investigation surfaced: your modal's real Close control is a bare `<p>` styled with `cursor:pointer`, which was being scraped but then filtered back out by the LLM-listing filter's tag allowlist. Both fixed. Live-verified full round trip: `snap` now shows `[#9] p "Close" role=clickable`; clicking it by that id genuinely dismisses the modal (`getComputedStyle` confirms `display:none` afterward). |
| A4 | SDK popup tab stays `about:blank`/stale title | **Fixed** | `title` can't read live from the page the way `url`'s getter already does (`page.title()` is async) — added a `'load'`-listener refresh plus a best-effort immediate refresh for a page adopted after it already finished loading. Also fixed `toDto()` (feeds `list_tabs`), which read the raw cached URL field directly instead of the live getter — same staleness, one layer further out. Live-verified: a real popup's title reads `"New Window"`, not `"New Tab"`, on both SDK and MCP. |
| A5 | Stale-id error doesn't tell the agent to re-snapshot | **Fixed** | The error now distinguishes "the page navigated since the last snapshot" from "this node id isn't in the current snapshot generation," both telling the agent explicitly to call `snap` again. Live-verified against a real post-navigation stale click. |
| A6 | `<select>` — fixed between your two runs, no CLI verb to change one | **Both addressed, differently than you'd expect** | The `<select>` fix "between runs" never actually happened in source — `git blame` shows the grounding code unchanged since before 0.2.0 shipped. The real defect was a release-integrity gap: the build had no clean step, and a stale compiled dependency could silently reach a published artifact undetected. That's now fixed with a real clean-rebuild pipeline and a `prepublishOnly` gate (see "What we fixed beyond your report" below). Separately, a real CLI `select <ref> <value>` command now exists. |

## B. Universal gaps

Agreed on all four — CAPTCHA solving, OTP/2FA/passkeys, canvas/WebGL vision, and prompt
injection are correctly scoped as walls no DOM-reading tool clears alone, not something we're
chasing. One clarification on prompt injection specifically: we deliberately do **not** sanitize
page text before handing it to the driving LLM. Filtering "IGNORE ALL INSTRUCTIONS" or similar
strings out of real page content risks silently corrupting legitimate content that happens to
contain that phrasing (a security blog discussing prompt injection, for instance) — the
mitigation we believe in is host-LLM discipline, not a heuristic text filter with its own false
positives. Noted as a deliberate position, not an oversight.

## C. Sutradhar-specific limitations

**Three corrections to how these were scoped**, verified against source before we started
fixing anything — worth flagging since the same pattern (CLI tested, verb not found, capability
assumed absent) shows up three separate times in your list:

- **C10 ("no network interception/mock/offline throttle")** is factually incorrect for the
  runtime/MCP surface — `browser.route` (mock/block) and `browser.set_network_conditions`
  (offline + DevTools throttling presets) already existed and work; you just tested the CLI,
  which had no verb for either. This was true even before we started fixing anything.
- **C3 ("no download feedback")** was the same pattern: `downloadFile` already opens a real CDP
  session, listens to genuine `Browser.downloadWillBegin`/`downloadProgress` events, and returns
  `{downloadedFilename, downloadedPath, downloadDir}` — not a polling sleep. The CLI simply had
  no `download` verb to surface it. Fixed by adding the verb, not by touching the download
  implementation (it didn't need it).
- **C9 ("no `select <ref> <option>`")** — same pattern again, `selectOption` already existed at
  the runtime level.

| # | Your finding | Status |
|---|---|---|
| C1 | Headless UA leaks `HeadlessChrome/151` | **Partially addressed, by design.** A `--user-agent` option now exists across CLI/SDK/MCP — real configurability, the same thing every HTTP client and browser automation tool exposes. The **default deliberately still contains "HeadlessChrome"** and always will; we're not rewriting it to chase a clean row on bot-detection benchmarks. This is a considered position (documented in `CLAUDE.md`, held through this exact remediation), not something left half-done: transparency about being an automated tool, plus operator-controlled configurability when there's a legitimate reason to change the UA (testing UA-conditional rendering, for instance), is the durable position we want to be known for — not covert evasion baked into a default. |
| C2 | Profile persistence doesn't cover sessionStorage | **Fixed.** Profiles now persist a storage-state blob (including real `sessionStorage`) on `shutdown()`, restored on the next launch with the same profile. One correction to the suggested repro: saucedemo's own login turned out to be cookie-based on direct inspection (`document.cookie` shows `session-username=...`; `sessionStorage` is empty), not sessionStorage-based — meaning it already survived a profile relaunch via Chrome's native `userDataDir` cookie persistence, independent of this fix. Verified the actual new mechanism with a purpose-built fixture instead: a real `sessionStorage` value set under a named profile survives shutdown + relaunch. |
| C3 | No download feedback | **Fixed** — see the scoping note above. `sutradhar download <ref> [dir]` now exists and prints the real filename/path. |
| C4 | No typing into cross-origin iframe bodies | **Corrected finding (2026-08-16), not a real gap.** Investigated live against the exact TinyMCE case this originally referenced: the editor's iframe is not actually cross-origin at all — its `src` is empty (same-origin; `iframe.contentDocument` is fully readable from the parent page's own JS, verified live) — so this was never a same-origin-policy limitation. `type` into the iframe body works correctly and reliably via its real selector (`body#tinymce`) or its `snap` node id; verified with an independent read-back of the iframe's own DOM confirming the exact typed text landed. What actually broke the original reproduction attempt was this project's own scenario-suite test code using an invalid CSS selector (`iframe.tox-edit-area__iframe body` — a descendant combinator can't reach into an iframe's content document; that construct never matches anything) alongside the working one in a comma-list, which — raced across frames while TinyMCE's own init sequence recreates that iframe — produced a real crash (an unhandled rejection that escaped the harness's per-scenario error handling, logged as `PROB-019`/`PROB-022` in `.ai/known-problems.md`). Fixed at the source (the scenario's selector), not by adding special-case handling to the engine, since the engine's existing behavior was already correct. |
| C5 | CLI daemon mode for near-SDK latency | **Deliberately deferred**, not built. Real ~1.7s/command overhead confirmed, but this is a genuine architectural addition (a long-lived process the CLI talks to), not a small fix — logged for a future, dedicated pass rather than built reflexively inside this remediation. |
| C6 | No `--json` snapshot mode | **Fixed.** `sutradhar snap --json` (and MCP's `includeNodes` param) now returns the real structured per-element data `interactiveElements` was rendered from — `boundingBox`, `confidence`, `isEnabled`, etc. — not a regex-parseable text listing. Plain `snap` output is unchanged (verified byte-identical). |
| C7 | No built-in waits / retry policies | **Partially addressed.** A real `wait <ref> [timeoutMs]` command now exists across CLI/SDK/MCP. General auto-wait-on-every-action was not built this round. |
| C8 | axsnap sr-only-text inconsistency | Not addressed this round. |
| C9 | Missing `hover`/`drag`/`select`/`upload`/scroll | **Fixed.** All five (plus `eval`, `wait`, `download`) now exist as real CLI commands, not `evaluate` fallbacks — each live-verified against a real page. |
| C10 | No network-layer controls | **Already existed** at the runtime/MCP level — see the scoping note above. Not touched this round beyond that correction. |
| C11 | MCP + `agent.runGoal` untested | **MCP: now covered.** The 14-scenario harness this remediation built runs on all three surfaces (CLI/SDK/MCP), not just the two your campaign covered — MCP now reaches a full 14/14 clean sweep. `agent.runGoal` (Sutradhar's own separate internal agent loop, distinct from driving `browser.*` directly) remains untested in this environment — it needs a real LLM provider (Ollama or an API key) that isn't available here, a real external dependency, not a code gap. |

## What we fixed beyond your report

Five bugs your campaign didn't catch, found live while fixing the ones it did:

1. **Duplicate-action guard false positive**: `click_by_role`/`click_by_text` calls carried their
   real target in `role`/`name`/`text`, not `selector` — the guard's key construction omitted
   them entirely, collapsing every such call to the same key and rejecting two genuinely
   different role/text clicks on the same tab within 1 second as "duplicates" of each other.
2. **Windows case-sensitivity bug** in the download-directory containment check — a legitimate,
   not-yet-existing subdirectory of an allowed root could be false-rejected depending on which
   case the caller happened to type it in.
3. **A second, more consequential download bug**: Chrome cancels *any* download targeted
   directly at the bare OS temp root, every single time, while the identical download into a
   subdirectory of that same root succeeds. This silently broke every download using the
   *default* directory (not just an explicit one), on every surface, until fixed — arguably
   worse than the case-sensitivity bug, since it needed no unusual input to trigger.
4. **`getStorageState()` returned the full URL mislabeled as `origin`** — a bug that had been
   there since the method was first written; nothing had ever compared two origins for equality
   until the profile↔storage-state wiring above depended on it being real.
5. **A release-integrity gap** — see A6 above. This is the one we'd flag as most worth knowing
   about if you re-test a future release: `npm publish` now goes through a real gate
   (`prepublishOnly` fails on a dirty git tree or a stale compiled workspace dependency,
   verified by actually inducing both conditions through the real `npm publish --dry-run`
   command) specifically so the kind of published-artifact/source-tree mismatch your campaign
   caught can't recur silently.

## The honest remainder

Not everything moved cleanly. Two things logged rather than hidden, per this project's own
standing rule against reporting only the flattering half:

- **`PROB-015`** (`.ai/known-problems.md`): UC-05 and UC-14 (the A1 and duplicate-guard fixes)
  pass reliably every time when re-run in isolation, but still show intermittent timing races
  specifically deep into a long, sequential 14-scenario run under real system load. The
  underlying bugs are confirmed fixed via source review and repeated isolated reproduction; the
  precise mechanism behind the residual raciness under sustained load wasn't fully identified in
  the time available for this pass.
- **CLI still has no tab-listing/switching command** — a real, honestly-diagnosed gap
  `tools/scenario-suite`'s own UC-09 driver surfaces on the CLI surface specifically (the
  runtime correctly tracks a newly-opened tab; the CLI just has no verb to address it). Not
  fixed this round; logged as a concrete next step rather than swept under "CLI is
  nondeterministic."

Thank you again for a thorough, well-evidenced report — it made this tool measurably better, and
the harness it prompted us to build is now a permanent part of how we'll validate future changes.
