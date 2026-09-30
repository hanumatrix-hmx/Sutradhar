# @sutradhar/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets any
MCP-compatible AI client (Claude Desktop, ZCode, Cline, custom agents) **drive a real
browser through Sutradhar** — and, optionally, hand control to Sutradhar's **own autonomous
agent** for multi-step goals.

Two brain modes, one server:

- **Browser tools** (`browser.*`) — the host AI is the brain. It calls `browser.snapshot`
  to read the page (an LLM-optimized listing of interactive elements), then `browser.click`
  / `browser.type` / … to act. Best when you want full control.
- **`agent.runGoal`** — Sutradhar's own agent loop is the brain. You pass a natural-language
  objective and it navigates, clicks, types, and extracts a final answer. Best for
  multi-step tasks you'd rather not script call-by-call. Requires an LLM provider.

## Tools (72: 71 `browser.*` plus `agent.runGoal`)

Grouped here by category, matching `tools.ts`'s own section layout. `agent.runGoal` is only registered when an LLM provider is configured, so without one the server exposes the 71 `browser.*` tools.

**`sessionId` is optional** on every tool that takes one (70 tools; none requires it). Omit it while exactly one session is live and that session is used (the result ends with a `sessionId omitted: used "<id>" ...` note); with zero or several live sessions the call fails and lists the live ids. It never guesses. `browser.launch`, `browser.attach` and `agent.runGoal` are the exception in meaning: their optional `sessionId` is the id to create or reuse, and omitting it always creates a new session. If your session was idle-reaped or crashed and you launched another, an omitted id uses the new one (the note says so).

**Selectors** are CSS, a snapshot `[#id]`, or Puppeteer's `pierce/`, `xpath/`, `aria/` and `text/` prefixes. Playwright syntax (`text=`, `role=`, `>>`, `:has-text()`, `getBy*()`) is rejected immediately with a hint; use `browser.click_by_text` / `click_by_role` / `type_by_label` instead.

### Reading results: `success` vs `verification`

Every action tool's JSON result has `success` (did the primitive run?) **and** `verification`
(`{verified, confidence, reason, evidence:{tier, checks[]}}`: was its effect observed?). Branch on
`evidence.tier`: `verified`, `contradicted` (a check ran and the effect did **not** happen; `success` is still
true), `unverifiable` (nothing could be checked; `reason` says why; not a failure), `low-confidence`,
`action-failed`. Confidence is fixed per tier (0.90 / 0.09 / 0.45 / as given / 0). `browser.navigate`, `go_back`,
`go_forward`, `reload`, `set_clipboard`, `get_clipboard` (`{text, verification}`), `upload_file_via_trigger`
(keeps `filePath`) and `click_at_point`/`drag_at_points` now report it too, and `browser.screenshot` returns the
image first and a small JSON block with `verification` second (a screenshot has no post-condition, so its tier is
`unverifiable` by design unless the capture isn't a valid PNG).

The 24 state-changing tools (`navigate`, `go_back`, `go_forward`, `reload`, `click`, `click_at_point`,
`drag_at_points`, `type`, `press_key`, `focus`, `scroll`, `hover`, `select_option`, `select_options`,
`wait_for_selector`, `click_by_text`, `click_by_role`, `type_by_label`, `upload_file`, `right_click`,
`drag_and_drop`, `touch_tap`, `download_file`, `upload_file_via_trigger`) accept an optional strict
`expect: {text?, url?, urlChanged?}` checked once right after the action: `text` is *rendered* text: laid out, `visibility:visible`, not under `display:none` / `content-visibility:hidden` / a closed `<details>`, and every enclosing `<iframe>` itself rendered and visible. `opacity:0`, `aria-hidden`, off-screen and clipped text still count ("rendered", not "perceivable") (any frame, open shadow roots; case-sensitive), `url` a substring of the final URL, `urlChanged`
true/false. A failed `expect` never fails the action: `success` stays true, `verified` is false, `tier` is
`contradicted` with a failing `expect.*` check. While a native dialog is open every result also carries
`dialogPending: {type, message, defaultValue, url}`.

Every tool that interacts with or navigates the page also accepts an opt-in `settle` (`true`, or `{mutationQuietMs?, networkIdleMs?, timeoutMs?}`): after the action it waits for the DOM to stop changing and the network to go idle (5 s overall bound, also when the action opened a native dialog), before `expect` is checked. That is `navigate`, `go_back`, `go_forward`, `reload`, `click`, `click_at_point`, `drag_at_points`, `type`, `press_key`, `focus`, `scroll`, `hover`, `select_option`, `select_options`, `click_by_text`, `click_by_role`, `type_by_label`, `fill_form` (once, after the last field), `upload_file`, `upload_file_via_trigger`, `right_click`, `drag_and_drop`, `touch_tap`, `download_file` and `handle_dialog`. It cannot see a timer the page scheduled for later: use `browser.wait_for` to wait for a specific result.

### Lifecycle
| Tool | Description |
|---|---|
| `browser.health` | Preflight check — is a real browser available, without committing to a session. |
| `browser.launch` | Launch a browser session; returns a `sessionId`. Other tools accept it, and it may be omitted while exactly one session is live. |
| `browser.attach` | Attach to an existing browser over CDP instead of launching a new one (e.g. your own Chrome with `--remote-debugging-port`). |
| `browser.shutdown` | Shut down a session. |
| `browser.shutdown_all` | Shut down every session. |

### Navigation
| Tool | Description |
|---|---|
| `browser.navigate` | Navigate a tab to a URL. |
| `browser.go_back` / `go_forward` | History navigation. |
| `browser.reload` | Reload the current page. |

### Agent vision
| Tool | Description |
|---|---|
| `browser.snapshot` | **DOM-attribute grounding** — interactive-element listing (numeric `[#id]`, `data-sd-node-id`-backed) + page text. Fast; can go stale if the page re-renders between snapshot and action. Elements inside an iframe read `[#31 in iframe "pay" (url)]`, elements inside an open shadow root end with `(shadow: host)`, and a frame that could not be read is listed as `[iframe <origin> — not inspectable] (reason)` instead of being dropped (match `^[#(d+)` when parsing). |
| `browser.ax_snapshot` | **Accessibility-tree grounding** — role + accessible-name listing, no ids to go stale. Prefer this for pages that re-render (SPAs, live search, infinite scroll). Iframe content (including cross-origin) is included, grouped under `[iframe ...]` lines. |

### Interaction
| Tool | Description |
|---|---|
| `browser.click` | Click by CSS selector or `[#id]` from a snapshot. |
| `browser.click_by_text` | Click the element containing this text (pairs with `ax_snapshot`). |
| `browser.click_by_role` | Click by accessibility role, optionally narrowed by name (pairs with `ax_snapshot`). |
| `browser.right_click` | Right-click (context menu) an element. |
| `browser.type` | Type into an input (selector or `[#id]`). |
| `browser.type_by_label` | Type into an input identified by its associated label text. |
| `browser.press_key` | Press a key (Enter, Escape, …). |
| `browser.focus` | Focus an element via the real DOM `.focus()` method — unlike `click`, doesn't move/collapse an existing text cursor or selection; use before a `press_key` that's part of a multi-step keyboard sequence (e.g. Home, then Ctrl+Shift+Right to select a word). |
| `browser.hover` | Hover the mouse over an element, optionally at a specific point within it — required for `:hover`-revealed controls (a real CSS `:hover` state, not simulable via a synthetic `mouseover` event). |
| `browser.scroll` | Scroll up/down/top/bottom. |
| `browser.select_option` / `select_options` | Set a `<select>`'s value (single or multi-select). |
| `browser.drag_and_drop` | Drag from one element to another. |
| `browser.touch_tap` | Simulate a touch tap (mobile emulation). |
| `browser.upload_file` | Set a file input's value. |
| `browser.upload_file_via_trigger` | For JS-triggered file choosers not backed by a plain `<input type=file>` — races `waitForFileChooser()` against clicking the triggering selector. |
| `browser.download_file` | Trigger and wait for a file download; saves under an allow-listed directory (`SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`) and returns the file's real absolute path. A second overlapping `download_file` on the same browser is refused immediately; run one download per browser at a time (see [Known limitations](#known-limitations)). |
| `browser.wait_for_selector` | Wait for an element to reach a state: `visible` (default), `attached` (just in the DOM), or `hidden` (removed or not visible). "Visible" is a non-empty box AND visibility not hidden/collapse, checked on the FIRST match — `opacity:0`/off-screen still count as visible; zero-size/`display:none`/`visibility:hidden` count as hidden. `hidden` succeeds immediately if nothing matches. `timeoutMs` is per attempt; retries can extend the real total wait. `timeoutMs <= 0` checks the current state once, immediately, with no waiting or retrying. Waiting states poll roughly every 100ms, so a state that's only true for less than ~100ms (a fast visibility flicker) may be missed. |
| `browser.wait_for` | Wait until a page condition is true instead of sleeping: `text` (rendered text, the same rule and code as `expect.text`, so the same documented limits (best effort: text inside never-painted SVG containers counts; visible text split across inline-block items or inside a `<textarea>` can be missed)), `textGone` (that text is absent from every frame; met at once if it was never there, so check `output.presentAtStart`; a frame that could not be inspected is never read as gone), `url` (substring of the tab URL, `pushState`/hash included), `js` (a JavaScript EXPRESSION run in the main frame, truthy = done, side-effect free, a throw fails the wait). Several conditions must ALL hold at once. Polls from outside the page every ~100 ms, so it works in a background tab and on a strict-CSP page. `timeoutMs` defaults to 10000 (max 300000, `0` = check once) and is the real total: no hidden retries; on a frozen page a failed wait can spend up to 1.5 s more reading the page title, so the total is bounded but can exceed `timeoutMs` by up to about 3 s. Text visible for less than one poll interval (about 100 ms) can be missed; use it for states that persist. A native dialog blocking the page fails it: a dialog already open fails the wait in about 1 s; one that opens partway through a check can take up to about 2.7 s after it opens. `settle` on an action only waits for DOM/network quiet and cannot see a pending timer; `expect` checks once and never waits. |
| `browser.fill_form` | Bulk multi-field form fill — an object of `{target: value}` pairs in one call instead of N `type` round-trips; a field that fails doesn't stop the rest. |
| `browser.click_at_point` | Click a raw viewport `(x, y)` coordinate with no element/selector at all — the escape hatch for canvas-heavy or custom-rendered UI with nothing addressable via DOM. |
| `browser.drag_at_points` | Coordinate-only mouse-down → move → mouse-up drag, the drag sibling of `click_at_point` (distinct from `drag_and_drop`'s element-to-element HTML5 `DataTransfer` API). |

### Capture & extraction
| Tool | Description |
|---|---|
| `browser.screenshot` | Full-page PNG (returned inline). |
| `browser.audit` | Page audit as a machine-readable JSON report (`schemaVersion` 1: console/page errors, HTTP 4xx/5xx requests, five heuristic a11y checks, LCP/CLS/FCP/TTFB) returned first, then the full-page screenshot and (with `baselineUrl`) a diff image inline; `includeImages: false` omits the images. Pass `url` for full coverage — auditing the current page as-is only sees activity since this server attached (`observation.coversWholeDocument`). Findings never set `isError`. See [Known limitations](#known-limitations). |
| `browser.export_pdf` | Export the current page as PDF. |
| `browser.eval` | Evaluate arbitrary JS in the page. Optional `frameSelector` runs it inside a specific `<iframe>` instead — including a genuinely cross-origin one. |
| `browser.extract_data` | Structured extraction: field name → selector map. With no `attribute`, form controls return their **live** current value and other elements return rendered `innerText`; `attr:<name>` reads the raw HTML attribute; `visibleOnly` (whole call or per field) drops non-visible matches. Optional `frameSelector` extracts from inside a specific `<iframe>` instead — including a genuinely cross-origin one. |

### Storage
| Tool | Description |
|---|---|
| `browser.get_cookies` / `set_cookie` / `delete_cookie` | Cookie read/write/delete. |
| `browser.get_local_storage` / `set_local_storage_item` / `clear_local_storage` | `localStorage` read/write/clear. |
| `browser.get_session_storage` / `set_session_storage_item` / `clear_session_storage` | `sessionStorage` read/write/clear. |
| `browser.get_storage_state` / `set_storage_state` | Single-blob export/import of cookies + localStorage + sessionStorage together — portable across sessions/machines, distinct from the per-item tools above. |

### Emulation & permissions
| Tool | Description |
|---|---|
| `browser.set_geolocation` | Override the page's geolocation. |
| `browser.grant_permissions` | Grant browser permissions (camera, clipboard, notifications, …). |
| `browser.set_viewport` / `get_viewport` | Set viewport size / mobile emulation / device scale factor, and read back the metrics actually in effect. |
| `browser.emulate` | Timezone, locale, color-scheme, and reduced-motion emulation. |
| `browser.get_clipboard` / `set_clipboard` | Read/write the system clipboard (via the Clipboard API). |
| `browser.set_network_conditions` | Emulate offline mode or throttled bandwidth/latency (DevTools presets or custom values). |

### Dialogs, observability & network
| Tool | Description |
|---|---|
| `browser.get_pending_dialog` / `handle_dialog` | Inspect and accept/dismiss an open `alert`/`confirm`/`prompt`. Left unhandled, a dialog is auto-dismissed after 30 s. |
| `browser.get_console_logs` | Read captured `console.*` output for the page. |
| `browser.get_page_errors` | Read captured uncaught page errors. |
| `browser.get_network_log` | Read captured network requests/responses. |
| `browser.get_action_history` | Read the action history: navigate, eval, back/forward/reload, the point actions, clipboard (length only), trigger-upload, `wait_for` and every element action, each with target/selector, success/error, the page URL afterwards (query/fragment dropped) and its `verification`. `scope:"session"` merges every tab (each entry has `tabId` and `seq`, including closed tabs); the default `scope:"tab"` is one tab. Bounded to 200 entries: `evicted` says exactly how many older ones were dropped. eval code is a 200-character preview and its result is never stored. Lives in the server process only. |
| `browser.route` / `clear_routes` | Intercept/mock network requests by pattern; clear interception rules. |

### Tabs
| Tool | Description |
|---|---|
| `browser.list_tabs` | List tabs in a session. |
| `browser.new_tab` | Open a new tab. |
| `browser.focus_tab` | Make a tab the active one. |
| `browser.close_tab` | Close a tab. |
| `browser.lock_tab` / `browser.unlock_tab` / `browser.get_tab_lock` | Advisory owner+TTL lock so multiple concurrent callers driving the same session can coordinate who's currently acting on a tab. |

### Autonomous agent (optional — requires an LLM provider)
| Tool | Description |
|---|---|
| `agent.runGoal` | Hand a natural-language goal to Sutradhar's own observe→reason→act→verify loop; returns a final answer + step trace. Only registered when an LLM provider (Ollama/OpenRouter) is configured. |

## Quick start

### 1. Prerequisites

- **Node.js ≥ 18**
- **Chrome or Edge** installed (Sutradhar drives your real system browser via Puppeteer).
  If it isn't auto-detected, set `CHROME_PATH` to the executable.

For the **autonomous `agent.runGoal` tool** you also need an LLM. The free, local path:

- **Ollama** running locally — `ollama serve` and `ollama pull qwen3.5:9b` (or set
  `SUTRADHAR_MODEL` to any model you've pulled). No API key needed.

Without an LLM, the server still works — only the `browser.*` tools are registered and the
host AI drives the page directly.

### 2. Build (from the monorepo root)

```bash
pnpm install
pnpm build
```

The entry point is `packages/mcp-server/dist/cli.js`.

### 3. Configure your AI client

Add Sutradhar as an MCP server in your client's config. For **Claude Desktop**
(`claude_desktop_config.json`), **ZCode**, or any client that takes a server map:

```json
{
  "mcpServers": {
    "sutradhar": {
      "command": "node",
      "args": ["E:/HMX_Projects/Internal_Projects/PinchTab/packages/mcp-server/dist/cli.js"],
      "env": {
        "SUTRADHAR_MODEL": "qwen3.5:9b"
      }
    }
  }
}
```

> The published package is `sutradhar` (bin `sutradhar-mcp`), so outside this monorepo the config is
> `"command": "npx", "args": ["-y", "--package=sutradhar", "sutradhar-mcp"]` — see
> [AGENT_SETUP.md](../../AGENT_SETUP.md). `@sutradhar/mcp-server` itself is not published separately.

To use **OpenRouter** instead of local Ollama, set `OPENROUTER_API_KEY` (and optionally
`SUTRADHAR_MODEL`). When `OPENROUTER_API_KEY` is present it takes precedence over Ollama.

### 4. Try it

Ask your AI client something like:

- *"Launch a browser, go to example.com, and tell me the page title."* — drives the
  `browser.*` tools itself.
- *"On example.com, find and return the contact email."* — same, using `browser.snapshot`.
- *"Use Sutradhar to: go to news.ycombinator.com and list the top 3 stories."* — hands the
  goal to `agent.runGoal` and Sutradhar's loop does the rest.

## Configuration

All config is via environment variables (matching the Sutradhar server):

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | _(unset)_ | If set, use OpenRouter as the LLM (takes precedence). |
| `SUTRADHAR_MODEL` | `qwen3.5:9b` | Model id (Ollama tag or OpenRouter model). |
| `SUTRADHAR_LLM_BASE` | `http://localhost:11434` | Ollama host (or any OpenAI-compatible base). |
| `CHROME_PATH` | _(auto-detected)_ | Path to Chrome/Edge executable if not found. |
| `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` | `<OS temp>/sutradhar-downloads` | Directories `browser.download_file` may write into, separated by `;` (Windows) or `:` (elsewhere); absolute paths, or `~` for the home directory (a relative entry fails startup with a message naming the variable). Replaces the default; the first entry is the destination when `downloadDir` is omitted. |
| `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` | _(unset — unrestricted)_ | If set, `browser.upload_file`/`browser.upload_file_via_trigger` may only read files under these directories. Setting this turns the restriction on. |
| `SUTRADHAR_ALLOWED_DOMAINS` | _(unset — any domain)_ | Comma-separated domains (and their subdomains) that `browser.navigate`/`launch`/`audit`/`new_tab` may visit. Does not intercept page-initiated navigation from a clicked link. |
| `SUTRADHAR_RESTRICT_NAVIGATION_TO_LOCAL` | _(unset)_ | Set to `1` to reject navigation to anything that isn't localhost, a private/loopback IP, or a `file:`/`about:`/`data:` URL. |
| `SUTRADHAR_IDLE_TIMEOUT_MS` | `1800000` (30 min) | Auto-close a session after this long with no observed activity. |

## Known limitations

These are open, reproduced problems on the current branch (not yet released as 0.5.0).

- **`browser.download_file` (best-effort overlap protection).** Path containment
  (`SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`/`SUTRADHAR_ALLOWED_UPLOAD_ROOTS`) is verified, including symlink,
  junction and Windows path tricks. Protection against overlapping downloads is not: a second
  `download_file` on the same browser is refused immediately, but the cross-process lock lives in the
  process temp directory and is keyed by the exact browser endpoint string, so two MCP servers (or an
  MCP server and a CLI) attached to one Chrome may not share it. Drive downloads for a given browser
  from one process at a time. Downloads a page starts on its own (not through `download_file`) are
  not covered by the roots and can land in Chrome's default download location.
- **`browser.audit`.** Auditing the current page (no `url`) of a brand-new tab immediately after its
  first navigation can miss the page's own HTTP error status while still reporting
  `coversWholeDocument: true`. The settle wait is a fixed 1500 ms, so a slower request can be absent
  from `brokenRequests`. A page restored from the back/forward cache reports
  `coversWholeDocument: false`. Only HTTP 400+ responses count as broken requests (DNS and blocked
  requests do not). The accessibility checks are heuristics, not a WCAG audit. Ring-buffer eviction
  (200 console, 50 page-error, 200 network entries per tab) is not reported. `cls` is the legacy
  layout-shift total, not session-windowed CLS. The JSON Schema file is in the repository and is not
  included in the npm package. A dialog that opens during page load or capture can make the call slow
  or fail with a misleading message.
- **`browser.wait_for_selector`.** A `state: "hidden"` success is best effort: the code path that
  decides "hidden" produced false answers in several audit rounds (the known ones, including a false
  success when the tab closes mid-wait, are fixed), and the class of bug is not mechanically
  prevented. A failed visible-wait can take about 3 x `timeoutMs` because the engine retries twice
  (`timeoutMs <= 0` does not retry). Polling is about every 100 ms; only the first matching element
  is checked; `opacity: 0` counts as visible. On a hidden-wait success MCP returns extra
  `otherVisibleMatches`/`matchedAtStart` detail that the CLI and SDK drop.
- **Dialogs.** The MCP server keeps the `auto` policy (a pending dialog is auto-dismissed after 30 s;
  handle it sooner with `browser.get_pending_dialog` / `browser.handle_dialog`). The CLI's dialog
  warden, `--dialog` flags and exit code 3 do not apply here.
- **Stealth.** There is none: Cloudflare, CAPTCHA walls and IP blocks stop Sutradhar as they stop any
  other automation tool. The only detection-relevant launch flag hides `navigator.webdriver` from
  simple scripts, nothing more.

## Programmatic API

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSutradharServer } from '@sutradhar/mcp-server';

const server = await createSutradharServer();
await server.connect(new StdioServerTransport());
```

`createSutradharServer({ runtime?, llmProvider?, disableAgent?, logger? })` lets you inject a
custom `SutradharRuntime` or LLM provider. See `src/server.ts`.

## Architecture

```
AI client ──stdio──▶ @sutradhar/mcp-server (this package)
                          │
                          ├─ browser.* tools ──▶ @sutradhar/capability-runtime (façade)
                          │                          └─▶ @sutradhar/browser (Puppeteer)
                          │
                          └─ agent.runGoal ────▶ @sutradhar/agent (AgentCore loop)
                                                      └─▶ @sutradhar/llm (Ollama/OpenRouter)
```

The capability-runtime façade is the single substrate every integration surface calls; the
MCP server is a thin transport + tool-mapping layer over it.
