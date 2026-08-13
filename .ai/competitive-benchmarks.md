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

## Puppeteer (official MCP server is dead)

Researched 2026-08-13, more precisely than before. Puppeteer has no accessibility-snapshot
grounding of its own, and — a stronger point than previously known — **the official
`@modelcontextprotocol/server-puppeteer` package has been deprecated and is no longer
supported.** What's left is a scatter of unofficial community forks (merajmehrabi,
code-craka, sultannaufal), none of them an official, actively-maintained option. Community
telemetry claims Puppeteer MCP (informally) enables 5–10x faster prototyping vs.
Selenium/WebDriver, which is a real baseline worth beating, but says nothing about
Puppeteer-vs-Sutradhar specifically. **Sutradhar is ahead here on two fronts, not one**: (1)
semantic DOM/AX grounding by construction (the whole point of `DOMSemanticEngine`) where raw
Puppeteer MCP wrappers fall back to screenshots, and (2) being an actively-maintained,
purpose-built MCP-native tool where Puppeteer's own official attempt was abandoned entirely.

## Real `pinchtab/pinchtab` (Go project — the original name collision)

Re-researched 2026-08-13 directly from the project's own GitHub (`pinchtab/pinchtab`,
`pinchtab.com`) rather than relying on an unspecified "earlier comparison" — more precise
findings:

- **Standalone 12MB Go binary**, HTTP API (not MCP-native itself, though there's a
  `skill/pinchtab/SKILL.md` for agent integration) — architecturally simpler/lighter than
  Sutradhar's Node/TypeScript monorepo, a real tradeoff (fewer deps, faster cold start) not
  worth chasing by rewriting languages.
- **Accessibility-tree-first by default**: "structured tree with stable refs (e0, e1...) ...
  optimized for AI agents (low token cost, fast)" — same positioning question already logged
  for Playwright MCP (their default matches our `ax_snapshot`, not our default
  `browser.snapshot`). Still not treated as an automatic gap — see that entry above.
- **Stealth injection, on by default (light level)**: patches `navigator.webdriver`, spoofs
  User-Agent, hides automation flags. Confirms the earlier documented differentiator.
  Deliberately excluded per CLAUDE.md's scope boundary — not revisited without the user
  explicitly reopening that decision.
- **Session/profile persistence**: "log in once via headed mode, then run headless" — Sutradhar
  already covers this via the CLI's named-profile mechanism (verified working, Milestone 2)
  plus the new portable storage-state blob (this milestone). No gap.
- **Multi-instance orchestration across containers/remote machines**: bigger infrastructure
  scope than a single-process tool; not chased — no evidence yet Sutradhar needs distributed
  orchestration specifically, and it's a materially larger undertaking than a tool-surface fix.
- **`POST /tab/lock` with owner + TTL — multi-agent tab-locking safety.** A real gap Sutradhar
  didn't have at all. **Fixed** — see iteration log.
- **Created February 2026, "rapid growth"**: confirms this is a real, actively-growing,
  independent project — the original rename rationale (avoiding a genuine collision, not a
  strawman) holds up under fresh scrutiny.

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

### 2026-08-13 — Researched Puppeteer + real pinchtab/pinchtab precisely, closed the tab-lock gap

Re-researched both directly from their own sources rather than an unspecified prior summary:

- **Puppeteer**: confirmed the official `@modelcontextprotocol/server-puppeteer` is deprecated
  and unsupported — only unofficial community forks remain. Strengthens Sutradhar's position
  (actively-maintained + semantic grounding, vs. an abandoned official attempt + screenshots).
- **Real `pinchtab/pinchtab`**: fetched from its own GitHub/site. Confirmed the stealth
  differentiator (already known, deliberately excluded). Found one genuinely new, real gap:
  **`POST /tab/lock`** — an owner+TTL advisory lock so multiple concurrent callers driving the
  same session can coordinate who's currently acting on a tab. Sutradhar had nothing like this.

**Built and verified `browser.lock_tab` / `browser.unlock_tab` / `browser.get_tab_lock`**,
matching real PinchTab's owner+TTL shape. Advisory only in this pass — full enforcement
(refusing `click`/`type`/etc. against a tab locked by a different caller) would mean threading
an `owner` identity through every one of the 20+ action methods, a materially bigger change
than this pass; logged, not built reflexively, per CLAUDE.md's own stated bar for what counts
as "small and scoped." Verified live against 9 distinct scenarios: initial-unlocked, acquire,
conflicting acquire (correctly refused), re-acquire/extend by the same owner, release attempt
by the wrong owner (correctly refused), release by the rightful owner, and TTL expiry (a
100ms-TTL lock correctly reported as gone after 200ms, and correctly acquirable by a new
owner at that point). All 9 behaved exactly as designed.

**Net result**: 1 new real capability built and fully verified (tab locking); Puppeteer and
real-PinchTab positioning now backed by fresh, direct-source research instead of a stale,
unlinked prior-session summary.
