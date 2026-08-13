---
State Category: Operational / Persistent
Machine Readable: true
Update Ownership: AI Agent
Freshness Expectation: Per Competitive Review
Update Policy: Append-driven (log), change-driven (comparison tables)
Last Updated: 2026-08-13
---

# Competitive benchmarks & positioning

See [CLAUDE.md](../CLAUDE.md): the goal is to be genuinely better than Playwright, Puppeteer,
the real `pinchtab/pinchtab`, and AI-company browser tools — not just bug-free. This doc holds
the researched landscape and real, sourced comparisons so "best" claims have evidence behind
them, not vibes.

## Agent-level benchmarks (require a real LLM driving the loop — currently blocked)

Researched 2026-08-13. The field has converged on a small set of standard benchmarks for
evaluating full browsing *agents* (not raw automation libraries):

- **WebArena** — 812 tasks on 5 live-website categories (e-commerce, forums, dev collab,
  content management). DOM-based, not visual.
- **Visual WebArena** — the visual-grounding sibling of WebArena, for screenshot-consuming
  agents (relevant for comparing against Anthropic Computer Use / OpenAI Operator, which are
  both screenshot-based).
- **OSWorld** — broader computer-use benchmark, not browser-specific. OpenAI Operator: 38.1%.
  Anthropic's Opus models: low-to-mid 80s on OSWorld-Verified (Opus 4.7 reported at 82.3%).
- **Web Bench** (Skyvern + Halluminate, 2026) — 5,750 tasks across 452 real top-1000 websites,
  split into read tasks (extraction) and write tasks (login, 2FA, forms, downloads) — the
  write-task split is exactly what this project's own loop has been testing manually
  (auth persistence, file upload/download, dialogs). Claude 4 leads read-heavy; Skyvern 2.0
  leads write-heavy, per the source.
- **Mind2Web / Online Mind2Web** — now considered historical/superseded per 2026 sources, but
  Online Mind2Web (300 tasks, 136 live sites, no cached pages) is still cited.
- **BrowserGym** (ServiceNow) — not a benchmark itself, a unified harness that runs the same
  agent code against WebArena/VisualWebArena/MiniWoB++/WorkArena/AssistantBench Live.

**Known scores for context** (WebArena): OpenAI Operator 58.1%; Anthropic reports SOTA
single-agent WebArena performance for Claude's computer-use implementation, outperforming
Operator on pure browser navigation specifically (per source below).

**Why none of these are runnable here**: every one of them scores an *agent* — something that
takes a natural-language goal and autonomously drives the browser via an LLM in the loop. In
Sutradhar's architecture that's `agent.runGoal`, which needs a real LLM provider (Ollama or
OpenRouter). This environment has neither (checked: no `ollama` binary, no
`OPENROUTER_API_KEY`, no response from `localhost:11434`). Not a code gap — a real external
dependency. Revisit once a provider is available; until then, no "we scored X% on WebArena"
claim can be made honestly.

## LLM-independent comparison: tool surface vs Microsoft's own Playwright MCP server

Playwright MCP (`microsoft/playwright-mcp`) is the most directly comparable reference point —
official, from the same company whose engine (Chromium via CDP) Sutradhar itself drives, and
explicitly designed for AI-agent tool use rather than test-authoring. Full tool list fetched
2026-08-13 from the project's own README.

**What Playwright MCP has that Sutradhar's 60-tool surface (at the time) didn't:**

| Their tool | Gap | Status |
|---|---|---|
| `browser_fill_form` | Bulk multi-field form fill in one call (Sutradhar only had single-field `type`/`type_by_label`) | **Fixed** — `browser.fill_form` |
| `browser_mouse_click_xy` (vision mode) | Free-form viewport-coordinate click with no element/selector at all — needed for canvas-heavy or custom-rendered UI with nothing addressable via DOM | **Fixed** — `browser.click_at_point`, verified pixel-exact |
| `browser_storage_state` / `browser_set_storage_state` | Single-blob export/import of all cookies+localStorage+sessionStorage — portable across machines, distinct from Sutradhar's per-item tools and from the CLI's directory-based named-profile mechanism | **Fixed** — `browser.get_storage_state`/`browser.set_storage_state`, verified: state exported from one session correctly restored a genuinely fresh, separate session's cookie + localStorage + sessionStorage |
| `browser_mouse_move_xy` / `drag_xy` / `wheel` (rest of vision mode) | Coordinate-based move/drag/scroll, beyond the click case just fixed | Not built — lower value than the click case (drag/move-by-coordinate has no clear real use case surfaced yet; logged, not chased reflexively) |
| `browser_resize`, `browser_wait_for`, `browser_navigate_back` | Sutradhar already covers these (`set_viewport`, `wait_for_selector`, `go_back`) | No gap |
| DevTools tools (tracing, video recording, highlight/annotate) | Testing/debugging aids, not core browsing capability — lower priority for an *agent* tool vs a *test-authoring* tool | Deliberately not prioritized |
| Testing assertion tools (`verify_element_visible` etc.) | Test-framework-specific, not relevant to autonomous browsing | Deliberately not prioritized |

**What Sutradhar has that Playwright MCP's list doesn't**: geolocation override, clipboard
get/set, network-condition throttling/offline emulation (built this loop, Milestone 3),
dual grounding (DOM-attribute *and* accessibility-tree, vs. their accessibility-tree-only
default + separate vision mode), `extract_data` (structured CSS-selector extraction),
`agent.runGoal` (an actual autonomous brain built into the tool itself — Playwright MCP is
purely host-driven, no equivalent).

**Notable positioning difference, not necessarily a gap**: Playwright MCP's *default*
`browser_snapshot` returns the accessibility tree — matching Sutradhar's `ax_snapshot`, not
its default `browser.snapshot` (DOM-attribute `data-sd-node-id` grounding). Sutradhar's own
tool description already steers callers toward `ax_snapshot` for frequently-re-rendering
pages, and this loop's own repeated stress-testing (Milestones 1 and 4) found the
DOM-attribute path holds up well under adversarial conditions. Not treated as an automatic
"copy the leader" gap — logged as a considered, evidence-based difference, not an oversight.

## Puppeteer (no official MCP server)

Puppeteer has no official MCP server, no accessibility-snapshot-based grounding, and (per
2026 comparisons) MCP wrappers built on top of it fall back to screenshots — the model reasons
visually rather than over structured elements, which is materially less token-efficient.
Sutradhar is already ahead of raw Puppeteer here by construction (semantic DOM/AX grounding is
the whole point of `capability-runtime`'s `DOMSemanticEngine`).

## Real `pinchtab/pinchtab` (Go project — the original name collision)

Covered in earlier comparison work this project did (see the [[pinchtab_vs_sutradhar]] context
in prior sessions — not re-litigated here). Known differentiator already documented: real
PinchTab has optional stealth/anti-detection (CloakBrowser) that Sutradhar deliberately
excludes per CLAUDE.md's scope boundary.

## Iteration log

Append-only. Newest first.

### 2026-08-13 — Established: researched the landscape, closed all 3 real gaps found

Researched agent-level benchmarks (confirmed all blocked on no LLM provider, not a code
issue) and did a precise, sourced tool-surface diff against Microsoft's own Playwright MCP
server. Found 3 real gaps; built and verified all three in one pass:

- **`browser.fill_form`** — bulk multi-field form fill (an object of `{target: value}` pairs,
  one call instead of N `type` round-trips), matching Playwright MCP's `browser_fill_form`.
  Verified live against a real 2-field login form (values confirmed via real DOM inspection);
  a deliberate partial-failure case correctly isolated the per-field error instead of failing
  the whole call.
- **`browser.click_at_point`** — click at an absolute viewport `(x, y)` with no element or
  selector at all, matching Playwright MCP's vision-mode `browser_mouse_click_xy`. Verified
  pixel-exact against a hand-drawn canvas target.
- **`browser.get_storage_state` / `browser.set_storage_state`** — single-blob export/import of
  cookies + localStorage + sessionStorage, matching Playwright MCP's `browser_storage_state`.
  Distinct from the existing per-item cookie/storage tools (bulk vs one-at-a-time) and from the
  CLI's directory-based named-profile mechanism (a portable blob vs a machine-local
  userDataDir). Verified live: state captured from one session correctly restored a
  genuinely fresh, separate session's cookie, localStorage, *and* sessionStorage together —
  confirmed empty before, confirmed populated after.

Not built: `browser_mouse_move_xy`/`drag_xy`/`wheel` (the rest of Playwright's vision-mode
suite beyond click) — no real use case has surfaced yet for coordinate-based move/drag/scroll
specifically, so not chasing feature parity for its own sake. Revisit if a real task needs it.
