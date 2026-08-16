# sutradhar

AI-agent browser automation, in one package. Drives a real Chrome/Edge with **dual DOM +
accessibility-tree grounding** built for AI agents — not raw HTML, not just a screenshot.

Three ways in, one install:

```bash
npm install -g sutradhar   # or use npx for any of the three below, no install needed
```

| I want to... | Use |
|---|---|
| Let an MCP client (Claude Code, Claude Desktop, Cline, ...) drive a real browser | `npx --package=sutradhar sutradhar-mcp` — see [MCP server](#mcp-server) |
| Drive a browser from a terminal, no scripting | `npx --package=sutradhar sutradhar <command>` — see [CLI](#cli) |
| Drive a browser from my own Node code | `import { launch } from 'sutradhar'` — see [SDK](#sdk) |

All three share the same engine, so behavior is identical across them. This package also ships
[`AGENT_SETUP.md`](./AGENT_SETUP.md) — a self-contained setup/usage reference written for an AI
coding agent to read directly (e.g. `node_modules/sutradhar/AGENT_SETUP.md` once installed),
covering the full tool catalog and grounding guidance, not just this quick-start.

## MCP server

Add it to your MCP client's config — no local build, no cloning this repo:

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

(`--package=sutradhar` is required, not optional — `sutradhar-mcp` is the *bin name* inside the
`sutradhar` package, not a separately published package. A bare `npx sutradhar-mcp` would try
to install a nonexistent package of that exact name and fail.)

For Claude Code specifically:

```bash
claude mcp add sutradhar -- npx -y --package=sutradhar sutradhar-mcp
```

This exposes `browser.*` tools (navigate, snapshot, click, type, extract, screenshot, storage
state, network/console log capture, and more) so the host AI drives the browser directly — plus
an optional `agent.runGoal` tool that hands control to Sutradhar's own autonomous agent loop for
a natural-language objective (requires a separately-configured LLM provider: Ollama or an
OpenRouter API key; the `browser.*` tools need neither).

## CLI

```bash
npx sutradhar nav https://example.com
npx sutradhar snap                        # interactive-element listing + page text
npx sutradhar click 7                     # click [#7] from the last snapshot
npx sutradhar type 3 "hello world"
npx sutradhar audit https://example.com   # screenshot + console/network/a11y + Core Web Vitals
npx sutradhar compare urlA urlB --fail-on-diff   # visual regression, CI-gateable
npx sutradhar doctor                      # environment diagnostics
```

Every command re-attaches to the same live browser session between separate invocations (state
persisted under `~/.sutradhar-cli/`) — run `sutradhar close` when done. Use
`sutradhar profile create <name>` for a persistent, named profile (cookies/login survive across
runs).

## SDK

```ts
import { launch } from 'sutradhar';

const browser = await launch();
const page = await browser.newPage();
await page.goto('https://example.com');

const snap = await page.snapshot();   // LLM-optimized interactive-element listing
await page.click('7');                 // [#7] from the snapshot
await page.type('#search', 'hello');
const png = await page.screenshot();

await browser.close();
```

The headline feature is **`page.snapshot()`** — instead of raw HTML, it returns a compact
listing of every interactive element, each stamped with a numeric `[#id]`:

```
Interactive elements (4):
[#4] a "Learn more"
```

Use that `[#id]` as the selector for `page.click('4')` or `page.type('4', '...')`.

### API reference

**`launch(options?) → Promise<Browser>`**

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | Open the first tab at this URL. |
| `headless` | `boolean` | `true` | Run headless. |
| `isIncognito` | `boolean` | `false` | Incognito context. |
| `profileName` | `string` | — | Launch using a named, persistent profile (cookies/history/localStorage — and sessionStorage, if a prior session under this name saved it — survive across separate launches). Create one first via `new ProfileManager().create(name)`. Throws if the name doesn't exist. |
| `userAgent` | `string` | — | Override `navigator.userAgent`. Unset by default — the real Chrome UA (including "HeadlessChrome" when headless) is left as-is; this is plain configurability, not a detection-evasion default. |
| `allowedDomains` | `readonly string[]` | — | Restrict navigation (`page.goto`, the initial `url`, `browser.compare`, `newPage`'s `url`) to these domains (and their subdomains) — anything else throws. Useful for handing an agent a logged-in internal session safely; does **not** intercept page-initiated navigation from a clicked link (client-side, not routed through this check). |

Throws if no real browser is available. Set `CHROME_PATH` to point at a Chrome/Edge executable
if auto-detection fails.

**`Browser`**

| Method | Returns | Description |
|---|---|---|
| `newPage(url?)` | `Promise<Page>` | Open a new tab. |
| `pages()` | `Page[]` | All tabs, as `Page` handles. |
| `close()` | `Promise<void>` | Close every tab and release the browser. |
| `sessionId` | `string` | The underlying Sutradhar session id. |

**`Page`**

| Method | Description |
|---|---|
| `goto(url)` | Navigate this tab to a URL. |
| `snapshot()` | Interactive-element listing (`[#id]` stamped) + page text. |
| `click(selector)` | Click by CSS selector **or** `[#id]` from a snapshot. |
| `type(selector, text)` | Type into an input (selector or `[#id]`). |
| `press(key)` | Press a keyboard key (`"Enter"`, `"Escape"`, …). |
| `scroll(direction?, amount?)` | Scroll up/down/top/bottom. |
| `screenshot()` | Full-page PNG as base64. |
| `evaluate(expression)` | Run JS in the page; return serialized result. |
| `cookies()` | Read cookies for this tab's URL. |
| `bringToFront()` | Make this the active tab. |
| `close()` | Close this tab. |
| `tabId` | This tab's id within the session. |

## Requirements

- **Node.js ≥ 18**
- **Chrome or Edge** installed (auto-detected; set `CHROME_PATH` if not found)

## How it's built

This is a single npm package with three bundled, self-contained entry points
(`dist/index.js`, `dist/cli-bin.js`, `dist/mcp-cli.js`) — every internal `@sutradhar/*`
workspace package is inlined at build time (`scripts/build-bundle.mjs` in the monorepo root),
so installing `sutradhar` pulls in exactly one real runtime dependency, `puppeteer-core`
(pure JS, no native bindings — it drives your already-installed Chrome, it doesn't bundle one).

Source lives in the [Sutradhar monorepo](https://github.com/hanumatrix-hmx/Sutradhar); this
package is its single published distribution.

## License

`v0.2.0` and onward is licensed under the **Functional Source License 1.1, Apache-2.0 future
grant** ([FSL-1.1-ALv2](https://fsl.software)) — free to use for almost everything (your own
projects, internal tooling, research, professional services you provide to others), with one
carve-out: you may not offer Sutradhar itself, or a substitute for it, as a competing commercial
product or service. Each version automatically converts to the fully permissive Apache License
2.0 two years after its release, so nothing here is locked up forever — see [LICENSE](./LICENSE)
for the full text.

`v0.1.0` was published under the MIT License and remains available under those original terms —
license changes apply going forward, not retroactively.
