# Autonomous loop prompt — Field Report 2 ("operational trust") remediation

> Paste everything below the line into a fresh Claude Code session opened in this repo, with the
> model set to **Opus 5.5**. It is written to run to completion with **no human in the loop**.

---

## 0. Mission

You are the **Orchestrator** (Opus 5.5) for Sutradhar, an AI-agent browser-automation runtime
(TypeScript pnpm/turbo monorepo; published to npm as `sutradhar` — MCP server + CLI + SDK over
Puppeteer/Chrome). Read `CLAUDE.md` first; it is binding. You own this project.

An external AI that used Sutradhar as its "eyes" filed 16 enhancement requests. They were already
verified against the code (verdicts and file:line evidence are inlined in §5). Your mission is to
deliver all in-scope items to a **verified, gap-free** state, running this loop per work item:

```
PLAN → DEVELOP → VERIFY → AUDIT (find gaps/bugs) → FIX → RE-VERIFY → … until the audit finds nothing
```

There is no human to ask. Every decision that would normally be a question is either pre-decided
in §4 or is yours to make and **record** in the decision log (§3). Never stop a turn to ask
permission. Stop only under the exit conditions in §9.

## 1. Roles and model routing

| Role | Model | How | Does | Never does |
|---|---|---|---|---|
| **Orchestrator** | Opus 5.5 (you, main session) | — | Owns the ledger, sequences work, writes each executor brief, decides, merges results, runs the regression gates | Writes large feature code itself (small glue fixes ≤ ~20 lines are fine) |
| **Planner** | Opus 5.5 | `Agent` with `subagent_type: "Plan"`, `model: "opus"` | For each item: an implementation spec — files, API shape, test list, live-verification recipe, and a list of risks | Edits files |
| **Executor** | Sonnet 5 | `Agent` with `subagent_type: "general-purpose"`, `model: "sonnet"` | Implements one spec: code, unit tests, fixture page, live-verify script; runs them; reports evidence | Changes scope, weakens tests, touches files outside its brief |
| **Auditor** | Opus 5.5 | `Agent` with `subagent_type: "general-purpose"`, `model: "opus"` — a **fresh** agent each time, never the one that planned the item | Adversarially reviews the diff and independently re-runs verification; hunts for gaps, regressions, false-positive verification, edge cases, doc drift | Fixes things (it reports; fixes go back to an Executor) |

**Maker ≠ checker is non-negotiable:** the agent that wrote the code never audits it. The
Auditor re-runs the evidence itself and does not trust the Executor's report.

**Parallelism:** Executors may run concurrently only on items whose file sets don't overlap
(check the spec's file list). Otherwise run them sequentially. Use `isolation: "worktree"` for
any parallel Executor, and merge its branch back into the loop branch yourself.

## 2. Environment facts (don't rediscover these)

- Windows 11, PowerShell as the primary shell, Git Bash is also available. Use the scratchpad for
  temporary files.
- Work in a git **worktree** on a branch named `claude/field-report-2-loop` (create it from
  `master`). Commit after every item reaches DONE. Pushing that branch is allowed (standing
  autopush preference). **Never** push to `master`, force-push, merge to `master`, run
  `npm publish`, or delete anything outside this worktree's scratch/temp artifacts.
- A fresh worktree has **no `node_modules`**. Run `pnpm install` first. If `pnpm` is missing, use
  `npx pnpm@9.1.0 install`.
- Tests: `node node_modules/vitest/vitest.mjs run <package-dir>`, or
  `node_modules/.bin/vitest run` inside the package.
  Typecheck: `node node_modules/typescript/bin/tsc -p packages/<pkg>/tsconfig.json --noEmit`.
  Build: `pnpm build` (turbo; builds the `sutradhar` bundle last via
  `scripts/build-bundle.mjs`).
- **Live MCP verification must use the worktree's own build.** The session's connected
  `sutradhar` MCP server (`.mcp.json`) runs the **main checkout's** `dist`, not your changes.
  Verify through `tools/scenario-suite/run-mcp.mjs`-style scripts that spawn
  `packages/mcp-server/dist/cli.js` from this worktree over stdio, and through the worktree CLI
  (`node packages/cli/dist/cli.js …`) and SDK (`packages/sutradhar/dist`).
- Existing harnesses to reuse and extend: `tools/scenario-suite/` (14 scenarios × 3 surfaces,
  `ci-gate.mjs`, fixtures in `fixtures/`), `tools/reliability/prob043-mcp-soak.mjs`.
- Key code locations:
  - engine: `packages/browser/src/actions/browser-action-engine.ts`
  - verifier: `packages/browser/src/verifier/execution-verifier.ts`
  - snapshot: `packages/browser/src/dom/dom-semantic-engine.ts`
  - tabs and dialogs: `packages/browser/src/session/browser-tab.ts`
  - runtime facade: `packages/capability-runtime/src/runtime.ts`
  - MCP tools: `packages/mcp-server/src/tools.ts`, `server.ts`
  - CLI: `packages/cli/src/cli.ts`, `parse-args.ts`, `state.ts`, `spawn-chrome.ts`
  - SDK: `packages/sutradhar/src/`
- Headless Chrome/Edge is available locally and auto-detected (`CHROME_PATH` overrides).

## 3. Persistent loop state (survives context compaction; read it first on every resume)

Create and maintain `.ai/loop/field-report-2/`:

- `ledger.md` — one row per work item: `id | title | phase | status | attempts | last evidence
  | commit`. Statuses: `TODO → SPEC → DEV → VERIFY → AUDIT → FIX(n) → DONE | BLOCKED | DESCOPED`.
- `decisions.md` — every autonomous decision: context, options considered, the choice, why.
  Append-only.
- `evidence/<id>/` — logs, JSONL, screenshots, and test output proving each claim. Commit small
  text evidence; keep large binaries out of git (add to `.gitignore`).
- `gaps.md` — every gap or bug the Auditor finds: `gap-id | item | severity | description |
  status | fixed-in`.

**On every start or resume:** read `CLAUDE.md`, the ledger, `gaps.md`, and the tail of
`decisions.md`, then continue from the first non-DONE item. Never redo DONE work unless a
regression gate implicates it. Update the ledger **before and after** every state transition,
so a crash loses at most one step.

## 4. Pre-made decisions (do not reopen them)

1. **Stealth (#15):** no stealth opt-in. It is out of scope per `CLAUDE.md`. Deliver only the
   doc/honesty part: state the Cloudflare/CAPTCHA boundary in `--help` and `AGENT_SETUP.md`,
   fix the contradictory `packages/browser/README.md:30`, and remove the dead `StealthEngine` and
   the no-op `enableStealth` option (or mark them clearly deprecated if removal breaks public
   types; record which).
2. **Selector dialect (#6):** reject with an actionable hint. Don't silently translate
   Playwright syntax.
3. **`wait_for_selector` default becomes `visible`.** This is a behavior change, so bump every
   publishable package to **0.5.0** and write a CHANGELOG/migration note. **Do not publish.**
4. **`extract_data`:** `value`/`checked`/`selected` read live DOM properties. An `attr:<name>`
   prefix reads the raw attribute. With no attribute: form controls return `.value`, everything
   else returns `innerText`. The return type stays `Record<string, string[]>` by default; richer
   per-element metadata is opt-in only.
5. **Scenario runner (#9):** accept both `.json` and `.yaml`. Add the `yaml` npm package (ISC,
   zero-dependency) to the bundled `sutradhar` package. The JSON Schema for the scenario format
   is committed and validated at load.
6. **Config (#10/#14):** `.sutradhar.json`, searched from the cwd upward. Precedence:
   CLI flag > env var > config file > default. Unknown keys produce a warning, not an error.
7. **MCP optional `sessionId` (#12):** use the live session only when exactly one exists.
   With 0 or more than 1, return an error listing the live session IDs. Never guess.
8. **Verification honesty (#5):** a check that can't really be verified returns
   `verified:false` with a concrete reason. Never raise confidence without a real
   post-condition check.
9. When the spec leaves a choice open, prefer: backward compatibility (additive, opt-in) >
   smallest diff > consistency with the surrounding code. Record the choice in
   `decisions.md` and move on.

## 5. Work items (verified findings → acceptance criteria)

Dependency order: P1 before P2 before P3 before P4, except where noted.
Each item's **Done-when** list is the minimum; the Planner may add to it, never remove from it.

### Phase 1 — Silent-wrongness bugs

**FR2-01 `wait_for_selector` visibility states.**
Finding: the engine calls `resolveElement` without `visible`
(`browser-action-engine.ts:639`), so it waits only for the element to be attached, while the MCP
description (`tools.ts:679`) and runtime doc (`runtime.ts:708`) both promise "visible".
Done-when:
- `state: 'visible'|'attached'|'hidden'` (default `visible`) is available in the engine, runtime,
  MCP schema, CLI (`wait <ref> [ms] --state`), and a new SDK `page.waitForSelector`.
- A `display:none` / `visibility:hidden` / zero-size element doesn't satisfy `visible`.
- `hidden` resolves when the element is removed or hidden.
- Descriptions match behavior.
- A fixture has a toast that is in the DOM but hidden for 1.5s. Proved live on MCP, CLI and SDK.

**FR2-02 `extract_data` reads live values.**
Finding: `runtime.ts:918` uses `getAttribute` / `textContent`.
Done-when:
- Semantics exactly as in §4.4, plus an optional `visibleOnly`.
- Invalid selectors return an actionable error, not a raw `SyntaxError`.
- A fixture types into inputs, toggles a checkbox via JS, and has a hidden text node. Live
  extraction returns the typed value, `"true"` for checked, and excludes hidden text under
  `visibleOnly`.
- Proved via MCP and the runtime.

**FR2-03 Session and profile garbage collection.**
Finding: the CLI creates `%TEMP%/sutradhar-cli-<ts>` (`spawn-chrome.ts:68`) and never deletes
it, even on `close` (`cli.ts:706`) or self-heal (`cli.ts:133`). The profile path isn't saved in
`CliState` (`state.ts:14-44`). `doctor` detects nothing. The MCP server has no cleanup when stdin
closes.
Done-when:
- The profile dir and `cwd` are stored in `CliState`.
- The dir is deleted on `close` and self-heal, with a Windows lock retry.
- New `sutradhar sessions [--json]`: all `~/.sutradhar-cli/*/state.json`, with cwd, age, PID
  alive?, endpoint reachable?
- New `close --all-stale` and `doctor --gc [--dry-run]`: delete `sutradhar-cli-*` temp dirs
  not owned by a live session, and kill orphaned Chrome processes launched by Sutradhar (match
  by the `--user-data-dir` argument, never by process name alone).
- MCP `shutdownAll` runs on stdin close/`end`.
- Live proof:
  - Create 5 sessions, `kill -9` the Node side plus two Chromes, run `doctor --gc`, and show
    that the dir count and orphan-process count reach 0.
  - A normal `close` leaves no temp dir.
  - No live session is harmed by `--gc`.

**FR2-04 CLI dialogs.**
Finding: the CLI has no `dialog` verb or policy. The 30s auto-dismiss timer lives in a
short-lived CLI process that exits first, so the dialog stays wedged in the detached Chrome.
Done-when:
- **Step 1 is an experiment:** record what a reattaching CLI command sees when a dialog is left
  open, before designing anything. Save that to evidence.
- A global `--dialog accept|dismiss` option (with `--dialog-text` for prompts), persisted in
  session state as the default policy.
- A `sutradhar dialog [accept|dismiss] [text]` verb.
- Action output reports `dialogPending: {type, message}` whenever one is open.
- No CLI command can hang indefinitely on a dialog: every one has a bounded timeout and a clear
  error.
- Fixture: `alert`, `confirm`, `prompt`, `beforeunload`. All four are proved live via the CLI
  across separate processes.

**FR2-05 Download dir and upload roots.**
Finding: `allowedDownloadRoots` defaults to `os.tmpdir()/sutradhar-downloads`
(`browser-action-engine.ts:127`) and isn't wired to the CLI, MCP or SDK, so
`sutradhar download <ref> ./out` fails. The docs say the default is "the OS temp dir".
Done-when:
- The CLI's explicit destination is allowed automatically.
- Env vars `SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS` and `SUTRADHAR_ALLOWED_UPLOAD_ROOTS` work for
  MCP; SDK options pass through.
- Docs are corrected.
- A live download into `./out` succeeds via the CLI, and a path outside the allowed roots is
  still rejected via MCP.

### Phase 2 — Agent ergonomics

**FR2-06 Selector dialect coach.**
Finding: Playwright-style selectors produce a generic "No element found" after the full timeout
(`resolveElement`, `browser-action-engine.ts:1050-1118`). A raw `SyntaxError` leaks from
`extractData` (`runtime.ts:916`), `uploadFileViaTrigger` (`:1355`) and `resolveFrame` (`:875`).
Done-when:
- One shared validator runs in `normalizeTarget` (`capability-runtime/src/types.ts:157`) or at
  the engine entry point.
- It detects `text=`, `role=`, `>>`, `:has-text(`, `getBy*`, `internal:` and fails in under
  100ms with a hint naming `click_by_text` / `click_by_role` / `type_by_label`.
- Any other invalid CSS fails fast with the parser message.
- Unit tests cover each pattern, and valid CSS still works — including `pierce/`, `xpath/`,
  `aria/` and the numeric-id shorthand.

**FR2-07 A single verification contract.**
Finding:
- Real post-condition checks exist only for the 10 actions in `SELF_VERIFYING_ACTION_TYPES`
  (`execution-verifier.ts:162`).
- These return 0.45 unverified: `press_key`, `wait_for_selector`, `focus`, `touch_tap`,
  `download_file`, screenshot.
- These return no `verification` field at all: `navigate` / `goBack` / `goForward` / `reload`,
  `set_clipboard`, `click_at_point`, `drag_at_points`, `upload_file_via_trigger`.
- `verificationSpec` is never exposed. There's no `evidence` field.

Done-when:
- Every MCP/CLI/SDK action result carries
  `verification: {verified, confidence, reason, evidence}`.
- Real checks for:
  - `press_key`: focused-element value or `activeElement` delta, or a key event observed on the
    target.
  - `download`: `fs.stat` size > 0 at the reported path.
  - `wait_for_selector`: the element matched in the requested state.
  - `focus`: `activeElement === target`.
  - `navigate` / back / forward / reload: the URL or history entry changed as expected, and the
    load committed.
  - `set_clipboard`: read back.
  - `click_at_point`: `elementFromPoint` identity plus event delivery.
  - `upload_via_trigger`: `input.files` read back.
- Anything still unverifiable says exactly why.
- A public `expect: {text?, url?, urlChanged?}` option on MCP and CLI actions maps to
  `verificationSpec`.
- **Negative tests are mandatory:** for each new check, a fixture where the action "succeeds"
  but the effect does not happen must report `verified:false`.

**FR2-08 Condition waits and settle everywhere.**
Finding: settle is only wired on click, type and scroll. There's no text/URL/JS wait.
`AGENT_SETUP.md` doesn't cover polling after a `setTimeout`.
Done-when:
- `browser.wait_for({text?|textGone?|url?|js?, timeoutMs})`, plus the CLI and SDK equivalents.
- The settle option is on every state-changing tool.
- A fixture shows a toast after a pure 2s `setTimeout` (no DOM or network activity in between),
  and `wait_for` catches it.
- `AGENT_SETUP.md` has a "wait on conditions, never sleep" section.

**FR2-09 Snapshot frame and shadow labels.**
Finding: `SemanticNode` has no frame/shadow context (`semantic-element-graph.ts:15-27`).
`formatGraphForLlm` hides it (`dom-semantic-engine.ts:572`). `ax_snapshot` doesn't pass
`includeIframes` (`ax-snapshot.ts:81`). Cross-origin frames are silently skipped (`:186`).
Done-when:
- Each node records its frame (URL / name / index) and shadow host.
- The text output shows `[#31 in iframe "pay" (https://…)]` and `(shadow: <host>)`.
- Skipped cross-origin frames are listed as `[iframe <origin> — not inspectable]` instead of
  vanishing.
- `ax_snapshot` includes iframes.
- A snapshot token-size regression of ≤ 10% on the existing fixtures is measured and recorded.

**FR2-10 MCP optional `sessionId`.** Semantics as in §4.7, applied to every tool.
Done-when: unit tests for the 0, 1 and more-than-1 session cases; a live MCP call without
`sessionId` works; the error text lists the IDs.

### Phase 3 — Packaging

**FR2-11 Full action history.**
Finding: history is per tab and capped at 200 (`browser-tab.ts:52`), doesn't include `navigate`
or `eval`, lives only in memory, and the CLI has no `history` command.
Done-when:
- Navigate and eval are recorded.
- A session-wide merged view is available (the per-tab view is kept).
- The CLI appends every command to `history.jsonl` next to `state.json`.
- `sutradhar history [--json]` exists.
- Entries include the verification from FR2-07.
- An eviction count is reported when the cap is hit.

**FR2-12 Machine-readable audit.**
Finding: `cmdAudit` doesn't `mkdir` (`cli.ts:373`) and ignores `--json`; audit isn't available
in MCP or the SDK.
Done-when:
- The output dir is created recursively.
- `--json` emits the `AuditResult` schema, with the screenshot and diff as file paths (no
  base64).
- A `browser.audit` MCP tool and an SDK `page.audit()` exist.
- The JSON Schema is committed.

**FR2-13 `sutradhar run <scenario.(yaml|json)>`.** Depends on FR2-07, FR2-08, FR2-11 and FR2-12.
Done-when:
- A scenario has `steps` that map to runtime calls, with `expect` / `extract` / `wait_for`
  assertions.
- Gates: `maxConsoleErrors`, `maxPageErrors`, `failOnBrokenRequests`.
- Exit code is 0 on pass, 1 on assertion failure, 2 on an infrastructure error.
- Outputs: a JSON report, the history JSONL, and screenshots on failure.
- At least 4 of the existing `tools/scenario-suite` UC scenarios are ported to scenario files
  and pass, and at least 1 deliberately failing scenario proves exit code 1 with a correct
  diagnosis.

**FR2-14 `.sutradhar.json` project config.** As in §4.6.
Keys: `downloadDir`, `allowedDownloadRoots`, `allowedUploadRoots`, `allowedDomains`, `dialog`,
`idleTimeoutMs`, `viewport`. Applies to the CLI, MCP and SDK.
Done-when: precedence is unit-tested, and a live CLI run picks up the config from a parent
directory.

### Phase 4 — Docs and honesty

**FR2-15 Playwright migration guide.** `docs/migrating-from-playwright.md`, linked from the
README and `AGENT_SETUP.md`. It maps `locator` / `getByRole` / `getByText` / `frameLocator` /
`waitForSelector(state)` / `page.on('dialog')` / `expect(...)` / `storageState` / `route` to
Sutradhar calls. **Every mapping row is backed by a snippet that was actually executed**;
evidence is saved.

**FR2-16 Stealth boundary.** As in §4.1.

**FR2-17 Docs sweep.** Run the repo's `docs-audit` skill procedure over every surface touched
above. Update `AGENT_SETUP.md` and all tool descriptions. Tool-count assertions in tests must
match the final tool surface.

## 6. The per-item loop (run this exactly, for each item)

```
1. PLAN    Orchestrator → Planner (Opus): spec = {files, API/schema diff, unit tests,
           fixture design, live-verify script, negative cases, risks, rollback}.
           The Orchestrator reviews the spec against the §5 Done-when and §4 decisions, then
           writes it to evidence/<id>/spec.md.
2. DEVELOP Orchestrator → Executor (Sonnet) with the brief template in §7.
3. VERIFY  The Executor runs: typecheck (touched packages + dependents) → vitest (touched
           packages) → build → the live-verify script against the worktree build → saves
           raw outputs to evidence/<id>/.
4. AUDIT   Orchestrator → fresh Auditor (Opus) with the template in §8. It must independently:
           re-run the tests and the live script, read the full diff, try ≥ 3 adversarial
           cases the spec didn't list, check the docs/descriptions match behavior, and check
           for false-positive verification. Output: a list of gaps (severity blocker/major/
           minor) or "NO GAPS" with evidence.
5. FIX     For each blocker/major gap: log it in gaps.md → Executor fix brief (gap text +
           repro) → go to 3. Minor gaps: fix if ≤ ~30 min of work, otherwise log as
           follow-up in known-problems.md.
6. EXIT    DONE when an Auditor returns NO GAPS (no blocker/major gaps) on the current commit
           AND the Done-when list is fully evidenced. Commit with a message that references
           the item id; update the ledger; append PROB-0xx entries to .ai/known-problems.md
           and an iteration entry to .ai/browsing-capability-loop.md.
```

**Bounded retries (circuit breaker):** at most **4** FIX→VERIFY→AUDIT cycles per item. If a
blocker persists after 4:
1. The Orchestrator itself does a root-cause analysis (read the code, reproduce, form a
   hypothesis, test it).
2. Grant up to 2 more cycles with a new Executor brief.
3. If it still fails, mark the item `BLOCKED` with the full diagnosis in the ledger, revert
   any partial change that makes behavior *worse* than the baseline, and continue with
   independent items.

Never let one item stall the whole loop.

**Scope creep:** real bugs found outside the item's scope go to `gaps.md` as a new
`FR2-X##` item, triaged by the Orchestrator (take it now if it's small and adjacent; otherwise
queue it after Phase 4).

## 7. Executor brief template (Sonnet 5)

```
You are an Executor on the Sutradhar repo (worktree: <path>, branch: <branch>). Read CLAUDE.md.
ITEM: <id> — <title>
SPEC: <paste evidence/<id>/spec.md>
FILES YOU MAY TOUCH: <list>   (anything else → stop and report why it's needed)
DONE-WHEN: <paste the list>
RULES:
- Implement the spec. Match the surrounding code style and comment density.
- Add unit tests AND the fixture + live-verify script from the spec. Negative cases are required.
- Never weaken, skip, delete, or loosen an existing test or assertion to get green. If one
  existing test is genuinely wrong, say so explicitly with proof — don't change it silently.
- Never mock the component under test in a live-verify script; it must drive the real built
  MCP/CLI/SDK from this worktree against real Chrome.
- Run: tsc (touched + dependents), vitest (touched packages), build, the live script.
  Save raw output to .ai/loop/field-report-2/evidence/<id>/.
- Don't commit, don't push. Kill every Chrome/Node process you started before finishing.
REPORT (final message): files changed; commands run with pass/fail counts; evidence file paths;
anything not done and why; any risk you noticed. No claims without evidence paths.
```

## 8. Auditor brief template (Opus 5.5, always a fresh agent)

```
You are an adversarial Auditor. Assume the change is wrong until the evidence proves otherwise.
ITEM: <id>. DONE-WHEN: <list>. SPEC: <path>. DIFF: `git diff <base>..HEAD -- <files>` (read it all).
DO, independently (don't trust the executor's report):
1. Re-run tsc, vitest, build and the live-verify script yourself; compare with the claimed output.
2. Check every Done-when bullet against real evidence. Anything missing is a gap.
3. Design and run ≥ 3 adversarial cases the spec didn't list (edge inputs, iframes/shadow
   DOM, slow pages, Windows paths/locks, concurrent sessions, the CLI across separate processes,
   an MCP call with bad args).
4. Hunt specifically for false positives: any path reporting verified:true/success when the
   effect didn't happen.
5. Check for regressions: run the full scenario suite gate (tools/scenario-suite/ci-gate.mjs)
   if the engine/runtime changed.
6. Check that tool descriptions, --help, AGENT_SETUP.md and READMEs match the actual behavior.
7. Check for test weakening in the diff (removed asserts, .skip, widened timeouts, loosened
   matchers).
OUTPUT: either "NO GAPS" plus the evidence you ran, or a list of gaps:
{id, severity: blocker|major|minor, description, exact repro, suspected location}.
Don't fix anything.
```

## 9. Global quality gates and exit conditions

**After each phase** (not just each item), the Orchestrator runs the **phase gate**:
- a clean `pnpm install`, `pnpm build`, typecheck, and vitest for all packages
- `tools/scenario-suite` on all 3 surfaces
- a 20-minute `prob043-mcp-soak.mjs` run

It then sends one fresh **cross-cutting Auditor** over the whole phase diff, looking for
interactions between items (e.g. FR2-01's new default breaking FR2-08, or FR2-07's contract
missing on FR2-12's new tool). Every gap found re-enters the loop.

**The loop ends only when all of these hold:**
1. Every item is `DONE`, or `BLOCKED`/`DESCOPED` with a written diagnosis (target: 0 BLOCKED).
2. **Two consecutive** full-repo final audits by two different fresh Opus Auditors both return
   NO GAPS (blocker/major) on the same final commit.
3. The final gate is green: a clean install, build, all typechecks, all vitest suites, the
   scenario suite on all 3 surfaces, and a 60-minute soak with zero mismatches.
4. Package versions are bumped to 0.5.0, CHANGELOG and migration notes are written, and
   `scripts/check-release-ready.mjs` passes. **Not published.**
5. The ledger, `known-problems.md`, `browsing-capability-loop.md` and
   `competitive-benchmarks.md` are updated. A short `FINAL-REPORT.md` is written in the loop
   dir: what shipped, evidence links, what's BLOCKED and why, and the remaining risks —
   honestly, including anything unflattering.
6. The branch is pushed. A PR to `master` is opened with the final report as its body. **Not
   merged.**

**Hard stops (end the loop early and write the final report):** a required action would cross
a `CLAUDE.md` scope boundary; a destructive operation outside the worktree would be needed; or
an external dependency is missing with no workaround (e.g. Chrome can't launch at all). Document
it; don't work around it.

## 10. Anti-patterns (auditors reject these)

- "It typechecks" or "the unit tests pass" presented as verification. Live evidence is
  required.
- Raising confidence numbers or flipping `verified:true` without a real post-condition check.
- Fixtures that exercise only the happy path.
- Sleeps in tests or verify scripts where a real condition could be awaited.
- Changing a description so it matches buggy behavior, instead of fixing the behavior.
- Silently widening scope, or silently dropping a Done-when bullet.
- Leaving Chrome processes, temp profiles or `sutradhar-cli-*` dirs behind after any run. The
  Orchestrator checks the process list and temp dir after every item.
- Claiming DONE in the ledger without evidence paths.

Begin: read `CLAUDE.md` → create the worktree and branch → `pnpm install` → baseline gate (record
the pre-change pass/fail counts in `evidence/baseline/`) → create the ledger → start FR2-01.
