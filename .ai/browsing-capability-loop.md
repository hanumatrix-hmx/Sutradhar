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
| DOM-attribute grounding (`data-sd-node-id`) under re-render | partial | Survived one real re-render test (TodoMVC filter round-trip). Id-reuse-after-deletion case still untested. |
| Accessibility-tree grounding (`axSnapshot`) | untested | Exists, documented as the recommended default for re-rendering pages, never actually exercised live. |
| Hover / `:hover`-revealed UI | partial | `browser.hover` exists in source; confirmed synthetic `mouseover` does NOT trigger real `:hover` (needs the real tool, not `eval`-based simulation). |
| Multi-tab workflows | untested | Tools exist (`new_tab`/`focus_tab`/`close_tab`/`list_tabs`); never dogfooded. |
| File download | untested | `browser.download_file` exists (with the Wave-8 path-containment fix); never dogfooded end-to-end. |
| File upload | untested | `browser.upload_file`/`upload_file_via_trigger` exist; never dogfooded. |
| iframes / cross-frame interaction | untested | `resolveElement` has main-frame-first + multi-frame fallback per earlier work; never dogfooded against a real embedded widget. |
| Shadow DOM | untested | `dom-semantic-engine.ts` has a shadow-piercing pattern reused elsewhere; never dogfooded. |
| PDF handling (export + encountering one mid-browse) | partial | `browser.export_pdf` exists; reading/interacting with a PDF opened by navigation is untested. |
| Real-time/streaming pages (WebSocket, SSE, live-updating UI) | untested | Does snapshot-based grounding cope with content that changes without a full re-render? |
| Media (video/audio/canvas) | untested | |
| Mobile/device emulation | untested | `browser.set_viewport`/`emulate` exist; never dogfooded. |
| Auth/session persistence across runs | partial | CLI has `profile create/list/delete` (cookies/storage survive across launches); never dogfooded against a real login flow. |
| Network conditions (slow/offline/throttled) | untested | No obvious tool for this yet — check if Puppeteer's CDP network-emulation is exposed. |
| Large-scale extraction / pagination | untested | |
| JS framework diversity beyond React | partial | Only tested against a React app (TodoMVC, the dashboard itself). Vue/Angular/Svelte/vanilla untested. |
| CAPTCHA / bot-detection / stealth evasion | excluded | Deliberately out of scope per CLAUDE.md — not a gap to close. |

## Iteration log

Append-only. Newest first.

### 2026-08-13 — Loop established (Milestone 0)

Set up `CLAUDE.md` and this doc per the user's request to make the find→fix→verify loop the
standing way of working, not a one-off. No capability work done yet in this entry — Milestone
1 (multi-tab, file download, iframe, real-time page) starts next, logged separately below as
it completes.

## Current milestone

**Milestone 1** (in progress): dogfood 4 categories not yet touched this session — multi-tab
workflow, file download end-to-end, iframe-embedded widget, real-time/streaming page. Fix
small real gaps found; log anything bigger instead of building it reflexively.
