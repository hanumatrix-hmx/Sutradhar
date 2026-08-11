# @pinchtab/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets any
MCP-compatible AI client (Claude Desktop, ZCode, Cline, custom agents) **drive a real
browser through PinchTab** — and, optionally, hand control to PinchTab's **own autonomous
agent** for multi-step goals.

Two brain modes, one server:

- **Browser tools** (`browser.*`) — the host AI is the brain. It calls `browser.snapshot`
  to read the page (an LLM-optimized listing of interactive elements), then `browser.click`
  / `browser.type` / … to act. Best when you want full control.
- **`agent.runGoal`** — PinchTab's own agent loop is the brain. You pass a natural-language
  objective and it navigates, clicks, types, and extracts a final answer. Best for
  multi-step tasks you'd rather not script call-by-call. Requires an LLM provider.

## Tools (14)

| Tool | Brain | Description |
|---|---|---|
| `browser.launch` | host | Launch a browser session; returns a `sessionId`. |
| `browser.shutdown` | host | Shut down a session. |
| `browser.navigate` | host | Navigate a tab to a URL. |
| `browser.snapshot` | host | **Agent vision** — the interactive-element listing + page text. |
| `browser.click` | host | Click by CSS selector or `[#id]` from a snapshot. |
| `browser.type` | host | Type into an input (selector or `[#id]`). |
| `browser.press_key` | host | Press a key (Enter, Escape, …). |
| `browser.scroll` | host | Scroll up/down/top/bottom. |
| `browser.screenshot` | host | Full-page PNG (returned inline). |
| `browser.eval` | host | Evaluate arbitrary JS in the page. |
| `browser.list_tabs` / `new_tab` / `close_tab` | host | Tab management. |
| `agent.runGoal` | PinchTab | Hand a natural-language goal to the autonomous loop. |

## Quick start

### 1. Prerequisites

- **Node.js ≥ 18**
- **Chrome or Edge** installed (PinchTab drives your real system browser via Puppeteer).
  If it isn't auto-detected, set `CHROME_PATH` to the executable.

For the **autonomous `agent.runGoal` tool** you also need an LLM. The free, local path:

- **Ollama** running locally — `ollama serve` and `ollama pull qwen3.5:9b` (or set
  `PINCHTAB_MODEL` to any model you've pulled). No API key needed.

Without an LLM, the server still works — only the `browser.*` tools are registered and the
host AI drives the page directly.

### 2. Build (from the monorepo root)

```bash
pnpm install
pnpm build
```

The entry point is `packages/mcp-server/dist/cli.js`.

### 3. Configure your AI client

Add PinchTab as an MCP server in your client's config. For **Claude Desktop**
(`claude_desktop_config.json`), **ZCode**, or any client that takes a server map:

```json
{
  "mcpServers": {
    "pinchtab": {
      "command": "node",
      "args": ["E:/HMX_Projects/Internal_Projects/PinchTab/packages/mcp-server/dist/cli.js"],
      "env": {
        "PINCHTAB_MODEL": "qwen3.5:9b"
      }
    }
  }
}
```

> Once published to npm, the config simplifies to
> `"command": "npx", "args": ["-y", "@pinchtab/mcp-server"]`.

To use **OpenRouter** instead of local Ollama, set `OPENROUTER_API_KEY` (and optionally
`PINCHTAB_MODEL`). When `OPENROUTER_API_KEY` is present it takes precedence over Ollama.

### 4. Try it

Ask your AI client something like:

- *"Launch a browser, go to example.com, and tell me the page title."* — drives the
  `browser.*` tools itself.
- *"On example.com, find and return the contact email."* — same, using `browser.snapshot`.
- *"Use PinchTab to: go to news.ycombinator.com and list the top 3 stories."* — hands the
  goal to `agent.runGoal` and PinchTab's loop does the rest.

## Configuration

All config is via environment variables (matching the PinchTab server):

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | _(unset)_ | If set, use OpenRouter as the LLM (takes precedence). |
| `PINCHTAB_MODEL` | `qwen3.5:9b` | Model id (Ollama tag or OpenRouter model). |
| `PINCHTAB_LLM_BASE` | `http://localhost:11434` | Ollama host (or any OpenAI-compatible base). |
| `CHROME_PATH` | _(auto-detected)_ | Path to Chrome/Edge executable if not found. |

## Programmatic API

```ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPinchTabServer } from '@pinchtab/mcp-server';

const server = await createPinchTabServer();
await server.connect(new StdioServerTransport());
```

`createPinchTabServer({ runtime?, llmProvider?, disableAgent?, logger? })` lets you inject a
custom `PinchTabRuntime` or LLM provider. See `src/server.ts`.

## Architecture

```
AI client ──stdio──▶ @pinchtab/mcp-server (this package)
                          │
                          ├─ browser.* tools ──▶ @pinchtab/capability-runtime (façade)
                          │                          └─▶ @pinchtab/browser (Puppeteer)
                          │
                          └─ agent.runGoal ────▶ @pinchtab/agent (AgentCore loop)
                                                      └─▶ @pinchtab/llm (Ollama/OpenRouter)
```

The capability-runtime façade is the single substrate every integration surface calls; the
MCP server is a thin transport + tool-mapping layer over it.
