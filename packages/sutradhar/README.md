# sutradhar

Embeddable AI browser automation SDK. Drive a real Chrome/Edge with a **Puppeteer-style
API**, with semantic DOM snapshots built for AI agents.

```bash
npm install sutradhar
```

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

## Why

Sutradhar is an AI browser runtime. This package is its embedding SDK — a thin, familiar
Puppeteer-style surface over the same proven engine that powers the Sutradhar MCP server and
REST API. Use it when you want to drive a real browser **from your own Node code** (scraping,
testing, RPA, agent tooling) instead of through an MCP client.

The headline feature is **`page.snapshot()`** — instead of raw HTML, it returns a compact,
LLM-optimized listing of every interactive element, each stamped with a numeric `[#id]`:

```
Interactive elements (4):
[#4] a "Learn more"
```

Use that `[#id]` as the selector for `page.click('4')` or `page.type('4', '...')`. It resolves
to `[data-sd-node-id="4"]` under the hood. This is the same grounding scheme Sutradhar's
autonomous agent uses.

## API

### `launch(options?) → Promise<Browser>`

Launches a headless Chrome/Edge and returns a `Browser`.

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | Open the first tab at this URL. |
| `headless` | `boolean` | `true` | Run headless. |
| `isIncognito` | `boolean` | `false` | Incognito context. |

Throws if no real browser is available. Set `CHROME_PATH` to point at a Chrome/Edge
executable if auto-detection fails.

### `Browser`

| Method | Returns | Description |
|---|---|---|
| `newPage(url?)` | `Promise<Page>` | Open a new tab. |
| `pages()` | `Page[]` | All tabs, as `Page` handles. |
| `close()` | `Promise<void>` | Close every tab and release the browser. |
| `sessionId` | `string` | The underlying Sutradhar session id. |

### `Page`

| Method | Description |
|---|---|
| `goto(url)` | Navigate this tab to a URL. |
| `snapshot()` | **Agent vision** — interactive-element listing (`[#id]` stamped) + page text. |
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

## Full example: search and extract

```ts
import { launch } from 'sutradhar';

const browser = await launch();
const page = await browser.newPage();
await page.goto('https://news.ycombinator.com');

const snap = await page.snapshot();
console.log(snap.interactiveElements);   // [#3] a "Hacker News" ...

const topTitle = await page.evaluate(
  'document.querySelector(".titleline > a")?.textContent ?? "(none)"'
);
console.log('Top story:', topTitle);

await browser.close();
```

## How it works

```
your app ──▶ sutradhar (this package)
                │
                └─▶ @sutradhar/capability-runtime  (the substrate façade)
                        └─▶ @sutradhar/browser       (Puppeteer-core + DOM semantic engine)
```

`sutradhar` is a thin, familiar wrapper. The actual engine is `@sutradhar/capability-runtime`,
which is the single substrate every Sutradhar integration surface (MCP server, this SDK,
future plugins/extension) shares — so behavior is identical across all of them.

## Requirements

- **Node.js ≥ 18**
- **Chrome or Edge** installed (set `CHROME_PATH` if not auto-detected)

## Publishing (maintainer notes)

This package is publish-ready in shape but currently `private: true` (not yet on npm). When
ready to publish:

1. **Create the `@sutradhar` npm org** (or just publish the unscoped `sutradhar` name).
2. The `workspace:*` dependency on `@sutradhar/capability-runtime` must be rewritten to a real
   version range at publish time — either publish the `@sutradhar/*` packages first (contracts,
   utils, observability, events, browser, capability-runtime) and let them resolve from the
   registry, or bundle them into this package via a build step (tsup/esbuild) so `sutradhar`
   has zero `@sutradhar/*` runtime deps.
3. Remove `"private": true`.
4. `npm publish` (scoped packages need `--access public`, already set in `publishConfig`).

`npm pack --dry-run` confirms the tarball ships only `dist/` + `README.md` + `package.json`
(no `src/` or `tests/`).
