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
| File upload | untested | `browser.upload_file`/`upload_file_via_trigger` exist; never dogfooded. |
| iframes / cross-frame interaction (incl. dynamically-injected, cross-origin) | covered | Milestone 1: verified directly against the runtime — `snapshot`/`click` correctly traverse into a cross-origin iframe injected into the page *after* initial load (the hardest realistic case — matches real chat-widget/payment-iframe behavior). Works correctly today. See the MCP-staleness note below — the first attempt via MCP tools falsely reported this as broken. |
| Shadow DOM | untested | `dom-semantic-engine.ts` has a shadow-piercing pattern reused elsewhere; never dogfooded. |
| PDF handling (export + encountering one mid-browse) | partial | `browser.export_pdf` exists; reading/interacting with a PDF opened by navigation is untested. |
| Real-time/streaming pages (continuous background DOM churn) | partial | Milestone 1: grounding survives ongoing unrelated DOM churn elsewhere on the page (a simulated live-feed stream, numeric id captured then acted on ~8 re-renders later — still hit the right element). True WebSocket/SSE-driven pages and the harder "target itself gets destroyed and id gets reused" case remain untested. |
| Media (video/audio/canvas) | untested | |
| Mobile/device emulation | untested | `browser.set_viewport`/`emulate` exist; never dogfooded. |
| Auth/session persistence across runs | partial | CLI has `profile create/list/delete` (cookies/storage survive across launches); never dogfooded against a real login flow. |
| Network conditions (slow/offline/throttled) | untested | No obvious tool for this yet — check if Puppeteer's CDP network-emulation is exposed. |
| Large-scale extraction / pagination | untested | |
| JS framework diversity beyond React | partial | Only tested against a React app (TodoMVC, the dashboard itself). Vue/Angular/Svelte/vanilla untested. |
| CAPTCHA / bot-detection / stealth evasion | excluded | Deliberately out of scope per CLAUDE.md — not a gap to close. |

## Known blocker: the connected MCP session is stale, and this already caused a false positive

The MCP session connected in this environment predates several rebuilds this session — its
tool list is missing newer tools (`hover`, `download_file`, `ax_snapshot`, `focus_tab`, and
more), and in Milestone 1 it produced an outright **false bug report**: testing iframe
interaction through it made cross-origin iframe support look broken, when the real, current
source handles it correctly. Diagnosed by bypassing MCP entirely and calling
`SutradharRuntime` directly via a throwaway Node script.

**Until the MCP session is reconnected**, prefer direct-runtime scripting (import
`SutradharRuntime` from `packages/capability-runtime/dist/index.js`, call its methods
directly) over the `mcp__pinchtab__*` tools for verification — it's proven reliable this
session where the MCP path gave a false negative. Re-verify anything the stale MCP session
reported as broken once a fresh session is available, rather than trusting that finding.

## Iteration log

Append-only. Newest first.

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

**Milestone 1: DONE** (2026-08-13) — see iteration log above.

**Proposed Milestone 2** (not started, pending user checkpoint per CLAUDE.md): file upload,
auth/session persistence against a real login flow, mobile/device emulation, and PDF handling
— the next batch of `untested`/`partial` rows in the taxonomy above.
