# @sutradhar/cli

A terminal CLI for driving the Sutradhar browser engine directly — `nav`/`snap`/`click`/`type`,
plus site auditing and visual-regression diffing — without writing a script or wiring up an
MCP client.

Every command is its own one-shot process, but they all operate on the **same live browser
session**: the first command that needs a browser spawns a detached Chrome and remembers how
to reconnect to it (in `~/.sutradhar-cli/state.json`); every later command re-attaches to that
same session instead of launching a new one. Run `sutradhar close` when you're done.

## Quick start

### 1. Prerequisites

- **Node.js ≥ 18**
- **Chrome or Edge** installed (set `CHROME_PATH` if it isn't auto-detected)

### 2. Build (from the monorepo root)

```bash
pnpm install
pnpm --filter @sutradhar/cli build
```

The entry point is `packages/cli/dist/cli.js`, exposed as the `sutradhar` bin. To use the
`sutradhar` command directly on your `PATH` without `npx`/`pnpm exec`, link it:

```bash
cd packages/cli && npm link
```

### 3. Try it

```bash
sutradhar nav https://example.com     # navigates (spawns a session if none is active)
sutradhar snap                        # prints the interactive-element listing
sutradhar click 4                     # click by the numeric [#id] from "snap"
sutradhar text                        # print the page's visible text
sutradhar close                       # done — closes the session
```

Run `sutradhar` with no arguments for the full command list.

## Commands

| Command | Description |
|---|---|
| `nav <url>` | Navigate to a URL (launches a session if none is active). |
| `snap` | Print the interactive-element listing for the current page. |
| `snap --json` | Same, plus the raw structured per-element data as JSON. |
| `snap --no-text` | Same elements, drops name/label/placeholder/value text (keeps tag+role+id) — smaller listing when you already know what you're targeting and just need fresh ids. |
| `snap --ids-only` | Smallest listing: only the bracketed `[#id]`, nothing else. |
| `snap --scan-listeners` | Also finds elements whose only interactivity signal is a real `addEventListener`-attached handler (no `onclick=`/role/`tabindex`/`cursor:pointer`) — e.g. SortableJS-style drag lists. Slower; real CDP introspection. |
| `axsnap` | Accessibility-tree listing — no ids, never goes stale even if the page re-renders; pair with `clicktext`/`clickrole`. |
| `text` | Print the current page's visible text. |
| `click <ref>` | Click an element (selector, or a numeric id from `snap`). |
| `clicktext <text>` | Click the element containing this text (from `axsnap`). |
| `clickrole <role> [name]` | Click by accessibility role, optionally narrowed by name (e.g. `clickrole button Submit`). |
| `type <ref> <text>` | Type text into an element. |
| `press <ref> <key>` | Focus an element then press a key (e.g. `press 3 Enter`). |
| `press <ref> <key> --modifiers Control,Shift` | Hold modifier keys while pressing (e.g. Ctrl+Shift+ArrowRight to select a word — a real rich-text-editor toolbar formatting workflow). |
| `select <ref> <value>` | Select an `<option>` by value on a `<select>`. |
| `wait <ref> [timeoutMs]` | Wait for an element to appear and be visible. |
| `eval <js-expression>` | Evaluate JS in the page's top-level context, print the result. |
| `eval <js-expression> --frame <selector>` | Same, but inside a specific `<iframe>` (selector or numeric id from `snap`) — including a genuinely cross-origin one. Chain with `::` for an iframe nested inside another iframe, e.g. `--frame "iframe.widget::iframe.payment"`. |
| `hover <ref>` | Hover an element. |
| `scroll [dir] [amountPx]` | Scroll the page (`dir`: up/down/top/bottom, default down 500px). |
| `scroll [dir] [amountPx] [targetRef]` | Scroll a specific element's own scroll container instead of the window (a data grid's rows, a chat pane, a modal body) — pair with `--settle` to reliably see newly-revealed content. |
| `upload <ref> <filePath>` | Upload a local file into an `<input type="file">`. |
| `drag <sourceRef> <destRef>` | Drag one element onto another. |
| `clickpoint <x> <y>` | Click at an absolute viewport coordinate — no element/selector, for canvas-rendered UI with nothing DOM-addressable to target. |
| `dragpoints <fromX> <fromY> <toX> <toY>` | Real mouse-down→move→up drag between two absolute viewport coordinates — for canvas-rendered drag targets (a signature pad, a slider/chart handle drawn on a `<canvas>`). |
| `grant <origin> <permission...>` | Grant browser permissions for an origin (e.g. `clipboard-read`, `clipboard-write`, `geolocation`, `notifications`) — needed before `setclipboard`/`getclipboard` work against most real sites. |
| `setclipboard <text>` | Set the system clipboard (e.g. to then paste into a rich-text editor via `press <ref> v --modifiers Control`). |
| `getclipboard` | Print the current system clipboard contents. |
| `tabs` | List open tabs (id, title, url) — `*` marks the active one. |
| `newtab [url]` | Open a new tab, optionally navigating it immediately. |
| `focustab <tabId>` | Switch the active tab (e.g. after a link opened `target="_blank"`). |
| `closetab <tabId>` | Close a specific tab. |
| `download <ref> [dir]` | Click an element that triggers a download, print the saved path. |
| `screenshot [path]` | Save a screenshot (default: `./screenshot.png`). |
| `audit [url] [outDir]` | Screenshot + console/page/network errors + accessibility checks + Core Web Vitals for a page (current page if no url). |
| `audit [url] [outDir] --baseline <url>` | Same, plus a visual pixel-diff against a known-good baseline URL — a one-command regression gate combining `audit` + `compare`. |
| `compare <urlA> <urlB> [out]` | Visual regression: pixel-diff two pages, save a diff image. |
| `close` | Close the active session. |
| `doctor` | Environment diagnostics (Chrome detection, active session). |
| `profile create <name> [desc]` | Create a named, persistent profile (cookies/history/storage survive across separate launches). |
| `profile list` | List profiles. |
| `profile delete <name>` | Delete a profile (irreversibly removes its stored data). |
| `profile export-state <name> <outFile>` | Export a profile's saved login state (cookies/localStorage/sessionStorage) to a portable JSON file. |
| `profile import-state <name> <inFile>` | Pre-bake a profile with login state from a JSON file (e.g. one produced by `export-state`, or `browser.get_storage_state`) — restored automatically on the next launch with that profile. |

**Flags:**

| Flag | Applies to | Effect |
|---|---|---|
| `--headed` | `nav` (new session only) | Launch visibly instead of headless. |
| `--profile <name>` | `nav` (new session only) | Launch as a named persistent profile (create one first via `profile create`). |
| `--user-agent <ua>` | `nav` (new session only) | Launch with a custom `navigator.userAgent`. |
| `--allowlist-domains <a.com,b.com>` | any command | Block navigation to any domain not in this comma-separated list (and their subdomains). Per-command, not persisted in session state — pass it on every command that might navigate. |
| `--json` | `snap` | Additionally print structured per-element data as JSON. |
| `--no-text` | `snap` | Drop per-element text, keep tag+role+id. |
| `--ids-only` | `snap` | Keep only the bracketed id, nothing else. |
| `--baseline <url>` | `audit` | Also visually diff the audited page against this URL. |
| `--fail-on-diff` | `compare`, `audit` | Exit nonzero if a pixel difference is found (`compare`), or if any console/page/broken-request error or (with `--baseline`) visual diff is found (`audit`) — CI-friendly gating. |
| `--settle` | `click`, `type`, `scroll` | Wait for the page to stop actively changing (no DOM mutations, no in-flight network requests) before returning — helps when the action triggers a menu/modal/toast/virtualized-list-update that renders a moment later. |
| `--scan-listeners` | `snap` | Also find real `addEventListener`-only elements (see command list above). |
| `--modifiers <Control,Shift>` | `press` | Hold modifier keys while pressing the given key. |

Run `sutradhar` with no arguments for this same list straight from the binary.

## Why `axsnap`/`clicktext`/`clickrole` over `snap`/`click`

`snap`'s numeric `[#id]`s are grounded in DOM attributes stamped at snapshot time — fast and
familiar, but they can go stale if the page re-renders between `snap` and `click`. `axsnap`
grounds on the accessibility tree (role + accessible name) instead, which survives
re-renders. Prefer `axsnap` + `clicktext`/`clickrole` for pages that update themselves (SPAs,
live search results, infinite scroll); `snap` + `click` is fine for static pages and is
slightly cheaper.

## How it works

```
your terminal ──▶ @sutradhar/cli (this package)
                       └─▶ @sutradhar/capability-runtime (SutradharRuntime façade)
                               └─▶ @sutradhar/browser (Puppeteer-core + DOM semantic engine)
```

Session persistence across separate CLI invocations works by spawning Chrome **detached**
(not tied to the CLI process's lifetime) and reconnecting via its CDP `wsEndpoint`, saved in
`~/.sutradhar-cli/state.json`. `sutradhar close` kills that Chrome process tree and clears the
saved state.

## Requirements

- **Node.js ≥ 18**
- **Chrome or Edge** installed (set `CHROME_PATH` if not auto-detected)
