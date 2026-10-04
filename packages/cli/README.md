# @sutradhar/cli

A terminal CLI for driving the Sutradhar browser engine directly — `nav`/`snap`/`click`/`type`,
plus site auditing and visual-regression diffing — without writing a script or wiring up an
MCP client.

Every command is its own one-shot process, but they all operate on the **same live browser
session**: the first command that needs a browser spawns a detached Chrome and remembers how
to reconnect to it (in `~/.sutradhar-cli/<hash-of-cwd>/state.json`, scoped automatically to the
directory you're running from so two unrelated projects on the same machine never collide);
every later command re-attaches to that same session instead of launching a new one. Run
`sutradhar close` when you're done. Set `SUTRADHAR_CLI_STATE_DIR` to point at a custom path
instead — e.g. to deliberately share one session across directories.

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
sutradhar nav https://example.com     # navigates (spawns a session if none is active; other commands need one)
sutradhar snap                        # prints the interactive-element listing
sutradhar click 4                     # click by the numeric [#id] from "snap"
sutradhar text                        # print the page's visible text
sutradhar close                       # done — closes the session
```

Run `sutradhar` with no arguments for the full command list.

## Commands

| Command | Description |
|---|---|
| `nav <url>` | Navigate to a URL (launches a session if none is active). Only `nav <url>`, `newtab <url>`, `audit <url>` and `compare <urlA> <urlB>` start a session; every other command needs one already open and otherwise exits 1 with `no active browser session ... Start a session with: sutradhar nav <url>` (it does not launch a blank browser). `grant` therefore needs an open session. |
| `back` / `forward` / `reload` | Go back / forward one history entry on the active tab, or reload it. Take `--settle`, `--expect-*`, `--json`, `--dialog`. Print `Navigated back to <url>` / `Navigated forward to <url>` / `Reloaded <url>`; same-page entries (`pushState`, `#hash`) count as navigation. At the start/end of history `back`/`forward` print `Back: no history entry to go back to` / `Forward: no forward history entry` and exit 1, **also when an `--expect-*` flag is given** (this is the one exception to the `--expect-*` exit-4 rule below); with `--json` the JSON (carrying a `go_back.history-edge` / `go_forward.history-edge` check) is on stdout and the edge line on stderr. A `beforeunload` dialog dismissed with `--dialog dismiss` cancels the move (exit 1, after Chrome's ~30 s navigation timeout). |
| `snap` | Print the interactive-element listing for the current page. |
| `snap --json` | Same, plus the raw structured per-element data as JSON. |
| `snap --no-text` | Same elements, drops name/label/placeholder/value text (keeps tag+role+id) — smaller listing when you already know what you're targeting and just need fresh ids. |
| `snap --ids-only` | Smallest listing: only the bracketed `[#id]`, nothing else. |
| `snap --scan-listeners` | Also finds elements whose only interactivity signal is a real `addEventListener`-attached handler (no `onclick=`/role/`tabindex`/`cursor:pointer`) — e.g. SortableJS-style drag lists. Slower; real CDP introspection. |
| `axsnap` | Accessibility-tree listing — no ids, never goes stale even if the page re-renders; pair with `clicktext`/`clickrole`. |
| `text [--offset N] [--max-chars N] [--json]` | Print the current page's visible text: the first 4000 characters by default. When the page has more, the **last stdout line** is a marker `[page text truncated: showing characters A-B of N. Continue with: sutradhar text --offset B]` (the last window ends `(end)`; an offset past the end prints an empty window and `offset N is past the end`). Page with `--offset`, or raise `--max-chars` (1..100000). `--json` prints the window plus totals (`totalChars`, `truncated`, ...) as one JSON document with no marker line. Bad flag values exit 1 before the browser is touched. A page whose text cannot be read exits 1 with `Error: text read failed: <reason>` (never empty text with exit 0); a PDF in the bundled build is such a case (PROB-052, see Known limitations). |
| `click <ref>` | Click an element (selector, or a node id from `snap`: `5`, `#5` and `[#5]` all work). |
| `clicktext <text>` | Click the element containing this text (from `axsnap`). |
| `clickrole <role> [name]` | Click by accessibility role, optionally narrowed by name (e.g. `clickrole button Submit`). |
| `type <ref> <text>` | Type text into an element. |
| `press <ref> <key>` | Focus an element then press a key (e.g. `press 3 Enter`). |
| `press <ref> <key> --modifiers Control,Shift` | Hold modifier keys while pressing (e.g. Ctrl+Shift+ArrowRight to select a word — a real rich-text-editor toolbar formatting workflow). |
| `select <ref> <value>` | Select an `<option>` by value on a `<select>`. |
| `wait <ref> [timeoutMs] [--state visible\|attached\|hidden]` | Wait for an element to become visible (default), just attached to the DOM (`--state attached`, visibility ignored), or removed/not visible (`--state hidden`). "Visible" means a non-empty bounding box AND computed visibility not `hidden`/`collapse`, checked on the FIRST matching element — `opacity:0` and off-screen elements still count as visible; zero width/height, `display:none` and `visibility:hidden` count as hidden. `--state hidden` succeeds immediately if nothing matches the selector at all. `timeoutMs` applies per internal attempt; retries can extend the real total wait beyond it (open issue). `timeoutMs <= 0` checks the current state once, immediately, with no waiting or retrying. Waiting states poll roughly every 100ms, so a state that's only true for less than ~100ms (a fast visibility flicker) may be missed. |
| `waitfor [timeoutMs] --text <t> \| --text-gone <t> \| --url <s> \| --js <expr>` | Wait until a page condition is true (default 10000 ms, max 280000, `0` = check once) instead of sleeping. `--text`: rendered text, the same rule and code as `expect.text`, so the same documented limits (best effort: text inside never-painted SVG containers counts; visible text split across inline-block items or inside a `<textarea>` can be missed). `--text-gone`: that text is absent from every frame; succeeds at once if it was never there (stderr `Note:`, and the Verification line says `unverifiable`); a frame that could not be inspected is never read as gone. `--url`: the URL contains `<s>` (`pushState`/hash included). `--js`: a JavaScript expression evaluated in the top frame, truthy = done (side-effect free; a throw fails the wait). Give several to require all at once. Quote multi-word values. Exit 0 met, 1 timed out or failed, 3 blocked by an open dialog. The four flags are an error on any other verb. |
| `eval <js-expression>` | Evaluate JS in the page's top-level context, print the result. |
| `eval <js-expression> --frame <selector>` | Same, but inside a specific `<iframe>` (selector or numeric id from `snap`) — including a genuinely cross-origin one. Chain with `::` for an iframe nested inside another iframe, e.g. `--frame "iframe.widget::iframe.payment"`. |
| `hover <ref>` | Hover an element. |
| `scroll [dir] [amountPx]` | Scroll the page (`dir`: up/down/top/bottom, default down 500px). |
| `scroll [dir] [amountPx] [targetRef]` | Scroll a specific element's own scroll container instead of the window (a data grid's rows, a chat pane, a modal body) — pair with `--settle` to reliably see newly-revealed content. |
| `upload <ref> <filePath>` | Upload a local file into an `<input type="file">`. Unrestricted unless `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` is set. |
| `drag <sourceRef> <destRef>` | Drag one element onto another. |
| `clickpoint <x> <y>` | Click at an absolute viewport coordinate — no element/selector, for canvas-rendered UI with nothing DOM-addressable to target. |
| `dragpoints <fromX> <fromY> <toX> <toY>` | Real mouse-down→move→up drag between two absolute viewport coordinates — for canvas-rendered drag targets (a signature pad, a slider/chart handle drawn on a `<canvas>`). |
| `grant <origin> <permission...>` | Grant browser permissions for an origin (e.g. `clipboard-read`, `clipboard-write`, `geolocation`, `notifications`) — needed before `setclipboard`/`getclipboard` work against most real sites. |
| `setclipboard <text>` | Set the system clipboard (e.g. to then paste into a rich-text editor via `press <ref> v --modifiers Control`). |
| `getclipboard` | Print the current system clipboard contents. |
| `tabs` | List open tabs (id, title, url) — `*` marks the active one. Still works when a tab is blocked by a dialog or has crashed: it then lists browser target ids at the browser level without attaching to any page, and marks crashed tabs `[crashed]`. |
| `newtab [url]` | Open a new tab, optionally navigating it immediately. |
| `focustab <tabId>` | Switch the active tab (e.g. after a link opened `target="_blank"`). |
| `closetab <tabId>` | Close a specific tab. Also works on a blocked or crashed tab (pass the target id exactly as `tabs` printed it — see [Known limitations](#known-limitations)). |
| `download <ref> [dir]` | Click an element that triggers a download, print the saved absolute path. Run one download per browser at a time (see [Known limitations](#known-limitations)). `[dir]` (relative to the current directory) is always allowed for this command; without it the file goes to the first allowed download root (`<OS temp>/sutradhar-downloads` by default, or `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`'s first entry). |
| `screenshot [path]` | Save a screenshot (default: `./screenshot.png`). |
| `audit [url] [outDir] [--json]` | Screenshot + console/page/network errors + accessibility heuristics + Web Vitals for a page (current page if no url; use `""` as url to also pass an outDir). `outDir` is created if missing. `--json` prints one machine-readable report (schemaVersion 1, see `packages/capability-runtime/schemas/audit-report.schema.json`) instead of the human-readable text; images are always written as files and referenced by absolute path, never inlined. Auditing the current page only sees errors/requests since this command attached — pass the url for full coverage. |
| `audit [url] [outDir] --baseline <url>` | Same, plus a pixel-diff of `<url>` vs a fresh load of the audited url (viewport screenshots; the page is reloaded) — a one-command regression gate combining `audit` + `compare`. |
| `compare <urlA> <urlB> [out]` | Visual regression: pixel-diff two pages, save a diff image. |
| `dialog` | Show any open native dialog (alert/confirm/prompt/beforeunload), or "No dialog is open." |
| `dialog accept [text]` | Accept the oldest open dialog (`text` = what to type into a `prompt()`; ignored for other dialog types). |
| `dialog dismiss` | Dismiss the oldest open dialog. |
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
| `--allowlist-domains <a.com,b.com>` | any command | Block navigation to any domain not in this comma-separated list (and their subdomains). Per-command, not persisted in session state — pass it on every command that might navigate. An empty value (`--allowlist-domains ""`) is an error, not "unrestricted" (breaking change; omit the flag for no restriction). |
| `--json` | `snap`, `audit`, action verbs | `snap`: additionally print structured per-element data as JSON. `audit`: print the machine-readable JSON report instead of the human-readable text. Action verbs (`click`, `type`, `press`, `nav`, `download`, …): print the full result JSON (including `verification`) instead of the one-line status. |
| `--expect-text <t>` | action verbs | After the action, require this **rendered** text on the page (any frame, open shadow roots; case-sensitive): laid out, `visibility:visible`, not under `display:none` / `content-visibility:hidden` / a closed `<details>`, and every enclosing `<iframe>` itself visible; `opacity:0`, `aria-hidden`, off-screen and clipped text still count. Known limit: text inside SVG containers that are never painted (<defs>, an unused <symbol>, <mask>, <clipPath>, <pattern>, <marker>) still counts, because Chrome reports it as laid out and visible. Exit **4** if absent. Checked once. |
| `--expect-url <s>` | action verbs | Require the final URL to contain `<s>` (exit 4 if not). |
| `--expect-url-changed` / `--expect-url-unchanged` | action verbs | Require the URL to have changed / stayed identical (exit 4 otherwise). Mutually exclusive. |
| `--no-text` | `snap` | Drop per-element text, keep tag+role+id. |
| `--ids-only` | `snap` | Keep only the bracketed id, nothing else. |
| `--baseline <url>` | `audit` | Also visually diff the audited page against this URL. |
| `--fail-on-diff` | `compare`, `audit` | Exit nonzero if a pixel difference is found (`compare`), or if any console/page/broken-request error or (with `--baseline`) visual diff is found (`audit`) — CI-friendly gating. |
| `--settle` | `click`, `type`, `scroll`, `nav`, `clicktext`, `clickrole`, `press`, `select`, `hover`, `upload`, `drag`, `clickpoint`, `dragpoints`, `download` | Wait for the page to stop actively changing (no DOM mutations, no in-flight network requests; 5 s bound) before returning — helps when the action triggers a menu/modal/toast/virtualized-list-update that renders a moment later. It cannot see a timer the page scheduled for later: use `waitfor` for a specific result. Ignored on other verbs. |
| `--text <t>` / `--text-gone <t>` / `--url <s>` / `--js <expr>` | `waitfor` | The conditions to wait for (see `waitfor`). An error on any other verb (a `click 7 --text Saved` would otherwise look like an assertion that never ran; use `--expect-text`). |
| `--scan-listeners` | `snap` | Also find real `addEventListener`-only elements (see command list above). |
| `--state <visible|attached|hidden>` | `wait` | Which state to wait for (default `visible`). |
| `--viewport <WxH>` | session creation | Set the CDP viewport (e.g. `--viewport 390x844`; each side 1..10000000, anything else is rejected before Chrome starts) and, with `--headed`, the real OS window size. Persists across later commands until a new `--viewport` is given. |
| `--frame <selector>` | `eval` | Evaluate inside a specific `<iframe>` (see the `eval` rows above). |
| `--modifiers <Control,Shift>` | `press` | Hold modifier keys while pressing the given key. |
| `--dialog <accept\|dismiss\|report>` | any session command | Sets this session's default policy for native dialogs (alert/confirm/prompt/beforeunload), **persisted** across later commands until changed again — including `--dialog report`, which explicitly persists back to the default "leave it open and report it" behavior (it does not merely clear a previous `accept`/`dismiss`). `report` (the CLI's own default) never auto-resolves alert/confirm/prompt; while one is open, other commands exit with code **3** until you run `sutradhar dialog accept\|dismiss`. `beforeunload` during a navigation is still auto-accepted after 3s under `report`, so a page-initiated "leave this page?" prompt can't hang a `nav` forever. |
| `--dialog-text <text>` | any session command, with `--dialog accept` | The text entered into `prompt()` dialogs when the session's policy auto-accepts one (default: the prompt's own default value). |

**Verification and exit codes.** Every action verb prints its status line and then a `Verification:` line, e.g.
`Verification: verified (confidence 0.90) — keydown 'a' reached the focused input#q and its value changed` or
`Verification: NOT verified — contradicted (confidence 0.09) — …`. `NOT verified — unverifiable` means nothing could
be checked (the reason says why), **not** that the action failed; `contradicted` means a check ran and the effect did
not happen (the exit code is still 0 unless you asked for an `--expect-*`). Exit codes: **0** ok, **1** the action
failed, **3** blocked by an open dialog, **4** an `--expect-*` check failed or couldn't be evaluated (the reason is on
stderr). `getclipboard` keeps stdout as just the clipboard text and prints its verification line on stderr. `press`
now aborts (`Press aborted: …`, exit 1, no key sent) when focusing the target fails or lands elsewhere, instead of
pressing into whatever holds focus.

**Selectors.** Selectors are CSS (shadow roots crossed for element actions), a node id from `snap` (`5`, `#5` or `[#5]`, exactly as `snap` prints it), or Puppeteer's `pierce/`, `xpath/`, `aria/` and `text/` prefixes. Playwright syntax (`text=`, `role=`, `>>`, `:has-text()`, `getBy*()`, `internal:`) and the old `xpath=`/`aria=`/`pierce=` forms are rejected immediately with a hint instead of failing slowly — use `clicktext`/`clickrole` to target by visible text or accessible role. Invalid CSS/XPath fails in one round trip with the browser's own parser message.

Run `sutradhar` with no arguments for this same list straight from the binary.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` | `<OS temp>/sutradhar-downloads` | Directories `download` may write into, separated by `;` (Windows) or `:` (elsewhere); absolute paths, or `~` for the home directory. Replaces the default; the first entry becomes the destination when `download`'s `[dir]` is omitted. The directory named on `download <ref> <dir>` itself is always allowed too, for that one invocation only — it is not written to session state and does not widen later commands. |
| `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` | _(unset — unrestricted)_ | If set, `upload` may only read files under these directories (off by default). |
| `SUTRADHAR_ALLOWED_DOMAINS` | _(unset — any domain)_ | Comma-separated domains navigation is limited to (and their subdomains); the same as `--allowlist-domains` on every command. Overridden by the flag; overrides `.sutradhar.json`. |
| `SUTRADHAR_CONFIG` | _(unset — search for `.sutradhar.json`)_ | An absolute path loads exactly that project config file; `none` ignores project config. See "Project config" below. |
| `SUTRADHAR_CLI_STATE_DIR` | per-project-directory hash | Where session state (`state.json`) is stored — see above. |
| `SUTRADHAR_CLI_DEADLINE_MS` | `300000` | Process watchdog: a command still running after this many milliseconds is stopped with an error message. `wait <ref> <timeoutMs>` extends its own deadline to at least 3 x `timeoutMs` + 30 s. |
| `SUTRADHAR_CLI_DEBUG_CLEANUP` | _(unset — silent)_ | Diagnostics switch. Set to `1` to print `[cleanup] <event> ...` lines on stderr for every temp-profile directory (`<OS temp>/sutradhar-cli-*`) that the session-end cleanup (`close`, self-heal) and the session-start sweep consider, create, remove or keep; every path appears as `path="<absolute path>"`. The cleanup is bounded: `close` spends at most 15 s on it and the sweep at most 15 s, measured on a monotonic clock, and no delete starts with less than 1 s left. A delete that has already started cannot be cancelled and may finish after that. |

## Project config (`.sutradhar.json`)

Put a `.sutradhar.json` in a project directory and every command run from that directory or a subdirectory picks it
up (the nearest file wins; the search stops at a `.git` boundary or your home directory and never reads the
filesystem root). Example:

```json
{
  "$schema": "urn:sutradhar:config:1",
  "allowedDomains": ["example.com", "localhost"],
  "downloadDir": "./downloads",
  "allowedUploadRoots": ["./fixtures"],
  "dialog": { "mode": "dismiss" },
  "viewport": { "width": 1280, "height": 800 },
  "idleTimeoutMs": 1800000
}
```

Precedence for every key is **flag > env var > config file > built-in default**: `--allowlist-domains` beats
`SUTRADHAR_ALLOWED_DOMAINS` beats `allowedDomains`; `--viewport` (and the viewport it made sticky) beats `viewport`;
`--dialog` (and the policy it made sticky, including `--dialog report`) beats `dialog`;
`SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`/`SUTRADHAR_ALLOWED_UPLOAD_ROOTS` replace the file's roots (including an out-of-tree `downloadDir` that would otherwise be refused). Paths in the file are
relative to the file, not to your shell's directory (the `[dir]` of `download <ref> [dir]` is still relative to your
shell). `idleTimeoutMs` is ignored by the CLI. The file is re-read on every command and nothing from it is written
to session state.

`sutradhar doctor` prints the file in use and the source of every key. Unknown keys print `Warning:`; an invalid
file prints `Error:` and exits 1 before Chrome is touched (`close`, `profile` and `dialog` never load it, so a broken
file cannot block cleanup; `doctor` does load it but only reports a broken one and still exits 0). `SUTRADHAR_CONFIG=none` ignores it. A file found by searching upward is
untrusted: its download directory must stay inside its own folder (and outside `.git`), and a `dialog.mode "accept"`
or file-supplied download directory is announced with a `Note:` on every command. Details: `docs/project-config.md`.

## Native dialogs (alert / confirm / prompt / beforeunload)

Because each `sutradhar` command is its own short-lived process, a dialog opened by one command
(e.g. `sutradhar click "#delete"` triggering a `confirm()`) would otherwise be invisible to, and
unhandleable by, the next one — the in-page `Dialog` object only ever exists inside the process
that was attached when it opened. The CLI runs a small per-session **dialog warden** (a detached
helper process, started automatically alongside the browser) that stays attached the whole time,
so a dialog left open between commands can still be seen and handled later:

```bash
sutradhar nav https://example.com
sutradhar click "#delete"        # opens a confirm() — the click "succeeds", but the
                                  # confirm is left open (the default policy is "report")
                                  # -> prints: dialogPending: {"type":"confirm","message":"...","defaultValue":null,"url":"..."}
sutradhar dialog                 # shows what's open, without touching it
sutradhar dialog accept          # accepts it — prints: Accepted confirm "..."
```

Every session command exits with code **3** while a dialog is open and blocking the page
(instead of hanging or silently acting on the wrong tab) — run `sutradhar dialog` to see what's
open, then `sutradhar dialog accept|dismiss` to clear it, or set `--dialog accept|dismiss` once
so future dialogs in that session are resolved automatically without you having to intervene.

**Exit codes:** `0` ok, `1` failure, `3` blocked by or interrupted by an open dialog.

The warden and the exit-3 gate are new and have known gaps — read [Known limitations](#known-limitations) before relying on them in automation.

## Temp profile directories and their cleanup

Without `--profile`, the first command that needs a browser starts Chrome with a throwaway profile directory,
`<OS temp>/sutradhar-cli-<epoch ms>[-<suffix>]` (50-100+ MB once Chrome has run). Since 0.6.1 the CLI removes these itself:

- **`close`** (and recovery from a dead session) stops Chrome, forgets the recorded Chrome process ID, and only then removes that
  session's own directory. Stopping Chrome is capped at about 10 s; the directory cleanup then has one 15 s deadline (waiting for
  Chrome to exit, the process scan and the delete together). The exit code is unchanged: if the directory could not be removed,
  `close` prints `Warning: could not remove temp profile ...` and still exits 0; if the state file itself cannot be cleared it fails
  as in 0.6.0 (after the directory cleanup ran).
- **Every new session** first sweeps leftover `sutradhar-cli-*` directories that are older than 10 minutes, within a 15 s budget
  (a Windows process query is part of it). A directory a sweep cannot remove is simply retried by a later session started 10 or more
  minutes afterwards.
- **A failed start** (Chrome cannot be spawned, exits at once, or never becomes ready) removes the directory that start created.
- **A directory is deleted only if all of these hold:** it is a real directory (never a link, junction or file) named like a
  CLI temp profile directly in the OS temp dir; the process scan succeeded and no running process has it on its command line; its
  owner process (recorded in `.sutradhar-owner.json`, or Chrome's POSIX `SingletonLock`) is gone; for a sweep, it is older than
  10 minutes; and on Windows Chrome's own `lockfile` can be deleted (a held lock means the profile is in use).
- **If the CLI cannot tell whether a directory is in use** (process scan failed or timed out, owner marker unreadable or corrupt), it
  leaves the directory alone. Named `--profile` directories, and anything not matching the name pattern, are never touched.
- **Bounds.** All deadlines use a monotonic clock and no delete starts with under 1 s left, but a delete that has already started cannot
  be cancelled, so the real worst case is the deadline plus one directory delete.
- **Diagnostics.** `SUTRADHAR_CLI_DEBUG_CLEANUP=1` prints every directory the cleanup considers, removes or keeps as
  `[cleanup] <event> ... path="<abs>"` on stderr (see [Environment](#environment)).

## Known limitations

These are open, reproduced problems as of 0.6.2, not
hypothetical ones.

**PDF text (PROB-052).** `text` cannot extract the text of a PDF page in the published (bundled) CLI: the bundled PDF reader needs an optional native module that the package does not ship. 0.6.1 printed an empty line with exit 0; 0.6.2 exits 1 with `Error: text read failed: the PDF text could not be extracted: PDF text extraction is not available in this build (PROB-052) ...`. Download the PDF and read it with another tool.

**Native dialogs and crashed tabs**

- A tab that has crashed (for example via `chrome://crash`), whether it is the active tab or a
  background tab, makes other gated commands (`nav`, `snap`, `click`, ...) hang until the crashed
  tab is closed (the process watchdog, `SUTRADHAR_CLI_DEADLINE_MS`, default 300 s, bounds how
  long a stuck command runs). Recover with `sutradhar tabs` (lists every tab without attaching to
  the crashed one and marks it `[crashed]`), then `sutradhar closetab <id>`. `tabs` and
  `closetab` are served from a browser-level connection, so they work even while a tab is blocked.
- The note printed for a crashed tab also suggests reloading it with `sutradhar nav <url>`. That
  advice is wrong for a `chrome://crash` crash (the `nav` hangs): use `tabs` then `closetab <id>`.
- `closetab` needs the target id exactly as `tabs` printed it (upper-case hex); a lower-case id is
  rejected by Chrome. `--dialog` policies are not applied on the `tabs`/`closetab` browser-level path.
- If the page that opened several same-renderer popups closes before you handle them, the popups
  are no longer linked to each other and `dialog accept|dismiss` can close the wrong (innocent)
  popup first.
- A tab that is busy from the moment it is created (long synchronous work) can be reported as
  blocked by an "unknown" dialog (exit 3) although none is open; the tool cannot tell the two apart.
  Treat exit 3 as "check with `sutradhar dialog` and `tabs`", not as proof of a dialog.

**Downloads and uploads**

- Path containment (`SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS`/`SUTRADHAR_ALLOWED_UPLOAD_ROOTS`) is verified,
  including symlink/junction and Windows path tricks.
- Protection against two overlapping downloads on one browser is **best effort**. A second
  `download` while another is in flight is refused immediately, but the cross-process lock lives in
  the process temp directory and is keyed by the exact browser endpoint string, so separate
  processes may not share it. Every CLI command is its own process: run one `download` per
  browser at a time.
- Downloads a page starts on its own (not through `sutradhar download`) are not covered by the
  roots and can land in Chrome's default download location.

**Audit**

- `audit` (no URL) of a brand-new tab right after its first navigation can miss the page's own HTTP
  error status while still reporting `coversWholeDocument: true`. The settle wait is a fixed 1500 ms,
  so a request slower than that can be missing from the broken-request list. A page restored from
  the back/forward cache reports `coversWholeDocument: false`. Only HTTP status 400+ counts as a
  broken request (DNS failures and blocked requests do not).
- `snap --json` can print more than one JSON document if a dialog is open at the time.

**`waitfor`**

- `--text`/`--text-gone` share `--expect-text`'s rendered-text check and its limits (never-painted SVG containers count; text split across inline-block items or in a `<textarea>` can be missed). `--js` runs in the top frame only and must be an expression. The `waitfor` timeout is capped at 280000 ms so its own error always beats the 300 s process watchdog. With `--dialog report` (the default) a page blocked by a dialog fails the command with exit 3, so a `--url`-only wait cannot start while a dialog is already open. A dialog already open fails the wait in about 1 s; one that opens partway through a check can take up to about 2.7 s after it opens (also exit 3). On a frozen page a failed wait can spend up to 1.5 s more reading the page title, so the total is bounded but can exceed `timeoutMs` by up to about 3 s. The conditions are checked about every 100 ms: text visible for less than one poll interval (about 100 ms) can be missed; use it for states that persist.

**`wait`**

- `--state hidden` success is best effort (the code path that decides "hidden" has produced false
  answers in several audit rounds; the known ones are fixed). Polling is about every 100 ms, only the
  first matching element is checked, and a failed visible-wait can take about 3 x `timeoutMs`
  because the engine retries twice (`timeoutMs <= 0` does not retry).

**Temp profile cleanup**

- On POSIX there is no equivalent of the Windows `lockfile` check: a live Chrome there is detected through the process scan and the
  owner PID only (the scan reads `/proc` on Linux and uses `ps -ww` on macOS). The 0.6.1 audits exercised Windows (Node 18, 20, 22 and
  25, with real Chrome and Edge) and Linux (WSL, Node 20, without Chrome); macOS and real Chrome on Linux were not exercised.
- The process scan cannot see the processes of other users or elevated processes. Such cases rely on the owner-PID check (a PID that exists but cannot
  be signalled counts as alive) and, on Windows, on the lock file.
- If the PID in a directory's marker is reused by an unrelated process, the directory is kept for good (a leak, not a loss).
- A stale-name directory that the CLI keeps because its marker is corrupt is never removed automatically; delete it by hand.
- One delete already in progress cannot be cancelled (see above), so `close` or the first command of a session can run past the
  stated bounds by the time that one delete takes.

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
`~/.sutradhar-cli/<hash-of-cwd>/state.json` — scoped by the calling directory by default, so
concurrent CLI use from two different projects doesn't share a browser. `sutradhar close` kills
that Chrome process tree and clears the saved state.

## Requirements

- **Node.js ≥ 18**
- **Chrome or Edge** installed (set `CHROME_PATH` if not auto-detected)
