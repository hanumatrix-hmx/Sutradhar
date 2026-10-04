# Plan review 2: release 0.6.1 plan (revision 2)

Reviewer: independent adversarial plan reviewer, round 2 (Claude Opus 5.5), 2026-10-04. I am read-only on the repo
except for this file. Location check: `git rev-parse --show-toplevel` printed `$WT` and `git branch --show-current`
printed `release/0.6.1`.
Sources read: `plan.md` (rev 2), `plan-review-1.md`, `git show fix/gap-315-temp-profile-cleanup:packages/cli/src/temp-profile.ts`,
`git diff fdae749 fix/gap-315-temp-profile-cleanup -- packages/cli/src/{cli,spawn-chrome,state}.ts`, the merged
`spawn-chrome.ts` (via `git merge-tree --write-tree`), master `cli.ts` (`cmdClose`, F8, self-heal),
`packages/browser/src/launcher/browser-launcher.ts:78-83`, the branch `temp-profile.spec.ts`, and the FR2-14 audit-2 evidence.

## Review-1 findings: resolution check

| # | resolved? | note |
|---|---|---|
| 1 Node versions | yes | Section 5 runtimes, with S8 on the same runtimes. |
| 2 POSIX | yes, with gaps | C5-live (a)-(d) exists. The WSL copy command and the fidelity of the node:test port have gaps (finding 11). |
| 3 close bound | partly | S6a exists. The bound leaves out the final in-flight `rm` and the pre-kill phases. The deadline also widens a PID-reuse window (findings 2 and 6). |
| 4 gating | yes | There is one rule and one set B. The escalation count conflicts with the global rule (finding 5). |
| 5 probe hygiene / rule 5 | yes | env-only paths, the attribution query and A4-pre are all in place. |
| 6 GAP-349 | partly | The helper shape and the 3 call sites are fixed. The timeout path has no test, L5/L5b do not exercise what they claim, and test (5) has no tmpRoot seam (findings 3 and 4). |
| 7 real-TEMP check | partly | The canary and the `dirname` check are good. The (iii) attribution cannot be executed as written (finding 9). |
| 8 same commands | partly | `--force` is only in prose and is missing from the S1/S3b code blocks. S1 has no lint baseline (finding 12). |
| 9-19 | yes | Except #10: the S11-3 check of `cli-bin.js` can never pass (finding 13). |

## Findings

1. **MAJOR: the isolated TEMP relies on `export` inside code blocks, but shell env does not persist between tool calls.**
   - Gap: S1 (line 256), S5 (line 494) and S11 ("Export TEMP/TMP/TMPDIR ... for every item") set TEMP with `export`.
     In this environment every Bash or PowerShell call starts a fresh shell ("Shell state (env vars, functions) does not
     persist"). A builder that runs `export` in one call and `vitest`/`turbo` in the next runs GAP-315 code against the
     real `E:\AI-Cache\tmp`, where 35 live sessions' dirs sit. This is the main safety control in the plan, and it fails
     silently.
   - Fix:
     - (a) Never use a bare `export`. Every command that can run GAP-315 code goes through `$SP/iso.sh`
       (`#!/bin/sh` + `TEMP=$1 TMP=$1 TMPDIR=$1 exec "${@:2}"`), or puts `env TEMP=.. TMP=.. TMPDIR=..` on the same line.
     - (b) Add a positive guard. A vitest `setupFiles` passed by CLI flag (`--setupFiles $SP/assert-tmp.mjs`, outside the
       repo) throws unless `os.tmpdir()` starts with `$SP`. Every probe and live script prints `os.tmpdir()` and aborts
       if it is not under `$SP`.
     - (c) Make an AC per step: the log contains the guard's `tmpdir=<$SP/...>` line.

2. **MAJOR: `close` now keeps `state.json` (with `chromePid`) for up to about 25 s after the kill, which widens a
   PID-reuse kill hazard.**
   - Gap: on the branch, `cmdClose` runs `await killChromeTree` -> `await cleanupSessionTempProfile` (up to 15 s after
     S6a) -> `clearState()`. Master clears state right after starting the kill.
   - If `close` is interrupted in that window (Ctrl-C, a harness timeout, a terminal closed), `state.json` keeps a dead
     `chromePid`. The next command's reattach fails. Self-heal then runs `await killChromeTree(state.chromePid)`, or a
     second `close` does. That is `taskkill /PID <pid> /T /F` on a PID that may already belong to an unrelated process
     tree.
   - The plan's own section 0 records this reuse: PID 66960 was a `bash.exe` seconds after the kill. On this shared
     machine the result would be killing another session's process, which is exactly what the project rules forbid.
   - Fix (S6a or its own S6 commit): once `waitForPidExit` confirms the exit, rewrite state without `chromePid`. Keep
     `userDataDir`/`tempProfile` so an interrupted close can still be cleaned up. Alternatively, capture the values,
     `clearState()`, then clean up.
   - Unit test: kill -> exit confirmed -> state no longer has `chromePid` before the scan/rm phase starts (inject a
     scan that asserts on `readState()`).
   - Mutant: move `clearState` back after the cleanup; the test fails.

3. **MAJOR: the GAP-349 live and unit cases do not exercise the paths they claim, and the timeout path is untested.**
   - (a) L5's trigger is probably not F8. FR2-14 audit-2 N5 (`.ai/loop/field-report-2/decisions.md:4130`,
     `evidence/FR2-14/audit-2/verdict.md:35`) recorded that `--viewport 10000000x10000000` passes validation
     (`cli.ts:1695`, max 10000000), gives exit 1 "No browser session", and **"state.json written"**. So the failure comes
     after `writeState`, not in the F8 catch. L5's "dir gone after the run" will then fail, or pass through some other
     path.
     - Fix: before using the trigger, prove it hits F8. Expect no `state.json` in `$T/state` after the run, and stderr
       carrying the attach/setViewport error.
     - If no deterministic live F8 trigger exists, extract the F8 block into a small exported function with injected
       `attach`/`discard`. Unit-test that it awaits discard before rethrowing, and record the live F8 case as
       "unit-only".
   - (b) L5b is wrong. `findExecutablePath` uses `CHROME_PATH` only `if (process.env.CHROME_PATH &&
     fs.existsSync(...))` (`browser-launcher.ts:82`). A non-existent path silently falls back to the real Chrome, so `nav`
     succeeds.
     - Fix: for no-PID, use `CHROME_PATH=<existing non-executable file in $T>` (e.g. `$T/notchrome.txt`). Expect
       EFTYPE/UNKNOWN, no PID, exit 1 and no dir left. Verify the error code first.
   - (c) GAP-349 path 2 (spawn timeout) has no unit test and no live case. S6b tests (1)-(5) cover the helper and
     no-PID. The mutant list cannot catch a dropped call in the timeout path.
     - Fix: add a unit test with an injected `fetch`/port probe that never succeeds and a short injectable deadline.
       Live: `CHROME_PATH=<a copy of node.exe in $T>`. It exits at once on `--remote-debugging-port`, so pid is set, the
       port never opens and the 10 s timeout fires. Expect exit 1 and no dir left.
   - (d) The timeout path kills a PID whose child may already have exited. The stand-in above exits immediately, and a
     crashed Chrome does the same. `killChromeTree(pid)` then hits a possibly reused PID.
     - Fix in S6b: `spawnDetachedChrome` tracks `child.on('exit')`. On timeout it kills only if the child has not
       exited (`child.exitCode === null && child.signalCode === null`). Add that to the helper input (`alive?: boolean`)
       and to the tests.
   - (e) The `error` event fires asynchronously. "Throw the original message plus the spawn error if one exists"
     needs the error read **after** an `await` (e.g. after `discardSpawnedProfile`). At the synchronous `if (!pid)`
     point it is always undefined.

4. **MAJOR: S6b test (5) has no tmpRoot seam, breaks C6, and its assertion is a false pass.**
   - Gap: `spawnDetachedChrome` calls `createTempProfileDir()` with the default `os.tmpdir()` (merged
     `spawn-chrome.ts:73`). The helper's default `deps.remove` is `removeSessionTempProfile(dir, pid)`, also with the
     default root and the real scan.
   - Test (5) therefore creates and removes a `sutradhar-cli-*` in the **process TEMP**: the real TEMP for any developer
     and for CI. It also launches PowerShell/`ps`. Its assertion "leaves no `sutradhar-cli-*` in the scratch tmpRoot"
     holds even if cleanup is broken, because the dir never existed there.
   - C6 ("every sweep/remove call in the spec passes an explicit tmpRoot") cannot hold for this test.
   - Fix: the optional last parameter of `spawnDetachedChrome` should be a deps object:
     `{ executablePath?, tmpRoot?, remove? }`. `createTempProfileDir(tmpRoot)` and the discard helper both use it.
     Test (5) passes a scratch `tmpRoot` and a remove wrapper with `scan: async () => []`. It asserts that the dir was
     created there (listing captured inside the injected `remove` before delegating) and that it is gone afterwards.
     Extend the C6 grep to `spawn-failure-cleanup.spec.ts`.

5. **MAJOR: the escalation count conflicts with the user's global rule.**
   - Gap: the global CLAUDE.md says that if an item fails independent audit **twice**, you stop fixing and re-derive the
     root cause, and after **3 failed audit cycles** it is BLOCKED.
   - Section 2 rule 4 and S8 count only post-merge audits: "Two failed post-merge audits: stop ... Three: BLOCKED".
     With an S4 REOPEN, which is GAP-315's first independent audit failure, the plan allows two more failures before
     stopping and four before BLOCKED.
   - Fix: count S4 too. An S4 REOPEN followed by one failed S8 means stop, re-derive and revise the plan before more
     code. A third failure overall means BLOCKED and the revert procedure runs.

6. **MINOR: the close bound and wording are not quite honest.**
   - (a) `removeWithRetries` is a `do { rm } while (now < deadline)`, so one recursive `rm` of a 50-100 MB profile can
     start just before the deadline and run past it. The plan states the in-flight-`rm` exception only for the sweep.
     Apply the sweep's "≥ 1 s left before starting an rm attempt" to close as well, or state "25 s + one in-flight rm"
     for close too.
   - (b) 25 s covers kill + cleanup only. `cmdClose` also runs the dialog gate/broker and `stopWarden` before the kill.
     The changelog should say "the cleanup adds at most about 15 s (plus up to 10 s for the kill)", not "close takes at
     most about 25 s". S7 L1 can keep measuring the whole command.
   - (c) The warning "it will be retried at the next session start" is wrong. The sweep only touches dirs whose
     top-level mtime is more than 10 minutes old, and a partial rm refreshes that mtime. Say "by a session started 10+
     minutes from now".
   - (d) Self-heal calls `cleanupSessionTempProfile(state)` with `warn=false`, so its leaks are silent. Warn there too.

7. **MINOR: the S6a tests and ACs lack positive controls.**
   - Test (3) "removes at most the dirs for which at least 1 s was left": with a 1000 ms budget and an 800 ms scan, 0 dirs
     qualify, so a sweep that never removes anything passes.
     - Fix: assert exactly 0 removed there. Add (3b): budget 5000 and an 800 ms scan removes all 3. Add a case where
       the scan's argument is ≤ remaining.
   - S6a-3 "shows only the documented constants" cannot be checked by a builder. List the exact expected lines
     (`CLOSE_CLEANUP_DEADLINE_MS = 15_000`, `SCAN_TIMEOUT_MS = 8_000`, the sweep default `15_000`, the exit cap
     `10_000`).

8. **MINOR: the scan timeout drops from 20 s to 8 s without measurement, and its cost and failure modes are not
   recorded.**
   - Fail-closed is correct: a non-zero exit, a timeout, ENOENT or maxBuffer all give `null`, which means keep. But a
     PowerShell 5.1 cold start plus a CIM `LIKE` query on a loaded machine can exceed 8 s. Each such case silently turns
     cleanup into a leak.
   - Fix: S7 wraps the scan, or reads a debug env, to log every scan's duration and result. The AC gives p50/max scan
     time and `scan-unavailable`/`deadline` counts across L1-L4. If max > 4 s, record it and reconsider the clamp.
   - Also: `execFile('powershell.exe')` and `spawn('taskkill')` use bare names, and libuv on Windows searches the
     current directory before PATH. A planted `powershell.exe` in the user's cwd could return `[]` and enable deletion.
     The `taskkill` exposure is pre-existing. Log a follow-up gap (S10b) to use
     `%SystemRoot%\System32\...` absolute paths, or fix it in S6a since it is one line.

9. **MINOR: S7(iii)'s attribution cannot be executed as written.** "Checking, with a CIM query, that its owning process
   was not one of ours" is impossible after the dir and process are gone.
   - Fix: before the run, record (read-only) each real-TEMP entry's name and its `.sutradhar-owner.json`
     `cliPid`/`chromePid` if one exists. During the run, record every PID our script spawned. After the run, a missing
     entry is attributed if its marker PIDs are not in our set. (i) and (ii) show that no process of ours had the real
     TEMP.

10. **MINOR: probe re-run and B-item details.**
    - S8 "re-run every S4 probe unmodified" can break for API reasons (S6a changes reasons and options; S6d may add
      `not-a-directory`). Allow a probe change only if it is listed in `$EV/S8/probe-diffs.md` with the reason, and
      never one that weakens an assertion.
    - B3/B4 are "after S6a", so mark them S8-only. Otherwise they FAIL at S4 by design.
    - B5's TEMP=B must be a second scratch dir, never the real TEMP. State it.
    - C5-live(b) must state "no `.sutradhar-owner.json`", because `readOwnerPid` prefers the marker over `SingletonLock`.
    - A4-pre uses Chrome only. `findExecutablePath` can return Edge on machines without Chrome. Run A4-pre once with
      Edge (present on Windows 11), or record it as untested.

11. **MINOR: the WSL harness commands are not copy-paste executable.**
    - In `wsl.exe -e sh -c '...cp $SPW/S4/...'`, `$SPW` sits inside single quotes, so Git Bash never expands it and it is
      empty in WSL `sh`. Give the literal `/mnt/e/...` path, or use `"..."` with `$SPW` defined.
    - Put a hard timeout on every `wsl.exe` call (`timeout 300 wsl.exe ...`).
    - C5-live(d), the hand-ported node:test, needs a fidelity check: a table mapping each of the 19 branch `it(...)`
      titles to its port, with the count asserted = 19, and the auditor diffs the assertions.
    - S6c's "-ww" can make busybox `ps` (Alpine) fail. That fails closed, but cleanup then never works there. Note it in
      the gaps.

12. **MINOR: the commands do not match the prose (`--force`, lint baseline).**
    - The S3b false-pass analysis says to add `--force` to `turbo run test` in S3b and S11, but the S1 (line 294) and S3b
      (line 420) code blocks lack it. Put `--force` in every turbo test command, S1 included.
    - S3b keep-condition 4 compares lint against "master's known state", but S1 records no lint run. Add
      `turbo run lint --force --concurrency=1` to S1.
    - Condition 5 compares an inventory run with an audit argument (S3a) against one without (S3b). Compare only the
      `==` lines.

13. **MINOR: S11-3 cannot pass for `cli-bin.js`.** Today `grep -c "0\.6\.0" packages/sutradhar/dist/cli-bin.js` gives 0,
    and `cli.ts` has no VERSION constant or `--version`. "each >= 1" for `cli-bin.js` is therefore wrong, and S11-8c's
    `--version` does not exist.
    - Fix: expect `mcp-cli.js` ≥ 1 and `index.js` ≥ 1, and `cli-bin.js` = 0 for both 0.6.0 and 0.6.1. Drop the
      `--version` sub-item.

14. **MINOR: S6b call-site expectations are inconsistent.** `grep -nE "killChromeTree\("` will print 3 lines after S6b:
    the definition, self-heal and cmdClose. The `deps.kill(...)` line and `kill: killChromeTree,` do not match.
    - Fix: the evidence expects 3 lines plus a separate `grep -n "deps.kill("` (1 line).
    - Rename the `unawaited-count=$?` echo to `grep-exit=$?` (1 = none found) so nobody reads it as a count.

15. **MINOR: the commit hygiene for untracked files is not specified.** `.ai/loop/release-0.6.1/` (plan, reviews) is
    untracked now, and S1 has no commit. S2-2 (`git diff --stat HEAD^ HEAD` lists only S2 files) and S11-1 (clean tree)
    depend on when these are committed.
    - Fix: S1 ends with a commit `0.6.1: plan, reviews, baseline evidence` that contains only those paths. Every
      later step adds paths by name (`git add <paths>`), never `-A`.

16. **MINOR: the S4-BLOCKED rollback drops GAP-349 completely.** On master the un-awaited kills (F8, spawn timeout) are a
    defect independent of GAP-315. Master does not pre-create the dir.
    - Fix: record the decision in `decisions.md`. Either ship only the awaited-kill + exit-check part (finding 3d) as
      its own commit, or state explicitly that GAP-349 waits for the next release.

## Things checked and found sound (no finding)

- **Fail-closed scan.** `scanCommandLines` returns `null` on any `execFile` error, timeout or maxBuffer overflow, and
  `decideRemoval` maps `null` to `scan-unavailable` (keep). With `$ErrorActionPreference='Stop'`, a CIM failure exits
  non-zero. The PowerShell command line contains `sutradhar-cli-%'`, which never equals a candidate basename, so the
  query's self-match is harmless.
- **No step touches the real TEMP by design.** This assumes finding 1 is fixed and test (5) is fixed per finding 4.
  - Probes pass `tmpRoot` explicitly.
  - S7 passes env per `spawnSync` and sets `SUTRADHAR_CLI_STATE_DIR`, which exists (`state.ts:92`), so the user's real
    session state and Chrome PID are never read.
  - No existing test spawns the CLI (grep of `packages/*/tests`).
- The S5 conflict resolution, S5-1 = 11 first-parent files, and the S8 revert order are correct.
- The `cmdClose` warning goes to stderr. The exit code stays 0. "Session closed." describes the session, not the dir,
  which is honest provided the warning names the reason (S6a-4).

## Verdict: REVISE

There are 5 MAJOR findings (1-5) and no BLOCKER. Fix 1-5 before any builder starts S1/S4. Finding 1 must be fixed before
**any** command runs GAP-315 code. Findings 6-16 can be folded into the same revision.
