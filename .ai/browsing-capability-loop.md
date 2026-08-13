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
| Large-scale extraction / pagination | untested | |
| JS framework diversity beyond React | covered | Milestone 3: real TodoMVC implementations in Vue, Angular, and Svelte — add-todo, snapshot, and DOM-state verification all worked correctly in each, matching the earlier React result. Grounding operates on the rendered DOM, not framework internals, so this is expected but now actually confirmed rather than assumed. |
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

**Proposed Milestone 7** (not started, pending user checkpoint per CLAUDE.md): confirm the
corrected `hasTouch` fix live once reconnected. Beyond that, the loop has covered enough
ground that further milestones should probably be driven by real work as it comes up, rather
than continuing to manufacture test scenarios — matches the project's own "dogfood on real
work, not synthetic tests" principle. Also worth internalizing going forward, independent of
this specific tool: **default direct-runtime verification to "provisional" and actively seek
a live MCP round-trip before calling any fix fully closed** — Milestone 6 is a concrete,
repeatable reason why.
