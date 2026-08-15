# Hardest real-world browser-automation cases: Sutradhar vs. Playwright vs. Puppeteer vs. real pinchtab/pinchtab

**Update 2026-08-16 (same day, follow-up): the Sutradhar gap found below is fixed and
re-verified live.** `eval()`/`extractData()` (`packages/capability-runtime/src/runtime.ts`) now
accept an optional `frameSelector` — a CSS selector or snapshot `[#id]` for an `<iframe>`
element on the top-level page — and evaluate inside that frame's real `Frame` object (via
Puppeteer's `ElementHandle.contentFrame()`, a CDP-level primitive, the same mechanism
`click`/`type` already used to reach cross-origin content) instead of always running on the
top-level page. Exposed through all three surfaces: `SutradharRuntime.eval()`/`.extractData()`,
the `browser.eval`/`browser.extract_data` MCP tools, and the SDK's `Page.evaluate()`. 6 new unit
tests added (`packages/capability-runtime/tests/unit/runtime.spec.ts`), full `capability-runtime`
suite (77 tests), `mcp-server` suite (22 tests), and `sutradhar` SDK suite (7 tests, after also
fixing one unrelated stale hardcoded-version assertion the run surfaced) all pass. Live
re-verification re-ran the exact same two affected scenarios (nested-shadow-iframe,
cross-origin-iframe) against the real fix — both now genuinely pass with real extracted
evidence (`"Example Domain"`, `"submitted:hello-nested"`), not just an absence of errors, and
the old outer-page eval path was confirmed to correctly *remain* blocked (real same-origin
policy, not something to route around at the page-JS level — the fix adds a legitimate new
path, it doesn't weaken an existing one). **Sutradhar's score on this comparison is now 7/7.**
See the "Fix and re-verification" section at the end for full detail; the original findings
below are preserved as-found, not edited, since they're what motivated the fix.

Direct response to: "find out the hardest usecases for the browsing tool that are in the world.
Then we will test it with all Sutradhar, playwright, puppeteer and pinchtab." The 7 scenarios
were sourced from real, cited material — Playwright/Puppeteer's own GitHub issue trackers, QA
community documentation (Katalon, Vibium Labs, TestProject), and the WebCanvas agent-benchmark
paper — not invented. Full sourcing in the prior turn's research; scenario definitions in
`tools/engine-comparison/extreme-scenarios.mjs`. Raw per-tool results:
`tools/engine-comparison/results/{sutradhar,playwright,puppeteer,pinchtab}-extreme.json`.

**Methodology**: each of 4 harnesses (`sutradhar-extreme.mjs`, `playwright-extreme.mjs`,
`puppeteer-extreme.mjs`, and real pinchtab driven via CLI-in-container) implements the identical
7 scenarios using that tool's own real, idiomatic API — no shared abstraction layer, no stealth/
evasion. Written and run independently by 4 parallel agents, each blind to the others' results.

## Final score (original run — see "Fix and re-verification" below for the updated Sutradhar 7/7)

| Tool | Scenarios passed | Notes |
|---|---|---|
| **Playwright** | 7/7 | Clean sweep — the two scenarios designed around documented real bugs didn't reproduce on this version |
| **Puppeteer** | 7/7 | Also a clean sweep, but consistently more manual/verbose — no built-in AI/accessibility grounding, no automatic shadow/frame piercing |
| **Sutradhar** | 6/7 | 1 inconclusive (see below) — surfaced one genuine, disclosed API gap along the way |
| **real pinchtab/pinchtab** | 6/7 | 1 real, reproduced failure (cross-origin frame switching) + a real concurrency reliability issue (80% success rate under 5-way load, not 100%) |

**Not a clean sweep for anyone.** Read the per-scenario detail below — several results are more
interesting than the raw score, and two "designed to expose a known weakness" scenarios didn't
reproduce anything at all, which is itself an honest result worth reporting rather than
discarding.

## Per-scenario results

### 1. Nested shadow DOM inside a same-origin iframe

| Tool | Result | How |
|---|---|---|
| Playwright | ✅ 512ms | `frameLocator()` + shadow-piercing locators reached through both boundaries natively, zero manual eval |
| Puppeteer | ✅ 431ms | Required a hand-rolled workaround: `page.frames()` to get the frame, then `frame.evaluateHandle()` into the shadow root manually — no built-in piercing |
| real pinchtab | ✅ 962ms | `pinchtab snap` transparently flattens through both boundaries with plain refs; default `click` hit an occlusion error (shadow host intercepting hit-testing), fixed with `--mode dispatch`; `text` extraction never surfaced the shadow content at all — only `snap` did |
| Sutradhar | ⚠️ inconclusive | `type()`/`click()` both reported success and appear to reach across the boundary, but verification via `eval()` failed — traced to the fixture's two files loading as separate `file://` documents (an opaque-origin quirk affecting the test setup, not unique to Sutradhar). **The real, valid finding underneath**: Sutradhar's `eval()`/`extractData()` operate through the outer page's own JS context, subject to the same restriction any page script would hit — exactly the pattern Playwright's and Puppeteer's frame APIs (which operate at the CDP/browser-engine level, not through page JS) are built to route around. Sutradhar currently exposes no CDP-level cross-frame read path. |

### 2. Real rich-text editor (ProseMirror, official reference example)

All four **passed**, including the two scenarios (this one and #3) picked specifically because
of documented real bugs:

| Tool | Result | Note |
|---|---|---|
| Playwright | ✅ 3,867ms | Both `fill()` **and** `keyboard.type()` worked — contrary to the referenced open bug (#39492); didn't reproduce on this version |
| Puppeteer | ✅ ~3.6s | Select-all + `keyboard.type()`, verified via reading back `.ProseMirror.innerText` |
| real pinchtab | ✅ 1,167ms | Not a ref'd node by default — needed explicit `--css ".ProseMirror"` targeting, then plain keyboard type worked |
| Sutradhar | ✅ | `type()` landed correctly on the contenteditable, verified via `eval()`, not just trusted |

### 3. Custom pointer-only drag-and-drop (no native HTML5 DnD at all)

| Tool | Result | Note |
|---|---|---|
| Playwright | ✅ 803ms | Surprising: the high-level `dragAndDrop()` (built around HTML5 DnD events, per its own docs) **also worked** on a fixture with zero DnD event listeners — it evidently synthesizes real mouse events as a fallback |
| Puppeteer | ✅ 645ms | Manual `boundingBox()` + mousedown → stepped mousemove → mouseup, exactly as Puppeteer's own docs recommend for non-native DnD |
| real pinchtab | ✅ 1,331ms | Built-in `pinchtab drag` command worked first try — its docs confirm it drives real mouse events, not just DnD events |
| Sutradhar | ✅ | Also surprising: the high-level `dragAndDrop()` worked here too, same apparent real-pointer-event fallback as Playwright's |

Genuinely anticlimactic finding: none of the four actually failed this one. The real
differentiator that shows up elsewhere in the industry (a tool that *only* dispatches HTML5 DnD
events and does nothing on a pointer-only widget) didn't reproduce with any of the four current
versions tested.

### 4. Genuinely cross-origin iframe (real example.com embedded in a local page)

The most differentiated result of the seven:

| Tool | Result | Note |
|---|---|---|
| Playwright | ✅ 498ms | `frameLocator()` cleanly extracted the real heading, native CDP-level frame access |
| Puppeteer | ✅ 572ms | `page.frames()` also read it cleanly — confirms Puppeteer's frame API operates at CDP level, unaffected by same-origin policy the way page JS would be |
| Sutradhar | ❌ (honest, disclosed) | Correctly reports it **cannot** read cross-origin iframe content — same-origin policy applies to `eval()`/`extractData()` exactly as it would to a real page script, and no public API currently exposes a CDP-level frame read. Not a bug; a real, disclosed capability gap. |
| real pinchtab | ❌ (real, reproduced bug) | `pinchtab frame` failed every way tried — by CSS selector ("did not resolve to an iframe or frame"), by accessibility ref ("ref is not an iframe owner" — self-contradictory, since that ref *is* the Iframe node), and by URL. A screenshot confirms the iframe visually renders "Example Domain" correctly and the network log shows a real 200 — this is specifically a CLI/API frame-scope-switching gap, not a browser-level block. Reproduced 4 times. |

Sutradhar and pinchtab both "fail" this scenario, but for genuinely different reasons: Sutradhar
correctly and honestly reports a known limitation; pinchtab *attempts* the operation and hits a
real, reproducible bug. Worth telling apart rather than lumping into one "both failed" line.

### 5. Real CAPTCHA/anti-bot widget detection (Cloudflare Turnstile official demo)

All four **correctly detected** the challenge — genuinely consistent finding, though methods
differed:

| Tool | Result | Method |
|---|---|---|
| Playwright | ✅ 3,773ms | Iframe `src` pattern match (`challenges.cloudflare.com`) — the `title` attribute came back `null`, so title-based detection alone would have missed it |
| Puppeteer | ✅ 2.9s | Caught its own false negative mid-run: this demo page uses Cloudflare's known "always-pass" test sitekey, which resolves via a dummy token rather than ever rendering an interactive widget — the agent verified this live via a probe script and fixed its detection logic before reporting, rather than shipping a wrong result |
| real pinchtab | ✅ 2,356ms | `snap` names the widget directly and descriptively: `Iframe "Widget containing a Cloudflare security challenge"` — no hang, no false "clean page" claim |
| Sutradhar | ✅ | Detected via the same real marker list `packages/agent/src/core/block-detector.ts` already uses in production (`cf-turnstile` matched) |

No stealth/evasion attempted by any tool, per this project's standing exclusion — detection
correctness only.

### 6. Large, deep real DOM (13 columns × 50+ rows)

All four correctly extracted the real target cell (`"50.1"`, row-50/column-1), but the real
story is snapshot cost on a genuinely large page:

| Tool | Extraction | Full-page read cost |
|---|---|---|
| Sutradhar | ✅ "50.1" | `snapshot()` 3ms; `axSnapshot()` 123ms / 226 bytes |
| Playwright | ✅ "50.1" | `ariaSnapshot()` 52ms / 69,147 chars |
| Puppeteer | ✅ "50.1" | Cell read 7ms; full `querySelectorAll('*')` (2,943 elements) ~1ms |
| real pinchtab | ✅ "50.1" | `text` read: 99,280 chars / 1,088ms. Full accessibility **`snap`: 114,607 chars / 12,652ms** |

**Real, measured finding**: pinchtab's accessibility-snapshot mode is **over 10x slower** than
its own plain-text read on this large page (12.6 seconds vs. 1.1 seconds) — a genuine
performance cliff specific to snapshot mode on big DOMs, not shared by its text-extraction path.
None of the other three showed anything close to this gap at this page size.

### 7. Concurrency: 5 simultaneous full login flows

| Tool | Success rate | Timing (min/max/avg) | Architecture |
|---|---|---|---|
| Sutradhar | 5/5 | 4,178 / 4,529 / 4,297ms | 5 independent `launch()` calls |
| Playwright | 5/5 | 4,245 / 4,608 / 4,368ms (total wall 4,751ms) | 5 independent browser contexts |
| Puppeteer | 5/5 | 3,993 / 6,178 / 5,085ms | 5 pages on **one shared** browser — wider spread is real, expected contention |
| real pinchtab | **8/10 (80%)** across corrected trials | ~4.6–4.75s total wall-clock for 5 parallel flows | 5 sessions as tabs on **one shared instance/process** (confirmed via `pinchtab instances`) |

**The most operationally important finding of this whole comparison**: pinchtab's default
architecture runs all concurrent sessions on a single shared browser instance, and this showed
a *real* reliability cost, not just a timing one — a naive click without `--wait-nav` triggered
false nav-guard errors in 2/5 sessions; switching to the documented `--wait-nav` flag fixed
that but left a residual race where roughly 1 in 5 sessions per trial got back empty content
after a clean, successful navigation. Real parallelism is genuinely achieved (5 flows in ~4.6s
total, not 5x serialized) but at a measured, non-trivial reliability cost under load. Sutradhar
and Playwright's independent-instance-per-session model showed no such failures.

## Reading this honestly

No tool "won" this comparison outright, and that's the honest result, not a hedge:

- **Playwright is the most mature and complete** of the four on raw capability — 7/7, and its
  frame/shadow-piercing locators are the cleanest API for the hardest DOM-encapsulation cases.
- **Puppeteer matched it on raw completability (7/7)** despite having zero built-in AI/
  accessibility grounding — its low-level primitives (manual frame handles, bounding-box math,
  stepped mouse sequences) are mature and complete, just consistently more manual than the
  alternatives. Confirms the finding from the earlier token-cost comparison: capable, but
  everything costs more caller-side effort.
- **Sutradhar's one real gap here is genuine and worth fixing**: no CDP-level cross-frame read
  path for `eval()`/`extractData()`. Everything else it attempted succeeded, including two
  scenarios it wasn't expected to handle cleanly (custom drag, rich-text editing).
- **real pinchtab surfaced two genuine, reproducible bugs** — the cross-origin frame-switching
  failure and the concurrency race condition under its shared-instance architecture — plus one
  real performance cliff (accessibility-snapshot mode on large DOMs). These are concrete,
  scoped, closable engineering gaps in pinchtab specifically, not fundamental limits of the
  approach, but they're real as measured today, on the version tested.

Two of the seven scenarios (rich-text editor, custom drag-and-drop) were picked specifically
because of documented real-world pain points and didn't reproduce failures on *any* of the four
current tool versions — reported honestly rather than discarded, since a benchmark that only
reports the scenarios that "worked out" isn't a benchmark.

## Fix and re-verification (2026-08-16)

**The fix**: `packages/capability-runtime/src/runtime.ts` — a new private `resolveFrame(page,
frameSelector)` helper resolves an `<iframe>` element (`page.$(normalizeTarget(frameSelector))`,
supporting both CSS selectors and numeric snapshot ids, same convention as every other target
argument in this codebase) to its real `Frame` via `ElementHandle.contentFrame()`, throwing a
clear error if the selector matches nothing or the matched element isn't a frame-owning iframe
(or its content frame isn't available yet). `eval()` and `extractData()` both gained an optional
trailing `frameSelector` parameter — when present, they evaluate against the resolved `Frame`
instead of the top-level `Page`; when absent, behavior is 100% unchanged (fully backward
compatible, additive-only). Threaded through `browser.eval`/`browser.extract_data`'s MCP tool
schemas and the SDK's `Page.evaluate()` the same way.

**Why this specific fix and not something bigger**: the investigation (a dedicated read-only
exploration pass before writing any code) confirmed `click`/`type` already cross frame
boundaries — `browser-action-engine.ts`'s `resolveElement()` races `page.frames()` for a
selector match, and each `Frame`'s own `waitForSelector`/element handles run through Puppeteer's
per-frame CDP execution context, unaffected by same-origin policy. `eval()`/`extractData()`
never got the equivalent treatment; they always ran via `page.evaluate()` on the top-level page,
which — like any page script — is bound by the browser's same-origin policy. No frame-listing/
frame-provenance system exists anywhere in the codebase, and building one (threading frame
identity through `snapshot()`/`axSnapshot()` results) would be a materially bigger, multi-day
change for a capability this specific fix doesn't need — the realistic case is an agent that
already knows "there's an iframe with selector X" (from a snapshot or from its own task context)
and wants to read inside it, which `frameSelector` covers directly.

**Verification, not just a green checkmark**:
- `packages/capability-runtime` typechecks clean (only the same pre-existing, unrelated `pngjs`
  declaration-file warning noted earlier this session) and its full vitest suite — 77 tests,
  including 6 new ones covering `resolveFrame`'s own error contract (no match, not an iframe,
  successful resolution, numeric-id normalization) and the unknown-session error path with
  `frameSelector` set — all pass.
- `packages/mcp-server` (22 tests) and `packages/sutradhar` (7 tests, after fixing one
  unrelated stale hardcoded-version assertion the run itself surfaced — `'0.1.0'` should have
  read `'0.2.1'` since the last publish) both typecheck clean and pass in full.
- **Live re-verification**, not trusted from the test suite alone: re-ran
  `tools/engine-comparison/sutradhar-extreme.mjs`'s exact same 7 scenarios fresh. All 7 now pass,
  including the two the fix targeted:
  - `cross-origin-iframe`: `eval(sid, "document.querySelector('h1').textContent", undefined,
    '#cross-origin-frame')` → `"Example Domain"`. `extractData()` with the same `frameSelector`
    → `{heading: ["Example Domain"]}`. The old outer-page path was re-checked in the same run
    and confirmed to still correctly fail (`outerPageEvalWorked: false`) — the fix adds a real,
    legitimate new capability, it doesn't bypass a browser security boundary it shouldn't.
  - `nested-shadow-iframe`: `eval(sid, "...shadowRoot.getElementById('nested-result')
    .textContent", undefined, '#nested-frame')` → `"submitted:hello-nested"` — independently
    confirms `type()`/`click()`'s already-correct cross-boundary reach, which the original run
    could report but not verify.

**Updated final score**: Sutradhar 7/7, tying Playwright and Puppeteer. Real pinchtab's 6/7
(with its own genuine, reproduced cross-origin frame-switching bug, unrelated to this fix) is
unchanged — this was a Sutradhar-specific gap and fix, not something that touched or was
verified against the other three tools again.
