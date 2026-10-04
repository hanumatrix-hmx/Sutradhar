# Release 0.6.2 plan (patch): WebBench 2026-10-04 defects — page-text truncation, detached-frame actions, `#N` refs, no-session reads, CLI history verbs

Planner: Claude Opus 5.5, 2026-10-04. **Revision 4.** Revision 1 was reviewed in `plan-review-1.md` (REVISE: 4 MAJOR,
17 MINOR), resolved in revision 2 (section 7). Revision 2 was reviewed in `plan-review-2.md` (REVISE: 1 MAJOR,
10 MINOR), resolved in revision 3 (section 8). Revision 3 was reviewed in `plan-review-3.md` (APPROVE, 6 MINOR),
folded in by revision 4 (section 9, "Changes from review-3"); nothing else changed. This file is the plan only; nothing in it has been implemented. Branch `release/0.6.2`
(based on `bench/webbench-2026-10-04`; HEAD **3f0ba55** = master 1cde002 + the WebBench report + the orchestrator's
`final-classes.json` correction), worktree
`E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041`.

The user publishes to npm and opens/merges the PR. Those are not steps here. **CI must be green on the release PR
before publishing** (6.4).

Scope (from `tools/webbench/claude-direct-run-2026-10-04.md`, `.ai/known-problems.md` PROB-047..051,
`.ai/loop/webbench-2026-10-04/CANDIDATE-FIXES.md`, `verify/phase2.json` entries for 2561, 982 and the MSD text-cap
replay):

| item | defect | steps |
|---|---|---|
| **I-048** (top priority) | silent page-text truncation (4000 runtime, 2000 MCP), no marker, no paging | S2, S3a, S3b, S3c |
| **I-047** | "Attempted to use detached Frame" on click/type; "Interactive elements (0)" snapshot | S4 |
| **I-049** | `#5` / `[#5]` rejected although `snap` prints `[#5]` | S5 |
| **I-051** | a read verb with no session silently launches a blank browser, exit 0 | S6 |
| **I-NAV** | CLI has no `back`/`forward`/`reload` (MCP has them); PROB-050 | S7 |
| release | version 0.6.1 -> 0.6.2, changelog, docs, gaps, gate | S9, S10, S10b, S11, S11b |

Out of scope: the 0.7.0 close/recovery redesign (0.6.1 plan section 10), the vitest major upgrade, PROB-050's
`eval` printing `undefined` (only the missing verbs are added), the self-heal path of I-051 (2.4), the pre-existing
SDK type-resolution gap (MINOR 16; recorded, not fixed), everything else.

Notation (same conventions as `.ai/loop/release-0.6.1/plan.md`):
- `$WT` = `E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041`
- `$SP` = `E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad` (160 characters). It holds many 0.6.1-era
  dirs (`S1/`, `S2/`, `S4/`, `S6/`, `S8/`, `r5/`, ...). **0.6.2 never reads or writes them** except the read-only
  inputs named below (`iso/`, `r5/` copied once, `v061/`).
- `$R` = `$SP/r062` — **the only scratch root for 0.6.2** (scripts, logs, matrix ISO dirs, pack, consumer, mutants,
  spikes). Per step: `$R/<STEP>/`. Live-Chrome ISO dirs are the one exception (top-level, 3 characters, see 0.2).
- `$EV` = `$WT/.ai/loop/release-0.6.2/evidence`; `$EV061` = `$WT/.ai/loop/release-0.6.1/evidence`
- `REAL_TEMP` = `E:/AI-Cache/tmp` (hard-coded; never derived from `TEMP` or `os.tmpdir()`). **In Git Bash `/tmp` IS
  `REAL_TEMP`** (0.6.1 A.6 P3): never use `/tmp` in a Git Bash command or a Windows-side script.
- `NEG061` = `$SP/v061/inst/node_modules/sutradhar/dist` — the **published** 0.6.1 package (the WebBench build pin).
  `cli-bin.js` sha256 `9858726a291e844e1f84089b18310e90379140e2dfabf7b2fda80eb550b5c59b`, `index.js` sha256
  `ddaaa00191710fc772db1c93a14e469381f0a40020de930ffae198834fd8db19`, its own `puppeteer-core` **25.12.0** (HEAD
  builds resolve the monorepo's **25.5.0**; both have the same synchronous `throwIfDisposed`). It is the **negative
  control** for the live checks. Read-only: nothing ever writes into `$SP/v061`.
- `<HEADER>` (paste literally; shell state does not persist between tool calls; every block is ONE Git Bash call):
  `SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; R="$SP/r062"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.2/evidence"; EV061="$WT/.ai/loop/release-0.6.1/evidence"; NEG061="$SP/v061/inst/node_modules/sutradhar/dist"; cd "$WT"`
- `export MSYS_NO_PATHCONV=1` before any `git show <rev>:<path>` and before any command that passes a POSIX path.

---

## 0. Safety rules and isolation (reused from 0.6.1; do not reinvent)

### 0.1 Safety rules (every builder and auditor brief carries these VERBATIM)
```
SAFETY RULES (non-negotiable, apply to every command in this step):
- Never kill processes by image name (no taskkill /IM chrome.exe, no Stop-Process -Name); only PIDs the step itself started, after an ownership check (CommandLine contains our ISO basename).
- Never `git stash`, `reset --hard`, `checkout -- .`, `restore .`, `clean -f`, force-push, push. One logical step = one commit; add paths by name (never -A or .); message ends with the attribution line from the session's system reminder (currently `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Never delete with globs or recursive deletes outside a directory the step itself created; live runs set TEMP/TMP/TMPDIR to a fresh ISO dir (section 0.2) and only clean it with the guarded form. Other sessions' `sutradhar-cli-*` dirs in the real TEMP (E:/AI-Cache/tmp) must never be touched. Never write into $SP/v061 (the pinned published 0.6.1) or into any 0.6.1-era $SP dir; 0.6.2 scratch lives under $SP/r062 only.
- Check `df -h /e` before builds (abort under 10 GB free). Every wait has a hard timeout (<= 1200 s; forced builds and the matrix are single foreground commands with `timeout`, start/end time logged).
- Live third-party sites: no stealth, no CAPTCHA/bot-wall bypass, no retries beyond those the step allows; a block is recorded as EXTERNAL-BLOCK, never worked around.
- Evidence goes under `.ai/loop/release-0.6.2/evidence/<STEP>/` with exact commands and output excerpts; every step writes `<STEP>/README.md` with a per-AC false-pass analysis.
```

### 0.2 Isolation preamble (0.6.1 section 0.2 + Addendum A.6, adapted only where noted)
The guard and path checker already exist and are **reused unchanged**:
`$SP/iso/assert-tmp.mjs` (sha256 `dff42280…835e6`) and `$SP/iso/check-cleanup-paths.mjs` (sha256 `bde6b533…6d55e`),
equal to `$EV061/S1/iso-tools.sha256`; contents in 0.6.1 plan section 0.2. If either hash differs, S1 rewrites them
byte-for-byte from `$EV061/S1/assert-tmp.mjs` / `$EV061/S1/check-cleanup-paths.mjs` and re-runs the self-tests.

```
ISOLATION PREAMBLE (0.6.2)
1. Only the Git Bash form runs product code (CLI, MCP, SDK, vitest). Never PowerShell. TEMP, TMP, TMPDIR and
   NODE_OPTIONS go on the SAME command line:
     <HEADER>; ISO=<ISO path>; [ ! -e "$ISO" ] || { echo "ISO exists: $ISO (delete it with item 8 if it carries .r062; otherwise STOP)"; exit 1; }; mkdir -p "$(dirname "$ISO")" && mkdir "$ISO" && : > "$ISO/.r062"; \
     TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 <command>
   ISO creation is **fail-closed**: a pre-existing ISO is never reused or adopted (no stale `state/state.json`, no
   marking of a foreign dir). Every ISO dir carries `.r062` from creation; the guarded delete (item 8) requires it.
   **Re-run cleanup (review-3 B):** a step that is re-run after an aborted attempt may remove only **its own** prior ISO
   (the ISO name(s) this step owns per item 2), and only if it carries `.r062`, using item 8; then it creates the ISO
   fresh. A dir without the marker, or an ISO name owned by another step, is a STOP (never deleted, never adopted).
   **Creation vs continuation (review-3 C):** each tool call is a separate Git Bash invocation. The **first** command of
   a step that uses an ISO runs the creation form above. **Every later command of the same step** that uses that ISO
   runs the continuation form instead, which never creates:
     <HEADER>; ISO=<ISO path>; [ -f "$ISO/.r062" ] || { echo "ISO missing or unmarked: $ISO"; exit 1; }; \
     TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 <command>
   A step that deliberately deletes its ISO between phases (e.g. S1 spikes -> 8b, S4 step 5 -> step 6) uses item 8 and
   then the creation form again; this is stated in the step text.
2. ISO paths.
   - Unit-test matrix runs and anything that launches no Chrome: "$R/<STEP>-tmp" (release-specific).
   - Live runs (anything that launches Chrome): a top-level 3-character name from this list ONLY, so that Chrome's
     --user-data-dir stays <= 200 characters ($SP is 160; CLI profile basename 34, SDK/MCP Puppeteer profile basename
     35: 160+1+3+1+35 = 200; 0.6.1 A.6 P5). A deeper path under $R would exceed 200.
       S2t N2t Sat Sbt Sct N3t S4t N4t S5t N5t S6t N6t S7t A8t N8t Sgt Ngt Wbt
     (S = HEAD build, N = NEG061 negative control, A = auditor, W = WebBench re-run; Sat/Sbt/Sct = S3a/S3b/S3c,
     Sgt/Ngt = the S11 gate. N3t is shared by S3a/S3b/S3c's negative-control runs, sequentially, deleted after each.)
     These names are release-specific by registration: S1 asserts none of them exists before 0.6.2 starts and records
     that in `$EV/S1/iso-names-free.txt`; each is created with the `.r062` marker.
   Every harness asserts, before the first launch, (ISO length + 1 + 35) <= 200, and after the first CLI `nav`
   asserts `state.userDataDir.length <= 200` and `dirname(state.userDataDir) == ISO`.
3. Every harness asserts os.tmpdir() is under $SP at startup in its own code, passes TEMP/TMP/TMPDIR/NODE_OPTIONS/
   SUTRADHAR_CLI_DEBUG_CLEANUP explicitly in every child `env`, sets SUTRADHAR_CLI_STATE_DIR="$ISO/state",
   SUTRADHAR_CONFIG=none, cwd=$ISO, and runs each CLI call with spawnSync(process.execPath, [<absolute cli-bin.js>, ...],
   {timeout: 120000}). On a timeout: 0.6.1 section 0.3 "indirectly started Chrome" rule (PID from state.json, CIM
   CommandLine contains our ISO basename, taskkill /PID <pid> /T /F, confirm exit within 15 s; never kill twice).
4. Every CLI session a harness opens ends with `close`. Every SDK/MCP session ends with close()/shutdown_all.
4b. **Harness parameters exist from the first version (review-3 D)**, because S8 and S11 re-run harnesses unmodified
   (sha256 equal): every live harness reads from env, with defaults equal to its own step's run: `CLI` (absolute
   `cli-bin.js`), `BUNDLE` (absolute `index.js`), `MCP` (absolute `mcp-cli.js`) — whichever surfaces it drives,
   defaulting to `$WT/packages/sutradhar/dist/...` — plus `RUNS` (repetition count, where the harness repeats) and
   `NO_MUTANTS` (where it embeds same-build mutants). It prints the resolved values and their sha256 at startup.
5. Path-log check after every live CLI run: node "$SP/iso/check-cleanup-paths.mjs" "$ISO" <stderr logs...> must exit 0
   (>= 1 [cleanup] line, none outside ISO).
6. Real-TEMP snapshot (read-only) before and after each live step: names + count of REAL_TEMP/sutradhar-cli-* and
   `find "$REAL_TEMP" -maxdepth 1 -name 'sutradhar-cli-*' -newer <stamp>`. A disappearance is unattributed until
   explained; with a passing path-log check it is recorded as external.
7. Attribution hygiene (A.6 P7): a probed path/basename never appears in a launching command line; pass it via env/file.
8. Guarded delete, the ONLY allowed form, after every PID the step started is confirmed dead:
     set -u; [ -n "${SP:-}" ] && [ -d "$SP" ] && [ -f "$ISO/.r062" ] || { echo "REFUSE: SP unset or no .r062 marker"; exit 1; }
     case "$ISO" in "$SP"/r062/S[0-9]*-tmp|"$SP"/r062/S[0-9]*-tmp-*|"$SP"/[ANSW][0-9a-z]t) ;; *) echo "REFUSE rm $ISO"; exit 1 ;; esac
     # contents first, marker last (review-3 B): a partial delete (e.g. a locked file on Windows) leaves the marker,
     # so the dir stays deletable by this same form on the next attempt and never becomes an unmarked wedge
     find "$ISO" -mindepth 1 -maxdepth 1 ! -name .r062 -exec rm -rf -- {} +
     if [ -z "$(find "$ISO" -mindepth 1 -maxdepth 1 ! -name .r062 -print -quit)" ]; then rm -f -- "$ISO/.r062" && rmdir -- "$ISO"; fi
     [ ! -e "$ISO" ] || { echo "ISO NOT REMOVED (marker kept, retry after the holder exits): $ISO"; ls -la "$ISO"; exit 1; }
9. AC for every step that runs code: >= 1 "[iso-guard] tmpdir=<...scratchpad...>" line, no "ISOLATION GUARD" line,
   path-log check 0 where a CLI ran, no PID of ours alive at the end. A missing guard line means the step did not happen.
```

### 0.3 Other standing rules (every brief)
- **Location check before writing**: `git -C $WT rev-parse --show-toplevel` prints `$WT`, `git -C $WT branch
  --show-current` prints `release/0.6.2`. Never write into another worktree or the main checkout.
- **Git from Git Bash** (stated deviation from the global "git through WSL" rule, as in 0.6.1: `node_modules` and
  hooks are Windows-native). No touched file is an executable entry point: `packages/cli/src/cli.ts` is tracked as
  **100644** (`git ls-files -s`), and S3a/S6/S7 record its mode before and after — it must stay 100644. A step that
  would create or modify a 100755 file stops and uses WSL.
- **Builds.** `df -h /e` first. Step-level live checks use a forced build of the bundle and its dependencies:
  `timeout 2400 node_modules/.bin/turbo run build --force --concurrency=1 --filter=sutradhar...` (log start/end, record
  dist sha256 + mtimes before and after; the after-hash must differ from the before-hash for any step that changed
  bundled source, otherwise the build was a cache replay or did not run: a FAIL). S11 uses the full root build.
- **No push** by any builder or auditor. Autopush is suspended for this release until S11b passes; the user pushes.
- **Evidence commit policy**: each step's commit adds its source paths **and** `$EV/<STEP>` by name. The `auditor`
  agent is read-only, so the **orchestrator** commits `$EV/S8`. S11 item 1 starts from a tree with no untracked evidence.
- **Tests**: `node_modules/.bin/vitest run` per touched package (CLAUDE.md) under the preamble, plus the full matrix at
  S1/S8/S11. Spec typecheck for CLI specs: S1 copies `$SP/r5/tsconfig.specs.json`, `tsconfig.neg.json` and `planted.ts`
  to `$R/spectsc/` (sha256 recorded; contents unchanged, they reference `$WT` paths only) and every later step uses the
  copy (baseline 7 errors, planted control TS2322; 0.6.1 section 1.9).
- **Mutation runs**: applied to a copy-restored source file (sha256 before, apply, run, restore, sha256 equal). Bundle
  mutants are sibling files `dist/<name>.mutant.js` (exactly 1 replacement, `grep -c`), deleted afterwards, the real
  dist sha256 unchanged. "Where is this statement" mutants are tried at block boundaries (0.6.1 B.0). A surviving
  mutant is a FAIL of the step's test suite.
- **Spec contradictions are a STOP** (0.6.1 B.0): a builder that finds two requirements in conflict stops and reports.

---

## 1. Verified findings (re-derived 2026-10-04, read-only; HEAD 3f0ba55)

### 1.1 Repo and environment
- Location check printed `$WT` / `release/0.6.2`. `df -h /e`: 48 G free. The only untracked path is
  `.ai/loop/release-0.6.2/` (this plan, `plan-review-1.md`); the tree is otherwise clean (the WebBench
  `final-classes.json` correction was committed by the orchestrator as 3f0ba55).
- Version sites (exactly 4, unchanged from 0.6.1 section 1.8): `packages/mcp-server/src/version.ts:2`,
  `packages/sutradhar/package.json:3`, `packages/sutradhar/src/index.ts:39`, `packages/sutradhar/tests/unit/api.spec.ts:42`,
  all `0.6.1`.
- "as of 0.6.1" / "Status (0.6.1)": `README.md:33`, `SECURITY.md:39`, `packages/cli/README.md:239`,
  `packages/mcp-server/README.md:236`, `packages/sutradhar/README.md:172`. Tool-count text: `README.md:42`,
  `packages/mcp-server/README.md:17,19`, **`AGENT_SETUP.md:60` and `packages/sutradhar/AGENT_SETUP.md:60`** ("72
  `browser.*` tools"; the two AGENT_SETUP copies are identical and the second ships in the npm `files` list).
- MCP tool count: `EXPECTED_BROWSER_TOOLS` in `packages/mcp-server/tests/unit/tools.spec.ts` (assertions at :125, :624,
  :950, :1155) and `$EV061/S3a/mcp-probe.mjs` (`EXPECT_TOOLS`, observed 73 at 0.6.1 S11).
- 0.6.1 S11 test totals (reference for S1): agent 56, apps-server 28, browser 938, capability 6, capability-runtime 505,
  cli 360 + 2 skipped, config 6, contracts 7, dev-runtime 4, events 6, frontend 29, llm 11, mcp-server 156, memory 8,
  observability 13, sdk 16, storage 7, sutradhar 64, utils 20, workflow 5. A forced build took ~40 s.
- Names free in NEG061 (all three bundles, `grep -c`): `readTextWindow` 0, `pageTextWindow` 0, `pageTextTotalChars` 0,
  `get_page_text` 0, `PageTextResult` 0. (`getPageText` is **not** free: pdf.js uses it — so it is not used.) NEG061
  does contain the private `async readPageText(tab)` (review-1 M1).

### 1.2 PROB-048 — where page text is cut, and every consumer
- `packages/capability-runtime/src/runtime.ts:2959` `document.body?.innerText?.slice(0, 4000)` in private
  `readPageText(tab)`; PDF path `:2986` `result.text.slice(0, 4000)` in `readPdfText`. No total, no marker. Both
  swallow every error as `''`.
- Private `readPageText` has **exactly one caller**: `snapshot()` (`runtime.ts:716`) -> `SnapshotResult.pageText`.
- Consumers of page text (product and repo tooling):

  | consumer | today | after 0.6.2 |
  |---|---|---|
  | CLI `text` (`cli.ts:838-843`) | `runtime.snapshot()`, prints `pageText` (re-stamps node ids as a side effect) | `runtime.readTextWindow`; window + marker; errors exit 1 |
  | CLI `snap` | does not print `pageText` | unchanged |
  | MCP `browser.snapshot` (`tools.ts:524`) | `pageText.slice(0, 2000)` | `textMaxChars` (default 2000) + marker |
  | SDK `page.snapshot()` (`sutradhar/src/page.ts:251`) | `SnapshotResult` | + two additive fields; new `page.text()` |
  | `capability-runtime/tests/unit/runtime.spec.ts:1520` | spies on private `readPageText` | spy on the renamed private `pageTextWindow` |
  | `mcp-server/tests/unit/tools.spec.ts:640,665,686` | mocks with `pageText: ''` | must still render without the new fields |
  | `tools/scenario-suite/run-sdk.mjs:536`, `run-mcp.mjs:353` (splits on `Page text:`), `run-cli.mjs` (`text` ~10x), `tools/engine-comparison/measure-snapshot-cost.mjs` | read `pageText`/`text` output | S2/S3a/S3b classify each: compatible (marker is an extra final line / after the block) or updated in the same commit |

- **Not consumers** (independent text, semantics unchanged): `wait_for` `text`/`textGone` and `expect.text`
  (`probeVisibleText`, `browser/src/verifier/execution-verifier.ts`), `extract_data` (`extract/extract-data.ts:135`),
  `audit` (`audit/site-audit.ts`), the block detector (`agent/src/core/block-detector.ts:53`).
- **Separate caps, not changed (S10b):** `agent/src/core/agent-loop.ts:705` (`raw.slice(0, 2000)`, agent.runGoal,
  labelled "excerpt", unverifiable here) and `apps/server/src/routes/browser-routes.ts:299` (`.slice(0, 1500)`).
- Snapshot generation attributes (for S3a): `SD_GENERATION_ATTR = 'data-sd-gen'` (per element) and
  `SD_CURRENT_GENERATION_ATTR = 'data-sd-current-gen'` (on `<html>`), `dom-semantic-engine.ts:52,55`, set at `:674`.

### 1.3 PROB-047 — root cause (confirmed in source; no-browser proofs by planner and reviewer)
**Root cause.** Puppeteer wraps `Frame` methods with `throwIfDetached = throwIfDisposed(...)`, whose wrapper is a
**plain, non-async function** that `throw`s synchronously when the frame is detached
(`puppeteer-core/lib/puppeteer/util/decorators.js:93-103`, same in 25.5.0 and 25.12.0). Decorated `Frame` methods
(`api/Frame.js:215-234`): `frameElement`, `evaluateHandle`, `evaluate`, `locator`, `$`, `$$`, `$eval`, `$$eval`,
`waitForSelector`, `waitForFunction`, `content`, `addScriptTag`, `addStyleTag`, `click`, `focus`, `hover`, `select`,
`tap`, `type`, `title`; `cdp/Frame.js:326` adds `goto`, `waitForNavigation`, `setContent`, `addPreloadScript`,
`addExposedFunctionBinding`, `removeExposedFunctionBinding`, `waitForDevicePrompt`. Code written as
`frame.waitForSelector(...).catch(() => null)`, or `const p = frame.evaluate(...)` outside the `try` meant to cover it,
or `bounded(frame.evaluate(...))`, does **not** contain the error. Proofs: `$SP/plan062/sync-throw-proof.mjs`
(`SYNC THROW escaped .catch`), reviewer's `$SP/review062/proof.mjs` (`OLD: rejected ... / NEW: returned null /
buildGraph-shape OLD: EMPTY GRAPH`).

`Page` delegators that are **plain** functions over decorated main-frame methods (`api/Page.js`): `click`, `focus`,
`hover`, `type`, `waitForFunction`, `locator` (sync throw only if the main frame itself is detached); `Page.evaluate`,
`Page.title`, `Page.$`… are `async` (rejections). `ElementHandle`/`JSHandle` carry `throwIfDisposed()` on ~30 methods,
but they throw only after an explicit `dispose()` (`CdpJSHandle` sets `disposed` only there), so they are SAFE unless
the code calls them on a handle it disposed itself — the inventory records this rationale per site.

**How kayak.com/stays hits it.** 4 iframes, one with the same URL as the top document, torn down and recreated
continuously (verifier inventory, `verify/phase2.json` 2561). `resolveElement` (`browser-action-engine.ts:1715-1783`):
the main-frame head start (1000 ms) finds no match, then the sequential loop takes `page.frames()` at pass start and
probes each frame for up to 150 ms in turn; a frame captured at pass start detaches while an earlier one is probed; its
`frame.waitForSelector(...)` throws synchronously (`:1773-1778`), `resolveElement` rejects, all 3 retries hit the
same churn, and the CLI prints `Click failed: Attempted to use detached Frame '<id>'` with a new id each time.
`clickrole` matches in the main frame during the head start; `text` uses `Page.evaluate` (async) on the main frame.

**Same root cause, "Interactive elements (0)":** `buildGraph` (`dom-semantic-engine.ts:390-405`) creates
`const scrape = frame.evaluate(...)` **outside** its per-frame `try`; a child that detached while an earlier frame was
scraped throws, skips the per-frame `catch` (D6: "detached -> dropped silently") and lands in the outer `catch` at
`:461`, which returns an **empty graph**, discarding the main frame's nodes.

**Initial classification (S4 re-derives it mechanically, 4.S4 step 1):**
- UNSAFE: `browser-action-engine.ts:1728`, `:1741`, `:1773` (`.catch` chained on the call); `dom-semantic-engine.ts:392`
  (promise created outside the `try`); `post-conditions.ts:631`, `:647`, `:1197` (`bounded(page.mainFrame().evaluate(...))`),
  `:1548`, `:1735`, `:1743` (`bounded(frame.evaluate(...))`: the call runs before `bounded`, so functions documented
  "never throws" reject).
- SAFE (a sync throw inside an `async` function becomes a rejection that existing handling covers):
  `execution-verifier.ts:357`, `:414`; `browser-action-engine.ts:657`, `:1911`; `dom-semantic-engine.ts:252`;
  `post-conditions.ts:608`, `:615`, `:618`, `:1497`, `:1758`, `:1762`.

### 1.4 PROB-049
`normalizeTarget` (`packages/capability-runtime/src/types.ts:322-329`) is the single entry point for every caller target
(click, focus, type, hover, select, wait, upload, scroll target, drag both ends, `resolveFrame` hops, `extract-data`
`spec.selector`, CLI `validateSelectorArgs`/`validateFrameChain`); no other code maps node ids. It maps `^\d+$` to
`[data-sd-node-id="N"]`, otherwise `assertSupportedSelectorDialect`, whose `NODE_ID_RE = /^\[?#(\d+)\]?$/`
(`selector-dialect.ts:130,181-188`) **rejects** `#5`. `#<digit>` / `[#<digit>]` are not valid CSS.

### 1.5 PROB-051
`withSessionFlow` (`packages/cli/src/session-flow.ts:46-54`): no state -> `spawnFresh()` for every `withSession` verb:
nav, snap, axsnap, text, click, clicktext, clickrole, type, press, screenshot, audit, compare, select, wait, waitfor,
eval, hover, scroll, upload, drag, clickpoint, dragpoints, setclipboard, getclipboard, grant, tabs, newtab, focustab,
closetab, download. `dialog`, `doctor`, `profile`, `close` do not use it. Help and `packages/cli/README.md:52`: only
`nav` "launches a session if none is active". The `cmdGrant` usage text documents granting before use; after 0.6.2
`grant` needs a session (documented). Every scenario-suite CLI flow starts with `nav` (review-1). The self-heal path
announces itself on stderr and is unchanged (2.4).

### 1.6 History verbs
`goBack/goForward/reload(sessionId, tabId?, expect?, settle?)` (`runtime.ts:605,631,657`) back the MCP tools.
`historyStep` swallows "history entry to navigate to not found". The `NavigationProbe` evaluates history moves by
**history index** (`post-conditions.ts:1092-1114`): checks `<go_back|go_forward>.history-index` (pass iff not at the
edge and `after.index === before.index ± 1`) with reasons `there was no history entry to go back to (index i of n)`,
`there was no forward history entry`, `history moved from entry i to j (url) (new document|same-document)`,
`the history index did not move`; reload is judged by "a new document committed". When the probe cannot observe
(dialog, CDP timeout), its checks are `not-run`. `cmdNav` has the beforeunload-cancel report
(`isBeforeunloadCancel`/`beforeunloadCancelMessage`, `cli.ts:747-763`), which requires an `ERR_ABORTED`-style
rejection. Chrome shows `beforeunload` only after sticky user activation; the existing FR2-04 tests arm it with a real
CLI `click '#arm-bu'` (`tools/scenario-suite/verify-fr2-04-dialogs.mjs:394`). The error shape of `reload`/`goBack`
under a dismissed beforeunload is **unknown** (spiked in S1).

---

## 2. Design decisions (binding; a builder that cannot implement one as written stops — 0.3)

### 2.1 Page-text windowing (I-048)
**Names (orchestrator decision; no collision with the 0.6.1 private `readPageText`):** the new public runtime method is
**`readTextWindow`**; the old private `readPageText(tab)` is **renamed** to private **`pageTextWindow(tab, opts)`**
(so no `readPageText` identifier remains in HEAD runtime source); `readPdfText` keeps its name. Both new names are
absent from NEG061 (1.1).

**Runtime API (capability-runtime, exported):**
```ts
export const DEFAULT_PAGE_TEXT_MAX_CHARS = 4000;     // unchanged default window: no token-budget change
export const MAX_PAGE_TEXT_CHARS = 100_000;          // runtime/CLI/SDK per-call ceiling; larger values rejected
export const MCP_MAX_PAGE_TEXT_CHARS = 40_000;       // MCP ceiling (client output limits, e.g. Claude Code's 25k-token default)
export interface PageTextResult {
  sessionId: string; tabId: string; url: string;
  text: string;            // the window; never contains the marker
  offset: number;          // effective start (UTF-16 code units = JS string indices), see surrogate rules
  returnedChars: number;   // text.length
  totalChars: number;      // full length of the page text
  truncated: boolean;      // offset > 0 || offset + returnedChars < totalChars
  source: 'dom' | 'pdf';
}
export class PageTextReadError extends Error { readonly source: 'dom' | 'pdf'; readonly cause?: unknown }
public async readTextWindow(sessionId: string, tabId?: string, opts?: { offset?: number; maxChars?: number }): Promise<PageTextResult>
export function formatPageTextMarker(r: Pick<PageTextResult,'offset'|'returnedChars'|'totalChars'|'truncated'>, continueHint?: string): string | null
```
- **DOM path:** ONE in-page evaluate taking `(o, m)` and returning `{ total: t.length, start, slice }` where
  `t = document.body?.innerText ?? ''`; only the window crosses CDP.
- **Surrogate rules (no split pairs, no zero-length loops):** if `o` lands on a low surrogate whose predecessor is a
  high surrogate, the effective start is `o - 1`; if the window would end on a high surrogate whose successor is a low
  surrogate, it is **extended by one** to include the whole pair (so `returnedChars` may be `maxChars + 1`, and a
  window is never empty unless `o >= total`). `offset` in the result is the effective start.
- **PDF path:** `readPdfText` returns the **full** parsed text (4000 cap removed); same windowing; `source:'pdf'`.
  A PDF that parses successfully to **empty** text (e.g. a scanned image PDF) returns `text:''`, `totalChars:0`,
  `truncated:false`, `source:'pdf'` — not an error, and no fallback to the viewer's (empty) DOM text (0.6.1's
  `if (pdfText) return pdfText;` fell back; that fallback could only ever yield `''` for a PDF). S2 unit case.
- **Error identity:** surfaces match errors by `err.name === 'PageTextReadError'` (the `ProjectConfigError` pattern),
  never `instanceof`, because the class is duplicated into each bundle (`index.js`, `cli-bin.js`, `mcp-cli.js`).
- **Validation** before any browser round trip: `offset` integer >= 0, `maxChars` integer 1..100000, else `TypeError`
  naming the parameter and range.
- **`offset >= total`:** `text:''`, `returnedChars:0`, `offset` as given, `truncated: true` if `total > 0`;
  marker shape C below. Not an error.
- **Failures are errors on the new surface (orchestrator decision, review-1 M4):** if the DOM evaluate rejects
  (context destroyed, dialog freeze, CDP failure) `readTextWindow` **rejects with `PageTextReadError`** (message names
  the reason). If the document is a PDF (`contentType === 'application/pdf'`) and fetching/parsing it fails, it rejects
  with `PageTextReadError` and `source:'pdf'` — never a silent fallback to the (empty) viewer DOM text. It never returns
  `text:''` with `totalChars:0` for a failed read.
- **`snapshot()` keeps its tolerance** (it is a composite read; a text failure must not fail the element listing): it
  uses `pageTextWindow` with offset 0 and `options.textMaxChars ?? DEFAULT_PAGE_TEXT_MAX_CHARS`, and on a text failure
  returns `pageText:''`, `pageTextTotalChars: 0`, `pageTextTruncated:false` **plus** `pageTextError: string` (additive).
  `SnapshotResult` gains `pageTextTotalChars: number`, `pageTextTruncated: boolean`, `pageTextError?: string`.
  `pageText` stays the raw window, so a caller ignoring the new fields sees byte-identical text on success.
- **Marker** (one shared formatter; ASCII only; on its own final line; `null` when not truncated). `<end>` = offset +
  returnedChars:
  - A (more follows): `[page text truncated: showing characters <offset>-<end> of <total>. <continueHint>]`
  - B (last window of a paged read, offset > 0, end == total): `[page text: showing characters <offset>-<end> of <total> (end)]`
  - C (offset >= total > 0): `[page text: offset <offset> is past the end; the page text has <total> characters]`
  - Hints: CLI `Continue with: sutradhar text --offset <end>`; MCP snapshot `Continue with browser.get_page_text
    offset=<end>, or raise textMaxChars (max 40000)`; MCP get_page_text `Continue with browser.get_page_text
    offset=<end>`; SDK: none (structured fields; `formatPageTextMarker` exported for renderers).

**CLI:** `text [--offset N] [--max-chars N] [--json]`. Prints the window, then the marker line on **stdout** when
truncated. `--json` prints the `PageTextResult` (no marker line). A `PageTextReadError` -> stderr
`Error: text read failed: <reason>`, stdout empty, **exit 1**. `--offset`/`--max-chars` with any other verb, a
non-integer, `--offset < 0`, `--max-chars` outside 1..100000, or a missing value: `printErrorAndExit` **before**
`withSession` (exit 1, no Chrome contact). `text` no longer calls `snapshot()` (no node-id re-stamp).

**MCP:** `browser.snapshot` gains `textMaxChars` (int 1..40000, default **2000**) and appends the marker after the
`Page text:` block when truncated (and `Page text unavailable: <pageTextError>` when set). New tool
**`browser.get_page_text`** `{ sessionId?, tabId?, offset?, maxChars? (1..40000, default 4000) }` (session resolution
copied from `browser.snapshot`, FR2-10): the window as text plus the marker line; a `PageTextReadError` returns
`isError: true` with the reason. Its description states the 40000 ceiling and why. Tool count **+1** (derived from
`tools/list`, never typed).

**SDK:** `page.text(options?: { offset?: number; maxChars?: number }): Promise<PageTextResult>` (rejects with
`PageTextReadError` on a failed read); `page.snapshot()` returns the additive fields; `PageTextResult`,
`PageTextReadError`, `DEFAULT_PAGE_TEXT_MAX_CHARS`, `MAX_PAGE_TEXT_CHARS`, `formatPageTextMarker` re-exported from
`sutradhar`.

**Behaviour changes to document (S10):** marker line on CLI `text` stdout when truncated; CLI `text` exits 1 on a
failed read (0.6.1 printed an empty line with exit 0); CLI `text` no longer re-stamps snapshot ids; `SnapshotResult`
additive fields; PDF text no longer capped at 4000; one new MCP tool; MCP snapshot marker. Unchanged: default window
sizes (4000 / 2000), `wait_for`/`expect.text`/`extract`/`audit` semantics.

### 2.2 Frame-detach containment (I-047)
- New module `packages/browser/src/actions/frame-call.ts` exporting `frameCall<T>(frame, op): Promise<T>` declared
  `async` (a synchronous `throwIfDisposed` throw becomes a rejection) and `isDetachedFrameError(err)`. No other
  behaviour: no retry, no frame substitution, no change to frame order, the 1000 ms head start, the 150 ms probe, or
  the retry count.
- Every site the S4 inventory classifies UNSAFE is fixed by `frameCall` or by moving the call inside the `try`/async
  scope that was meant to cover it. **Scope: any file under `packages/*/src`** that holds an UNSAFE site (review-1
  MINOR 4). A detached frame then gets exactly the treatment each site's existing contract gives a rejection:
  `resolveElement` -> no match this pass; `buildGraph` -> D6 "dropped silently", main-frame nodes kept;
  `post-conditions` -> the `{ok:false}`/not-run outcome `bounded` already returns.
- `buildGraph`'s outer catch-all that returns an empty graph is not redesigned (S10b); S4 removes the path by which a
  child-frame detach reached it.

### 2.3 `#N` refs (I-049)
`normalizeTarget`: after trim, `^\d+$`, `^#(\d+)$` and `^\[#(\d+)\]$` map to `[data-sd-node-id="<digits>"]` (digits
verbatim, like the bare-number path). Unchanged: `#5]`/`[#5` keep the node-id-syntax hint; `#a5`, `#\35`, `div#x`
are CSS; `#5 > span` is never rewritten to the node id. `selector-dialect.ts` is unchanged. Help and the
`browser.snapshot` description say `#N`/`[#N]` are accepted.

### 2.4 No-session reads (I-051)
- **Launch-capable invocations:** `nav <url>`, `newtab <url>` (url given), `audit <url>` (non-empty url),
  `compare <urlA> <urlB>`. Every other `withSession` verb (including `back`, `forward`, `reload`, `newtab`/`audit`
  without a url, `grant`, `tabs`, `getclipboard`) is not.
- `withSessionFlow` gains `mayLaunch: boolean` and `noSession: () => Error`. The correct placement is the **first
  statement inside `if (!state) {`**: `if (!deps.mayLaunch) throw deps.noSession();` — before `spawnFresh`,
  `afterAttach`, `fn`. With state present the flow is byte-for-byte unchanged.
- `noSession()` returns a `NoSessionError` (`name === 'NoSessionError'`). `main().catch` (which prints `Fatal: <msg>`
  for plain errors) gains a branch, matched by `err.name` like the existing `ProjectConfigError` handling, that prints
  exactly this one line on stderr and exits 1, stdout empty (also with `--json`):
  `Error: no active browser session — "<verb>" needs an open page and does not start one. Start a session with: sutradhar nav <url>`
  (em dash U+2014; S6 asserts the whole line byte-for-byte, and asserts no `Fatal:` line).
- Self-heal (state present, browser gone) unchanged (announced on stderr); S10b gap. The FR2-14 config load stays the
  first statement of `withSession`; validation that runs before `withSession` stays before it.

### 2.5 History verbs (I-NAV)
`back`, `forward`, `reload` with `--settle`, `--expect-*`, `--json`, `--dialog`; dialog class `guarded` (like `nav`);
not launch-capable. **Success is decided by the probe's history index, never by loaderId (orchestrator decision):**
- **Machine-readable edge marker (review-2 MAJOR-1; S7 touches `packages/browser/src/verifier/post-conditions.ts` for
  it):** `decideNavigationVerdict` emits, for `go_back`/`go_forward` when `edge` is true, an additional check
  `{ check: '<go_back|go_forward>.history-edge', outcome: 'fail', expected: 'a history entry in this direction',
  observed: 'index <i> of <n>' }`, placed **immediately after** the `history-index` check. No edge -> no such check.
  Nothing else in the probe changes. `capEvidence` (cap 8, navigation checks first) must keep it: a unit test proves the
  check survives the cap together with up to the maximum number of `expect.*` checks. The verdict *reason* text is
  never used for classification (it is replaced by `failReasons[0]` when an `--expect-*` fails, `execution-verifier.ts`
  Rule 5), and neither is `expected === -1`.
- `back`/`forward`, the `<go_back|go_forward>.history-index` check **passed** (index moved by ±1; same-document
  `pushState`/hash entries included): `Navigated back to <url>` / `Navigated forward to <url>`, `Title:`,
  `Verification:`; exit per `reportActionResult` (0, or 4 if an `--expect-*` failed).
- a `<verb>.history-edge` check is present (**edge**, for back AND forward): `Back: no history entry to go back to
  (still on <url>)` / `Forward: no forward history entry (still on <url>)`, **exit 1 regardless of `--expect-*`**
  (precedence for both verbs: edge -> 1 > failed expectation -> 4 > 0). Documented exception to the README rule that a
  contradiction alone exits 0 (`packages/cli/README.md:131`). In `--json` mode: the result JSON on stdout (unchanged
  `toCliJson` shape, which contains the edge check), the edge line on **stderr**, exit 1.
- the history-index check is `not-run`/absent (probe unavailable: dialog, CDP timeout): neutral line
  `Back requested; the history move could not be confirmed (<verification reason>)`, `Verification:` line, exit 0
  (or 4 with a failed `--expect-*`). Never "Navigated", never "no history".
- index did not move and no `history-edge` check: printed as the verification states (`NOT verified — the history
  index did not move`), exit 0 (4 with a failed `--expect-*`), per the README rule.
- `reload`: `Reloaded <url>` + `Title:` + `Verification:` (new-document check); exit per `reportActionResult`.
- **A rejected `goBack`/`goForward`/`reload` outside the beforeunload branch** (e.g. a navigation timeout) is not
  caught by the verb: it reaches `main().catch` and prints `Fatal: <message>`, exit 1, stdout empty — intended
  (the same contract as a failing `nav`), and never a "Navigated"/"Reloaded" line. A verification with **no checks
  at all** classifies as `unconfirmed` (neutral line, exit 0 / 4 with a failed `--expect-*`).
- **beforeunload:** bound by the S1 spike (S1 step 8). If `reload`/`goBack` under `--dialog dismiss` rejects with an
  `ERR_ABORTED`-style error, reuse `isBeforeunloadCancel`/`beforeunloadCancelMessage` (factored out of `cmdNav`,
  `nav` unchanged) and exit 1. If it instead resolves or waits for a timeout, the CLI detects the cancel from the
  dialog history (`runtime.getDialogHistory` has a dismissed `beforeunload` opened after the verb started) and prints
  the same cancel message, exit 1. The spike records which; the builder implements that one; if neither is observable
  deterministically, S7's H3 is dropped **only with orchestrator sign-off** and logged in S10b.

---

## 3. Order, gating, escalation

```
S1 baseline + fixtures + spikes + plan commit
-> S2 I-048 runtime -> S3a I-048 CLI -> S3b I-048 MCP -> S3c I-048 SDK
-> S4 I-047 (mechanical inventory, unit proof, deterministic live repro vs NEG061 + same-build mutants, Kayak supporting)
-> S5 I-049 -> S6 I-051 -> S7 I-NAV
-> S8 independent audit (fresh auditor; per-item verdicts; orchestrator commits $EV/S8)
-> S9 version -> S10 changelog/docs -> S10b gaps -> S11 release gate -> S11b WebBench re-run -> handoff
```
1. Steps run in this order; each is one commit (S3a/b/c three commits; S11 and S11b separate). A step's ACs must all
   PASS before the next starts.
2. **Escalation per item** (I-048, I-047, I-049, I-051, I-NAV) over every independent audit. #1 fail: fix commit(s)
   `S8-fix-<item>-<n>`, fresh re-audit of that item. #2: **stop**; the orchestrator re-derives the root cause from the
   code, decides spec/tests/implementation, writes `.ai/loop/release-0.6.2/replan-<item>.md`, then fixes. #3:
   **BLOCKED**: `git revert --no-edit` the item's commits newest first (never reset); PROB entry stays OPEN; changelog
   "not included"; the gate runs without it.
3. **If I-048 is BLOCKED the release stops** and the orchestrator reports to the user. Other BLOCKED items ship as
   "not included".
4. **I-047 fixture-validity STOP:** if NEG061 shows 0 failures at both churn levels (S4 L1/L3), the item STOPs for a
   replan and PROB-047 is not marked RESOLVED (a HEAD pass on a fixture that never fails is not evidence).
5. Builder briefs: section 0 verbatim + the step text + the relevant 2.x, nothing from other builders. Auditor briefs:
   section 0, the ACs, section 5, pointers; never builder reasoning.

---

## 4. Steps

Every step: location check first; scratch under `$R/<STEP>/`; `$EV/<STEP>/README.md` with commands, output excerpts,
per-AC false-pass analysis, the mutant table (mutant, killing test, exit codes), and `git status --porcelain` before
the commit.

### S1 - Baseline, fixtures, spikes, plan commit
1. `<HEADER>; git rev-parse --show-toplevel; git branch --show-current; git rev-parse HEAD; git status --porcelain; df -h /e; mkdir -p "$EV/S1" "$R/S1"`
   — `git status --porcelain` must print **exactly** `?? .ai/loop/release-0.6.2/` (this plan + reviews), nothing else.
2. Guard/path checker: `sha256sum "$SP/iso/"*.mjs` equal to `$EV061/S1/iso-tools.sha256`; re-run the 0.6.1 S1
   self-tests verbatim with ISO `$R/S1-tmp` (guard `neg-exit=97`, `pos-exit=0`, `vitest-neg-exit=97`; checker
   `pos-exit=0`, `neg-exit=1` with `OUTSIDE-ISO`, `empty-exit=1`). Save `guard-selftest.txt`, `pathcheck-selftest.txt`,
   `pathcheck-neg.log` to `$EV/S1/`.
3. NEG061 pin: `sha256sum "$NEG061/"{cli-bin,index,mcp-cli}.js` and its `package.json` version (0.6.1) ->
   `$EV/S1/neg061.sha256`; `for w in readTextWindow pageTextWindow pageTextTotalChars get_page_text PageTextResult; do echo "$w $(cat "$NEG061"/*.js | grep -c "$w")"; done`
   -> `$EV/S1/neg061-absent-names.txt` (all 0) and `grep -c "async readPageText(tab)" "$NEG061/index.js"` (>= 1, recorded).
4. ISO registry: for each live ISO name in 0.2, `[ ! -e "$SP/<name>" ]` -> `$EV/S1/iso-names-free.txt` (all free).
   On a re-run of S1 after an aborted attempt, S1's own leftovers (`$R/S1-tmp`, `S2t`) carrying `.r062` are first
   removed with the guarded form (0.2 item 8); any other non-free name, or an unmarked one, is a STOP.
   Copy `$SP/r5/{tsconfig.specs.json,tsconfig.neg.json,planted.ts}` to `$R/spectsc/` (sha256 recorded).
5. Matrix baseline: copy `$EV061/S1/matrix.sh.txt` to `$R/S1/matrix.sh`, changing only `EV=` (0.6.2 path) and
   `ISO="$SP/$STEP-tmp"` -> `ISO="$SP/r062/$STEP-tmp"` (+ `: > "$ISO/.r062"`); `bash "$R/S1/matrix.sh" S1`;
   `$EV/S1/test-totals.txt`; expected equal to the 1.1 totals, differences explained.
6. Spec typecheck baseline (`$R/spectsc/`): 7 errors, 0 TS6059, planted TS2322. Lint:
   `timeout 900 node_modules/.bin/turbo run lint --force --continue --concurrency=1` -> `$EV/S1/lint.log` + summary.
7. **Fixture server** `$EV/fixtures/fixture-server.mjs` (product-independent; sha256 in `$EV/S1/fixtures.sha256`; any
   later change is its own commit with a reason). `start()` -> `{ url, port, hits, setPdf, close }` on 127.0.0.1:0:
   - `/long?n=10000`: deterministic numbered lines, `innerText` length >= n (harnesses read the real length via a raw
     evaluate); `/long-emoji`: surrogate pairs straddling indices 3999/4000 and at a known offset; `/short` (~300 chars).
   - `/churn?k=8&ms=25`: 5 visible buttons `#b1..#b5`, hidden `#late` revealed `d` ms after `window.__arm(d)`,
     click counters `window.__clicks`, `k` same-origin iframes recreated every `ms` ms (one with `src` = the top URL;
     children never create iframes), `window.__recreated` counter.
   - `/nodeid`: button "Go" (`window.__goClicks`), an input, an iframe with its own title and button.
   - `/hist/a`, `/hist/b` (full documents; each records `window.__nav = { type: performance.getEntriesByType('navigation')[0].type, persisted }`
     from its `pageshow` event so the evidence names whether a `back` was a bfcache restore), **`/hist/spa`**: an
     **inline script at the end of `<body>`** (synchronous, before `load`, so it has run when the CLI's `nav` returns)
     does `history.pushState({}, '', '#2')` then `location.hash = 'x'` (two same-document entries);
     `/reload-count` (server-side counter in `hits`).
   - **`/beforeunload`**: a button `#arm-bu` whose click handler sets `window.onbeforeunload` (armed by a real CLI
     `click`, the FR2-04 pattern, giving Chrome sticky user activation).
   - `/pdf`: serves `setPdf(buffer)` bytes, `content-type: application/pdf`, `content-disposition: inline`.
   Self-test `$EV/fixtures/selftest.mjs` (GET each route, status 200 + marker) -> `$EV/S1/fixtures-selftest.txt`.
8. **Spikes** (built 0.6.1 behaviour is the same code path; run with the **current HEAD build**, ISO `S2t` — created
   and deleted here, then re-created fresh in S2), recorded in `$EV/S1/spikes.md`, no product change:
   - SP-1 beforeunload: a throwaway harness `$R/S1/sp1.mjs` imports `SutradharRuntime` from the HEAD bundle, sets the
     session dialog policy to `dismiss`, navigates `/hist/a` then `/beforeunload`, arms the handler with a **real
     click** on `#arm-bu` (`runtime.click`, CDP input = user activation), then calls `runtime.reload`; re-arms and calls
     `runtime.goBack`. For each: rejects (message) / resolves / times out (bounded 30 s), the URL afterwards, and what
     `runtime.getDialogHistory` shows. This selects 2.5's beforeunload branch.
   - SP-2 headless PDF: SDK `exportPdf` of `/long?n=10000`, `setPdf`, `nav /pdf` headless; record whether the document
     loads (`document.contentType`) or aborts (`ERR_ABORTED`). If it aborts, try without `content-disposition`; if
     still aborted, S3a(g) runs `--headed` (window off-screen via the existing `--viewport`/position defaults) and, if
     that also fails, S3a(g) becomes unit-only with an S10b gap (orchestrator informed).
8b. **Tool-count baseline (S3b and S10 read it from here):** after the spikes, delete `S2t` (guarded form), re-create
   it fail-closed, and under the preamble run
   `$EV061/S3a/mcp-probe.mjs` unmodified on the HEAD build with `EXPECT_VERSION=0.6.1 EXPECT_TOOLS=73`; record the
   observed `tools/list` length and `node -e` count of `EXPECTED_BROWSER_TOOLS` entries (read from
   `packages/mcp-server/tests/unit/tools.spec.ts` by a small script that imports nothing from the product) to
   `$EV/S1/tool-count.txt` as `tools_list=<n> expected_browser_tools=<m>`. AC: probe exit 0 and both numbers recorded.
9. Delete `$R/S1-tmp` and `S2t` (guarded form). Commit `0.6.2: plan, reviews, baseline evidence, fixtures, spikes`
   adding by name `.ai/loop/release-0.6.2/plan.md`, each `plan-review-*.md`, `.ai/loop/release-0.6.2/STATE.md`
   (created here: last step, next step, verify command; 6.4), `$EV/S1`, `$EV/fixtures`.

**AC** S1-1 location + exactly the expected untracked dir. S1-2 self-tests exact values. S1-3 NEG061 hashes, absent
names all 0, private `readPageText` present. S1-4 ISO names free; spectsc copy hashes. S1-5 20 matrix logs with guard
lines. S1-6 spec typecheck 7/0/TS2322; lint summary. S1-7 fixture self-test. S1-8 SP-1 and SP-2 outcomes recorded with
the branch they select. S1-9 clean tree after commit.
**Mutants** guard without normalisation fails `pos-exit`; checker ignoring quoted paths fails `neg-exit` (0.6.1).
**False-pass**: S1-3 "absent names" could be a grep against the wrong dir — the command also counts `async
readPageText(tab)` in the same files (>= 1 proves the files were read).

### S2 - I-048 runtime: `readTextWindow`, totals, errors, marker, PDF (capability-runtime only)
Files: `packages/capability-runtime/src/runtime.ts`, `src/types.ts`, `src/index.ts`, new `src/page-text.ts`
(validation, windowing, surrogate rules, `formatPageTextMarker`, `PageTextReadError`), tests in
`packages/capability-runtime/tests/unit/` (new `page-text.spec.ts`; the spy at `runtime.spec.ts:1520` retargeted to
`pageTextWindow`, plus a test that fails if `snapshot()` does not call it).
1. Implement 2.1's runtime part exactly; remove both `slice(0, 4000)`; rename private `readPageText` -> `pageTextWindow`.
2. Consumers: `rg -n "pageText|readPageText|readPdfText|Page text:|\btext\b'\]|innerText\?\.slice\(0, ?4000\)" packages apps tools .claude/skills --glob '!**/dist/**' --glob '!**/node_modules/**'`
   -> `$EV/S2/consumers.txt`; each hit classified in `$EV/S2/consumers.md` against 1.2 (incl. the `tools/` rows); any
   incompatible consumer is updated in the commit of the step that changes the surface it reads (S2/S3a/S3b).
   `rg -n "readPageText" packages/capability-runtime/src` prints nothing.
3. Unit tests (the evaluate mock **executes the passed function** against a fake `document.body.innerText`): default
   window of a 10 000-char text (`totalChars:10000`, `truncated:true`); offset/maxChars windows; offset >= total
   (shape C); validation errors (0, 100001, -1, 1.5, NaN) with evaluate call count 0; surrogate cases (window ending on a
   high surrogate is extended; `maxChars:1` at a pair returns 2 code units, never 0; offset on a low surrogate starts one
   earlier); **evaluate rejects -> `readTextWindow` rejects `PageTextReadError`, while `snapshot()` returns `pageText:''`
   + `pageTextError`**; PDF detected + parse throws -> `PageTextReadError` with `source:'pdf'` (never a `dom` result);
   PDF ok (9000 chars mocked) windowed with `source:'pdf'`; PDF parsed to empty text -> `text:''`, `totalChars:0`,
   `source:'pdf'`, no error and no DOM fallback (the DOM evaluate mock's call count for innerText is 0); marker strings exactly for A/B/C and `null`.
4. `vitest run` capability-runtime, browser, mcp-server, sutradhar, cli under the preamble (ISO `$R/S2-tmp`):
   capability-runtime > S1 by the new tests, others == S1.
5. Live (forced build; HEAD ISO `S2t`, NEG061 ISO `N2t`): harness `$EV/S2/live-runtime.mjs` (env `BUNDLE=<abs index.js>`)
   imports `SutradharRuntime` (exported from the bundle), launches headless, navigates `/long?n=10000` and `/short`,
   reads FULL via a raw `page.evaluate('document.body.innerText')` / `runtime.eval` (independent channel).
   HEAD: `readTextWindow` windows and `snapshot()` fields. **NEG061 negative control (genuinely absent things only):**
   `typeof runtime.readTextWindow === 'undefined'` (S1-3 grep count 0), and `snapshot()` on `/long` gives
   `pageTextTotalChars === undefined` and `pageText.length === 4000`.

**AC**
- S2-1 HEAD `readTextWindow` on `/long`: `text.length 4000`, `totalChars == FULL.length`, `truncated`; windows at
  0/4000/8000/... concatenate to exactly FULL; FULL.length >= 10000 and the windows differ.
- S2-2 invalid options throw `TypeError` with evaluate call count 0 (unit).
- S2-3 `/short` `snapshot().pageText` byte-identical to NEG061's for the same page, length > 200, `pageTextTruncated:false`.
- S2-4 failure semantics (unit): rejecting evaluate -> `PageTextReadError` on `readTextWindow`, tolerant `snapshot()`
  with `pageTextError`; PDF failure -> `PageTextReadError(source:'pdf')`.
- S2-5 NEG061 control values as stated.
- S2-6 consumers.md complete; wait_for/expect.text/extract/audit sources untouched (`git diff --stat`) and their test
  counts unchanged.
**Mutants** M-048a window ignores offset; M-048b `totalChars` from the slice; M-048c validation after evaluate;
M-048d PDF keeps `slice(0,4000)`; M-048e marker when not truncated; M-048f surrogate rule removed (and M-048f2 "shrink
instead of extend" — the `maxChars:1` test must kill it); **M-048p `readTextWindow` swallows the evaluate error and
returns `text:''`/`totalChars:0` (S2-4 must kill it)**; M-048q PDF parse failure falls back to DOM text.
**False-pass**: S2-1 against a stale dist — dist hash changed and `grep -c readTextWindow dist/index.js` >= 1; FULL
from the same code path — it is a raw evaluate; S2-3 with both sides empty — length > 200 asserted.
Commit `I-048 (1/4): runtime readTextWindow with totals, marker and explicit read errors; PDF text no longer capped`.

### S3a - I-048 CLI `text --offset/--max-chars/--json` + marker + read errors
Files: `packages/cli/src/cli.ts`, `packages/cli/src/parse-args.ts`, CLI unit tests (`parse-args.spec.ts`,
`help-text.spec.ts`, a pure formatter test), help text; `tools/scenario-suite/run-cli.mjs` only if S2's consumers.md
marked it incompatible.
1. Flags and validation per 2.1 (pure, in parse-args; `printErrorAndExit` before `withSession`).
2. `cmdText` uses `runtime.readTextWindow`; prints the window, then the marker when truncated; `--json` prints the
   result; a `PageTextReadError` (matched by `err.name`) is **caught inside `cmdText`**, which prints exactly
   `Error: text read failed: <reason>` on stderr, nothing on stdout, and sets exit 1 (it never reaches `main().catch`'s
   `Fatal:` path; S3a(j) and the unit test assert the exact prefix, empty stdout and no `Fatal:` line).
3. Help: `text [--offset N] [--max-chars N] [--json]` + one line on the marker; help-text.spec pins it.
4. Unit: flag parsing (valid, missing value, non-integer, negative, 0, 100001, `--offset` with `snap`); formatter for
   marker shapes A/B/C; error path formatter.
5. Live (forced build; HEAD under ISO `Sat`; NEG061 runs of the same harness, env `CLI=<abs>`, under ISO `N3t`; both
   deleted at the end). Harness `$EV/S3a/live-cli-text.mjs`:
   a. `nav /long?n=10000`; `eval "document.body.innerText.length"` -> L; `eval "document.body.innerText"` -> FULL.
   b. `text` -> stdout = FULL[0:4000] + "\n" + marker A naming `0-4000 of L` and `sutradhar text --offset 4000`.
   c. `text --offset 4000`, `--offset 8000`, ... until marker B; concatenation == FULL (L >= 10000, windows differ).
   d. `text --max-chars 100000` -> FULL, no marker. `text --offset <L+5>` -> empty window + marker C, exit 0.
   e. `text --json` parses; fields equal (b).
   f. `/short`: `text` stdout byte-identical to NEG061 `text` on the same page (length > 200).
   g. PDF (branch selected by SP-2): `nav /pdf`, `text --json` -> `source:'pdf'`, `totalChars > 4000`; NEG061 prints
      <= 4001 characters on the same PDF.
   h. invalid flags (5 cases) **mid-session** -> exit 1, stderr message, `$ISO/state/state.json` sha256 unchanged, no
      new `sutradhar-cli-*` under ISO.
   i. **ids not re-stamped (fixed attribute names):** `snap`; read `G1 = document.documentElement.getAttribute('data-sd-current-gen')`
      (must be non-null) and `E1 = document.querySelector('[data-sd-node-id]').getAttribute('data-sd-gen')`; `text`;
      read `G2`, `E2`; AC `G1 !== null && G1 === G2 && E1 === E2`. Control: a second `snap` changes `G` (proves the
      read detects a re-stamp).
   j. read failure (the deterministic proof of the error path is the step-4 unit test; this is the live check): on
      `/long`, `eval "setTimeout(()=>alert('x'),0)"` (default dialog policy), then `text`. HEAD must give either the
      existing dialog-blocked report (exit 3) or `Error: text read failed: …` (exit 1) — **never exit 0 with empty
      stdout**. NEG061 on the same is recorded (whatever it does). Dismiss the dialog (`dialog dismiss`) before `close`.
   k. NEG061 on (b): stdout length 4001, no marker (proves the harness sees the old defect).
   **Same-build mutant M-048i (live; the harness skips it when `NO_MUTANTS=1`):** a sibling `dist/cli-bin.mutant.js` where `cmdText` calls `runtime.snapshot()`
   again (exactly 1 replacement, `grep -c`); running (i) with it must FAIL (`G2 !== G1`). Mutant file deleted; real
   `cli-bin.js` sha256 unchanged.
   `close` each session; path-log check; real-TEMP snapshot.

**AC** S3a-1..S3a-11 = items a-k; S3a-12 M-048i live fails (i); S3a-13 cli vitest = S1 + new tests; spec typecheck
baseline 7 + 0 new; `cli.ts` mode 100644 before and after.
**Mutants** M-048g marker on stderr (b); M-048h validation inside `withSession` (h); M-048i (above, live + a unit-level
equivalent if `cmdText` is extracted to a testable function); M-048j `--offset` parsed but not passed (c); M-048r
`PageTextReadError` printed as empty stdout with exit 0 (unit error-path test).
**False-pass**: (c) with identical windows — L >= 10000 and windows differ asserted; (f) both empty — length > 200;
(h) vacuous without a session — run mid-session; (i) vacuous attribute — G1 non-null asserted and the control `snap`
changes it, plus M-048i must fail it.
Commit `I-048 (2/4): CLI text paging flags, truncation marker, explicit read errors`.

### S3b - I-048 MCP: `browser.snapshot` `textMaxChars` + marker; `browser.get_page_text`
Files: `packages/mcp-server/src/tools.ts`, `packages/mcp-server/tests/unit/tools.spec.ts` (`EXPECTED_BROWSER_TOOLS`
+1; tests for both tools); `tools/scenario-suite/run-mcp.mjs` only if consumers.md marked it incompatible.
1. Implement 2.1's MCP part: `textMaxChars: z.number().int().min(1).max(40000).optional()`, `offset:
   z.number().int().min(0).optional()`, `maxChars: z.number().int().min(1).max(40000).optional()`; session resolution
   copied from `browser.snapshot`; tool description states the 40000 ceiling and the client-output reason. The
   handler matches a read failure by `err.name === 'PageTextReadError'` and returns `isError: true` with its message.
2. The snapshot renderer tolerates a `SnapshotResult` without the new fields (old mocks at :640/:665/:686).
3. Unit: marker iff truncated; `textMaxChars` honoured; `pageTextError` rendered; get_page_text windows; a rejecting
   `readTextWindow` -> `isError: true` with the reason; schema rejects 0/40001/-1; tool count = previous + 1.
4. Live (forced build; ISO `Sbt`; NEG061 `mcp-cli.js` under `N3t`): `$EV061/S3a/mcp-probe.mjs` **unmodified** with
   `EXPECT_VERSION=0.6.1`, `EXPECT_TOOLS=<tools_list from $EV/S1/tool-count.txt, + 1>` -> PASS, and with the S1
   `tools_list` value -> FAIL; `EXPECTED_BROWSER_TOOLS` = S1 `expected_browser_tools` + 1. Harness
   `$EV/S3b/live-mcp-text.mjs`: navigate `/long?n=10000`; `browser.snapshot` "Page text:" block = FULL[0:2000] + marker
   (`0-2000 of L`, names `browser.get_page_text offset=2000`); `textMaxChars:5000` -> 5000 + marker; `get_page_text`
   paged to marker B, concatenation == FULL (FULL via `browser.eval`); `maxChars:40001` -> schema error; `/short`
   snapshot text byte-identical to NEG061's (length > 200); NEG061 tools/list lacks `browser.get_page_text` and its
   snapshot block is exactly 2000 chars with no marker. `shutdown_all`; child exit.

**AC** S3b-1 tools/list = S1 + 1 incl. `browser.get_page_text`; S3b-2 snapshot marker/size; S3b-3 paging exact;
S3b-4 short page identical; S3b-5 NEG061 old behaviour; S3b-6 vitest = S1 + new; probe negative exits 1.
**Mutants** M-048k snapshot ignores `textMaxChars`; M-048l get_page_text ignores `offset`; M-048m tool missing from
`EXPECTED_BROWSER_TOOLS`; M-048s get_page_text returns empty text instead of `isError` on a read error.
**False-pass**: stale `mcp-cli.js` — dist hash changed + `grep -c get_page_text dist/mcp-cli.js` >= 1.
Commit `I-048 (3/4): MCP snapshot textMaxChars + marker; browser.get_page_text`.

### S3c - I-048 SDK `page.text()` and exports
Files: `packages/sutradhar/src/page.ts`, `src/index.ts`, `packages/sutradhar/tests/unit/*` (new tests; `api.spec.ts`
version line untouched).
1. `page.text(options?)` -> `runtime.readTextWindow(sessionId, tabId, options)`; JSDoc: marker not in `text`, how to
   page, rejects with `PageTextReadError`. Exports per 2.1.
2. Unit: delegation with exact arguments (incl. `tabId`); export presence; rejection propagated.
3. Live (forced build; ISO `Sct`; NEG061 under `N3t`): harness `$EV/S3c/live-sdk-text.mjs`: `page.text()` on
   `/long?n=10000` (fields; paging concatenation == `page.evaluate('document.body.innerText')`); `page.snapshot()`
   additive fields; `/long-emoji` windows never end on a lone high surrogate and never start on a lone low surrogate;
   `{maxChars:0}` -> `TypeError`; NEG061: `typeof page.text === 'undefined'`. `browser.close()`; attribution query
   shows no Chrome with the ISO basename.

**AC** S3c-1..S3c-4 as listed; sutradhar vitest = S1 + new.
**Mutants** M-048n `page.text` drops `tabId`; M-048o `formatPageTextMarker`/`PageTextReadError` not re-exported.
Commit `I-048 (4/4): SDK page.text() and page-text exports`.

### S4 - I-047 frame-detach containment
Files: `packages/browser/src/actions/browser-action-engine.ts`, `src/dom/dom-semantic-engine.ts`,
`src/verifier/post-conditions.ts`, new `src/actions/frame-call.ts`, new `packages/browser/tests/unit/frame-detach.spec.ts`,
**plus any other `packages/*/src` file holding an UNSAFE site** (2.2), each listed in the README.
1. **Mechanical inventory (orchestrator decision: every call site that can throw synchronously).**
   - `$EV/S4/sync-throw-methods.txt`: the method names that throw synchronously, derived from the installed Puppeteer
     by script `$EV/S4/list-sync-methods.mjs` (parses `api/Frame.js`, `cdp/Frame.js`, `api/Page.js` plain delegators,
     `api/ElementHandle.js`, `api/JSHandle.js` for `throwIfDetached`/`throwIfDisposed` decorator arrays and
     non-`async` Page methods), run against **both** 25.5.0 (monorepo) and 25.12.0 (`$SP/v061/inst/node_modules/puppeteer-core`);
     the union is used; the list must contain at least the 1.3 names (self-check in the script).
   - `$EV/S4/sites.txt`: **every** call in `packages/*/src/**/*.ts` (excluding `dist`, tests) of any listed method on any
     receiver, including multi-line chains, produced by `$EV/S4/list-sites.mjs`, which:
     - builds the alternation from `sync-throw-methods.txt` with every name **regex-escaped** (`$`, `$$`, `$eval`,
       `$$eval` contain `$`; escape with `s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`), longest names first;
     - runs `rg -nU --pcre2 --column -o "\.\s*(?:<alternation>)\s*\(" packages/*/src --glob '!**/dist/**'` via
       `spawnSync` with an argument array (no shell quoting of `$`);
     - normalises every path to forward slashes and keys each hit as **`file:line:col`** (two calls on one line are two
       keys).
     A self-test in the script asserts the generated regex matches `frame.$$eval(`, `x.$(` and `y\n  .waitForSelector(`
     in a scratch string and does not match `$eval(` without a dot.
   - `$EV/S4/frame-call-sites.md`: one row per `sites.txt` hit (same `file:line:col` key): receiver type (Frame /
     Page-plain-delegator / Page-async / ElementHandle-JSHandle / non-Puppeteer), SAFE or UNSAFE, one-sentence reason
     (ElementHandle rows: "throws only after an explicit dispose(); this code never disposes it before the call", or
     UNSAFE if it does). 1.3's UNSAFE list, including `post-conditions.ts:1197`, is the minimum.
   - `$EV/S4/check-inventory.mjs`: exits 0 iff the set of `file:line:col` keys (separators normalised on both sides) in
     `sites.txt` equals the set of rows in `frame-call-sites.md` and every row has a classification; prints
     missing/extra keys. **Negative controls:** a copy of the md with one row removed -> exit 1; with an extra fake row
     -> exit 1. **Documented-limitation control:** a scratch copy (under `$R/S4/`) of one source file with an added
     `frame.evaluate.call(frame, () => 1)` — record that `list-sites.mjs` run on that copy does **not** list it (the
     grep cannot see `.call/.apply/.bind`, optional `?.(`, bracket or destructured calls); therefore assert on the real
     post-fix tree that `rg -n --pcre2 "\.(?:<alternation>)\s*\.(call|apply|bind)\(|\?\.\(|\[['\"](?:<alternation>)['\"]\]\s*\(" packages/*/src`
     has **0** hits (review-2 found 0 today), so the blind spot is empty.
   - The inventory is re-run **after** the fix (line numbers move): `check-inventory` exits 0 on the post-fix tree and no
     row is UNSAFE.
2. Fix every UNSAFE site per 2.2.
3. **Deterministic unit proof** (`frame-detach.spec.ts`): fake objects whose decorated methods are **plain non-async
   functions** that `throw new Error("Attempted to use detached Frame '<id>'.")` synchronously when detached, with a
   scripted detach (frame B detaches when frame A's probe is invoked):
   - U-ctl `expect(() => frameB.waitForSelector('x')).toThrow()` after detach (the fake really throws synchronously).
   - U1 loop path: main no match, A probed -> B detaches -> C matches -> C's handle; never throws.
   - U2 loop path, no match anywhere, frames detaching every pass -> `null` at the deadline (smallest `timeoutMs`).
   - U3 single-frame path, frame detached at call -> `null`. U4 head start, main detached at call -> loop, no throw.
   - U5 `buildGraph`: main 5 nodes; child X detaches while main is scraped -> 5 main nodes, no skipped entry for X.
   - U6.. one per other UNSAFE site (incl. `post-conditions.ts:631/647/1197/1548/1735/1743`), asserting the site's
     documented rejection outcome (e.g. "never throws" -> resolves with not-run/`{ok:false}`).
4. `vitest run` browser (S1 + new); capability-runtime, mcp-server, sutradhar, cli unchanged counts.
5. **Deterministic live repro** (forced build; HEAD ISO `S4t`, NEG061 ISO `N4t`). Harness `$EV/S4/live-detach.mjs`,
   fixture `/churn?k=8&ms=25`; after each run the harness asserts `window.__recreated > 100` (churn really happened):
   - L1 (CLI; `#absent` never matches in the main frame, so the loop always runs): 10x `nav /churn` + `click '#absent'`
     + `close` per binary. HEAD: every run exit 1 with `No visible element found`, no `detached Frame` anywhere.
     NEG061: count runs containing `Attempted to use detached Frame`.
   - L2 (SDK in-process, loop path proven): `page.evaluate('window.__arm(2500)')` then immediately `page.click('#late')`;
     measure `t0`/`t1` with `performance.now()` around the click; HEAD: 10/10 succeed, `window.__clicks.late === 1`, and
     `t1 - t0 > 1000` (past the head start; both numbers recorded). NEG061: record outcomes (supporting).
   - L3 (snapshot under churn): 20x SDK `page.snapshot()` + 10x CLI `snap`; HEAD: every result lists `#b1..#b5`;
     NEG061: count degraded results (`Interactive elements (0)` or fewer than 5).
   - L4 `type '#absent-input' x` 5x per binary: HEAD never `detached Frame`.
   - **Fixture validity (section 3 rule 4):** NEG061 must show >= 1 detached failure in L1 and >= 1 degraded result in
     L3. If either is 0, re-run both binaries at `k=16&ms=10`; if still 0, STOP (replan); never accept a HEAD pass from
     a fixture that did not fail NEG061.
   - **Same-build mutants (same Puppeteer as HEAD; skipped when `NO_MUTANTS=1`):** `dist/cli-bin.mutant.js` with M-047a (loop wrapper reverted) on
     L1 must show `detached Frame` in >= 1 of 10; `dist/index.mutant.js` with M-047b (`buildGraph` fix reverted) on L3
     must show >= 1 degraded result in 20 (validity rule applies: raise churn once if 0). Mutant files deleted; real
     dist sha256 unchanged.
   - Path-log check, real-TEMP snapshot, PIDs confirmed gone, guarded delete of `S4t`/`N4t`.
6. **Supporting live check (never a gate; may block):** HEAD CLI, ISO `S4t` **re-created with the creation form**
   (step 5 removed it; later commands of step 6 use the continuation form), one attempt: `nav https://www.kayak.com --settle`,
   `nav https://www.kayak.com/stays --settle`, `snap`, `click <id of 'Enter a city…'>`, `snap`, `type <destination id> Rome`,
   `text`. Supporting PASS: no `detached Frame` in any output and no `Interactive elements (0)` while `text` shows content.
   Bot wall/429 -> EXTERNAL-BLOCK. A clear `No visible element`/occlusion error because the field lives in a child frame
   is a separate finding (S10b), not an I-047 failure.

**AC** S4-1 `check-inventory` exits 0 before and after the fix, its two negative controls exit 1, the method list
covers both Puppeteer versions, and the post-fix inventory has 0 UNSAFE rows; S4-2 U-ctl, U1-U5 and one U per UNSAFE
site pass; S4-3 L1 HEAD 10/10 clean, NEG061 >= 1 (validity); S4-4 L2 HEAD 10/10 with `t1 - t0 > 1000`; S4-5 L3 HEAD
30/30 complete, NEG061 >= 1 degraded; S4-6 L4 clean; S4-7 same-build mutants M-047a (L1) and M-047b (L3) fail; S4-8
counts/typecheck; S4-9 Kayak result recorded honestly.
**Mutants** (each fails >= 1 U test): M-047a loop wrapper reverted (U1/U2); M-047b `buildGraph` wrapper reverted (U5);
M-047c `frameCall` non-async `(f, op) => op(f).catch(e => { throw e })` (U1-U5); M-047d single-frame path (U3);
M-047e head start (U4); M-047f per-frame catch clears `allNodes` (U5); one per other fixed site (U6..).
**False-pass**: fake throws asynchronously — U-ctl; loop never reached — `#absent` (L1) and the measured `t1 - t0`
(L2); stale dist — dist hash changed and the grep used for `frameCall` (record it; names may be minified); no churn —
`__recreated > 100`; Puppeteer-version confound — the same-build mutants.
Commit `I-047: contain synchronous detached-frame throws in frame probes, snapshots and post-conditions`.

### S5 - I-049 `#N` / `[#N]` accepted as node ids
Files: `packages/capability-runtime/src/types.ts` (`normalizeTarget`), its tests, `packages/cli/tests/unit/selector-args.spec.ts`,
`packages/mcp-server/src/tools.ts` (description sentence only), `packages/cli/src/cli.ts` (help sentence only).
`selector-dialect.ts` unchanged (its `#12`/`[#12]` tests still pass: `normalizeTarget` handles those first).
1. Implement 2.3.
2. Unit: `#5`, `[#5]`, ` #5 `, `5` -> `[data-sd-node-id="5"]`; `#05` -> `"05"`; `#5]`, `[#5` -> InvalidSelectorError with
   the hint; `#a5`, `#\\35`, `div#x` unchanged; `#5 > span` never mapped; `validateSelectorArgs(['#5'])` null;
   `validateFrameChain('#7::#8')` null.
3. Live (forced build; ISO `S5t`, NEG061 `N5t`): `/nodeid`; `snap` -> ids; `click "#<go>"` exit 0 and `__goClicks` 1;
   `click "[#<go>]"` -> 2; `type "#<input>" hello` -> value; `eval "document.title" --frame "#<iframe>"` -> iframe
   title; MCP `browser.click {target:"#<go>"}`; SDK `page.click('#<go>')`; NEG061 `click "#<go>"` exit 1 with the hint.

**AC** S5-1 unit; S5-2 live CLI/MCP/SDK/`--frame` with independent counters; S5-3 NEG061 rejects; S5-4 counts.
**Mutants** M-049a unanchored regex; M-049b `#N` only (bracket test); M-049c `Number()` normalisation (`#05`).
Commit `I-049: accept #N and [#N] snapshot ids wherever a target is accepted`.

### S6 - I-051 no-session reads fail with a hint
Files: `packages/cli/src/session-flow.ts`, `packages/cli/src/cli.ts`, `session-flow.spec.ts`, `help-text.spec.ts`, help
text (incl. the `grant` usage line: "needs an active session; run nav first"); dependents found in step 1.
1. Dependents inventory `$EV/S6/autolaunch-dependents.md`:
   `rg -n "runCli\(|cli\(|spawnSync\(|drive\.mjs" tools .ai/loop/webbench-2026-10-04 packages/*/tests .claude/skills`;
   `.github/workflows/*.yml` CLI steps; docs examples with **every** non-launch verb:
   `rg -n "sutradhar (snap|axsnap|text|click|clicktext|clickrole|type|press|screenshot|select|wait|waitfor|eval|hover|scroll|upload|drag|clickpoint|dragpoints|setclipboard|getclipboard|grant|tabs|newtab|focustab|closetab|download|back|forward|reload)\b" README.md docs packages/*/README.md AGENT_SETUP.md packages/sutradhar/AGENT_SETUP.md .claude/skills .ai/loop/webbench-2026-10-04/driver-brief.md`.
   Each case where a non-launch verb is the first command against a fresh state is fixed in this commit (prepend `nav`)
   or justified; frozen WebBench files are never edited (recorded as historical). `verify-fr2-14-config.mjs:330` is read.
2. Implement 2.4 (`mayLaunch` from verb + args via a pure `isLaunchCapable(verb, args)`; `noSession` message exact).
3. Unit (session-flow.spec): no state + `mayLaunch:false` -> rejects with `noSession()`'s error, `spawnFresh`,
   `afterAttach`, `fn` call counts 0; no state + `mayLaunch:true` -> existing order (W5); state present +
   `mayLaunch:false` -> existing reattach/self-heal tests unchanged. `isLaunchCapable` table test over every verb in
   1.5 plus back/forward/reload, with and without url args.
4. Live (forced build; ISO `S6t`, NEG061 `N6t`, each created once, fail-closed): every sub-case uses its **own fresh
   state dir** `SUTRADHAR_CLI_STATE_DIR="$ISO/st<k>"`, which the harness asserts does not exist before the call. Each of
   `text`, `snap`, `axsnap`, `click 1`,
   `type 1 x`, `press 1 Enter`, `screenshot`, `eval 1`, `tabs`, `waitfor 1000 --text x`, `scroll`,
   `grant <fixture origin> clipboard-read`, `getclipboard`, `newtab`, `audit` (no url), `snap --json`: exit 1, stderr is
   **exactly** the one 2.4 line for that verb (byte-for-byte, em dash included; no `Fatal:` line), stdout empty;
   afterwards no `state.json`/`warden.json`, no
   `sutradhar-cli-*` under ISO, and the CIM attribution query for the ISO basename returns 0. Positive: `nav /short`,
   `close`; `newtab <url>` (then `tabs` lists it), `close`; `audit <url>`, `close`; `compare <a> <b>`, `close`. Smoke
   scenario: `nav`, `close`, `text` -> exit 1 with the hint. NEG061 `text` from no state -> exit 0 and a `state.json`
   appears (validity; then `close`).
5. Spec typecheck: still the 7 baseline errors, 0 in new tests.

**AC** S6-1 dependents inventory complete and handled; S6-2 unit; S6-3 every non-launch verb live with the four
"nothing launched" checks; S6-4 launch-capable verbs launch; S6-5 NEG061 auto-launches; S6-6 counts/typecheck; `cli.ts`
mode 100644.
**Mutants** (correct placement: first statement inside `if (!state) {`) M-051e `NoSessionError` not special-cased in
`main().catch` (stderr `Fatal: …`; the exact-line assertion kills it); M-051a `mayLaunch` always true; M-051b the
check placed **after `spawnFresh`**; M-051c the check placed **after `afterAttach`** (both fail the unit call-count test
and S6-3's state/profile checks); M-051d `newtab` without url launch-capable (table test).
**False-pass**: failure for another reason — exact hint text asserted; Chrome elsewhere — attribution by ISO basename
and any state's `dirname`; harness blind to auto-launch — NEG061 validity.
Commit `I-051: CLI read verbs fail with a hint when no session is active`.

### S7 - I-NAV CLI `back`, `forward`, `reload`
Files: `packages/cli/src/cli.ts` (verbs, dispatch, help), `packages/cli/src/dialog-cli.ts` only to factor the
beforeunload helper, CLI tests (help-text.spec, a pure outcome classifier + formatter test), the S6 launch table,
**`packages/browser/src/verifier/post-conditions.ts` (only the `history-edge` check of 2.5) and its tests in
`packages/browser/tests/unit/`** (review-2 MAJOR-1).
1. Probe: add the `<go_back|go_forward>.history-edge` check exactly as 2.5 states. Browser unit tests
   (`decideNavigationVerdict`): back edge and forward edge each carry the check; forward not-moved (index 0 of 2) and
   back not-moved carry **no** edge check; a passing move carries none; `capEvidence` keeps the edge check when the
   evidence also holds the maximum number of `expect.*` checks (record the cap, 8, and the resulting order).
2. CLI: implement 2.5, with the beforeunload branch selected by SP-1. The pure classifier
   `classifyHistoryOutcome(verb, verification)` returns `moved | edge | unconfirmed | not-moved | reloaded` from the
   `<verb>.history-index`, `<verb>.history-edge` and reload checks only — **edge iff the `history-edge` check is
   present**; never from the reason text, never from `expected === -1`, never from loaderId.
3. CLI unit: classifier table (moved same-document, moved new-document, edge back, edge forward, not-run, index
   unmoved, reload, **no checks at all -> `unconfirmed`**); a unit test that a rejecting `runtime.goBack` propagates
   (no "Navigated" line printed); exit-code rows **forward edge + failed `--expect-*` -> 1; back edge + failed `--expect-*` -> 1;
   forward not-moved + failed `--expect-*` -> 4; back not-moved + failed `--expect-*` -> 4**; a row where the
   verification `reason` was replaced by an expectation's fail reason (Rule 5) still classifies the edge; `--json` at an
   edge -> JSON on stdout, edge line on stderr, exit 1; help lists the verbs.
4. `vitest run` browser (S1/S4 count + the new edge tests) and cli (+ new tests); others unchanged.
5. Live (forced build; ISO `S7t`):
   - H1 full documents: `nav /hist/a`, `nav /hist/b`, `back` -> `Navigated back to …/hist/a`, `eval location.href` == a;
     record `eval "JSON.stringify(window.__nav)"` (bfcache restore or not); `forward` -> b; `nav /reload-count`,
     `reload` -> server hit counter +1 exactly.
   - **H1-SPA (orchestrator decision): `nav /hist/spa`; before any `back`, assert `eval "location.hash"` == `#x` and
     record `eval "history.length"`; `back` -> exit 0, `Navigated back to …/hist/spa#2`, `eval location.href` ends with
     `#2`; `back` again -> `…/hist/spa`; `forward` -> `#2`.**
   - H2 edges (no assumption about how many entries a fresh tab starts with): after `nav /hist/a`, `forward` -> exit 1
     and the forward-edge line (newest entry); **`forward --expect-url-changed` there -> exit 1 (not 4)**; then `back`
     repeatedly (at most 5) until the back-edge line appears: every earlier `back` exits 0 with a "Navigated back" line
     whose URL `eval location.href` confirms, the edge `back` exits 1 with `Back: no history entry…`;
     `back --expect-url-changed` at the edge -> exit 1; `back --json` at the edge -> parseable JSON on stdout containing
     the `go_back.history-edge` check, the edge line on stderr, exit 1.
   - H3 beforeunload (SP-1 branch): `nav /hist/a`, `nav /beforeunload`, `click '#arm-bu'` (real click = activation),
     `reload --dialog dismiss` -> cancel message, exit 1, hit counter unchanged; `back --dialog dismiss` (re-armed) ->
     cancel message, exit 1, URL unchanged. Validity: before the `--dialog dismiss` runs, a `reload --dialog accept`
     on the armed page shows the dialog was raised (`getDialogHistory`/the CLI's handled-dialog line), proving arming works.
   - H4 `back --json` after a successful move parses (exit 0); no-session `back` -> the exact S6 line.
**AC** S7-1 H1; S7-2 H1-SPA; S7-3 H2 incl. forward and back precedence with `--expect-*` and the `--json` edge; S7-4
H3 with its validity check (or the signed-off drop); S7-5 H4; S7-6 probe edge-check unit tests incl. the cap; S7-7
counts/typecheck/mode.
**Mutants** M-NAVa `back` mapped to `goForward` (H1); M-NAVb edge printed as "Navigated back" (H2); M-NAVc reload as
`navigate(currentUrl)` without the beforeunload handling (H3); **M-NAVd no-history detected by loaderId (H1-SPA must
kill it: exit 1 on a same-document back)**; M-NAVe `--expect-*` failure outranks the edge (H2 back and forward
precedence rows); **M-NAVf edge detected from the verdict reason text (killed by the unit row with a Rule-5-replaced
reason and by live `forward --expect-url-changed` -> must be 1, the mutant gives 4)**; M-NAVg probe emits the edge
check on not-moved too (browser unit "not-moved carries no edge check").
Commit `I-NAV: CLI back/forward/reload verbs`.

### S8 - Independent audit (fresh `auditor`, read-only; acceptance gate for S2-S7)
- Brief: section 0 verbatim, the ACs of S2-S7, section 5, pointers to `$EV/S2..S7`; never the builders' reasoning.
- The auditor re-runs the full matrix (ISO `$R/S8-tmp`), re-derives the S4 inventory itself (own grep, compared with
  `check-inventory`), re-runs every live harness **unmodified** (sha256 equal to the builder's record) against a fresh
  forced build (ISO `A8t`; NEG061 `N8t`), re-runs every listed mutant plus >= 1 of its own per item, and runs >= 1 new
  probe per item (I-047: an iframe navigating cross-origin during the loop, and a main-frame same-origin navigation
  during a click — the error must be the existing "navigated away" diagnosis, never raw detached text; I-048: text that
  changes between paged reads — the marker totals must describe the window actually returned).
- The auditor writes its verdicts to its report; the **orchestrator** saves it as `$EV/S8/audit.md` and commits
  `0.6.2: independent audit of I-048/I-047/I-049/I-051/I-NAV` with `$EV/S8`. Escalation per section 3 rule 2.

### S9 - Version bump 0.6.1 -> 0.6.2 (exactly 4 files; 0.6.1 S9 procedure)
1. Edit `packages/sutradhar/src/index.ts` first; the sutradhar matrix entry **must FAIL** on `api.spec.ts`.
2. Edit `api.spec.ts`, `packages/mcp-server/src/version.ts`, `packages/sutradhar/package.json`.
3. `git diff --stat` = 4 files, 4(+), 4(-); `git grep -nF "0.6.1" -- packages/mcp-server/src packages/sutradhar/src packages/sutradhar/tests packages/sutradhar/package.json` prints nothing; the sutradhar entry passes.
Commit `Bump version to 0.6.2 (not published)`.

### S10 - Changelog and docs
Under `## [Unreleased]` in `docs/22-changelog.md`:
```
## [0.6.2] - unreleased

Prepared on branch `release/0.6.2`; the date and the published-to-npm line are filled in after `npm publish`.
Fixes for the defects found by the Claude-direct WebBench run of 2026-10-04 (`tools/webbench/claude-direct-run-2026-10-04.md`).

### Fixed
- **Page text is no longer cut off silently (PROB-048).** CLI `text`, SDK `page.snapshot()` and MCP `browser.snapshot`
  used to return at most 4000 (MCP: 2000) characters with no sign that more existed. They now state the total, print
  `[page text truncated: showing characters A-B of N. …]` when they show only part, and let you page through the rest:
  `sutradhar text --offset B` / `--max-chars N`, `page.text({ offset, maxChars })`, MCP `browser.get_page_text`.
  A failed read is now an error (CLI exit 1, MCP `isError`, SDK rejection), not empty text. Default sizes are unchanged.
  PDF text is no longer capped at 4000 characters.
- **Clicks and typing no longer fail with "Attempted to use detached Frame" (PROB-047)** on pages that keep replacing an
  iframe, and `snap` no longer returns an empty element list on such pages. <CAUSE_LINE>
- **`#5` and `[#5]` work as element ids (PROB-049)**, as `snap` prints them.
- **Commands other than `nav` no longer start a blank browser when no session is open (PROB-051)**; they exit 1 with
  `no active browser session … sutradhar nav <url>`. `nav <url>`, `newtab <url>`, `audit <url>` and `compare` still
  start one; `grant` now needs an open session.

### Added
- CLI `back`, `forward`, `reload` (PROB-050). Same-page history entries (`pushState`, `#hash`) count as navigation;
  at the start/end of history they exit 1.
- CLI `text --offset/--max-chars/--json`; SDK `page.text()`; MCP `browser.get_page_text` (<TOOL_COUNT> tools now:
  <BROWSER_TOOL_COUNT> `browser.*` plus `agent.runGoal`); MCP `browser.snapshot` `textMaxChars` (MCP ceiling 40000).

### Changed
- `go_back`/`go_forward` verification evidence (CLI `--json`, MCP `browser.go_back`/`go_forward`, SDK) gains a
  `go_back.history-edge` / `go_forward.history-edge` check when there is no history entry in that direction; tier and
  reason are unchanged.
- CLI `text` prints a marker line on stdout when the text is truncated, exits 1 when the page text cannot be read, and
  no longer re-numbers snapshot ids.
- `SnapshotResult` has new fields `pageTextTotalChars`, `pageTextTruncated` and `pageTextError`.
```
Placeholders filled from evidence (S3b tools/list count, S4 cause line), never typed from memory. AC S10-1:
`grep -nE "<(CAUSE_LINE|TOOL_COUNT|BROWSER_TOOL_COUNT)>" docs/22-changelog.md` prints nothing; negative control: the
saved template `$EV/S10/template.txt` gives `grep -oE ... | wc -l` = 3. BLOCKED items are written "not included".

Docs (each re-checked against built behaviour):
- `README.md`: `### Status (0.6.2) and known limitations`, one sentence on 0.6.2, tool count at :42.
- `packages/cli/README.md`: commands table (`text` flags/marker/exit 1 on failure, `back/forward/reload` incl. the
  exit-1-at-edge exception next to the `:131` rule, the launch-capable list, `grant` needs a session), `#N` accepted,
  "as of 0.6.2".
- `packages/mcp-server/README.md`: header count, `browser.get_page_text` row, `textMaxChars`, 40000 ceiling, "as of 0.6.2";
  if it (or `packages/cli/README.md`'s verification section) lists evidence check names, add `go_back.history-edge` /
  `go_forward.history-edge` (`rg -n "history-index" packages/*/README.md docs AGENT_SETUP.md` finds the places).
- `packages/sutradhar/README.md`: `page.text()`, `PageTextReadError`, snapshot fields, "as of 0.6.2". `SECURITY.md:39`.
- **`AGENT_SETUP.md` and `packages/sutradhar/AGENT_SETUP.md`** (identical copies; the second ships): tool count at :60,
  tool table row for `browser.get_page_text`, the marker/paging note, `#N`, `back/forward/reload`, no auto-launch. AC:
  `cmp AGENT_SETUP.md packages/sutradhar/AGENT_SETUP.md` exits 0 after the edit.
- `docs/*` mentions of `text`/long pages (`rg -n "\btext\b.*4000|truncat|auto-?launch" docs`).
- `.ai/known-problems.md`: PROB-047, 048, 049, 051 -> RESOLVED (0.6.2, evidence paths); PROB-050 -> MITIGATED.
- `.ai/browsing-capability-loop.md`: iteration log entry.
AC S10-2: `git grep -n "as of 0\.6\.1\|Status (0\.6\.1)" -- README.md SECURITY.md packages/*/README.md AGENT_SETUP.md packages/sutradhar/AGENT_SETUP.md`
prints nothing or each hit is justified in `$EV/S10/notes.md`. S10-3: every tool count in README.md,
`packages/mcp-server/README.md`, both AGENT_SETUP copies and the changelog equals S3b's observed tools/list count
(a script greps each count and compares). S10-4: the `cmp` above.
Commit `0.6.2 docs: changelog, CLI/MCP/SDK/AGENT_SETUP docs, known-problems`.

### S10b - Follow-up gaps (next free GAP numbers on this branch; never reuse)
1. Self-heal (state present, browser gone) still starts a fresh blank session for non-launch verbs (2.4).
2. `agent-loop.ts:705` 2000-char observation cap (agent.runGoal; unverifiable here).
3. `apps/server` REST snapshot `.slice(0, 1500)` without a marker.
4. `buildGraph`'s outer catch-all returns an empty graph silently on any unexpected error.
5. `eval` prints `undefined` for void expressions (PROB-050 remainder).
6. Any Kayak finding from S4 step 6 that is not I-047.
7. **Unconfirmed, from WebBench 2388 (`CANDIDATE-FIXES.md` items 2, 3):** a click that opens a new tab makes
   `--expect-url-changed` exit 4 (it checks the original tab); a "Past 24 hours" click reported a 15 s timeout although
   the filter applied.
8. **SDK types for consumers (pre-existing):** published `dist/*.d.ts` re-export from `@sutradhar/capability-runtime`,
   which is not on npm, so `PageTextResult` and other runtime types resolve to `any` for consumers (S11 item 6 probe).
9. If SP-2 forced a headed or unit-only PDF check, or H3 was dropped: that limitation.
10. Any S8 INFO finding.
Commit `0.6.2: log follow-up gaps`.

### S11 - Final release gate (fix nothing inside the gate)
Preamble everywhere (matrix ISO `$R/S11-tmp`, live `Sgt`, NEG061 `Ngt`). Items 1-9 mirror 0.6.1 S11.
1. Location check, clean tree, >= 10 GB free, no untracked evidence.
2. `npx --yes pnpm@9.1.0 install --frozen-lockfile`.
3. Full forced build (`timeout 2400 node_modules/.bin/turbo run build --force --concurrency=1`, root script order);
   `grep -cF 'SUTRADHAR_VERSION = "0.6.2"' packages/sutradhar/dist/index.js` >= 1; `grep -cF '0.6.2' dist/mcp-cli.js` >= 1;
   `grep -cE "(SUTRADHAR_VERSION|MCP_SERVER_VERSION) = [\"']0\.6\.1[\"']" dist/*.js` = 0 each; `grep -c get_page_text dist/mcp-cli.js` >= 1;
   `grep -c "no active browser session" dist/cli-bin.js` >= 1; `grep -c readTextWindow dist/index.js` >= 1.
4. `timeout 1200 node_modules/.bin/turbo run typecheck --force --concurrency=1`; spec typecheck (`$R/spectsc`) =
   baseline 7 + 0 new, planted TS2322.
5. Full matrix: totals >= S1, every increase attributed to a step, 0 new failures, guard lines, path-log check on the
   cli log exits 0.
6. Advisories (0.6.1 S11 item 6, `bundle-inventory.mjs` from `$EV061/S1`; pack to `$R/S11-pack`; consumer install in
   `$R/S11-consumer`): inventory `shipped advisories: 0`; `audit --prod` 0; consumer prints 0.6.2; new-advisory rule
   (stop and re-plan). **Consumer type probe (record only, S10b 8):** in `$R/S11-consumer`, a `probe.ts` importing
   `{ launch, type PageTextResult }` from `sutradhar`, checked with `npx --yes -p typescript@5.4.2 tsc --noEmit
   --strict --moduleResolution node16 --module node16 probe.ts`; the output is recorded, not gated.
7. Dry-run pack vs `sutradhar@0.6.1`: added/removed lists empty or explained; no `*.mutant.js`.
8. Live checks, each harness **unmodified** (sha256 equal to its step's record):
   a. `$EV061/S3a/mcp-probe.mjs` (`EXPECT_VERSION=0.6.2`, `EXPECT_TOOLS=<S3b count>`) PASS; with `EXPECT_VERSION=0.6.1` FAIL.
   b. I-048: `$EV/S3a/live-cli-text.mjs`, `$EV/S3b/live-mcp-text.mjs`, `$EV/S3c/live-sdk-text.mjs` on the HEAD dist.
   c. I-047: `$EV/S4/live-detach.mjs` with `RUNS=5` against **both** the HEAD dist and the **consumer install**
      (`$R/S11-consumer/node_modules/sutradhar/dist`, i.e. the shipped dependency resolution, puppeteer-core from
      `^25.5.0` as npm resolves it; record that version): HEAD-style results clean on both.
   d. I-049 `$EV/S5/live-nodeid.mjs`; e. I-051 `$EV/S6/live-nosession.mjs`; f. I-NAV `$EV/S7/live-history.mjs`.
   All 8b-8f runs set `NO_MUTANTS=1` (every harness that embeds same-build mutant runs — S3a, S4 — implements this
   switch from its first version, so it is not a modification).
   g. Path-log check on all S11 logs exits 0; its negative control (`$EV/S1/pathcheck-neg.log`) exits 1; real-TEMP
      snapshot explained; no PID of ours alive.
   h. **Scenario suite locally (review-2 MINOR 6):** under the preamble (ISO `Sgt` sub-dirs as the scripts require;
      0.6.1 S7-R precheck that no write target leaves `os.tmpdir()`/the isolated home/`tools/scenario-suite/results`,
      with `USERPROFILE`/`HOME` set to `$SP/Sgt/home`): `node tools/scenario-suite/run-cli.mjs`, `run-mcp.mjs`,
      `run-sdk.mjs`, then `node tools/scenario-suite/ci-gate.mjs`. Scenario failures caused by external sites are
      recorded as EXTERNAL-BLOCK with evidence; any other failure is a gate FAIL. Rewritten files under
      `tools/scenario-suite/results` are never committed. Restore method (review-3 E): first copy each rewritten file
      to `$EV/S11/scenario-results/` (evidence), then list them with `git status --porcelain -- tools/scenario-suite/results`
      and restore **each tracked file by name** (`git restore -- <path>`, one path per argument, never a directory or
      `.`); an untracked file the suite created is removed by name with `rm -- <path>` only if it lies under
      `tools/scenario-suite/results/`. Afterwards `git status --porcelain -- tools/scenario-suite` is empty.
      All 8a-8h commands after the first use the continuation form of `Sgt` (0.2 item 1).
   i. **After 8a-8h:** `ls packages/sutradhar/dist/*.mutant.js packages/*/dist/*.mutant.js 2>/dev/null` prints nothing
      and the dist sha256 values equal those recorded right after item 3.
9. Commit `0.6.2: release gate evidence` (`$EV/S11` by name), then `node scripts/check-release-ready.mjs` -> OK.

**Mutants the gate catches**: version bump forgotten (3, 8a); install skipped (6); tool count drift (5, 8a); stale
dist (3 greps); mutant file left over (7); marker/paging/read-error regression (8b); frame-detach regression (8c);
auto-launch regression (8e); history regression (8f).

### S11b - WebBench mini re-run through the packed CLI (regression check, not a scored sample)
CLI = `$R/S11-consumer/node_modules/sutradhar/dist/cli-bin.js` (sha256 and version recorded). Harness
`$EV/S11b/wb-rerun.mjs`, preamble with ISO `Wbt` (state `$SP/Wbt/state`, cwd `$SP/Wbt`, `SUTRADHAR_CONFIG=none`); logs
every command, exit, stdout/stderr sha256 + excerpts to `$EV/S11b/<task>.jsonl`; <= 2 attempts per task; no stealth.
- **982 lawinsider.com**: `nav https://www.lawinsider.com --settle`, `nav https://www.lawinsider.com/search?q=Non-Disclosure+Agreement --settle`,
  `text --json`, then **immediately** `eval "document.body.innerText.length"`; then `text --offset <end>` until marker B.
  Regression AC: the first `text` either is complete (`truncated:false`) or carries a marker whose total equals its own
  `totalChars`; the paged text contains every `Filed <date>` entry that an `eval` of the full text (run right after the
  paging) contains. A difference between `totalChars` and the eval length on this live, dynamic page is **recorded with
  both numbers, not auto-failed**. Record the five titles and "Filed" dates found. Outcome: COMPLETED /
  EXTERNAL-BLOCK / FAIL with reason.
- **2561 kayak.com**: `nav https://www.kayak.com --settle`, `nav https://www.kayak.com/stays --settle`, `snap`,
  `click "#<destination id>"`, `type` Rome into the destination input, pick the first suggestion via
  `clicktext`/`clickrole`, `text`. Regression AC: no output contains `detached Frame`, and no `snap` prints
  `Interactive elements (0)` while `text` shows content. Task completion recorded honestly; blocks as such.
- `$EV/S11b/wb-rerun.md`: per task outcome, regression verdict, and a statement that this is not comparable to the scored
  2026-10-04 sample (n=2, not pre-registered).
Commit `0.6.2: WebBench 982/2561 re-run on the packed CLI` (evidence only); `node scripts/check-release-ready.mjs` -> OK.
Then handoff (6.4).

---

## 5. Adversarial audit checklist (S8; the auditor re-derives every item)

**X. Isolation**: guard line in every log, no `ISOLATION GUARD`; ISO names from 0.2 with `.r062` markers, each created
fail-closed (no step log shows an adopted pre-existing ISO; S6 sub-cases each used a fresh state dir); all 0.6.2
scratch under `$R`; user-data-dir <= 200 asserted; path-log check 0 on every CLI log with >= 1 line, negative control
1; real-TEMP snapshots explained; no Chrome left with an ISO basename; nothing written under `$SP/v061` or 0.6.1-era
`$SP` dirs (`find "$SP/v061" "$SP/S1" "$SP/S2" "$SP/S4" "$SP/S6" "$SP/S8" "$SP/r5" -newer "$EV/S1/neg061.sha256"` empty).

**I-048**
- T1 every page-text 4000/2000 cut is gone or justified (`rg -n "slice\(0, ?(4000|2000)\)" packages/*/src`); no
  `readPageText` identifier left in `packages/capability-runtime/src`.
- T2 windows concatenate to the independent full text on CLI, MCP and SDK; totals equal the independent length.
- T3 short pages byte-identical to NEG061 on all three surfaces (non-empty).
- T4 marker shapes A/B/C exact; CLI marker on stdout; never inside `text`/`pageText`.
- T5 validation before browser contact (CLI state.json unchanged mid-session; runtime evaluate count 0).
- T6 PDF total > 4000 on HEAD (or the SP-2 fallback recorded), <= 4000 on NEG061.
- T7 **failed reads are errors**: unit (rejecting evaluate, PDF parse failure) and live S3a(j); `snapshot()` tolerant
  with `pageTextError`; M-048p/q/r/s killed.
- T8 S3a(i) uses `data-sd-current-gen`/`data-sd-gen`, G1 non-null, control `snap` changes G, live M-048i fails it.
- T9 `wait_for`/`expect.text`/`extract`/`audit` untouched, counts unchanged; `tools/` consumers classified.
- T10 MCP tool count +1 everywhere (registry, probe, both READMEs, both AGENT_SETUP copies, changelog); 40000 MCP
  ceiling enforced and described; FR2-10 optional session on the new tool.
- T11 auditor probe: text changing between paged reads (record; FAIL only if a marker misdescribes its own window).

**I-047**
- F1 the auditor's own mechanical grep equals `sites.txt`; `check-inventory` 0 on the post-fix tree, negative controls
  1; 0 UNSAFE rows; `post-conditions.ts:1197` covered; the method list was derived from both Puppeteer versions.
- F2 U-ctl proves synchronous throws; U1-U5 + per-site tests pass; every mutant killed (incl. M-047c).
- F3 L1/L3 NEG061 validity and clean HEAD; L2 10/10 with `t1 - t0 > 1000`; same-build mutants M-047a/M-047b fail live.
- F4 containment only: frame order, head start, probe size, retries identical (`git diff` review).
- F5 auditor probes: cross-origin iframe navigating during the loop; same-origin main-frame navigation during a click.

**I-049**: N1 only `^#\d+$` / `^\[#\d+\]$` (trimmed) map; N2 `selector-dialect` unchanged; N3 live CLI/MCP/SDK/`--frame`
with independent counters; N4 M-049a-c killed.

**I-051**: S1 launch-capable table equals 2.4 exactly; S2 nothing spawned/written per non-launch verb; S3 state-present
path unchanged (diff review) and the 0.6.1 close/self-heal tests unchanged and passing; S4 dependents inventory
re-derived (incl. `.claude/skills`, the WebBench driver brief, all verbs); S5 M-051a-d killed.

**I-NAV**: H0 the probe emits `<verb>.history-edge` exactly at edges (back and forward), never on not-moved, and it
survives `capEvidence`; the classifier reads only that check for edges (no reason text, no `expected === -1`);
**H2 includes `forward --expect-url-changed` at the newest entry -> exit 1** and `back --json` at the edge (JSON stdout,
edge line stderr, exit 1); M-NAVf/M-NAVg killed.
H1 full-document and **H1-SPA (same-document) moves succeed, decided by history index**; H2 edges exit 1 with
precedence over `--expect-*`; H3 beforeunload per SP-1 with its validity check; H4 no-session; M-NAVa-e killed
(M-NAVd by H1-SPA).

**D. Docs/evidence integrity**: D1 test counts re-derived from logs; D2 harness sha256 equal across step, S8, S11; D3
changelog statements match observed behaviour; D4 every step README has a per-AC false-pass analysis; D5 `cmp` of the
AGENT_SETUP copies.

**Verdict rule**: any FAIL on X, T1-T10, F1-F4, N1-N4, S1-S5, H0-H4 is blocking for that item. A security finding (code
execution, deletion outside a candidate, writes outside ISO/`$R`) is blocking for the release (0.6.1 A.6 P6).

---

## 6. Risks, deferred, gate checklist, handoff

### 6.1 Risks
1. Stdout marker breaks a script diffing `text` output: only when truncated; `--json`; documented; short pages
   byte-identical (T3).
2. `text` exit 1 on a failed read where 0.6.1 printed an empty line: intended (PROB-048); documented in Changed.
3. MCP tool count drift: derived from `tools/list`; T10 covers every doc site.
4. I-051 changes workflows that ran `tabs`/`grant`/`eval` first: inventory, hint, docs; self-heal unchanged.
5. Frame-fix scope creep: containment only (F4).
6. Puppeteer version skew (25.5.0 build vs 25.12.0 NEG061 vs the consumer's resolution): same-build mutants (S4) and
   the consumer-install re-run (S11 8c).
7. Live-site variability: supporting/regression checks only; EXTERNAL-BLOCK recorded; <= 2 attempts; no bypass.
8. Load-sensitive tests: none — scripted detach events, event-based validity rules, measured `t1 - t0` with >= 1500 ms
   margin below the 5000 ms deadline.
9. Semver: 0.6.2 is additive (CLI flags/verbs, SDK method, MCP tool) plus behaviour changes; the number is the user's
   decision; noted for the PR description.
10. Shared machine: preamble, `.r062` markers, short ISO names, path-log check, ownership-checked kills.

### 6.2 Deferred
0.7.0 close/recovery redesign; vitest major; everything in S10b.

### 6.3 Gate checklist (copy into `$EV/S11/README.md`)
- [ ] Location; clean tree; >= 10 GB; nothing pushed by builders; all scratch under `$R` + registered ISO names
- [ ] S1 self-tests (97/0/97, 0/1/1), NEG061 hashes and absent names, fixtures self-test, SP-1/SP-2 recorded, tool-count baseline `$EV/S1/tool-count.txt`
- [ ] I-048 S2/S3a/S3b/S3c ACs + mutants; T1-T11
- [ ] I-047 mechanical inventory + check-inventory (+ negatives), U-tests incl. U-ctl, L1-L4 with validity, same-build
      mutants, Kayak supporting result
- [ ] I-049, I-051, I-NAV (incl. H1-SPA, history-edge check, forward+back precedence with --expect-*) ACs + mutants; exact no-session stderr line
- [ ] S8 verdicts, escalation counts per item, BLOCKED items reverted and "not included"
- [ ] Version in 4 files; dist greps; changelog placeholders filled; doc counts (incl. both AGENT_SETUP) match; `cmp` 0
- [ ] Build, typecheck (forced), spec typecheck baseline, matrix >= S1, path-log check
- [ ] Advisories 0 / consumer 0.6.2 / consumer type probe recorded / pack diff explained
- [ ] Live 8a-8i incl. 8c on the consumer install, 8h local scenario suite + ci-gate, 8i no mutant files and dist hashes unchanged; S11b WebBench 982/2561 recorded honestly
- [ ] `check-release-ready` OK after S11 and after S11b; every step README has a per-AC false-pass analysis

### 6.4 Handoff (global session-handoff rule) and post-handoff (user-owned; publish blocked until 1-2 are done)
**Before any stop (any step, not only the end):** write `$EV/HANDOFF.md` (and append to `.ai/loop/release-0.6.2/STATE.md`,
created in S1, committed with each step) listing: every background process started and still running (PID, command,
ISO/worktree, exit condition) — expected none; any in-progress test/harness run and its state; the last completed step
and commit; the exact next step and the command that verifies it; any open escalation count per item.

Post-handoff (user):
1. Push `release/0.6.2`, open the PR to `master` (mention risk 9).
2. CI green on the PR **and** a green `workflow_dispatch` run of `scenario-suite.yml` on `release/0.6.2` (judged by
   `tools/scenario-suite/ci-gate.mjs`) before `npm publish` — both are publish preconditions (0.6.2 changes CLI
   startup semantics, `text` output and the MCP snapshot block; `ci.yml` runs only typecheck/build/test).
3. `npm publish` from `packages/sutradhar` after an explicit `cd` and `pwd` check, from the S11b-gated commit (or a
   merge-commit checkout after re-running S11 items 2, 3, 6, 7).
4. After publishing: shasum row, changelog date, isolated install of 0.6.2 to verify; PROB entries' "published" note.
5. (Folded into item 2 as a requirement in revision 3.)

---

## 7. Changes from review-1 (`plan-review-1.md`, REVISE: 4 MAJOR, 17 MINOR) — revision 2

| # | sev | finding | resolution |
|---|---|---|---|
| M1 | MAJOR | S2 negative control "readPageText absent" is false (NEG061 has a private `readPageText`) | Orchestrator decision: public API renamed **`readTextWindow`**, private helper renamed **`pageTextWindow`** (2.1); both proven absent from NEG061 by grep (1.1, S1-3). S2's NEG061 control checks only genuinely absent things: `typeof runtime.readTextWindow === 'undefined'` plus the behavioural `pageTextTotalChars === undefined` / `pageText.length === 4000`. `rg readPageText` in runtime source prints nothing (T1). |
| M2 | MAJOR | S3a(i)/M-048i read a nonexistent attribute | Uses `data-sd-current-gen` (non-null asserted) and the element's `data-sd-gen`; a control `snap` must change G; M-048i run live via `cli-bin.mutant.js` and must fail (i) (S3a-12, T8). |
| M3 | MAJOR | history verbs judged by loaderId would fail SPA back/forward | 2.5 decides by the probe's `history-index` check; `unconfirmed` (probe not-run) prints a neutral line, exit 0; fixture `/hist/spa` (pushState + hash), live H1-SPA, mutant M-NAVd (loaderId) killed by it. |
| M4 | MAJOR | failed reads reported as empty text | `readTextWindow` rejects `PageTextReadError` (DOM and PDF); CLI exit 1 `Error: text read failed`, MCP `isError`, SDK rejection; `snapshot()` stays tolerant with `pageTextError`; unit S2-4, live S3a(j), mutants M-048p/q/r/s; changelog says so. |
| 1 | MINOR | P0 stale; S1-1 self-contradictory | Base 3f0ba55 (1.1); S1-1 requires exactly `?? .ai/loop/release-0.6.2/`. |
| 2 | MINOR | `cli.ts` is 100644, not executable | 0.3 corrected; mode must stay 100644. |
| 3 | MINOR | 1.3 mislabels SAFE/UNSAFE, misses `:1197`, overstates `Page`/`ElementHandle` | 1.3 rewritten with the reviewer's classification, `:1197` added, Page plain delegators and the ElementHandle dispose rationale stated; S4 re-derives it mechanically. |
| 4 | MINOR | S4 file scope too narrow | Any `packages/*/src` file holding an UNSAFE site (2.2, S4 Files). |
| 5 | MINOR | Puppeteer skew; no same-build control for L3; validity rule open-ended | Same-build live mutants M-047a (L1) and M-047b (L3); S11 8c on the consumer install; section 3 rule 4: 0 failures at both churn levels -> STOP, PROB-047 not RESOLVED. |
| 6 | MINOR | L2 may never reach the loop | Arm 2500 ms; assert `t1 - t0 > 1000` (`performance.now()`), both recorded. |
| 7 | MINOR | beforeunload fixture unarmed; error shape unknown | Fixture armed by a real `click '#arm-bu'`; SP-1 spike in S1 selects 2.5's branch (helper reuse vs dialog-history detection); H3 validity check (`--dialog accept` shows the dialog); drop only with sign-off. |
| 8 | MINOR | history exit codes nondeterministic | Precedence: edge -> 1 > expectation -> 4 > 0; documented next to README `:131`; M-NAVe. |
| 9 | MINOR | windowing edges | Surrogate rules extend (never shrink to 0) and back up a low-surrogate start; marker shape C for `offset >= total`. |
| 10 | MINOR | headless PDF may abort | SP-2 spike; fallback chain inline header -> `--headed` -> unit-only + S10b gap. |
| 11 | MINOR | 100k MCP ceiling vs client limits | MCP ceiling 40000 (`MCP_MAX_PAGE_TEXT_CHARS`), stated in the tool descriptions; runtime/CLI/SDK keep 100000. |
| 12 | MINOR | 0.6.1 scratch leftovers | All 0.6.2 scratch under `$R = $SP/r062`; live ISOs registered free in S1 and marked `.r062`; guarded delete requires the marker; spectsc copied to `$R/spectsc`; X audit item checks 0.6.1 dirs untouched (orchestrator: every scratch path release-specific). |
| 13 | MINOR | consumer/dependent greps incomplete | S2 grep covers `tools/` and `.claude/skills`; S6 grep covers every non-launch verb, `.claude/skills`, the driver brief; `grant` documented as needing a session. |
| 14 | MINOR | AGENT_SETUP.md missing | Both copies in S10, in S10-3's count check, `cmp` AC (orchestrator decision). |
| 15 | MINOR | 2388 findings unlogged | S10b item 7. |
| 16 | MINOR | SDK consumer types resolve to `any` | S11 item 6 consumer `tsc` probe (recorded), S10b item 8. |
| 17 | MINOR | procedure | S11/S11b split; 6.4 handoff content (HANDOFF.md/STATE.md); 982 AC uses `text --json` totals + an immediate eval, mismatches recorded not auto-failed; `runtime.eval`; the orchestrator commits `$EV/S8`; M-051b/c named as "after `spawnFresh`" / "after `afterAttach`", correct placement stated in 2.4. |

Orchestrator decisions applied beyond the findings: the WebBench `final-classes.json` blocker is resolved (3f0ba55);
the new public text API name avoids the private name; S2's negative control checks only genuinely absent names; the
I-047 inventory covers every synchronously-throwing call site with a mechanical grep AC (`check-inventory.mjs` with
negative controls); every scratch path is release-0.6.2-specific.

---

## 8. Changes from review-2 (`plan-review-2.md`, REVISE: 1 MAJOR, 10 MINOR) — revision 3

| # | sev | finding | resolution |
|---|---|---|---|
| MAJOR-1 | MAJOR | forward edge indistinguishable from "index unchanged"; edge reason lost when `--expect-*` fails (Rule 5); S7 could not touch the probe | 2.5: `decideNavigationVerdict` emits a machine-readable `<go_back|go_forward>.history-edge` check at edges only, right after `history-index`; S7 Files include `post-conditions.ts` + browser tests; classifier: edge iff that check is present (never reason text, never `expected === -1`); exit contract edge -> 1 > expectation -> 4 > 0 for back AND forward incl. `--expect-*`; browser unit tests (edge back/forward, not-moved without the check, survives `capEvidence` cap 8); CLI unit rows (forward/back edge + failed expect -> 1, not-moved + failed expect -> 4, Rule-5-replaced reason); live H2 `forward --expect-url-changed` -> 1; mutants M-NAVf (reason text) and M-NAVg (edge on not-moved); S8 item H0; browser vitest count rises in S7. |
| 1 | MINOR | `Fatal:` vs promised `Error:` | Code is made to print the promised line: `NoSessionError` (matched by `name`) handled in `main().catch` -> exactly the 2.4 `Error: …` line, exit 1; S6 asserts the whole line byte-for-byte and no `Fatal:`; mutant M-051e. `text read failed` is caught inside `cmdText` with the exact prefix, empty stdout, no `Fatal:`. |
| 2 | MINOR | `mkdir -p` adopts existing ISO dirs | Fail-closed creation in 0.2 item 1 (`[ ! -e ]` then `mkdir`); `.r062` leftovers removed by the guarded form first, unmarked dirs STOP; S6 sub-cases use fresh state dirs; X audit item. |
| 3 | MINOR | inventory regex `$` escaping, Windows separators, two calls per line | `list-sites.mjs` regex-escapes names, runs `rg` via an argument array, normalises `\` to `/`, keys on `file:line:col` (`--column`); regex self-test; `.call/.apply/.bind`, `?.(`, bracket-call blind spot documented with a scratch control and asserted empty (0 hits) on the post-fix tree. |
| 4 | MINOR | S3b's "S1-observed count" never recorded | S1 step 8b runs the MCP probe on HEAD and records `tools_list` and `expected_browser_tools` in `$EV/S1/tool-count.txt`; S3b and S10 read it. |
| 5 | MINOR | `--json` at an edge unspecified | 2.5: JSON on stdout, edge line on stderr, exit 1; unit row; live `back --json` at the edge in H2. |
| 6 | MINOR | scenario suite not a publish precondition | S11 item 8h runs `run-cli/run-mcp/run-sdk` + `ci-gate.mjs` locally under the preamble (external blocks recorded); 6.4 item 2 makes a green `scenario-suite.yml` dispatch a publish precondition next to CI. |
| 7 | MINOR | PDF that parses to empty text | 2.1: `source:'pdf'`, `totalChars:0`, not an error, no DOM fallback; S2 unit case. |
| 8 | MINOR | `/hist/spa` timing race | Pushes run from an inline end-of-`<body>` script (before `load`); H1-SPA asserts `location.hash == #x` and records `history.length` first; H1 records the bfcache/navigation type via `window.__nav`. |
| 9 | MINOR | mutant files vs S11 re-runs | Harnesses implement `NO_MUTANTS=1` from their first version; S11 8b-8f set it; new item 8i asserts no `*.mutant.js` and unchanged dist hashes after item 8. |
| 10 | MINOR | class identity across bundles | 2.1 and S3a/S3b: match `err.name === 'PageTextReadError'` (the `ProjectConfigError` pattern), never `instanceof`. |

---

## 9. Changes from review-3 (`plan-review-3.md`, APPROVE: 6 MINOR) — revision 4

| # | finding | resolution (sections changed) |
|---|---|---|
| A | new `history-edge` evidence check undocumented | S10 changelog `### Changed` line; S10 MCP/CLI README check-name lists (located by `rg history-index`). |
| B | partial guarded delete could leave an unmarked, undeletable dir (re-run wedge) | 0.2 item 8: contents deleted first, `.r062` last, then `[ ! -e "$ISO" ]` asserted (a partial delete keeps the marker, so the same form retries); 0.2 item 1: a re-run removes **only the step's own prior ISO, identified by its `.r062` marker**; another step's or an unmarked dir is a STOP; S1 step 4: S1's own marked leftovers removed before the free-names check. |
| C | later commands of a step refused by the creation check | 0.2 item 1: the first command of a step uses the creation form, every later command of the same step uses the **continuation form** (`[ -f "$ISO/.r062" ] || exit 1`, never creates); deliberate delete-then-recreate is stated in the step (S1 8b, S4 step 6); S11 8a-8h use the continuation form of `Sgt`. |
| D | gate parameters must exist in each harness's first version | New 0.2 item 4b: every live harness reads `CLI`/`BUNDLE`/`MCP` (dist paths), `RUNS` and `NO_MUTANTS` from env from its first version, defaults = its own step's run, and prints resolved values + sha256. |
| E | scenario-results restore method unnamed | S11 8h: copy to evidence, then `git restore -- <path>` per tracked file by name, `rm -- <path>` only for untracked files under `tools/scenario-suite/results/`; final `git status` of `tools/scenario-suite` empty. |
| F | rejected `goBack`/`goForward`/`reload` outside beforeunload unspecified | 2.5: propagates to `main().catch` (`Fatal:`, exit 1, never "Navigated"), intended; "no checks at all" -> `unconfirmed`; S7 unit rows for both. |

---

## Addendum A (orchestrator decisions during the build; binding)

**A.1 — S3a-7 (g) PDF (builder STOP, correctly raised).** Finding: in every BUNDLED build (published 0.6.1 and HEAD) PDF
text extraction fails because pdf.js is inlined and needs `@napi-rs/canvas` (DOMMatrix) at run time, which
`packages/sutradhar` does not ship; 0.6.1 printed one empty line (silent data loss), the unbundled
capability-runtime/dist works (`source:'pdf'`, 10098 chars). This is PRE-EXISTING (PROB-009's "resolved" only holds
unbundled), not caused by 0.6.2. Decision: do NOT widen 0.6.2 with a native dependency or polyfill.
- S3a-7 (g) is replaced by: (g1) unit tests cover the PDF windowing path (`source:'pdf'`, totals, marker) with the PDF
  reader stubbed; (g2) LIVE on the bundled CLI, `text` on the /pdf fixture must exit 1 with a CLEAR, documented message
  that names the limitation (not the raw "DOMMatrix is not defined"), e.g. `Error: text read failed: PDF text
  extraction is not available in this build (PROB-052); ...`, and must never print empty text with exit 0; NEG061
  control shows the old empty-line/exit-0 behaviour. The message mapping lives where the read error is produced, and
  MCP get_page_text / SDK page.text() surface the same error class.
- New PROB-052 in .ai/known-problems.md (bundled PDF extraction broken since the bundle shipped; root cause and both
  fix options); S10b gap; S10 changelog "Known limitations" entry; PROB-009 note amended.
**A.2 — M-048h** (validation placed inside withSession): the "exactly 1 replacement" rule exists to keep bundle mutants
unambiguous. Run M-048h as a source-level mutant + rebuilt bundle (2 replacements are allowed for this one mutant
because the validation and its call site move together), recorded with both replacement sites; if that is not
feasible, run it at unit level and record why.
