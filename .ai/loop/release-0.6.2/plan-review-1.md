# Release 0.6.2 plan, review 1 (independent, adversarial)

Reviewer: Claude Opus 5.5, 2026-10-04. Plan reviewed: `.ai/loop/release-0.6.2/plan.md` Revision 1.
Location check: `git rev-parse --show-toplevel` printed the worktree path, `git branch --show-current` printed `release/0.6.2`,
HEAD `3f0ba55`. I used only read-only commands, plus one no-browser Node proof in `$SP/review062/proof.mjs`.

## Verdict: **REVISE** (4 MAJOR, 0 BLOCKER, 17 MINOR)

## What holds up (checked, not assumed)

- **PROB-047 mechanism.** In `puppeteer-core@25.5.0/lib/puppeteer/util/decorators.js`, `throwIfDisposed` returns a plain
  non-async wrapper that throws synchronously. `api/Frame.js:215-234` applies `throwIfDetached` to `frameElement`,
  `evaluate`, `evaluateHandle`, `locator`, `$`, `$$`, `$eval`, `$$eval`, `waitForSelector`, `waitForFunction`, `content`,
  `addScriptTag`, `addStyleTag`, `click`, `focus`, `hover`, `select`, `tap`, `type` and `title`. `cdp/Frame.js:326` adds
  `goto`, `waitForNavigation`, `setContent` and others.
- My proof copies the shapes of `resolveElement` and `buildGraph` exactly. Output:
  - `OLD: rejected -> Attempted to use detached Frame 'C'.`
  - `NEW: returned null` (with an async `frameCall` wrapper)
  - `buildGraph-shape OLD: EMPTY GRAPH`
- The NEG061 `cli-bin.js` contains the old loop (`grep -c "timeout: Math.min(probeTimeoutMs, remaining)"` = 1). Its
  hashes match the plan's notation section.
- **PROB-049.** `normalizeTarget` is the single entry point. Every runtime target, `resolveFrame` hop, extract selector and
  CLI `validateSelectorArgs`/`validateFrameChain` goes through it. No other code maps node ids (`rg data-sd-node-id`).
- **Isolation.** `$SP` is 160 characters, so 3-character ISO basenames keep `--user-data-dir` at 200 or less. The
  guarded-delete patterns match every planned ISO name. No collision with existing `B*t`/`Kt`/`Mt`/`V1t` dirs.
- **MCP tool count.** `EXPECTED_BROWSER_TOOLS` drives the count assertions in `tools.spec.ts` at lines 125, 624, 950 and
  1155. The probe uses `EXPECT_TOOLS`. The plan says to derive the count, not type it.

---

## MAJOR

### M1. The S2 negative control asserts something false about NEG061, so S2 cannot pass as written
- **Evidence.** NEG061 already has a method with this name: `grep -o "async readPageText([a-zA-Z]*)"` finds
  `async readPageText(tab)` in all three of NEG061's `index.js`, `cli-bin.js` and `mcp-cli.js`. TypeScript `private` is
  not enforced at runtime, so S2 step 5 ("`readPageText` absent") fails on the correct build.
  - Calling `runtime.readPageText(sessionId)` on NEG061 passes a string where a tab object is expected. It then returns
    `''` or throws, depending on `requirePage`.
  - The plan gives the new public method the same name as the existing private helper. A builder will either hit a spec
    contradiction (STOP) or weaken the check.
- **Fix.**
  - Replace "readPageText absent" with a behavioural negative: on NEG061, `runtime.snapshot()` gives
    `pageTextTotalChars === undefined` and `pageText.length === 4000` on `/long` (already in the plan; keep only this).
    If the method is probed at all, assert that the NEG061 result is not an object with a numeric `totalChars`.
  - State the private helper's new name in 2.1 (for example `readPageTextWindow`), so both the S2 spy update and the
    HEAD dist grep target a known identifier.

### M2. S3a(i) and mutant M-048i check an attribute that does not exist, so they pass vacuously
- **Evidence.** The snapshot engine stamps `data-sd-current-gen`, not `data-sd-current-generation`:
  `packages/browser/src/dom/dom-semantic-engine.ts:55` defines `SD_CURRENT_GENERATION_ATTR = 'data-sd-current-gen'`,
  set at `:674`.
  - The plan's check `getAttribute('data-sd-current-generation')` returns `null` both before and after `text`. So
    "unchanged" holds even when `cmdText` still calls `snapshot()`, and M-048i survives.
  - The `click <id>` half does not discriminate either: re-stamping usually reproduces the same ids on a static fixture.
- **Fix.**
  - Use `data-sd-current-gen`. Assert it is non-null after `snap`, and equal before and after `text`.
  - Add a second independent read: `document.querySelector('[data-sd-node-id]').getAttribute('data-sd-gen')` unchanged.
  - Run M-048i live (sibling `cli-bin.mutant.js`, as S4 does) and require it to fail (i).

### M3. I-NAV's "no history entry" rule misreports single-page-app back/forward as failures (exit 1)
- **Evidence.** Plan 2.5 decides on "committed no new document (history start/end; NavigationProbe evidence)", and 1.6
  describes it as a loaderId comparison.
  - A same-document history step (a `pushState` or hash entry, the normal case in a single-page app) moves the history
    index but keeps the loaderId. A loaderId-based rule would print `Back: no history entry...` and exit 1 while the URL
    did change.
  - The probe already has the correct signal. `post-conditions.ts:1092-1114` decides by history index:
    `edge = before.index === 0` produces the reason `there was no history entry to go back to (index ...)`.
  - S7's live checks use only full-document `/hist/a` and `/hist/b`, so a loaderId implementation passes every AC.
- **Fix.**
  - Bind 2.5 to the probe's `go_back`/`go_forward` `history-index` check: an edge plus an unmoved index means no history.
  - Define the output when the probe is unavailable (dialog, CDP timeout): neither "Navigated" nor "no history". Print a
    neutral line with the verification and exit 0.
  - Add fixture `/hist/spa`, which does `pushState('#2')` and then `location.hash = 'x'`. Live AC: `back` gives exit 0,
    `Navigated back to .../hist/spa#2`, and `eval location.href` agrees.
  - Add mutant M-NAVd: detect no-history by loaderId. The SPA case must kill it.

### M4. The new paged-read API reports a failed read as empty text, which recreates silent data loss
- **Evidence.** 2.1 says: "a failed evaluate yields `text:''` with `totalChars:0` ... no new throw paths."
  - For `snapshot()` this keeps the old tolerance. For `readPageText`, CLI `text --offset` and MCP
    `browser.get_page_text`, a failed window looks the same as a finished one. Examples: a context destroyed by a
    navigation, a dialog freeze, a CDP hiccup.
  - An agent paging a 20 000-character page whose third read fails gets `text ''`. If offset is 0 it sees no marker. If
    offset > 0 it sees a marker like `showing characters 8000-8000 of 0 (end)`. Either way it stops with no signal that
    anything is missing. That is exactly what PROB-048 is about.
  - The same applies to the PDF path: a PDF parse failure falls back to DOM text, which is empty in the viewer.
  - The changelog line "Page text is no longer cut off silently" would then be false in that case.
- **Fix.**
  - Keep `snapshot()` tolerant, but make the new surface explicit: `PageTextResult` gains `error?: string`, or
    `readPageText` rejects.
  - CLI `text`: exit 1 and print `Text read failed: <reason>` on stderr.
  - MCP `get_page_text`: `isError` with the reason.
  - When the PDF is detected but cannot be parsed: `source:'pdf'` with an `error`, never an empty `dom` result.
  - Unit test: a rejecting evaluate gives an error on the new surface and `''` from `snapshot()`.
  - Mutant: swallow the error in `readPageText`.

---

## MINOR

1. **P0 is already resolved, and S1-1 contradicts itself.**
   - Commit `3f0ba55` already contains the `final-classes.json` change, so the branch base is 3f0ba55, not 3179857.
   - Section 1.1 and the P0 text are stale.
   - S1 step 1 requires `git status` to show "nothing" when P0 is resolved. It will show `?? .ai/loop/release-0.6.2/`
     (the plan and this review).
   - Fix: update 1.1. S1-1 should allow exactly that untracked dir, which S1 then commits.

2. **The claim that `cli.ts` is an executable file is wrong.**
   - `git ls-files -s packages/cli/src/cli.ts` prints mode `100644`, while 0.3 says it is "tracked as an executable
     source file".
   - The "mode unchanged" ACs still work. Fix the sentence so no builder "restores" a 100755 mode.

3. **The 1.3 inventory mislabels sites and repeats a false premise about `Page`.** S4 re-classifies the sites, but the
   auditor's F1 starts from this list. Correct it:
   - **SAFE sites listed as if broken.** A sync throw inside an `async` function becomes a rejection, which the existing
     handling already covers:
     - `execution-verifier.ts:357` and `:414` (inside async IIFEs, `try` or `bounded`);
     - `browser-action-engine.ts:1911` (`raceFrameProbe` is async; `pierceFirstMatch` and the `.catch` calls absorb it);
     - `:657` (inside `try` in an async function);
     - `dom-semantic-engine.ts:252` (async `try`);
     - `post-conditions.ts:608/615/618/1497/1758/1762` (inside `run()`, passed to `bounded`).
   - **Truly UNSAFE sites.**
     - `browser-action-engine.ts:1728`, `:1741` and `:1773` (`.catch` chained on the call);
     - `dom-semantic-engine.ts:392` (promise created outside the `try`);
     - `post-conditions.ts:631`, `:647`, `:1548`, `:1735` and `:1743` (`bounded(frame.evaluate(...))`: the call runs
       before `bounded`, so the functions documented as "never throws" reject);
     - **missing from the list:** `post-conditions.ts:1197`, `bounded(page.mainFrame().evaluate(...))`.
   - **`Page.*` is not all async.** 1.3 says "`Page.*` ... are `async` methods". In `api/Page.js`, `click`, `focus`,
     `hover`, `type`, `waitForFunction` and `locator` are plain functions that delegate to decorated main-frame methods.
     They matter only when the main frame is detached, but the inventory should say so.
   - **`ElementHandle` has many more throwing methods than listed.** About 30 methods carry `throwIfDisposed()`, not just
     `$$`/`asLocator`. They throw only after an explicit `dispose()`, which `CdpJSHandle` sets only in `dispose()`.
     Record that rationale in the inventory instead of listing two methods.

4. **The S4 file list can contradict "fix every UNSAFE site".**
   - "Files:" is limited to four browser files. If the inventory finds an UNSAFE site elsewhere (for example
     `condition-wait.ts` or `capability-runtime`), the builder cannot fix it without breaking the step scope.
   - Fix: either allow any `packages/*/src` file that holds an UNSAFE site, or STOP and re-plan.

5. **The I-047 live controls mix Puppeteer versions, and L3 has no same-build mutant.**
   - NEG061 resolves its own `puppeteer-core` 25.12.0. The HEAD dist resolves the monorepo's 25.5.0. The fixture-validity
     signal and the HEAD pass therefore come from different Puppeteer versions.
   - L1 has a same-build control (live M-047a). L3, the snapshot check, does not.
   - Fix:
     - run M-047b live through `cli-bin.mutant.js` for L3;
     - run S11 8c against the packed consumer install, which uses the shipped dependency resolution;
     - make the fixture-validity rule explicit: if the raised-churn attempt also shows 0 failures on NEG061, the item
       STOPs (replan), and PROB-047 is not marked RESOLVED.

6. **L2 does not prove the loop path ran.**
   - If pre-click work (selector probes, the stale check) takes about 500 ms or more, the 1000 ms head start finds
     `#late` in the main frame and the loop never runs.
   - Fix: arm with 2500 ms, still inside the 5000 ms deadline. Assert with `performance.now()` that click start to
     resolve is above 1000 ms. Record both numbers.

7. **The beforeunload fixture and the S7 dialog case are unverified assumptions.**
   - **Fixture.** `/beforeunload` "after a user gesture is simulated via `eval`" gives no user activation. Chrome shows
     beforeunload only with sticky activation. The existing L4 tests arm it with a real `click '#arm-bu'`
     (`verify-fr2-04-dialogs.mjs:394`).
   - **Error shape.** Under a dismissed beforeunload, `page.reload()` and `goBack()` probably wait for the navigation
     timeout instead of rejecting with `ERR_ABORTED`. `isBeforeunloadCancel` requires `ERR_ABORTED`, so S7 may be
     unimplementable as specified.
   - Fix: arm via CLI `click`, and spike the reload/back error shape in S1 before binding 2.5.

8. **Exit codes for history verbs are undefined.**
   - S7 accepts "1 (or 4 ...)". That is non-deterministic.
   - `packages/cli/README.md:131` documents that `contradicted` exits 0 unless `--expect-*` is given. Exiting 1 at a
     history edge is a deliberate exception.
   - Fix: state the precedence (for example, no-history gives 1 even with `--expect-*`) and document the exception.

9. **Windowing edge cases.**
   - `maxChars:1` at a high surrogate gives `returnedChars:0` with `end == offset`. The marker's "Continue with
     `--offset <end>`" then loops forever. Fix: extend to the full pair rather than shrink to zero.
   - `offset > total` renders as `9000-9000 of 4000`. Fix: clamp the display, or define the marker for that case.
   - A user-supplied offset that lands on a low surrogate is unspecified.

10. **The PDF live check may not run headless.**
    - S3a(g) assumes headless Chrome opens `/pdf` in the viewer. Headless can treat a PDF as a download (`ERR_ABORTED`).
    - Fix: spike in S1. If it aborts, define the fallback (`--headed`, or fixture `content-disposition: inline`) before S3a.

11. **The MCP ceiling of 100 000 characters can be truncated by the MCP client.**
    - Claude Code limits MCP tool output to 25k tokens by default. 100k characters of CJK or dense text exceed that, so
      the client truncates or errors on what the server returned in full.
    - Fix: lower the MCP `maxChars`/`textMaxChars` ceiling (for example 40 000) or document the client limit in the tool
      description.

12. **The scratchpad holds 0.6.1 leftovers, a stale-read risk.**
    - `$SP/S1` (including `matrix-run.out`, `mut/`), `$SP/S2`, `$SP/S4`, `$SP/S6` and `$SP/S8` already exist.
    - S1 writes `$SP/S1/matrix.sh` into that directory.
    - Fix: put 0.6.2 scripts and outputs under `$SP/r062/<STEP>/`. ISOs stay top-level 3-character names.

13. **The consumer and dependent greps are incomplete.**
    - S2 consumers: the `rg` covers `packages apps` only. It misses `tools/scenario-suite/run-sdk.mjs:536`,
      `run-mcp.mjs:353` (splits on `Page text:`), `run-cli.mjs` (`text` used about 10 times) and
      `tools/engine-comparison/measure-snapshot-cost.mjs`.
    - S6 dependents: the docs regex covers only 6 verbs, and neither grep covers `.claude/skills/*` or the WebBench
      driver brief.
    - `grant` before `nav` is a documented workflow (the `cmdGrant` usage text). Document that it now needs a session.

14. **`AGENT_SETUP.md` is missing from S10.**
    - It ships in the npm `files` list, and both copies, root and `packages/sutradhar/`, are identical. Line 60 says
      "72 `browser.*` tools", and its tool table has no `get_page_text`, marker, `#N`, `back/forward/reload` or
      no-auto-launch text.
    - Fix: add both copies to S10 and to S10-3's count check, plus a `cmp` check that they stay identical.

15. **Unlogged WebBench findings.**
    - `CANDIDATE-FIXES.md` items 2 and 3 (2388) are in neither known-problems nor S10b: a click that opens a new tab makes
      `--expect-url-changed` exit 4, and a false 15 s click timeout.
    - Fix: log both in S10b as unconfirmed.

16. **SDK types do not resolve for consumers (pre-existing).**
    - The published `dist/index.d.ts` and `page.d.ts` re-export from `@sutradhar/capability-runtime`, which is not on
      npm. The new `PageTextResult` therefore resolves to `any` for consumers, and S3c's "export presence" is runtime
      only.
    - Fix: add a consumer `tsc --noEmit` probe in S11 item 6 (record, do not fix), and log it in S10b.

17. **Procedure.**
    - S11 makes two commits; split it into S11 and S11b to keep one step per commit.
    - 6.4 lacks the global session-handoff content (background PIDs, the state of in-progress runs, STATE/JOURNAL with
      the next step).
    - The 982 regression AC compares `text` totals with a separately timed `eval` on a live, dynamic page. Use
      `text --json` totals and an `eval` run immediately after, and record any mismatch instead of auto-failing.
    - S2 says `runtime.evaluate`; the method is `runtime.eval` (`page.evaluate` exists).
    - S8 says the auditor commits. The `auditor` agent type is read-only, so the orchestrator should commit `$EV/S8`.
    - M-051c's wording is confusing. The correct placement is the first statement inside `if (!state) {`; the broken
      variants are "after `spawnFresh`" and "after `afterAttach`". Name them.

## Answers to the four review questions
1. **PROB-047.** The root cause is confirmed in the Puppeteer source and by the proof. The fix is incomplete as specified:
   one UNSAFE site is missing (`post-conditions.ts:1197`), several sites are mislabelled, and the file scope is too narrow
   (MINOR 3, 4). The local repro is likely deterministic: with 25 ms churn, every frame captured at pass start is already
   detached by its turn. Failure on 0.6.1 has not yet been shown; the S4 validity rule must be what shows it (MINOR 5).
2. **PROB-048.**
   - Making `pageText` additive leaves existing consumers unbroken. `wait_for`, `expect.text`, `extract`, `audit` and the
     block detector compute text independently.
   - Gaps: the failure path (M4), the marker when `offset > total` and the surrogate edge cases (MINOR 9), tool-count
     sites in `AGENT_SETUP.md` (MINOR 14), consumers under `tools/` (MINOR 13), the MCP ceiling against client limits
     (MINOR 11), the headless PDF assumption (MINOR 10).
   - SDK naming (`page.text`, `browser.get_page_text`, `maxChars`/`textMaxChars`) is consistent.
3. **PROB-049, PROB-051 and the history verbs.**
   - PROB-049 is sound.
   - PROB-051: every scenario-suite CLI flow starts with `nav`, so CI is not affected. Exit code 1 matches the existing
     fatal-error contract.
   - History verbs: the single-page-app defect (M3), the exit-code precedence (MINOR 8) and the beforeunload assumptions
     (MINOR 7) need revision.
4. **Evidence discipline.** Steps have ACs, negatives, named mutants and false-pass prompts. M1 and M2 are concrete
   cases where an AC either cannot pass or passes vacuously. Escalation is correct per item, and the I-048 BLOCKED rule
   stops the release.
