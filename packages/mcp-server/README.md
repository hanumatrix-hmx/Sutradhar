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

## Tools (69)

Grouped here by category, matching `tools.ts`'s own section layout.

### Lifecycle
| Tool | Description |
|---|---|
| `browser.health` | Preflight check — is a real browser available, without committing to a session. |
| `browser.launch` | Launch a browser session; returns a `sessionId`. |
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
| `browser.snapshot` | **DOM-attribute grounding** — interactive-element listing (numeric `[#id]`, `data-sd-node-id`-backed) + page text. Fast; can go stale if the page re-renders between snapshot and action. |
| `browser.ax_snapshot` | **Accessibility-tree grounding** — role + accessible-name listing, no ids to go stale. Prefer this for pages that re-render (SPAs, live search, infinite scroll). |

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
| `browser.download_file` | Trigger and wait for a file download; saves under an allow-listed directory. |
| `browser.wait_for_selector` | Wait for an element to reach a state: `visible` (default), `attached` (just in the DOM), or `hidden` (removed or not visible). "Visible" is a non-empty box AND visibility not hidden/collapse, checked on the FIRST match — `opacity:0`/off-screen still count as visible; zero-size/`display:none`/`visibility:hidden` count as hidden. `hidden` succeeds immediately if nothing matches. `timeoutMs` is per attempt; retries can extend the real total wait. `timeoutMs <= 0` checks the current state once, immediately, with no waiting or retrying. Waiting states poll roughly every 100ms, so a state that's only true for less than ~100ms (a fast visibility flicker) may be missed. |
| `browser.fill_form` | Bulk multi-field form fill — an object of `{target: value}` pairs in one call instead of N `type` round-trips; a field that fails doesn't stop the rest. |
| `browser.click_at_point` | Click a raw viewport `(x, y)` coordinate with no element/selector at all — the escape hatch for canvas-heavy or custom-rendered UI with nothing addressable via DOM. |
| `browser.drag_at_points` | Coordinate-only mouse-down → move → mouse-up drag, the drag sibling of `click_at_point` (distinct from `drag_and_drop`'s element-to-element HTML5 `DataTransfer` API). |

### Capture & extraction
| Tool | Description |
|---|---|
| `browser.screenshot` | Full-page PNG (returned inline). |
| `browser.export_pdf` | Export the current page as PDF. |
| `browser.eval` | Evaluate arbitrary JS in the page. Optional `frameSelector` runs it inside a specific `<iframe>` instead — including a genuinely cross-origin one. |
| `browser.extract_data` | Structured extraction: field name → selector map, returns matched text/attributes. Optional `frameSelector` extracts from inside a specific `<iframe>` instead — including a genuinely cross-origin one. |

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
| `browser.get_pending_dialog` / `handle_dialog` | Inspect and accept/dismiss an open `alert`/`confirm`/`prompt`. |
| `browser.get_console_logs` | Read captured `console.*` output for the page. |
| `browser.get_page_errors` | Read captured uncaught page errors. |
| `browser.get_network_log` | Read captured network requests/responses. |
| `browser.get_action_history` | Read the session's action-execution history. |
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

> Once published to npm, the config simplifies to
> `"command": "npx", "args": ["-y", "@sutradhar/mcp-server"]`.

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
