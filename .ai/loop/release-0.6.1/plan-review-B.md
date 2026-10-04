# Plan review B: Addendum B (post-S8), release/0.6.1

Reviewer: independent plan reviewer (did not build or audit any of this work). 2026-10-04.
Scope: only "Addendum B (post-S8)" (plan.md lines 2125-2178). Worktree `project-understanding-696041`, branch
`release/0.6.1`, HEAD `bff46db`. Read-only. The only file written is this one.

## Verdict: **REVISE** (0 BLOCKER, 5 MAJOR, 6 MINOR)

The root-cause classification is correct, and the S6g design (rethrow after the cleanup) is the right one. Five
MAJOR gaps would let S8b (the final audit) fail for avoidable reasons, or let a false pass through:
- S6g contradicts an existing test.
- Nothing covers the self-heal call site.
- The live A/B has a false-pass path and no negative control, and its teardown repeats S8's stale-PID kill.
- S6h's main option cannot be done as a test-only change.

All of them are plan-text fixes.

## 1. Root-cause verification (question 1)

| claim in B.0 | verified? | evidence (read-only) |
|---|---|---|
| 0.6.0 `close` fails non-zero and skips "Session closed." when `clearState` throws | **Yes** | `git show origin/master:packages/cli/src/cli.ts`, lines 1665-1678. `killChromeTree(state.chromePid)` is fire-and-forget (not awaited). Then `await clearState();` runs, unguarded, before `console.log('Session closed.')`. `main()` (1797 `case 'close': return cmdClose();`) has no try around the switch. `main().catch` at about 2077-2082 ends in `console.error(\`Fatal: ${err.message}\`); finalExitCode = 1; process.exitCode = 1;`. The result is **exit 1, stderr `Fatal: EBUSY: ... unlink '...state.json'`, no "Session closed."**. `clearState` in 0.6.0 is `rm(STATE_FILE, {force:true})` (state.ts:109). |
| 0.6.0 self-heal fails the command | **Yes** | master cli.ts 476-485: `selfHeal` runs `killChromeTree` (not awaited), then `await clearState();` (unguarded), then `spawnFreshSession`. `session-flow.ts` `withSessionFlow` calls `selfHeal` inside the `catch` of `reattach`, with no guard of its own, so the rejection reaches `main().catch`: the same `Fatal:`, exit 1. A command that wraps `withSession` in its own try would behave identically in both versions, because S6g does not touch it. |
| HEAD swallows the error | **Yes** | close-session.ts 59-64: `try { await deps.clearState() } catch { warn(...) }`. The file header (lines 13-14) and the JSDoc at line 38 both say it never throws. The S8 CLR log shows HEAD: `close exit=0`, `Session closed.`. |
| F-S8-1 is a test defect, not a product defect | **Yes** | close-session.spec.ts:173-177. `cb` is the index of the `if` keyword. `extractBlock` starts at the first `{` after `cb`, so `cb + cbBlock.length - 1` lands 19 characters (`"if (!closeBlocked) "`) before the real closing `}`. The product code (cli.ts 1721-1733) has the clear after the block. |
| F-S8-2 is "spec contradictory" | **Yes** | S6b-4 says "Do not change exit codes" (plan 1979). The S6b/N2 design states "never throws". These cannot both hold when `clearState` rejects. The narrower N2 requirement ("never abort the close on a malformed state") is what B.0 says. |

The classification is accepted. The systemic lesson (try boundary placements; a contradiction means STOP) is correct, and finding 2 below applies it.

## 2. Findings

### F1 (MAJOR): S6g contradicts an existing test that the plan says stays unchanged
- **Evidence.**
  - close-session.spec.ts:215-231, test "a failing kill or clearState never throws (never-throws contract) and later
    steps still run".
  - Its second half sets `clearState` to throw `'disk full'` and asserts
    `await expect(stopSpawnedChrome(...)).resolves.toBeUndefined()` and `warnings.some(w => w.includes('disk full'))`.
  - After S6g this test must fail, but S6g AC (2) says "existing O-tests unchanged" and says nothing about this test.
  - This is the same silent-judgement-call situation that B.0 just named as the root cause. A builder who follows the
    new STOP rule will stop here and waste a cycle. One who does not will edit the test without a spec.
- **Fix.** S6g must say explicitly:
  - keep the kill half of that test unchanged (a rejecting kill still resolves, and `['clearState','cleanup']` still runs);
  - replace the clearState half with the AC (1) test (rejects with the same error object, cleanup called with the same args);
  - assert `warnings` has **no** "could not clear the session state" line, which pins "no extra warning line";
  - rename the test;
  - also update the file-header sentence (close-session.ts lines 13-14, "this function never throws"), not only the
    JSDoc at line 38.

### F2 (MAJOR): No AC or mutant covers the self-heal call site
- **Evidence.**
  - F-S8-2 is about both close and self-heal. S6g AC (4) is close-only.
  - The only call-site guard is O6, which counts `await stopSpawnedChrome(` == 2. A mutant that swallows at the call
    site would survive it: `await stopSpawnedChrome(state, sessionStopDeps()).catch(() => {});` still contains that
    string. The same goes for a `try {...} catch {}` around the self-heal line (cli.ts:496).
  - No unit or live test would fail on that mutant: the AC (1) unit tests exercise `stopSpawnedChrome` directly, and
    the live A/B covers only `cmdClose`.
- **Fix.**
  1. Add a source guard (O6b). Neither `await stopSpawnedChrome(` call is followed by `.catch(`, and neither sits
     inside a `try {` whose block contains it. For selfHeal, use `extractBlock` on `selfHeal: async`; for cmdClose,
     use the `if (state.chromePid) {` block.
  2. Add mutants **M-B2d** (`.catch(() => {})` on the selfHeal call) and **M-B2e** (the same on the cmdClose call).
     Both must fail O6b. M-B2e must also fail the live A/B.
  3. Optionally add a live self-heal A/B, with the same safety rules as F4:
     - take a state with our own live `chromePid` and a `wsEndpoint` rewritten to a closed port;
     - lock state.json;
     - run `nav`;
     - expect `Fatal:` and exit 1 on both 0.6.0 and HEAD+S6g.
     If the live case is not done, record why in the evidence. The source guard plus mutants is the minimum.

### F3 (MAJOR): The live A/B can false-pass, and no negative control is required
- **Evidence.** AC (4) requires only:
  - the exit codes are equal and non-zero;
  - "Session closed." is absent in both runs;
  - the temp dir is removed on HEAD.

  Any unrelated failure on HEAD also satisfies that, for example a `getBroker`/attach error, the watchdog's `Error:`
  exit 1, or a harness timeout (`spawnSync` timeout gives `status=null`). Such a run would pass on a broken S6g. The
  temp-dir check alone does not prove the right path ran. The global rule requires running a negative case and seeing
  it FAIL. The current HEAD (`bff46db`) build is exactly that case (exit 0, "Session closed."), but the plan does not
  require running it in the same harness.
- **Fix.** AC (4) must also require:
  - **(a)** In both runs, stderr contains `Fatal: ` followed by the same errno code (`EBUSY` or `EPERM`) and the
    `state.json` path. `status` is a number (not null), and `r.error` is undefined.
  - **(b)** On HEAD with `SUTRADHAR_CLI_DEBUG_CLEANUP=1`:
    - `[cleanup] phase kill` is present;
    - `[cleanup] state-cleared` is absent;
    - a `[cleanup] ... removed` line is present for the session dir, and it comes **before** the process exits (it
      proves the cleanup ran before the rethrow, as the live counterpart of M-B2b);
    - no `could not clear the session state` warning.
  - **(c)** Chrome is gone in both runs (`tasklist` plus a CIM CommandLine ownership check).
  - **(d)** A **negative control**: the same harness against the `bff46db` build (keep a copy of its `cli-bin.js`
    before S6g's force build; its sha256 is `48c1756c...` per S8) must FAIL AC (4) (exit 0, "Session closed."
    present). Record the output.
  - **(e)** The 0.6.0 binary's identity: its sha256, plus the tarball integrity compared with the 0.6.0 checksum row
    recorded on master (commit `324ee8f`).

### F4 (MAJOR): A/B safety and feasibility, as written ("use the auditor's method")
- **Evidence.**
  1. S8's CLR case ran a **second `close` on the stale state**, which re-issued `taskkill /T /F` on a dead,
     possibly reused PID. audit.md section 7 discloses this and says a re-run "must first rewrite state.json without
     `chromePid`".

     Under S6g the failed close leaves state.json with `chromePid` on **both** 0.6.0 and HEAD. So the A/B teardown
     must not run any CLI command (close, nav or self-heal) in that state dir until the harness itself has deleted or
     rewritten state.json, after releasing the lock holder. Addendum B does not say this. On a shared machine this
     is a wrong-kill risk.
  2. The auditor's `caseCLR` cannot run unmodified against 0.6.0:
     - 0.6.0 state.json has no `userDataDir` or `tempProfile`, so `path.basename(st.userDataDir)` throws, and with it
       the ownership check `ourAlive`.
     - The 0.6.0 profile dir is `os.tmpdir()/sutradhar-cli-<Date.now()>` (master spawn-chrome.ts:68). It must be found
       from Chrome's CIM CommandLine instead.
     - 0.6.0 **leaks** that dir by design, so the harness has to remove it with the exact-path guarded delete.
     - 0.6.0's kill is fire-and-forget (master spawn-chrome.ts:105-107), so the harness must check that Chrome is gone
       and, if it is not, kill it only after the ownership check.
- **Fix.** Write the A/B procedure into S6g:
  - separate isolated TEMP and `SUTRADHAR_CLI_STATE_DIR` per run, under the isolation preamble;
  - a lock holder (FileShare ReadWrite, no Delete) that the harness spawns itself, with its PID logged and its exit
    confirmed;
  - after the measured `close`, release the holder, then remove state.json from the harness, and only then do any
    other cleanup. **No second CLI command against that state dir.**
  - for 0.6.0, identify the dir from the CIM CommandLine of the recorded `chromePid`, and use the guarded delete for the leaked dir;
  - run a leftover-process query at the end, with a positive control.

### F5 (MAJOR): S6h's main option needs a product change; the fallback is ill-defined and still load-sensitive
- **Evidence.**
  - T5 (temp-profile.spec.ts:320-332) drives `removeSessionTempProfile` → `removeWithRetries`. That code reads
    `performance.now()` directly (temp-profile.ts:437, 466, 558-561) and has no injected clock. The `now` seam exists
    only on `stopSpawnedChrome`.
  - "Drive it with the injected `now` clock" is therefore impossible in a test-only commit.
  - The fallback, "a bound at least 10x the measured value", is ambiguous: 10x of which value? If it means the
    measured check-to-rm slack (a few ms), it is still a fixed wall-time threshold. It is load-sensitive, which the
    global rule forbids.
  - A 20/20 run under load is evidence, not determinism.
- **Fix.** Specify the deterministic method that the S8 auditor already proposed: assert on the value the module itself compared.
  - In T5, set `SUTRADHAR_CLI_DEBUG_CLEANUP=1` (restore it afterwards).
  - Spy on `process.stderr.write` and collect the `[cleanup] rm-attempt ... remaining-ms=N` lines (temp-profile.ts:447;
    `remaining` is the same variable the `< MIN_RM_START_MS` check used).
  - Assert that every `N >= MIN_RM_START_MS`, with zero slack, and that there is at least one attempt.
  - Keep the fake's `starts` only as an INFO log, not as an assertion.
  - Name the mutant: S8's **M-b** (`remaining < MIN_RM_START_MS` changed to `remaining < 0`) must fail.
  - Note that M-b's detection still depends on a third attempt landing in the range [0, 1000) ms. Record that this
    holds in the unloaded run.

  This needs no product change, so S6h stays test-only. Keep the 20/20 run under load as a supporting check only.

### F6 (MINOR): Safety of the CPU-load generator (S6h AC)
The plan says only "own PID, killed by PID". It also needs:
- the worker count, at most half the logical cores, because this is a shared machine and other sessions run timing tests;
- a **self-terminating** timer inside the generator (for example 5 min), so a crashed harness cannot leave a CPU hog,
  plus the global hard cap of 20 min or less;
- every worker PID logged;
- a final leftover-process query by command-line marker, with a positive control;
- never kill by image name (feedback_no_image_name_kill).

### F7 (MINOR): Unit cases missing from the S6g ACs
Add these cases:
- **(i)** `clearState` rejects **and** cleanup rejects: the call rejects with the clearState error object, and
  exactly one cleanup warning is printed. Mutant **M-B2f** rethrows the cleanup error, or skips the rethrow when the
  cleanup fails.
- **(ii)** `clearState` rejects with `tempProfile` false or absent: the call rejects and cleanup is not called.
- **(iii)** `clearState` rejects **and** kill rejects: the call rejects with the clearState error, and the kill error is debug-only.
- **(iv)** AC (5) should name O6b from F2, and say that O9 and O10 (resolve paths) stay green.

### F8 (MINOR): S6f could add two placements cheaply
The three M-O6 placements cover the boundary (first after `{`, last before `}`, middle), which is sufficient for
guard (b). The required fix (`cbOpen = elseBlock.indexOf('{', cb)`, compare with `cbOpen + cbBlock.length - 1`)
is correct: that index is the block's closing `}`.

Optionally add:
- (iv) the clear placed **inside the `catch {}`** of the nested try, a different nesting level;
- (v) the clear moved **before** `if (!closeBlocked) {` inside the else. It must fail because the guard requires
  "after", and that pins the 0.6.0 order.

Also re-run S7's L12m dist-patch anchor against the post-S6g bundle. The anchor text is unchanged by S6g, but confirm
that the `ANCHOR-COUNT` is 1.

### F9 (MINOR): The S8b revert path is not enumerated for the new commits
- **Evidence.** The S8 revert procedure (plan 1150-1158) step 1 lists "S6e.. (newest first), then S6d, S6c, S6b,
  S6a". B.2 says "revert the merge and the S6* commits" but does not name S6f, S6g or S6h, or any S10b-addition commit.
- **Fix.**
  1. Step 1 becomes "S6h, S6g, S6f, then S6e-5..S6e-1, S6d, S6c, S6b, S6a, newest first, each `git revert --no-edit`".
     Then `-m 1` on `254b1ed`. Evidence-only commits (`1ebc466`, `bff46db`) are not reverted.
  2. If the S10b additions (the F-S8-3/5/6 gap entries, and the changelog line about F-S8-5's fail-fast start) are
     committed before S8b and S8b fails:
     - drop or mark them "not included";
     - F-S8-5 describes GAP-349 behaviour, which is reverted.

     Simplest: schedule the S10b additions **after** the S8b verdict.
  3. Add a check after the revert: `git diff origin/master -- packages/cli/src` must be empty, as in the existing
     S11 BLOCKED variant.

### F10 (MINOR): S8b scope should name the new items explicitly
B.2 lists the S4 probes, the S7 harness, mutants, the matrix and the diff read. It should also list:
- an independent re-derivation of the S6g live A/B, including the negative control (F3) and the teardown rule (F4);
- the self-heal check (F2);
- the S6h deterministic assertion, plus one load run;
- dist freshness after S6g's force build (the new `cli-bin.js` sha, which must differ from `48c1756c...`);
- the S8 auditor's own probes (`win-a7b`, the `s8-live.mjs` cases B1/B4/B5/C4). Re-run CLR **only** in the F4-safe
  form, because its unmodified form re-kills a stale PID;
- an explicit escalation statement: S8b is audit #3. Any REOPEN, even one that is test-only or INFO-promoted, means
  BLOCKED under the global rule. The plan says this; repeat it in the auditor brief.

### F11 (MINOR): Process record
- Section 2 rule 4 (#2) asks for `replan-gap315.md` plus orchestrator approval. Addendum B lives in plan.md instead.
  Either create `replan-gap315.md` as a one-line pointer to Addendum B, or amend rule 4 to say that Addendum B is the
  re-plan. Record this review's verdict as the approval input.
- INFO, no change needed: after a failed clear, HEAD+S6g leaves Chrome killed (awaited), the temp dir **removed**,
  and state.json still recording `chromePid` and `userDataDir`. That is no worse than 0.6.0, which killed Chrome
  without awaiting it, **leaked** the dir and kept the state. On the next command, both re-kill the stale PID (the
  pre-existing 1.5 hazard). HEAD's cleanup then finds the dir `already-gone`, which is silent. Mention "a failed
  state clear leaves `chromePid` recorded (as in 0.6.0)" in the S10b 1.5 hazard entry.

## 3. Answers to the specific questions
1. **Root cause:** correct, see section 1. On a clearState failure, 0.6.0 gives `Fatal: <errno message>` on stderr,
   exit code 1 (`finalExitCode = 1`), and no "Session closed.". Self-heal fails the same way.
2. **S6g design:** correct and minimal (rethrow the original error after the bounded cleanup). Compared with 0.6.0 on that path:
   - The warden stop still runs earlier, in both close and self-heal.
   - The dialog paths are unchanged (the gate and `closeBlocked` come before the call).
   - The no-`chromePid` `else` branch already calls `clearState()` unguarded, exactly as 0.6.0 did (master
     1667-1677), and S6g leaves it alone.
   - Rethrowing in self-heal does not leave things worse than 0.6.0 (F11). The remaining differences come from S6b
     and are outside S6g: an awaited kill, and up to 15 s of cleanup before the error.

   Gaps: F1 (conflicting test), F2 (the self-heal call site is unguarded).

   The A/B is feasible. It does discriminate: the current HEAD gives exit 0 and prints "Session closed.", so it fails
   AC (4). But the negative control is not required (F3), the AC has a false-pass path (F3), and the procedure needs
   0.6.0-specific and safety adaptations (F4). The 0.6.0 binary exists at the given scratchpad path (`package.json`
   version `0.6.0`).
3. **S6f:** sufficient, with optional extras (F8). **S6h:** the main option cannot be done as a test-only change, and
   the fallback is load-sensitive (F5). The load AC is acceptable as a supporting check with F6's limits.
4. **S8b:** the scope and the revert intent hold. The revert list and the S10b timing need enumerating (F9), and the
   scope should name the new items (F10).
