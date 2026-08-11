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
| `axsnap` | Accessibility-tree listing — no ids, never goes stale even if the page re-renders; pair with `clicktext`/`clickrole`. |
| `text` | Print the current page's visible text. |
| `click <ref>` | Click an element (selector, or a numeric id from `snap`). |
| `clicktext <text>` | Click the element containing this text (from `axsnap`). |
| `clickrole <role> [name]` | Click by accessibility role, optionally narrowed by name (e.g. `clickrole button Submit`). |
| `type <ref> <text>` | Type text into an element. |
| `press <ref> <key>` | Focus an element then press a key (e.g. `press 3 Enter`). |
| `screenshot [path]` | Save a screenshot (default: `./screenshot.png`). |
| `audit [url] [outDir]` | Screenshot + console/page/network errors + accessibility checks + Core Web Vitals for a page. |
| `compare <urlA> <urlB> [out]` | Visual regression: pixel-diff two pages, save a diff image. |
| `close` | Close the active session. |
| `doctor` | Environment diagnostics (Chrome detection, active session). |
| `profile create <name> [desc]` | Create a named, persistent profile (cookies/history/storage survive across separate launches). |
| `profile list` | List profiles. |
| `profile delete <name>` | Delete a profile (irreversibly removes its stored data). |

**Flags:** `--headed` (launch visibly instead of headless — only applies to `nav` when
starting a new session), `--profile <name>` (launch as a named persistent profile, created
first via `profile create`), `--fail-on-diff` (`compare` exits nonzero on any pixel
difference — CI-friendly gating).

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
