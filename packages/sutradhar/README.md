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
| `allowedDownloadRoots` | `readonly string[]` | `[<OS temp>/sutradhar-downloads]` | Directories `page.download()` may write into. Replaces the default; the first entry becomes the destination when `downloadDir` is omitted. The SDK does **not** read `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` or any other `SUTRADHAR_ALLOWED_*` env var — pass this option explicitly. |
| `allowedUploadRoots` | `readonly string[]` | — (unrestricted) | If set, `page.uploadFile()` may only read files under these directories. |
| `viewport` | `{width, height}` | — | Initial CDP viewport for the first tab. |
| `configFile` | `string` | — | Load this `.sutradhar.json` (path relative to `process.cwd()`). Trusted like an option. Mutually exclusive with `discoverConfig`. |
| `discoverConfig` | `boolean` | `false` | Search upward from `process.cwd()` for a `.sutradhar.json` (nearest wins; stops at a `.git` boundary or your home directory). The SDK reads no config unless you ask. |
| `idleTimeoutMs` | `number` | — (never) | Close the session after this many ms idle (`0` = never). |
| `dialogPolicy` | `{mode, promptText?}` | `auto` | `auto`, `accept` or `dismiss`. `report` throws a `TypeError` (the SDK has no way to handle a pending dialog yet). |

**Project config.** With `configFile`/`discoverConfig`, `.sutradhar.json` supplies defaults for `allowedDomains`,
`downloadDir`/`allowedDownloadRoots`, `allowedUploadRoots`, `dialog`, `idleTimeoutMs` and `viewport`. Precedence is
**option you pass > config file > default**; the SDK never reads `SUTRADHAR_*` environment variables. Paths in the
file are relative to the file. A `dialog.mode "report"` in the file is mapped to `auto` with a `console.warn`. A
discovered file's download roots must stay inside its own directory. Example and full rules: `docs/project-config.md`.

Throws if no real browser is available. Set `CHROME_PATH` to point at a Chrome/Edge executable
if auto-detection fails.

**`Browser`**

| Method | Returns | Description |
|---|---|---|
| `newPage(url?)` | `Promise<Page>` | Open a new tab. |
| `pages()` | `Promise<Page[]>` | All tabs, as `Page` handles (async: titles are read live). |
| `getWsEndpoint()` | `string | undefined` | The session's CDP WebSocket endpoint, so a separate process can attach to the same browser. |
| `close()` | `Promise<void>` | Close every tab and release the browser. |
| `sessionId` | `string` | The underlying Sutradhar session id. |

**`Page`**

| Method | Description |
|---|---|
| `goto(url, options?)` | Navigate this tab to a URL; still returns the `Page` (chaining). The navigation's verification (did a new document commit? HTTP status?) is on `page.lastResult`. `options.expect` throws `ExpectationFailedError` when it doesn't hold. |
| `snapshot()` | Interactive-element listing (`[#id]` stamped) + page text. |
| `click(selector, options?)` | Click by CSS selector **or** `[#id]` from a snapshot. Returns the result (`{success, verification, …}`); throws `ActionFailedError` when the action failed. `options.settle` waits for the page to stop changing before returning (also accepted by `type`, `goto`, `press`, `scroll`, `download` and `uploadFile`; it cannot see a timer the page scheduled for later, use `waitFor` for that); `options.expect` (`{text?, url?, urlChanged?}`) is checked once after the action and throws `ExpectationFailedError` when it doesn't hold. A Playwright-style selector (`text=...`) throws `InvalidSelectorError`. |
| `type(selector, text, options?)` | Type into an input (selector or `[#id]`). Same result/throw contract as `click`. |
| `press(key, options?)` | Press a keyboard key (`"Enter"`, `"Escape"`, …). Same contract as `click`; the result's `verification` says whether the key reached the focused element and changed it (`contradicted` if not, `unverifiable` if nothing had focus). |
| `waitForSelector(selector, options?)` | Wait for `selector` to reach `options.state` — `"visible"` (default), `"attached"` (just in the DOM), or `"hidden"` (removed or not visible). "Visible" is a non-empty box AND visibility not hidden/collapse, checked on the FIRST match — `opacity:0`/off-screen still count as visible; zero-size/`display:none`/`visibility:hidden` count as hidden. `"hidden"` succeeds immediately if nothing matches. `options.timeout` is per attempt; retries can extend the real total wait. `options.timeout <= 0` checks the current state once, immediately, with no waiting or retrying. Waiting states poll roughly every 100ms, so a state that's only true for less than ~100ms (a fast visibility flicker) may be missed. Throws on timeout. |
| `waitFor(options)` | Wait until every given condition holds at once — `{text?, textGone?, url?, js?, timeout?}` (note `timeout`, in ms: default 10000, max 300000, `<= 0` = check once). `text`/`textGone`: rendered text, the same rule and code as `expect.text`, so the same documented limits (best effort: text inside never-painted SVG containers counts; visible text split across inline-block items or inside a `<textarea>` can be missed); `textGone` is met at once if the text was never there (`lastResult.output.presentAtStart === false`, verification `unverifiable`); a frame that could not be inspected is never read as gone. `url`: substring of the tab URL. `js`: a side-effect-free JS expression evaluated in the main frame; a throw fails the wait. Polls from Node every ~100 ms (works in a background tab and on strict-CSP pages), no hidden retries. Text visible for less than one poll interval (about 100 ms) can be missed; use it for states that persist. A dialog already open fails the wait in about 1 s; one that opens partway through a check can take up to about 2.7 s after it opens. On a frozen page a failed wait can spend up to 1.5 s more reading the page title, so the total is bounded but can exceed `timeout` by up to about 3 s. Resolves the result; **throws `ActionFailedError`** on a timeout or fatal condition (message lists which conditions were met/unmet), `TypeError` for invalid options. |
| `scroll(direction?, amount?, options?)` | Scroll up/down/top/bottom. Same contract as `click`. |
| `screenshot()` | Full-page PNG as base64. Its verification (on `page.lastResult`) is `unverifiable` by design: a screenshot has no post-condition. |
| `lastResult` | The full result of this page's most recent action call (`goto`, `screenshot`, `waitForSelector`, … included), the uniform way to read `verification`. |
| `audit(options?)` | JSON audit report (errors, broken requests, a11y heuristics, Web Vitals) + `screenshotBase64` (+ files/absolute paths when `outDir` is given). Throws if the audit can't run; a failed `baselineUrl` comparison is reported in `report.baseline.error` instead. |
| `evaluate(expression, frameSelector?)` | Run JS in the page (or, with `frameSelector`, inside that `<iframe>`, including a cross-origin one); return the serialized result. |
| `getStorageState()` / `setStorageState(state)` | Export / restore cookies + localStorage + sessionStorage as one blob (log in once, reuse later). |
| `setViewport({width, height, isMobile?, deviceScaleFactor?, hasTouch?})` / `getViewport()` | Set this tab's viewport, read back the metrics in effect (`null` if never set). |
| `download(selector, options?)` | Click `selector` (the download-triggering element) and wait for it to finish on disk. `options.downloadDir` must resolve inside an allowed root (`LaunchOptions.allowedDownloadRoots`) or this throws. Returns `{filename, path, downloadDir, verification}`; `verification` is backed by an `fs.stat` of the saved file (non-empty, written during this call). `options.expect` is supported. |
| `uploadFile(selector, filePath)` | Upload a local file into an `<input type="file">` targeted by `selector`. `filePath` is resolved to an absolute path. Unrestricted unless `LaunchOptions.allowedUploadRoots` was set, in which case it must be under one of those directories, or this throws. |
| `cookies()` | Read cookies for this tab's URL. |
| `bringToFront()` | Make this the active tab. |
| `close()` | Close this tab. |
| `tabId` | This tab's id within the session. |

**Results and errors (FR2-07).** `click`/`type`/`press`/`scroll` return the runtime result and throw
`ActionFailedError` (with `.result`) when `success` is false; before, they silently swallowed the failure.
`options.expect` throws `ExpectationFailedError` (with `.failed` and `.result`) when the action succeeded but the
assertion did not hold; a built-in `contradicted` verification with no `expect` is *returned*, not thrown, so read
`result.verification.evidence.tier`. `waitForSelector` keeps its contract (throws a plain `Error` naming the state it
waited for, resolves `undefined`); its verification is on `page.lastResult`. Both error classes are exported from
`sutradhar`.

## Known limitations

These are open on the current branch (0.5.0, not yet published):

- **Downloads:** `page.download()` only writes inside `allowedDownloadRoots` (default
  `<OS temp>/sutradhar-downloads`). Do one download per browser at a time: a second overlapping
  `page.download()` on the same browser is refused immediately, and the cross-process protection is
  best effort (a lock file in the process temp directory keyed by the browser endpoint, so
  separate processes may not share it). A download the page starts by itself is not governed by the
  roots and can land in Chrome's default download location.
- **`page.audit()`:** auditing the current page (no `url`) of a brand-new tab immediately after its
  first navigation can miss the page's own HTTP error status while still reporting
  `coversWholeDocument: true`. The settle wait is a fixed 1500 ms, so a slower request can be missing;
  a page restored from the back/forward cache reports `coversWholeDocument: false`. Only HTTP 400+
  responses count as broken requests, and the accessibility checks are heuristics, not a WCAG audit.
  The report's JSON Schema is in the repository, not in the npm package.
- **`page.waitForSelector()`:** a `state: "hidden"` success is best effort (that code path produced false
  answers in several audit rounds; the known ones are fixed). Only the first matching element is
  checked, `opacity: 0` counts as visible, and a failed visible-wait can take about 3 x `timeout`
  because the engine retries twice (`timeout <= 0` does not retry).
- **Selectors:** Playwright syntax (`text=`, `role=`, `>>`, `:has-text()`, `getBy*()`) throws
  `InvalidSelectorError` immediately; use CSS, a snapshot `[#id]`, or Puppeteer's `pierce/`,
  `xpath/`, `aria/`, `text/` prefixes.
- Native dialogs keep the `auto` policy in the SDK (auto-dismissed after 30 s); the CLI's dialog
  warden and exit code 3 do not apply. No stealth or bot-detection evasion.

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
