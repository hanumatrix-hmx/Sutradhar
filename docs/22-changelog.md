---
Version: 1.0.0
Status: APPROVED
Implementation Ready: YES
Owner: Principal Software Architect
Last Reviewed: 2026-07-28
Next Review: 2026-10-28
Review Frequency: Per Release
Depends on ADRs:
  - 0001-monorepo
References ADRs:
  - 0001-monorepo
Related Packages:
  - '@sutradhar/contracts'
---

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.6.2] - unreleased

Prepared on branch `release/0.6.2`; the date and the published-to-npm line are filled in after `npm publish`.
Fixes for the defects found by the Claude-direct WebBench run of 2026-10-04 (`tools/webbench/claude-direct-run-2026-10-04.md`).

### Fixed
- **Page text is no longer cut off silently (PROB-048).** CLI `text`, SDK `page.snapshot()` and MCP `browser.snapshot`
  used to return at most 4000 (MCP: 2000) characters with no sign that more existed. They now state the total, print
  `[page text truncated: showing characters A-B of N. ...]` when they show only part, and let you page through the rest:
  `sutradhar text --offset B` / `--max-chars N`, `page.text({ offset, maxChars })`, MCP `browser.get_page_text`.
  A failed read is now an error (CLI exit 1, MCP `isError`, SDK rejection), not empty text. Default sizes are unchanged.
  PDF text is no longer capped at 4000 characters (but see Known limitations: PDF text is not extractable in the
  bundled builds).
- **Clicks and typing no longer fail with "Attempted to use detached Frame" (PROB-047)** on pages that keep replacing an
  iframe, and `snap` no longer returns an empty element list on such pages. Cause: Puppeteer throws synchronously (not as a rejected promise) when a frame is already detached, so `.catch()`, promises built outside a `try`, and `bounded(frame.evaluate(...))` never saw it; every such site in the action, snapshot and verification code now contains it.
- **`#5` and `[#5]` work as element ids (PROB-049)**, as `snap` prints them.
- **Commands other than `nav` no longer start a blank browser when no session is open (PROB-051)**; they exit 1 with
  `no active browser session ... sutradhar nav <url>`. `nav <url>`, `newtab <url>`, `audit <url>` and `compare` still
  start one; `grant` now needs an open session.

### Added
- CLI `back`, `forward`, `reload` (PROB-050). Same-page history entries (`pushState`, `#hash`) count as navigation;
  at the start/end of history they exit 1.
- CLI `text --offset/--max-chars/--json`; SDK `page.text()`; MCP `browser.get_page_text` (74 tools now:
  73 `browser.*` plus `agent.runGoal`); MCP `browser.snapshot` `textMaxChars` (MCP ceiling 40000).

### Changed
- `go_back`/`go_forward` verification evidence (CLI `--json`, MCP `browser.go_back`/`go_forward`, SDK) gains a
  `go_back.history-edge` / `go_forward.history-edge` check when there is no history entry in that direction; tier and
  reason are unchanged.
- CLI `text` prints a marker line on stdout when the text is truncated, exits 1 when the page text cannot be read, and
  no longer re-numbers snapshot ids.
- `SnapshotResult` has new fields `pageTextTotalChars`, `pageTextTruncated` and `pageTextError`.

### Known limitations
- **PDF text extraction does not work in the bundled builds (PROB-052, pre-existing).** The published `sutradhar`
  package (CLI, SDK, MCP) cannot extract text from a PDF page: the bundled PDF reader needs an optional native module
  that the package does not ship. 0.6.1 printed an empty line and exited 0; 0.6.2 fails loudly: `text` exits 1 with
  `text read failed: the PDF text could not be extracted: PDF text extraction is not available in this build
  (PROB-052) ...`, `browser.get_page_text` returns `isError`, `page.text()` rejects with `PageTextReadError`. Not fixed
  in this release (both fix options are logged in `.ai/known-problems.md`).

## [0.6.1] - 2026-10-04

Published to npm as `sutradhar@0.6.1` on 2026-10-04.
A patch release: no SDK or MCP API or tool changes (still 72 `browser.*` tools plus `agent.runGoal`). CLI exit codes
are unchanged, including when `close` or session recovery cannot clear its state file: that still fails with the same
error and a non-zero exit code, as in 0.6.0.

### Security
- The MCP server bundle (`sutradhar-mcp`, `dist/mcp-cli.js`) inlines `fast-uri` (through the MCP SDK's `ajv`); it is
  now 3.1.8 (was 3.1.5), fixing GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp,
  GHSA-qw65-cvwx-89v3 and GHSA-hrr3-gc8f-f4qj. These were the only advisories that reached the published package (the
  SDK's HTTP transports, which pull in express/qs/hono/ip-address, are not bundled). The monorepo lockfile also moves qs
  to 6.16.0 (was 6.15.3), hono to 4.13.12 (was 4.13.1), @hono/node-server to 2.1.3 (was 2.1.0) and ip-address to 10.7.3 (was 10.3.1) within the SDK's existing
  ranges; `@modelcontextprotocol/sdk` stays at 1.30.0. The dev-only brace-expansion, js-yaml and nanoid were refreshed
  in the lockfile too; none of them ship.

### Fixed
- **The CLI removes its own temp Chrome profiles (GAP-315, GAP-349).** Without `--profile`, the CLI starts Chrome in a
  throwaway `sutradhar-cli-*` directory in the OS temp dir. `close` now deletes it once Chrome has exited; a failed
  start deletes its own; and each new session sweeps leftovers older than 10 minutes that no running process uses
  (owner process gone; on Windows, Chrome's lock file free). If the CLI cannot tell whether a directory is in use, it
  leaves it alone. Named `--profile` directories are never touched.

### Changed
- `close` (and recovery from a dead session) now forgets the recorded Chrome process ID immediately after stopping
  Chrome, before cleaning up the profile directory, so a slow or interrupted cleanup no longer leaves a stale ID
  behind. How Chrome is stopped is unchanged. If the state file itself cannot be cleared, the command still fails
  exactly as in 0.6.0 (same error, non-zero exit code, and the ID stays recorded), but the profile directory cleanup
  runs first.
- `close` can take longer: stopping Chrome is capped at about 10 s and the directory cleanup at about 15 s more
  (measured: about 1.1 s in total); one delete already in progress may run past that. A directory that cannot be removed is
  reported and retried by a CLI session started 10 or more minutes later.
- Starting a new CLI session can take longer: it first sweeps old temp profiles, which on Windows includes a process
  query, capped at about 15 s in total (measured: typically under a millisecond when there is nothing to sweep, about half a second when a stale temp dir exists).
- When Chrome exits before it is ready, starting a session now fails at once with "Chrome exited (code N) before it
  was ready" instead of polling for the full 10 s start window.
- New diagnostics switch `SUTRADHAR_CLI_DEBUG_CLEANUP=1` prints what the cleanup considers and deletes.

## [0.6.0] - 2026-10-03

Published to npm as `sutradhar@0.6.0` on 2026-10-03.
Contents: the verification contract (FR2-07, **PARTIAL**: ships with the documented `expect.text` limits), condition
waits and settle (FR2-08, DONE) and the `.sutradhar.json` project config (FR2-14, DONE). The action-history privacy
work (FR2-11) did not pass its audits and is **not** in this release. Items still blocked from Field Report 2
(FR2-13 behind FR2-12, FR2-15 behind FR2-01, FR2-03) are listed in `.ai/loop/field-report-2/ledger.md`.

### Added
- **`.sutradhar.json` project config (FR2-14).** Per-project defaults for the CLI, the MCP server and (opt-in) the
  SDK: `allowedDomains`, `downloadDir`, `allowedDownloadRoots`, `allowedUploadRoots`, `dialog`, `idleTimeoutMs`,
  `viewport`. Searched from the current directory upward (nearest file wins; stops at a `.git` boundary or your home
  directory; the filesystem root is never read). **Precedence: CLI flag > env var > config file > default.** Unknown keys
  warn; anything invalid (including an empty array, a duplicate key, a URL where a domain belongs) stops the command
  before Chrome is touched. A file found by searching upward is treated as untrusted: its download directory must stay
  inside its own folder and outside `.git`, a `dialog.mode "accept"` is announced, and on POSIX a file owned by another
  user is refused. `SUTRADHAR_CONFIG=<absolute path>` loads one file explicitly, `SUTRADHAR_CONFIG=none` ignores it;
  `sutradhar doctor` shows the file and every key's source; the MCP server prints which file it loaded. The SDK reads
  a config only with `launch({discoverConfig:true})` or `launch({configFile})`, and gains `idleTimeoutMs` and
  `dialogPolicy` options. Reference and example: `docs/project-config.md`. Details:
  `.ai/loop/field-report-2/evidence/FR2-14/changelog-fragment.md`.

- **One verification contract (FR2-07).** Every MCP, CLI and SDK action result carries
  `verification: {verified, confidence, reason, evidence}`, with real post-condition checks for
  `press_key`, `focus`, `touch_tap`, `download_file` (file size on disk), `wait_for_selector`,
  `navigate`/back/forward/reload, `set_clipboard` (read back), `click_at_point`, `drag_at_points` and
  `upload_file_via_trigger`, plus a public `expect: {text?, url?, urlChanged?}` option. Anything that
  cannot be checked says why and is never reported as verified. Details: `.ai/loop/field-report-2/evidence/FR2-07/changelog-fragment.md`.
  Status: **PARTIAL** (ships with documented limitations; the `expect.text` check failed three audits,
  every other part passed all three).

- **Condition waits and settle everywhere (FR2-08).** New `browser.wait_for` (MCP), `sutradhar waitfor`
  (CLI: `--text`, `--text-gone`, `--url`, `--js`) and `page.waitFor()` (SDK) block until a page condition is
  true instead of sleeping: visible text appears, visible text is gone, the URL contains a substring, or a JS
  expression is truthy. Several conditions must all hold at once. It polls from Node every ~100 ms with
  fully-awaited per-frame probes (never `page.waitForFunction`, whose default `requestAnimationFrame` polling
  does not fire in a background tab: measured here, a hidden-tab `waitForFunction` timed out at 10 s while
  `wait_for` succeeded within 700 ms of the page's own event), has no hidden retries (`timeoutMs` is the real
  total, `0` = check once; on a frozen page a failed wait can spend up to 1.5 s more reading the page title, so
  the total is bounded but can exceed `timeoutMs` by up to about 3 s), and fails, naming the dialog, when a
  native dialog blocks the page (CLI exit 3): in about 1 s if the dialog is already open, up to about 2.7 s after
  it opens if it opens partway through a check. Text visible for less than one poll interval (about 100 ms) can
  be missed; use it for states that persist. `text`/`textGone` reuse the `expect.text` rendered-text check (one definition), so they
  inherit its documented limits below; a frame that cannot be inspected is "unavailable", never "met" and never
  "gone". `settle` (wait for DOM-quiet and network-idle) is now accepted by every tool that interacts with or
  navigates the page: `navigate`, `go_back`, `go_forward`, `reload`, `click_at_point`, `drag_at_points`,
  `press_key`, `focus`, `hover`, `select_option(s)`, `click_by_text`, `click_by_role`, `type_by_label`,
  `fill_form` (once, after the last field), `upload_file`, `upload_file_via_trigger`, `right_click`,
  `drag_and_drop`, `touch_tap`, `download_file`, `handle_dialog` (the SDK `goto`/`press`/`scroll`/`download`/
  `uploadFile`, and the CLI `nav`/`clicktext`/`clickrole`/`press`/`select`/`hover`/`upload`/`drag`/`clickpoint`/
  `dragpoints`/`download`). `AGENT_SETUP.md` gains "Waiting: wait on conditions, never sleep". Tool count: 72
  `browser.*` tools plus `agent.runGoal` (was 71). Details: `.ai/loop/field-report-2/evidence/FR2-08/changelog-fragment.md`.

### Changed
- **`SUTRADHAR_IDLE_TIMEOUT_MS` is validated (FR2-14).** `abc`, `-1` and other bad values used to become `NaN` and
  silently disable the idle reaper (leaking Chrome). They now fail MCP startup naming the variable; valid values are
  `0` (never) or an integer from 1000 to 2147483647.
- **The CLI now honors `SUTRADHAR_ALLOWED_DOMAINS` (FR2-14)**, as the MCP server always did. A user who exported it for
  MCP will now also be restricted in the CLI (narrower, never wider).
- **An empty `allowedDomains` option no longer suppresses `SUTRADHAR_ALLOWED_DOMAINS` (FR2-14)** in
  `createSutradharServer`; an empty list counts as "not set" like the roots options.
- **CLI: `--allowlist-domains` with no usable domain is an error (FR2-14)** (it used to mean "unrestricted").
- **`settle` now has a hard upper bound (FR2-08).** It previously had none on the Node side: a `click` with
  `settle:true` that opened an `alert` blocked until the tab's 30 s auto-dismiss (measured: see the evidence).
  It now always returns by `timeoutMs + 500 ms`, and still never fails the action.
- **CLI:** `--text`, `--text-gone`, `--url` and `--js` on any verb other than `waitfor` are an error (exit 1)
  instead of being silently ignored, because `click 7 --text Saved` reads like an assertion that never ran.

### Known limitations
- **`expect.text` is best-effort "rendered text", not a paint check (FR2-07).** Text inside SVG
  containers that are never painted (`<defs>`, an unused `<symbol>`, `<mask>`, `<clipPath>`,
  `<pattern>`, `<marker>`) is still counted, because Chrome reports it as laid out and visible
  (GAP-329). Visible text split across `inline-block`/flex items, or inside a `<textarea>`, can be
  reported as missing (GAP-331). A cross-origin frame that the browser never attaches makes the check
  `unverifiable` (named in the reason), never verified (GAP-325).
- **`wait_for` text conditions share those limits, and a few of their own (FR2-08).** `text`/`textGone` use
  the same check as `expect.text`, so never-painted SVG containers count and split inline-block/`<textarea>`
  text can be missed (GAP-329, GAP-331). `js` runs in the main frame only (no `frameSelector`), re-runs every
  ~100 ms and must be side-effect free. `textGone` on text that was never there succeeds at once
  (`output.presentAtStart:false`, verification `unverifiable`). The CLI cannot start a wait while a dialog is
  already open (the CLI's dialog gate exits 3 first), and caps the timeout at 280000 ms. `settle` cannot see a
  timer the page scheduled for later; use `wait_for`.

## [0.5.0] - 2026-09-29

Published to npm as `sutradhar@0.5.0` on 2026-09-29. This file has no
entries between 0.1.0 and 0.5.0; the published 0.2.0 through 0.4.3 releases are not itemised
here. Items are labelled DONE (independently audited and passed), PARTIAL or BLOCKED (code is on
the branch, but the item did not pass its audits) so nobody reads a shipped feature as a proven
one. Everything under "Known limitations" is real and reproduced, not hypothetical.

### Added

- **`browser.audit` (MCP), `page.audit()` (SDK), `sutradhar audit --json` (CLI)** — a
  machine-readable audit report (console errors, page errors, HTTP 4xx/5xx requests, five
  heuristic accessibility checks, LCP/CLS/FCP/TTFB, a full-page screenshot). JSON Schema at
  `packages/capability-runtime/schemas/audit-report.schema.json` (`schemaVersion` 1). MCP returns
  the JSON first, then the images (`includeImages: false` omits them); `--json` writes images to
  files and references them by absolute path. Status: **BLOCKED** (FR2-12, see Known limitations).
  `browser.audit` is the one new MCP tool: 71 `browser.*` tools plus `agent.runGoal`, 72 in total
  (was 70 plus `agent.runGoal`).
- **`wait_for_selector` states** — `state: "visible" | "attached" | "hidden"` on the MCP tool, the
  CLI (`wait <ref> [timeoutMs] --state ...`) and a new SDK `page.waitForSelector(selector,
  {state, timeout})`, which throws on timeout. Status: **BLOCKED** (FR2-01) with the
  false-success bugs GAP-132 to GAP-135 fixed afterwards in a separate scoped item.
- **CLI native-dialog handling** — a `dialog` verb (`dialog`, `dialog accept [text]`, `dialog
  dismiss`), `--dialog accept|dismiss|report` and `--dialog-text`, exit code **3** for "blocked by
  or interrupted by an open dialog", and a small per-session helper process (the "dialog warden")
  that keeps a dialog visible to later commands. Status: **BLOCKED** overall (FR2-04); it ships
  together with the GAP-256 fix below.
- **`SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` and `SUTRADHAR_ALLOWED_UPLOAD_ROOTS`** for `sutradhar-mcp`
  and the CLI, `allowedDownloadRoots`/`allowedUploadRoots` options on the SDK's `launch()`, and SDK
  `page.download()` / `page.uploadFile()`. Status: **PARTIAL** (FR2-05).
- **`SUTRADHAR_CLI_DEADLINE_MS`** — overrides the CLI's per-command watchdog (default 300000 ms; a
  `wait` with a long `timeoutMs` extends its own deadline automatically).
- **MCP: `sessionId` is optional** on every tool that took one (70 tools; none requires it). When
  omitted and exactly one session is live, that session is used and the result says so; with zero
  or several live sessions the call fails and lists the live ids. It never guesses. `browser.launch`,
  `browser.attach` and `agent.runGoal` are unchanged (their `sessionId` still means "the id to
  create"). New `SutradharRuntime.listSessions()`. Status: DONE (FR2-10).
- **Snapshot frame and shadow labels** — elements inside an iframe read `[#31 in iframe "pay"
  (url)] ...`, elements inside an open shadow root end with `(shadow: host)`, frames that cannot be
  read are listed as `[iframe <origin> — not inspectable] (reason)` instead of being dropped, a
  slow child frame no longer stalls the snapshot (5 s bound), and `ax_snapshot` now includes iframe
  content. Parsers should match `^\[#(\d+)`. Status: DONE (FR2-09).

### Changed

- **BREAKING: `wait_for_selector` now defaults to `state: "visible"`** (it used to wait only for DOM
  presence, although every description already said "visible"). A call that used to succeed
  instantly on an attached-but-hidden element now waits and fails. Pass `state: "attached"` to get
  the old behaviour. The CLI's success line changed from `<ref> appeared` to `<ref> is <state>
  (state=<state>)`.
- **CLI default dialog policy is `report`, not `auto`.** Alert/confirm/prompt are left open and
  reported (`dialogPending: {...}`) and other commands exit 3 until `sutradhar dialog accept|dismiss`;
  `beforeunload` is still accepted after 3 s. Scripts that relied on silent auto-dismissal should
  pass `--dialog dismiss`. MCP and the SDK keep their `auto` default (30 s auto-dismiss).
- **`extract_data` reads live values.** With no `attribute`, form controls return their current
  `.value` (including typed-but-unsubmitted text), other elements return trimmed rendered `innerText`
  (CSS-hidden text and `<script>`/`<style>` content left out; it used to be raw `textContent`).
  `"value"`, `"checked"`, `"selected"` read live DOM state, `"attr:<name>"` reads the raw markup
  attribute, and `visibleOnly` drops non-visible matches. Invalid selectors fail the whole call and
  name every bad field. Status: DONE (FR2-02). Password inputs are not special-cased, so their values
  are readable this way (they were already readable through `eval`).
- **Selectors: Playwright syntax is rejected immediately.** `text=`, `role=`, `>>`, `:has-text()`,
  `getBy*()` and `internal:` fail at once with a hint (runtime and SDK throw `InvalidSelectorError`)
  instead of a slow, unhelpful failure. Puppeteer's `pierce/`, `xpath/`, `aria/` and `text/` prefixes
  now actually work on engine-routed element actions (they used to be double-prefixed and always
  failed). The legacy `xpath=`/`aria=`/`pierce=`/`text=` forms are now rejected by the same check
  (use `xpath/`, `aria/`, `pierce/`, `text/`), including on `upload_file_via_trigger` and
  `frameSelector`. Genuinely invalid CSS/XPath fails in one
  round trip with the browser's own message. Status: DONE (FR2-06).
- **Downloads and uploads: path containment is fail-closed.** A symlink or junction inside an allowed
  root that points outside it can no longer be used to escape through a not-yet-created subdirectory;
  trailing-dot/space path components (Windows), Unicode look-alike case folding and case-sensitive
  Windows folders are handled. `download_file` reports the file's real on-disk path (from Chrome)
  and matches progress events to its own download by guid. `sutradhar download <ref> <dir>` now
  works (`<dir>` is allowed for that one invocation only). The default download root is the
  `sutradhar-downloads` subdirectory of the OS temp directory, never the bare temp root. Overlapping
  `download_file` calls on one browser are refused immediately (see Known limitations).
- **Audit correctness (FR2-12 code).** Findings are scoped to the audited document (a long-lived
  session no longer leaks a previous page's errors into a later audit), CLS is no longer multiplied
  by repeated audits of one tab, Web Vitals are read from a buffered `PerformanceObserver` at audit
  time so current-page audits report real LCP/CLS, `sutradhar audit` creates a missing `outDir`,
  `--baseline` with no URL is a usage error, and a baseline failure is reported in the output
  instead of aborting the command.
- **`@sutradhar/browser` removed dead stealth exports:** `enableStealth`, `IStealthEngine`,
  `StealthEngine`, `StealthOptions`, `DEFAULT_STEALTH_OPTIONS` and the script generators. They were
  never called; the launch arguments are unchanged, including the unconditional
  `--disable-blink-features=AutomationControlled`. Boundary wording was corrected in the README,
  `--help`, `AGENT_SETUP.md` and `SECURITY.md`: that flag hides `navigator.webdriver` from simple
  scripts and nothing more; Cloudflare, CAPTCHA and IP blocks still stop Sutradhar. Status: PARTIAL
  (FR2-16): the dead-code removal and the wording landed; the CI check meant to stop the wording
  regressing did not (the best-effort checker script in `tools/scenario-suite/fr2-16/` is not wired
  into CI and is not a guarantee).

### Fixed

- **A crashed tab no longer locks the CLI session (GAP-256).** The dialog warden now records Chrome's
  crash events and never treats a crashed target as a blocking unknown dialog; `sutradhar tabs` and
  `sutradhar closetab <id>` are served from a browser-level connection that attaches to no page, so a
  blocked or crashed tab can always be listed and closed. Status: DONE.
- **`download_file` attribution race (GAP-307).** A completed or cancelled progress event for a
  different download that arrived before this call's own start event could resolve this call with the
  wrong file. Fixed, with two deterministic tests; the flaky download unit tests were also fixed.
  Status: DONE.
- The CLI's self-heal no longer wraps the command itself, so a real mid-command failure is reported
  instead of being replaced by a fresh, unrelated session (GAP-006), and a blocked page can no longer
  be silently swapped for a new blank tab (GAP-017).

### Known limitations

These are open on this branch. They are also listed where users will look for them
(`packages/cli/README.md`, `packages/mcp-server/README.md`, `SECURITY.md`, `AGENT_SETUP.md`).

- **CLI dialogs (FR2-04, BLOCKED).**
  - After the opener window closes, several same-renderer popups it opened are no longer linked to
    each other, and `dialog accept|dismiss` can close the wrong (innocent) popup first (GAP-257).
  - A tab that is busy from the moment it is created can be reported as blocked (exit 3) although no
    dialog is open; the tool cannot tell these apart, so treat exit 3 as "check", not proof.
  - After a `chrome://crash`-style crash of the active tab or of a background tab (GAP-310), other
    gated commands (`nav`, `snap`, ...) hang until the crashed tab is closed. Use `sutradhar tabs`,
    then `sutradhar closetab <id>`. The crash note also suggests reloading with `nav`; that advice is
    wrong for `chrome://crash` (GAP-309), ignore it. `closetab` needs the id exactly as `tabs` prints
    it; a lowercase id is rejected by Chrome (GAP-311).
  - `--dialog` policies are not applied on the `tabs`/`closetab` browser-level path.
- **Downloads and uploads (FR2-05, PARTIAL).** Path containment is verified. Protection against two
  overlapping downloads is best effort: a second `download_file` on the same browser is refused
  immediately, but the cross-process lock lives in the process temp directory and is keyed by the
  exact endpoint spelling, so separate processes may not share it. Drive downloads for one browser
  from one process at a time. Downloads a page starts on its own (not through `download_file`) are
  not governed by the roots and can land in Chrome's default download location. A stale
  case-sensitivity cache entry can be wrong in the unsafe direction (GAP-306, narrow), and a foreign
  download that begins before this call's own can still be attributed to it (GAP-313, mitigated by
  the lock).
- **Audit (FR2-12, BLOCKED).** Auditing the current page (no `url`) of a brand-new tab immediately
  after its first navigation can miss the page's own HTTP error status while still reporting
  `coversWholeDocument: true` (GAP-288). The settle wait is a fixed 1500 ms, so a slower request can
  be missing from `brokenRequests` (GAP-038). A page restored from the back/forward cache reports
  `coversWholeDocument: false`, and a same-URL error can be attributed to it wrongly (GAP-291). Only
  HTTP responses with status 400 or above count as broken requests; DNS, refused and blocked requests
  do not. The accessibility checks are heuristics, not a WCAG audit. Ring-buffer eviction (200
  console, 50 page-error, 200 network entries per tab) is not surfaced in the report. `cls` is the
  legacy total of layout shifts, not session-windowed CLS. `audit <outDir>` with no URL treats
  `outDir` as the URL (use `audit "" <outDir>`). The schema file is in the repository and is not
  included in the npm package. A dialog that opens during page load or capture can make an audit
  slow or fail with a misleading message (GAP-270), and `snap --json` can print more than one JSON
  document when a dialog is open (GAP-277).
- **`wait_for_selector` (FR2-01, BLOCKED).** Six audits each found a new instance of the same
  false-answer pattern. The critical hidden-wait false success on tab close (GAP-132) and its
  sibling messages (GAP-133 to GAP-135) are fixed and were re-audited (0 false successes in 1,920
  engine and 320 MCP trials), but the class of bug is not mechanically prevented, so treat a
  `state: "hidden"` success as best effort and confirm it when it gates something important.
  Other open points: a failed visible-wait can take about 3 times `timeoutMs` because the engine
  retries twice (GAP-001; `timeoutMs <= 0` does not retry); polling is roughly every 100 ms so a
  state that lasts under that can be missed; only the first matching element is checked and
  `opacity: 0` counts as visible; the CLI and SDK drop the extra `otherVisibleMatches` /
  `matchedAtStart` details that MCP returns on a hidden-wait success (GAP-136).
- **Stealth boundary (FR2-16, PARTIAL).** Wording only; there is no automated guard that keeps it
  honest, and the best-effort checker misses many phrasings (GAP-138 to GAP-142).
- **Not in this release.** Session/profile garbage collection (FR2-03), a unified verification
  contract (FR2-07), condition waits everywhere (FR2-08), a full action history (FR2-11), a
  `sutradhar run` scenario runner (FR2-13), a `.sutradhar.json` project config (FR2-14) and the
  Playwright migration guide (FR2-15) are not implemented on this branch and are not documented as
  features.

## [0.1.0] - 2026-07-28

### Added

- Initialized Monorepo root workspace (`package.json`, `pnpm-workspace.yaml`, `.gitignore`).
- Added Turborepo v2 build pipeline configuration (`turbo.json`).
- Established strict TypeScript compiler baselines (`tsconfig.base.json`, `tsconfig.json`).
- Added Prettier and ESLint root configurations (`.prettierrc`, `.eslintrc.js`).
- Materialized supreme repository law (`PROJECT_CONSTITUTION.md`) and root entry point (`README.md`).
- Materialized complete human documentation suite (`docs/00-project-overview.md` through `docs/23-glossary.md`).
