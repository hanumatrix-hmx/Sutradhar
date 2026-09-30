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
| `history [--json]` | Every command run against this directory's sessions, read from `history.jsonl` (see [History](#history)). Never starts a browser. `--json` prints the raw JSONL lines. |
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
| `--json` | `snap`, `audit`, action verbs | `snap`: additionally print structured per-element data as JSON. `audit`: print the machine-readable JSON report instead of the human-readable text. Action verbs (`click`, `type`, `press`, `nav`, `download`, …): print the full result JSON (including `verification`) instead of the one-line status. `history`: print the raw JSONL lines. |
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
| `--viewport <WxH>` | session creation | Set the CDP viewport (e.g. `--viewport 390x844`) and, with `--headed`, the real OS window size. Persists across later commands until a new `--viewport` is given. |
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

**Selectors.** Selectors are CSS (shadow roots crossed for element actions), a numeric id from `snap`, or Puppeteer's `pierce/`, `xpath/`, `aria/` and `text/` prefixes. Playwright syntax (`text=`, `role=`, `>>`, `:has-text()`, `getBy*()`, `internal:`) and the old `xpath=`/`aria=`/`pierce=` forms are rejected immediately with a hint instead of failing slowly — use `clicktext`/`clickrole` to target by visible text or accessible role. Invalid CSS/XPath fails in one round trip with the browser's own parser message.

Run `sutradhar` with no arguments for this same list straight from the binary.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` | `<OS temp>/sutradhar-downloads` | Directories `download` may write into, separated by `;` (Windows) or `:` (elsewhere); absolute paths, or `~` for the home directory. Replaces the default; the first entry becomes the destination when `download`'s `[dir]` is omitted. The directory named on `download <ref> <dir>` itself is always allowed too, for that one invocation only — it is not written to session state and does not widen later commands. |
| `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` | _(unset — unrestricted)_ | If set, `upload` may only read files under these directories (off by default). |
| `SUTRADHAR_CLI_STATE_DIR` | per-project-directory hash | Where session state (`state.json`) and the command history (`history.jsonl`) are stored — see above. |
| `SUTRADHAR_CLI_DEADLINE_MS` | `300000` | Process watchdog: a command still running after this many milliseconds is stopped with an error message. `wait <ref> <timeoutMs>` extends its own deadline to at least 3 x `timeoutMs` + 30 s. |

## History

Every command that runs against (or manages) the directory's browser session appends **one JSON line** to
`history.jsonl`, next to `state.json` (`~/.sutradhar-cli/<hash-of-cwd>/`, or `SUTRADHAR_CLI_STATE_DIR`). That
includes reads (`snap`, `text`, `tabs`, `eval`, `screenshot`) and `close`. Not recorded: `doctor`, `profile`,
`history` itself, `--help`, and usage errors (nothing ran). The file **survives `close`** and self-heal, so you can
read what happened after the session is gone.

```
$ sutradhar history
History: 3 command(s) in C:\Users\me\.sutradhar-cli\1a2b3c4d5e6f7a8b\history.jsonl
--- session sess_1758800000000_1 (current) ---
2026-09-25 14:02:11Z  exit 0    1204ms  nav http://127.0.0.1:53211/fr2-11-history.html
    - navigate ok verified tab_sess_1758800000000_1_1 http://127.0.0.1:53211/fr2-11-history.html
2026-09-25 14:02:15Z  exit 0     120ms  snap
2026-09-25 14:02:17Z  exit 1   15840ms  click #missing
    - click FAILED action-failed tab_sess_1758800000000_1_1 #missing: No element found for selector: #missing
```

Each line has `v`, `type`, `ts`, `sessionId`, `cwd`, `verb`, `args`, `exitCode`, `durationMs`, an optional `error`,
and `actions`: the runtime actions that command performed (`navigate`, `eval`, `click`, `press_key`, ... with
`target`/`selector`, `success`, `error`, the page `url` afterwards and the action's full `verification` object from the
[verification contract](../../AGENT_SETUP.md)). `sutradhar history --json` prints those lines verbatim (JSONL), so
`sutradhar history --json | tail -n 20` (or `jq`) is the way to see only the last few. Tab ids are not stable across CLI
processes (each command is a new process), which is why every action row also carries the page URL.

**The redaction rule (one function, fail-closed).** Every stored string (args, error, verification reason and evidence,
selector, target, eval preview) goes through the same function, which is also what MCP and the SDK use:

1. The text is split on whitespace. In every token that carries a **URL marker** (`scheme://`, a leading `//`,
   `host[:port]/` or `host?x` with or without a scheme, IPv4 / IPv6 / `localhost`, `user:pass@`, `data:`) everything from
   the first `?`, `#` or `;` to the end of the token is replaced by `[redacted]` (so `?q=(a)&token=X`, `?ids[]=1`,
   `?q=it's`, `#frag`, `;jsessionid=X` all go), and userinfo (`user:pass@`) is removed. After a cut, the following
   tokens are dropped until the next URL or path (a URL typed with literal spaces cannot leak its tail). `data:` bodies
   become `data:…`; `blob:` keeps its origin. The display origin and path stay visible (`http://127.0.0.1:5000/p`).
2. A token that looks like an **absolute local path** (`C:\Users\…`, `C:/…`, `\\server\share\…`, `/home/x/…`, `~/x/…`)
   or a `file://` URL is reduced to its **basename**, also when the path contains spaces. This includes site-relative
   paths that look absolute in free text (`/api/users` becomes `users`): over-redaction is preferred to a leak. The
   `upload`, `download`, `screenshot`, `audit` and `compare` path arguments are stored as a basename even when relative.
3. `type` / `select` values, `setclipboard` text and `dialog` prompt text are recorded as a length only (`<8 chars>`);
   eval code as a whitespace-collapsed 200-character preview (same rule); eval **results**, cookie / storage values and
   CLI flags are not recorded (so a `--expect-text` or `--text` value is not in `args`).

**What IS stored (not masked).** The first 200 characters of `eval` code (a literal secret written in it, e.g.
`localStorage.setItem('jwt', '...')`, is stored; the rule only removes URL parts and paths), `clicktext` text, selectors,
`expect.text` / `wait_for` text as they appear in the action `selector` and in `verification.evidence` (`expected` /
`observed` / `detail`), page text quoted in error messages (all capped at 200 / 300 characters), URL *paths* (a token in a
`/reset/<token>` path is kept) and `cwd` (the directory the command ran in, the one full local path in a line). Not
recorded at all: `handle_dialog` (the MCP dialog tool; the CLI `dialog` verb is recorded, prompt text as a length), tab
lifecycle and state setters. Lines written by an earlier build are not rewritten (`history` re-applies the rule when it
**prints**, `history --json` stays byte-identical to the file). Do not `eval` literal secrets if the directory is shared.
The file is created with mode 0600 (POSIX); it sits next to `state.json`, which already grants full control of the browser.

**Size and robustness.** A line is written with a single append, so parallel CLI processes cannot interleave bytes inside
a line. At 5 MiB the file is moved to `history.1.jsonl` (one generation, about 10 MiB per directory; `history` shows only
the current file and says when an older one exists). A torn or unreadable line (a process killed mid-write) is skipped
with a `Note:` on stderr and never breaks `history`. If the file cannot be written the command still behaves exactly as
before and prints one `Warning:` line. A command that dies before any session exists (a failed Chrome spawn) writes no
line. Cross-process history for the MCP server is not persisted: it lives in the server process (see
`browser.get_action_history`).

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

## Known limitations

These are open, reproduced problems on the current branch (not yet released as 0.5.0), not
hypothetical ones.

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
that Chrome process tree and clears the saved state (the command history, `history.jsonl`, is kept).

## Requirements

- **Node.js ≥ 18**
- **Chrome or Edge** installed (set `CHROME_PATH` if not auto-detected)
