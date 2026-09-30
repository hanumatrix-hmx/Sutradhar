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

72 `browser.*` tools, grouped by what they do:

| Category | Tools | What they're for |
|---|---|---|
| **Lifecycle** | `health`, `launch`, `attach`, `shutdown`, `shutdown_all` | Start/stop a session. `attach` connects to an already-running Chrome over CDP instead of launching a new one. Other tools take the sessionId from launch/attach. It may be omitted only while exactly one session is live. Otherwise the call fails and lists the live ids. |
| **Navigation** | `navigate`, `go_back`, `go_forward`, `reload` | Standard page navigation. |
| **Agent vision** | `snapshot`, `ax_snapshot` | **Read the page.** See the grounding section below — this is the most important pair of tools here. Elements inside an iframe are labelled `[#31 in iframe "pay" (https://…)]` (the URL shown once per frame; an unnamed frame shows its number instead), and elements inside an open shadow root end with `(shadow: host-tag#id)`; a frame that couldn't be read is listed as `[iframe <origin> — not inspectable] (reason)` instead of being silently dropped. |
| **Interaction** | `click`, `click_by_text`, `click_by_role`, `right_click`, `type`, `type_by_label`, `press_key`, `hover`, `scroll`, `select_option`/`select_options`, `drag_and_drop`, `touch_tap`, `upload_file`, `upload_file_via_trigger`, `download_file`, `wait_for_selector`, `wait_for`, `fill_form`, `click_at_point`, `drag_at_points` | Act on the page. `fill_form` does a whole form in one call. `click_at_point`/`drag_at_points` are the escape hatch for canvas/custom-rendered UI with nothing addressable via DOM. Selectors are standard CSS or a snapshot node id; Puppeteer's `pierce/`, `xpath/`, `aria/` and `text/` prefixes also work. `wait_for_selector` takes `state`: `visible` (the default; non-empty box and not `visibility:hidden`, `opacity:0` still counts), `attached` (just in the DOM) or `hidden` (removed or not visible; succeeds at once if nothing matches). `wait_for` waits on a *page condition* (text, text gone, URL, a JS expression) instead of an element: see "Waiting" below. Every tool in this row except the two waits takes `settle` (see "Waiting" for what it does and does not see). Playwright-style syntax (`text=`, `role=`, `>>`, `:has-text()`, `getBy*()`) is rejected immediately with a hint — use `click_by_text`/`click_by_role`/`type_by_label` to target by visible text or accessible role/name instead. |
| **Capture & extraction** | `screenshot`, `audit`, `export_pdf`, `eval`, `extract_data` | Get data out. `audit` returns a JSON report (console/page errors, broken requests, a11y heuristics, Web Vitals) plus the screenshot; pass `url` for full coverage (auditing the current page as-is only sees activity since this session attached); findings never fail the call. `extract_data` takes a field-name → CSS-selector map and returns real matched values — prefer this over eyeballing a screenshot for anything you need to assert on. With no `attribute`, form controls (`input`/`select`/`textarea`) return their **live** current value (including typed-but-unsubmitted text) and other elements return rendered text; `"value"`/`"checked"`/`"selected"` read live DOM state, `"attr:<name>"` reads the raw HTML attribute, and `visibleOnly` (whole call or per field) drops non-visible matches. Both `eval` and `extract_data` accept an optional `frameSelector` (a CSS selector or snapshot `[#id]` for an `<iframe>` element) to read inside that frame instead of the top-level page — including a genuinely cross-origin one. |
| **Storage** | `get_cookies`/`set_cookie`/`delete_cookie`, `get_local_storage`/`set_local_storage_item`/`clear_local_storage`, `get_session_storage`/`set_session_storage_item`/`clear_session_storage`, `get_storage_state`/`set_storage_state` | Cookie/storage read-write. The `storage_state` pair is a single-blob export/import of all three at once — the way to log in once and reuse that session later. |
| **Emulation & permissions** | `set_geolocation`, `grant_permissions`, `set_viewport`/`get_viewport`, `emulate`, `get_clipboard`/`set_clipboard`, `set_network_conditions` | Geolocation, camera/clipboard/notification permissions, viewport/mobile emulation, timezone/locale/color-scheme, throttled or offline network. |
| **Dialogs, observability & network** | `get_pending_dialog`/`handle_dialog`, `get_console_logs`, `get_page_errors`, `get_network_log`, `get_action_history`, `route`/`clear_routes` | Handle native `alert`/`confirm`/`prompt` dialogs (an unhandled one is auto-dismissed after 30 s over MCP), and — importantly — **check what actually happened**: console output, uncaught JS errors, real network requests/responses. Don't call a flow verified without checking these. `get_action_history` is the record of what was run (navigate and `eval` included; `eval` as a 200-character preview, never its result), each entry with its `verification`; `scope:"session"` merges every tab, closed ones too, and `evicted` says exactly how many older entries the 200-entry cap dropped. Privacy (the character rule: one function, same for MCP, the SDK and the CLI's `history.jsonl`, no URL recognition): stored text is split on any Unicode whitespace; in each token everything from the first `?`, `#` or `;` is replaced by `[redacted]` and the rest of the text after that cut is dropped; a token that still contains `=` or `&` is replaced whole; `userinfo@` is stripped; a token with a `/` or `\` followed by more text is reduced to its last segment (`<dir>` when it has no `.`; a `scheme://` URL keeps origin + path); `%3F`, `%23`, `%3B`, `%253F` and JSON / fullwidth forms are decoded first. Ordinary text containing those characters is redacted too (over-redaction is deliberate; it only affects the stored history, never a live result), and selectors keep `#id` and `[a=b]`. The CLI stores `cwd` as `~/dir` or `<dir>`. Typed, `select`, clipboard and dialog-prompt text are lengths only. **Stored, redacted by that rule and capped (not masked):** eval code (first 200 chars; the character rule applies to it too, so a `=` token or everything after a `;` or `?` is stored as `[redacted]`), selectors, `click_by_text` text, `expect.text` / `wait_for` text and page text quoted in errors or evidence. **Not recorded:** eval results, CLI flags, `handle_dialog`, tab lifecycle and cookie/storage setters. Full rule and limits: `packages/cli/README.md#history`. |
| **Tabs** | `list_tabs`, `new_tab`, `focus_tab`, `close_tab`, `lock_tab`/`unlock_tab`/`get_tab_lock` | Multi-tab handling. The lock tools are an advisory owner+TTL mechanism if multiple concurrent callers need to coordinate driving the same session. |
| **Autonomous agent** | `agent.runGoal` | Optional. Hands a natural-language goal to Sutradhar's own loop. Only registered if an LLM provider (Ollama or an OpenRouter key) is separately configured for the server. |

## Reading results: `success` vs `verification`

Every action result (`click`, `type`, `press_key`, `focus`, `navigate`, `go_back`, `set_clipboard`,
`click_at_point`, `download_file`, `upload_file_via_trigger`, `screenshot`, …) carries two separate answers,
and you should read both:

- **`success`** (true/false) — did the primitive run? `false` means the action did not happen: the element
  was missing, occluded, the download timed out. `error` says why.
- **`verification`** — was its *effect* observed? `{verified, confidence, reason, evidence:{tier, checks[]}}`.
  Branch on `evidence.tier`, never on the confidence number:

| `tier` | Meaning | `verified` | `confidence` |
|---|---|---|---|
| `verified` | A real post-condition check ran and passed. | true | 0.90 |
| `contradicted` | A check ran and found the effect did **not** happen (a key delivered but the field didn't change; a 0-byte download; a `go_back` with no history; a clipboard write the page intercepted). The action itself still reports `success:true`. | false | 0.09 |
| `unverifiable` | Nothing could be checked, and `reason` says exactly why (no element had focus, the clipboard read was blocked, a screenshot has no post-condition). It does **not** mean the action failed. | false | 0.45 |
| `low-confidence` | The target was a fuzzy match. | false | as given |
| `action-failed` | `success:false`; nothing to verify. | false | 0 |

`evidence.checks[]` lists each check with a stable id (`press_key.effect`, `download_file.file-on-disk`,
`navigate.document`, `expect.text`, …) and what was expected vs observed. It never contains field values or
clipboard contents.

A failed `contradicted` verification is the honest signal that a "successful" action did nothing. Three cases
to know: `press_key` is only verified against the *focused* element (`focus` first, or pass `expect`);
`click_at_point` verifies that a trusted click reached *some* element and names it, but cannot know which one
you *meant* (a transparent overlay is named in the reason); an `Enter` key is "delivered", not "form submitted".
For anything where the *result* matters, assert it with `expect`.

**`expect: {text?, url?, urlChanged?}`** (on the 24 state-changing tools; CLI: `--expect-text`, `--expect-url`,
`--expect-url-changed`/`--expect-url-unchanged`; SDK: `options.expect`) is checked once, right after the action
(after `settle`, if requested). `text` is *rendered* text: laid out, `visibility:visible`, not under `display:none` / `content-visibility:hidden` / a closed `<details>`, and every enclosing `<iframe>` itself rendered and visible. `opacity:0`, `aria-hidden`, off-screen and clipped text still count ("rendered", not "perceivable"), in any frame or open shadow root (case-sensitive
substring; script text never counts); `url` is a substring of the final URL; `urlChanged:false`
means the URL must be identical. A failed `expect` does **not** fail the action: `success` stays true and
`verification.verified` is false with `tier:"contradicted"` and a failing `expect.*` check. Note it is checked
*once*: text that appears 800 ms later (a `setTimeout` toast) is missed. Use `wait_for` (or `wait_for_selector`) for that.
It is best effort, not a paint check: text inside SVG containers that are never painted (`<defs>`, an unused
`<symbol>`, `<mask>`, `<clipPath>`, `<pattern>`, `<marker>`) still counts, because Chrome reports it as laid
out and visible; visible text split across `inline-block`/flex items, or inside a `<textarea>`, can be missed.

Every result also carries `dialogPending: {type, message, defaultValue, url}` **while** a native dialog is open
on the tab (the key is absent otherwise). The page is frozen until you `handle_dialog`; checks that need the page
report `unverifiable` with the dialog named instead of hanging.

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

## Waiting: wait on conditions, never sleep

Fixed delays are the #1 cause of flaky browser automation. A `sleep(2000)` is either too short (the
toast shows up at 2.3s on a slow run, and you read the page too early) or too long (every run pays
the full delay), and the result never tells you which one happened. Sutradhar gives you waits that
end the moment the thing you care about is true, and fail with a message saying what was still
missing when it isn't.

**Decide what you're actually waiting for, then wait for exactly that:**

| You're waiting for… | Use |
|---|---|
| an element to appear, become visible, or go away | `browser.wait_for_selector` (`state`: `visible` default, `attached`, `hidden`) |
| some text to show up anywhere on the page | `browser.wait_for` `{text}` |
| a spinner / "Loading…" / "Saving…" message to go away | `browser.wait_for` `{textGone}` |
| a navigation or client-side route change | `browser.wait_for` `{url}` |
| app state that isn't visible in the DOM (a JS flag, a store value, a counter) | `browser.wait_for` `{js}` |
| "let the page finish reacting" after an action, with no specific signal | `settle: true` on that action |

**`wait_for` examples** (MCP, then CLI, then SDK):

```jsonc
{ "sessionId": "s1", "text": "Saved successfully" }                          // appears
{ "sessionId": "s1", "textGone": "Loading…", "timeoutMs": 20000 }             // disappears
{ "sessionId": "s1", "url": "/dashboard" }                                    // route changed
{ "sessionId": "s1", "js": "window.__app?.ready === true" }                   // JS state
{ "sessionId": "s1", "url": "/orders/", "text": "Order confirmed" }           // BOTH must hold
```

```bash
sutradhar waitfor --text "Saved successfully"
sutradhar waitfor 20000 --text-gone "Loading…"
sutradhar waitfor --url /dashboard
sutradhar waitfor --js "window.__app?.ready === true"
sutradhar waitfor --url /orders/ --text "Order confirmed"
```

```ts
await page.waitFor({ text: 'Saved successfully' });
await page.waitFor({ textGone: 'Loading…', timeout: 20000 });
await page.waitFor({ url: '/dashboard' });
await page.waitFor({ js: 'window.__app?.ready === true' });
```

**What each condition means, exactly:**
- `text` is *rendered* text, the same rule (and the same code) as `expect.text`: laid out,
  `visibility:visible`, not under `display:none` / `content-visibility:hidden` / a closed `<details>`, and every
  enclosing `<iframe>` itself visible, across every frame and open shadow root, case-sensitive. A form field's
  *value* is not text: use `js` for values, e.g. `document.querySelector('#email')?.value === 'a@b.com'`.
  `opacity:0`, `aria-hidden`, off-screen and clipped text still count. It is best effort, not a paint check,
  and inherits `expect.text`'s two documented limits: text inside SVG containers that are never painted
  (`<defs>`, an unused `<symbol>`, `<mask>`, `<clipPath>`, `<pattern>`, `<marker>`) still counts, and visible
  text split across `inline-block`/flex items, or inside a `<textarea>`, can be missed (use `js` for those).
- `textGone` succeeds **immediately** if the text was never on the page. The result's
  `output.presentAtStart` is `false` in that case, and `verification` is `unverifiable`. Check it if you
  expected the text to be there (a typo looks exactly like "already gone"). A frame that could not be
  inspected (it hung, it went away, a dialog is open) is never read as "gone": the wait keeps polling and,
  on timeout, says it could not check.
- `url` is a plain substring of the current URL, including `pushState` and `#hash` changes.
- `js` is an **expression** (not statements; wrap those in an IIFE). It re-runs about every
  100 ms, so it must not change anything. If it throws, the wait fails right away with the page's
  error, so guard it with `?.`. It runs in the top frame only.
- Several conditions together mean **all of them, at the same moment**.
- `timeoutMs` defaults to 10000 (max 300000; the CLI caps at 280000); `0` means "check once, don't wait". It's
  the real total, with no hidden retries, but not a hard ceiling on a frozen page: a failed wait can spend up to
  1.5 s more reading the page title, so the total is bounded but can exceed `timeoutMs` by up to about 3 s. On
  timeout the error lists which conditions were met and which weren't.
- It polls from outside the page, so it keeps working in a background tab (where the browser stops
  `requestAnimationFrame`, measured here: a `page.waitForFunction` in a hidden tab never fired) and on a
  strict-CSP page. If a native dialog (alert/confirm) blocks the page, it fails and tells you to handle the
  dialog (CLI: exit 3). A dialog that is already open fails the wait in about 1 s; one that opens partway
  through a check can take up to about 2.7 s after it opens. It doesn't hang.
- A condition is checked once per poll (about every 100 ms). Text visible for less than one poll interval
  (about 100 ms) can be missed; use it for states that persist.

**`settle` vs `wait_for` vs `expect`: three different tools.**
- `settle: true` on an action (every tool that interacts with or navigates the page accepts it: `navigate`,
  `go_back`/`go_forward`/`reload`, `click*`, `type*`, `press_key`, `focus`, `hover`, `scroll`, `select_option(s)`,
  `fill_form`, `upload_file*`, `download_file`, `drag_*`, `touch_tap`, `right_click`, `handle_dialog`) waits
  until the DOM has stopped changing and the network is idle, up to 5 s. It's a heuristic for "let the menu
  finish rendering". **It can't see a timer the page scheduled for later.** A page that calls
  `setTimeout(showToast, 2000)` looks perfectly quiet for those two seconds, so settle returns
  before the toast exists. It never fails an action, and it is bounded even when the action opened a native
  dialog. Tools that only read or configure (snapshot, eval, cookies, storage, viewport, tabs, ...) don't take it.
- `wait_for` waits for the specific thing you name, however long it takes, up to the timeout.
- `expect` on an action (`{text, url, urlChanged}`) is a **one-shot check right after the
  action**. It never waits. If the effect you expect is delayed, do the action, then
  `wait_for` the effect.

**Don't build your own polling loop** out of repeated `snapshot`/`eval` calls with sleeps in
between. Each iteration is a full round trip through your context window, and you'll still guess
the interval. One `wait_for` call does the same thing in-process every 100 ms, and returns one
result.

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

The example commands above aren't the full CLI — it also has `select`/`wait`/`waitfor`/`eval`/`hover`/
`scroll`/`upload`/`drag`/`download`, coordinate-only `clickpoint`/`dragpoints` (for
canvas-rendered UI with nothing DOM-addressable), tab management (`tabs`/`newtab`/`focustab`/
`closetab`), clipboard + permissions (`grant`/`setclipboard`/`getclipboard`), an
`audit --baseline <url>` one-command regression gate, a `--settle` flag for every interaction verb
(`click`/`type`/`scroll`/`nav`/`clicktext`/`clickrole`/`press`/`select`/`hover`/`upload`/`drag`/`clickpoint`/
`dragpoints`/`download`: waits for the page to stop actively changing before returning; it can't see a timer the
page scheduled for later, so use `waitfor` for a specific result), a `waitfor` verb (`--text`/`--text-gone`/
`--url`/`--js`, see "Waiting" above; these flags are an error on any other verb), a `--modifiers` flag
for `press` (hold modifier keys, e.g. Ctrl+Shift+ArrowRight to select a word),
`--no-text`/`--ids-only`/`--scan-listeners` flags for `snap`, and an `--allowlist-domains`
navigation guardrail. `download` defaults to `<OS temp>/sutradhar-downloads` (configurable via
`SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`), and `upload` is unrestricted unless
`SUTRADHAR_ALLOWED_UPLOAD_ROOTS` is set. Run `sutradhar` with no arguments for the complete,
current command and flag list straight from the binary — that's the authoritative reference,
not this file.

Native dialogs (`alert`/`confirm`/`prompt`/`beforeunload`) are the one place the CLI's default
behavior differs from the MCP server and SDK: by default a session leaves a dialog open and
reports it (`dialogPending: {...}` on stdout) rather than silently accepting or dismissing it,
and any command that finds one blocking the page exits with code **3** instead of hanging. Run
`sutradhar dialog` to see what's open, `sutradhar dialog accept [text]|dismiss` to resolve it, or
set `--dialog accept|dismiss` once to make future dialogs in that session resolve automatically
(`--dialog report` restores the default, and — like `accept`/`dismiss` — persists explicitly,
it does not just clear a previous setting). This is safe across separate CLI invocations because
of a small per-session helper process (the "dialog warden") that stays attached even between
commands; see `packages/cli/README.md`'s "Native dialogs" section for the full behavior.

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

- **No stealth or bot-detection evasion, by design.** Sutradhar does not attempt to evade
  bot-detection or solve CAPTCHAs, and Cloudflare challenges, CAPTCHA walls, and IP-level
  blocks stop it exactly as they would stop any other automation tool run the same way — this
  was directly measured and confirmed, not assumed, across real benchmark runs against real
  sites. The only launch argument here with detection-relevant behavior is
  `--disable-blink-features=AutomationControlled`, which hides `navigator.webdriver` from
  scripts that check for it -- measured directly: `navigator.webdriver` is `true` without the
  flag and `false` with it. It does not defeat Cloudflare, CAPTCHA, or any other real
  bot-detection service, and other simple signals -- the default headless user agent's
  `HeadlessChrome` substring and `--enable-automation` still being present in the launch
  command line -- remain unmasked.
- **Downloads: one at a time per browser.** `download_file` (and CLI `download`) only writes inside
  the allowed roots (`<OS temp>/sutradhar-downloads` by default; `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`
  replaces it) and that path containment is verified, including symlink/junction and Windows path
  tricks. Overlapping downloads are only protected on a best-effort basis: a second `download_file`
  on the same browser is refused immediately, but the lock lives in the process temp directory and
  is keyed by the exact browser endpoint string, so separate processes (two MCP servers, or several
  CLI commands, since each CLI command is its own process) may not share it. Drive downloads for a
  browser from one process at a time. A download the page starts by itself (not through
  `download_file`) is not governed by the roots and can land in Chrome's default download location.
- **CLI dialogs and crashed tabs have known gaps.** If the page that opened several popups closes
  before you handle them, `sutradhar dialog accept|dismiss` can close the wrong popup first. A tab
  that is busy from the moment it is created can be reported as blocked (exit 3) with no dialog
  open. After a crash of any tab (`chrome://crash`), other gated commands (`nav`, `snap`, ...) hang
  until the crashed tab is closed: run `sutradhar tabs`, then `sutradhar closetab <id>`, using the id
  exactly as printed. The crash note's advice to reload with `nav` is wrong for `chrome://crash`.
  MCP and the SDK are not affected by any of this (they keep the `auto` dialog policy).
- **`audit` limits.** Auditing the current page (no `url`) of a brand-new tab right after its first
  navigation can miss the page's own HTTP error status while still saying it covers the whole
  document. The settle wait is a fixed 1500 ms, so a slower request can be missing. A page restored
  from the back/forward cache reports `coversWholeDocument: false`. Only HTTP 400+ counts as a
  broken request. The accessibility checks are heuristics, not a WCAG audit.
- **`wait_for_selector` limits.** Treat a `state: "hidden"` success as best effort (that code path
  produced false answers in several audit rounds; the known ones are fixed). Only the first matching
  element is checked, `opacity: 0` counts as visible, polling is about every 100 ms, and a failed
  visible-wait can take about 3 x `timeoutMs` because the engine retries twice (`timeoutMs <= 0`
  does not retry).
- **Not implemented yet:** a unified verification contract, condition waits everywhere,
  a `sutradhar run` scenario runner, a `.sutradhar.json` project config and
  automatic session/profile garbage collection are not part of this version.
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
