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

## [0.5.0] - 2026-09-29

Nothing here is published yet: no package version has been bumped (`sutradhar` on npm is still
0.4.3) and this section describes the `claude/field-report-2-loop` branch only. This file has no
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
