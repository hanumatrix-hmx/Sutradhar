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
| DOM-attribute grounding (`data-sd-node-id`) under re-render | partial | Survived 2 independent real re-render tests (TodoMVC filter round-trip; a continuous-stream sibling-churn test). Id-reuse-after-*deletion* specifically still untested (attempted in Milestone 1, blocked by an unrelated test-script bug, not chased further). |
| Accessibility-tree grounding (`axSnapshot`) | untested | Exists, documented as the recommended default for re-rendering pages, never actually exercised live. |
| Hover / `:hover`-revealed UI | partial | `browser.hover` exists in source and works when called directly against the runtime; confirmed synthetic `mouseover` does NOT trigger real `:hover` (must use the real tool). |
| Multi-tab workflows | covered | Milestone 1: created a background tab via `new_tab`, navigated/snapshotted/clicked it independently via `tabId`, confirmed the original tab was completely unaffected. Works correctly. |
| File download | covered | Milestone 1: `runtime.downloadFile` verified end-to-end — real file landed on disk at the expected path with correct content (read back and checked, not just a success flag). |
| File upload | covered | Milestone 2: `browser.upload_file` against a real fixture page (the-internet.herokuapp.com/upload) — set a file input, clicked Upload, confirmed via the server's own response page ("File Uploaded! upload-test.txt") that it actually landed server-side, not just a client-side success flag. |
| iframes / cross-frame interaction (incl. dynamically-injected, cross-origin) | covered | Milestone 1: verified directly against the runtime — `snapshot`/`click` correctly traverse into a cross-origin iframe injected into the page *after* initial load (the hardest realistic case — matches real chat-widget/payment-iframe behavior). Works correctly today. |
| Shadow DOM | covered (open); closed is a known, reasonable limitation | Milestone 3: an injected open shadow root's button was correctly listed by `snapshot` and correctly clicked (verified via the real click handler firing). A *closed* shadow root's content is invisible to both — expected: `mode:'closed'` blocks even `evaluate()`-level JS access by design, and closed shadow roots are rare in practice since most real widgets use open ones. Not treated as a gap worth chasing. |
| PDF handling: export | covered | `browser.export_pdf` verified — returns real, valid `%PDF-1.4` content for the current page. |
| PDF handling: reading one encountered mid-browse | gap found, logged (`PROB-009`) | Navigating directly to a `.pdf` URL correctly enumerates Chrome's native PDF-viewer toolbar via `snapshot`, but `pageText` comes back completely empty even against a PDF with real (compressed) text content. Not fixed — needs real PDF text-layer extraction, nontrivial scope. |
| Real-time/streaming pages (continuous background DOM churn) | partial | Milestone 1: grounding survives ongoing unrelated DOM churn elsewhere on the page (a simulated live-feed stream, numeric id captured then acted on ~8 re-renders later — still hit the right element). True WebSocket/SSE-driven pages and the harder "target itself gets destroyed and id gets reused" case remain untested. |
| Media (video/audio/canvas) | covered | Milestone 3: native `<video controls>` UI is not exposed via `snapshot` (expected — UA-internal shadow DOM; the correct control path is the JS media API, not clicking browser chrome). `video.play()`/`.pause()`/state inspection via `eval` works correctly against a real, well-formed video. One specific external test file failed with a genuine format/codec error (`MEDIA_ELEMENT_ERROR`) — confirmed to be that file's problem, not Sutradhar's, by successfully loading a different real video right after. Canvas: `browser.click`'s `offset` param verified pixel-accurate against a hand-drawn canvas region (239,119 landed correctly inside a 200-280×100-140 target). |
| Mobile/device emulation | covered, 1 bug fixed | Milestone 2: `set_viewport`'s width/height/deviceScaleFactor/media-query emulation all verified correct against a real site (github.com). Found and fixed a real gap: `isMobile:true` didn't enable touch (`ontouchstart`) since `hasTouch` was never passed to Puppeteer — real mobile devices always have touch. Fixed by defaulting `hasTouch` to `isMobile`'s value, overridable; verified all 3 cases (default-on, desktop-off, explicit-off) directly against the runtime. |
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

**Milestone 1: DONE. Milestone 2: DONE. Milestone 3: DONE** (all 2026-08-13) — see iteration
log above.

**Remaining untested rows in the taxonomy**: `axSnapshot` (never actually exercised live,
despite being the documented recommendation), the harder id-reuse-after-*deletion* grounding
case, true WebSocket/SSE-driven pages (vs. the background-churn case already covered), and
large-scale extraction/pagination.

**Standing item**: 3 fixes across Milestones 2–3 (double-header bug, `hasTouch` default,
network-conditions tool) are verified directly against the runtime but not yet confirmed
through an actual MCP round-trip — needs a reconnect to close that loop for real.

**Proposed Milestone 4** (not started, pending user checkpoint per CLAUDE.md): reconnect MCP
and re-verify the 3 pending fixes end-to-end, then `axSnapshot` live testing + the
id-reuse-after-deletion grounding case.
