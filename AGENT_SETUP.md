# Sutradhar — setup & usage guide for AI coding agents

Copy this file into any project (as `SUTRADHAR.md`, appended into an existing `CLAUDE.md` /
`AGENTS.md`, or just referenced directly) so an AI coding agent working in that project knows
what Sutradhar is, what it can do, and exactly how to set it up. Nothing in this document
assumes you're working inside Sutradhar's own repo — it's written for **any project** that
wants to use it.

## What this is

Sutradhar is a real browser-automation tool built for AI agents: it drives an actual Chrome/Edge
browser and exposes it through a Model Context Protocol (MCP) server, a terminal CLI, and a
Node SDK — one npm package, three ways in. Its core feature is **agent-oriented grounding**: an
LLM driving it doesn't parse raw HTML or guess at pixel coordinates, it reads a compact,
LLM-optimized listing of interactive elements and acts on those directly.

Published as [`sutradhar`](https://www.npmjs.com/package/sutradhar) on npm. Requires **Node.js
≥ 18** and a **Chrome or Edge** install (auto-detected; set `CHROME_PATH` if it isn't found).

## Setup — MCP server (the primary, recommended way in)

This is what lets Claude Code (or Claude Desktop, Cline, or any other MCP-compatible client)
drive a real browser directly.

**Claude Code:**

```bash
claude mcp add sutradhar -- npx -y --package=sutradhar sutradhar-mcp
```

**Any MCP client that takes a server map** (Claude Desktop's `claude_desktop_config.json`,
a project's `.mcp.json`, etc.):

```json
{
  "mcpServers": {
    "sutradhar": {
      "command": "npx",
      "args": ["-y", "--package=sutradhar", "sutradhar-mcp"]
    }
  }
}
```

**`--package=sutradhar` is required, not optional.** `sutradhar-mcp` is the name of a *binary
inside* the `sutradhar` package, not a separately published package — a bare `npx sutradhar-mcp`
will try to install a package that doesn't exist and fail. This exact syntax was verified live
against the real published registry package before being written down here.

No local build, no repo checkout — `npx` fetches the published package on first use.

## What you can do with it

Once connected, you get `browser.*` tools (the host AI — you — is the brain, driving the
browser directly) and, if a separate LLM provider is configured for it, one `agent.runGoal`
tool (Sutradhar's own autonomous loop takes a natural-language goal and drives itself — most
agent setups won't need this; `browser.*` is the normal path and needs no LLM provider config
at all since you already are one).

68 `browser.*` tools, grouped by what they do:

| Category | Tools | What they're for |
|---|---|---|
| **Lifecycle** | `health`, `launch`, `attach`, `shutdown`, `shutdown_all` | Start/stop a session. `attach` connects to an already-running Chrome over CDP instead of launching a new one. |
| **Navigation** | `navigate`, `go_back`, `go_forward`, `reload` | Standard page navigation. |
| **Agent vision** | `snapshot`, `ax_snapshot` | **Read the page.** See the grounding section below — this is the most important pair of tools here. |
| **Interaction** | `click`, `click_by_text`, `click_by_role`, `right_click`, `type`, `type_by_label`, `press_key`, `hover`, `scroll`, `select_option`/`select_options`, `drag_and_drop`, `touch_tap`, `upload_file`, `upload_file_via_trigger`, `download_file`, `wait_for_selector`, `fill_form`, `click_at_point`, `drag_at_points` | Act on the page. `fill_form` does a whole form in one call. `click_at_point`/`drag_at_points` are the escape hatch for canvas/custom-rendered UI with nothing addressable via DOM. |
| **Capture & extraction** | `screenshot`, `export_pdf`, `eval`, `extract_data` | Get data out. `extract_data` takes a field-name → CSS-selector map and returns real matched values — prefer this over eyeballing a screenshot for anything you need to assert on. Both `eval` and `extract_data` accept an optional `frameSelector` (a CSS selector or snapshot `[#id]` for an `<iframe>` element) to read inside that frame instead of the top-level page — including a genuinely cross-origin one. |
| **Storage** | `get_cookies`/`set_cookie`/`delete_cookie`, `get_local_storage`/`set_local_storage_item`/`clear_local_storage`, `get_session_storage`/`set_session_storage_item`/`clear_session_storage`, `get_storage_state`/`set_storage_state` | Cookie/storage read-write. The `storage_state` pair is a single-blob export/import of all three at once — the way to log in once and reuse that session later. |
| **Emulation & permissions** | `set_geolocation`, `grant_permissions`, `set_viewport`, `emulate`, `get_clipboard`/`set_clipboard`, `set_network_conditions` | Geolocation, camera/clipboard/notification permissions, viewport/mobile emulation, timezone/locale/color-scheme, throttled or offline network. |
| **Dialogs, observability & network** | `get_pending_dialog`/`handle_dialog`, `get_console_logs`, `get_page_errors`, `get_network_log`, `get_action_history`, `route`/`clear_routes` | Handle native `alert`/`confirm`/`prompt` dialogs, and — importantly — **check what actually happened**: console output, uncaught JS errors, real network requests/responses. Don't call a flow verified without checking these. |
| **Tabs** | `list_tabs`, `new_tab`, `focus_tab`, `close_tab`, `lock_tab`/`unlock_tab`/`get_tab_lock` | Multi-tab handling. The lock tools are an advisory owner+TTL mechanism if multiple concurrent callers need to coordinate driving the same session. |
| **Autonomous agent** | `agent.runGoal` | Optional. Hands a natural-language goal to Sutradhar's own loop. Only registered if an LLM provider (Ollama or an OpenRouter key) is separately configured for the server. |

## Grounding: `snapshot` vs `ax_snapshot` — read this before driving anything

- **`browser.snapshot`** — DOM-attribute grounding. Returns a compact interactive-element
  listing (numeric `[#id]`, backed by a stamped `data-sd-node-id`) plus page text. Fast, and
  fine for static pages — but the `[#id]`s are a snapshot of the DOM at that instant, and can
  go stale if the page re-renders (a React/Vue update, a list re-sorting) before you act on it.
- **`browser.ax_snapshot`** — accessibility-tree grounding (role + accessible name). No ids to
  go stale, since `click_by_role`/`click_by_text` re-resolve the real element at the moment
  they run rather than trusting a stored id. **Prefer this for anything that re-renders
  itself** — SPAs, live search, infinite scroll, optimistic UI.

Rule of thumb: static content page → `snapshot` + `click`/`type` is fine and cheaper.
Anything dynamic → `ax_snapshot` + `click_by_role`/`click_by_text`/`type_by_label`.

## Other ways in

**CLI** (no scripting, one-shot terminal commands):

```bash
npx --package=sutradhar sutradhar nav https://example.com
npx --package=sutradhar sutradhar snap
npx --package=sutradhar sutradhar click 7
npx --package=sutradhar sutradhar audit https://example.com     # screenshot + console/network/a11y + Core Web Vitals
npx --package=sutradhar sutradhar compare urlA urlB --fail-on-diff   # visual regression, CI-gateable
npx --package=sutradhar sutradhar doctor    # environment diagnostics
```

Or `npm install -g sutradhar` once, then drop the `npx --package=sutradhar` prefix and just
run `sutradhar <command>`. Sessions persist across separate CLI invocations, scoped
automatically to the calling directory (`~/.sutradhar-cli/<hash-of-cwd>/state.json`) so two
projects run in parallel don't share a browser — run `sutradhar close` when done. `sutradhar profile create
<name>` gives you a persistent, named profile (cookies/login survive across runs); `sutradhar
profile export-state`/`import-state` turns that into a portable file you can pre-bake into a
different profile without ever logging in there directly.

The example commands above aren't the full CLI — it also has `select`/`wait`/`eval`/`hover`/
`scroll`/`upload`/`drag`/`download`, coordinate-only `clickpoint`/`dragpoints` (for
canvas-rendered UI with nothing DOM-addressable), tab management (`tabs`/`newtab`/`focustab`/
`closetab`), clipboard + permissions (`grant`/`setclipboard`/`getclipboard`), an
`audit --baseline <url>` one-command regression gate, a `--settle` flag for `click`/`type`/
`scroll` (waits for the page to stop actively changing before returning), a `--modifiers` flag
for `press` (hold modifier keys, e.g. Ctrl+Shift+ArrowRight to select a word),
`--no-text`/`--ids-only`/`--scan-listeners` flags for `snap`, and an `--allowlist-domains`
navigation guardrail. Run `sutradhar` with no arguments for the complete, current command and
flag list straight from the binary — that's the authoritative reference, not this file.

**Node SDK** (drive a browser from your own code):

```bash
npm install sutradhar
```

```ts
import { launch } from 'sutradhar';

const browser = await launch();
const page = await browser.newPage();
await page.goto('https://example.com');
const snap = await page.snapshot();
await page.click('7');
await browser.close();
```

## Using Sutradhar for UAT / acceptance testing

If you're using this to acceptance-test a real running webapp (a PR, a branch, a feature before
it ships), the pattern that actually holds up is:

1. Get the target app running (its own dev-server command — build/start it the normal way for
   that project).
2. Drive each scenario via `browser.*`, preferring `ax_snapshot` for anything dynamic.
3. **After every meaningful action, check `browser.get_console_logs` and
   `browser.get_page_errors`** — a flow that visually completes with a swallowed JS exception
   underneath is exactly the kind of bug a naive click-through misses. Check
   `browser.get_network_log` for the specific request the action should have triggered, not
   just that something fired.
4. Assert on real extracted values (`browser.extract_data`/`browser.eval`), not a screenshot
   you're eyeballing.
5. Score each scenario **Pass** (real evidence confirms the criterion), **Fail** (name the exact
   break with evidence), or **Blocked** (something outside the app under test stopped it) — never
   round an ambiguous result up to Pass.
6. Never auto-commit changes or reports to the target repo without asking first.

## Known limitations — stated honestly

- **No stealth or bot-detection evasion, by design.** Sutradhar launches a plain, undisguised
  browser. Real anti-bot walls (Cloudflare challenges, CAPTCHAs, hard IP-level denies) will
  block it exactly the way they'd block any other automation tool run the same way — this was
  directly measured and confirmed, not assumed, across real benchmark runs against real sites.
- **`agent.runGoal` needs its own LLM provider** (Ollama running locally, or an OpenRouter API
  key) configured separately for the server — the `browser.*` tools need none of that, since the
  calling AI is already the brain.
- Chrome/Edge only, driven locally — no built-in remote/cloud-browser execution.
- **A headed Chrome window will never visually shrink narrower than ~516px wide**, no matter what
  viewport/window-size is requested — Chromium enforces this floor at the OS-window level and it
  can't be overridden via CDP by Sutradhar or any other CDP-based tool (confirmed empirically:
  requesting 500px silently clamped to 516px; there's no equivalent floor on height). This is
  purely cosmetic — `window.innerWidth`/`innerHeight`/`devicePixelRatio` inside the page (what
  real layout code reads) are set correctly and unaffected, and `page.screenshot()` captures only
  the content viewport, not the OS window — only the visible on-screen window keeps a margin
  below the floor. If a headed session genuinely needs to *look* narrower than 516px on screen,
  draw the page into a canvas/iframe at the target size instead of resizing the real window — the
  same pattern Chrome DevTools' own "Responsive" device-toolbar mode uses.
- **A script holding an open `attach()`/`launch()` session never exits on its own** — the CDP
  WebSocket connection keeps Node's event loop alive indefinitely. Always call `browser.close()`
  (or `runtime.shutdown()`, or `process.exit(0)` if the browser should keep running detached) at
  the end of a one-shot script, or it will sit there as an invisible live process forever. This is
  also the main reason orphaned Chrome processes accumulate — see the previous point about
  `launch()` now warning when a prior session isn't closed.

## License

Published under the **Functional Source License 1.1, Apache-2.0 future grant**
(`FSL-1.1-ALv2`). Free to use for your own projects, internal tooling, and professional
services — the one restriction is offering Sutradhar itself, or a substitute for it, as a
competing commercial product or service. Each version converts automatically to the fully
permissive Apache License 2.0 two years after its release.

## Troubleshooting

- **`npx sutradhar-mcp` fails / "package not found"** — you need `--package=sutradhar` before
  the bin name; see the setup section above.
- **"No real browser available" / Chrome not found** — set the `CHROME_PATH` environment
  variable to your Chrome or Edge executable.
- **A click/action seems to silently no-op or targets the wrong element** — you're probably
  hitting a stale `[#id]` from `browser.snapshot` on a page that re-rendered; switch to
  `browser.ax_snapshot` + `click_by_role`/`click_by_text` for that flow.
