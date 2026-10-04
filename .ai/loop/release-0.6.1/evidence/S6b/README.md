# S6b - close/recovery ORDER: kill (awaited, 0.6.0 semantics) -> clear state -> bounded cleanup (+ N2 folded in, Addendum A.2)

Source state tested and committed (`source.sha256`): `close-session.ts 5f29b2fa...`, `cli.ts c468206c...`, `temp-profile.ts 27f85983...`,
`spawn-chrome.ts 4521e127...` (unchanged since S6a).

## What changed
- new `packages/cli/src/close-session.ts`: `stopSpawnedChrome(state, deps)` (never throws) and `KILL_CAP_MS = 10_000`.
  Order: validated-PID kill (`deps.kill`, awaited) -> `deps.clearState()` -> cleanup only if `typeof state.userDataDir === 'string' && state.tempProfile === true`,
  with `deadlineAt = deps.now() + CLOSE_CLEANUP_DEADLINE_MS` (monotonic; default `now` is `performance.now()`), errors from the cleanup are a warning.
- `cli.ts`: `sessionStopDeps()` (`kill: killChromeTree` by reference, `now: () => performance.now()`, `clearState`, the cleanup closure with `warn=true`);
  cmdClose chromePid branch and self-heal both `await stopSpawnedChrome(...)`; the trailing clear is removed from the chromePid branch; the no-chromePid
  branch is the plan's exact target shape (`else { if (!closeBlocked) {...} await clearState(); }`). Statement-by-statement table: `cmdclose-before-after.md`.
- N2 (Addendum A.2 "S6b amendment"): PID guard (only a positive integer is ever passed to the kill), `userDataDir` type guard, and in `temp-profile.ts`
  `removeSessionTempProfile` / `sweepStaleTempProfiles` top-level try/catch (non-string dir -> `not-auto-temp`; a REJECTING scan -> `null` -> `scan-unavailable`;
  any other error -> `{removed:false, reason:'error'}` or a contained sweep end).
- tests: new `close-session.spec.ts` (O1-O10 + a never-throws test, 14 tests), `temp-profile.spec.ts` +4 (T9, T10, close-catch, sweep-catch).

## AC table
| AC | result | evidence |
|---|---|---|
| S6b-1: O1-O10 pass | PASS | `test-cli.log`: `Test Files 19 passed (19)`, `Tests 297 passed (297)`; `close-session.spec.ts (14 tests)`. Red first: `red-before-change.log` (module missing, T9/T10/error tests failing) |
| S6b-2: all mutants fail (plan: 6 + the 2 N2 mutants = 8; M-O4 split into default/wiring) | PASS | `mutants.txt`: M-O1 (O1,O2), M-O2 (O1), M-O3 (O3), M-O4a default clock (O8), M-O4b wiring `now: Date.now` (O6), M-O5 trailing clear re-added (guard (a)), M-O6 clear moved into `if (!closeBlocked)` (guard (b)), M-O7 type guards removed (O9, O10), M-T10 (T10). Extras: M-T9, M-N2-close-catch, M-N2-sweep-catch. `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 restored for every run |
| S6b-3: `grep -n "killChromeTree(" packages/cli/src/*.ts` = exactly 3 lines | PASS | `grep-killChromeTree.txt`: spawn-chrome.ts:116 (definition), spawn-chrome.ts:106 (spawn-timeout call), cli.ts:306 (F8 call) |
| S6b-4: no exit-code change | PASS | `grep-exit-diff.txt`: 0 lines of `process.exit|exitCode` added or removed in `git diff HEAD -- cli.ts` (S6a commit as base); `cli-vs-S6a.diff` |
| S6b-5: tsc, spec typecheck, guard, check-cleanup-paths | PASS | `tsc.txt` exit 0; `spec-tsc.txt` 7 errors identical to the S5 baseline, 0 TS6059, 0 errors in new spec files (the first run caught a TS2352 in my new `close-session.spec.ts`, fixed; proves the check bites); planted control TS2322 re-run; 50 `[iso-guard]` lines, 0 `ISOLATION GUARD`; `pathcheck.txt`: `cleanup-lines=165 outside-iso=0` exit 0 and the wrong-root control exit 1 (120 OUTSIDE-ISO) |

## Deviations / judgment calls
1. `clearState()` failing inside `stopSpawnedChrome` is caught and warned (plan: "never throws"); on master/0.6.0 a failing `clearState` rejected and the CLI exited 1.
   Not an `process.exit` change (S6b-4 holds) but a behaviour difference in a practically unreachable case (`clearState` is a forced `rm`). Test: "a failing kill or clearState never throws".
2. `StopDeps` also has an optional `warn` (the plan lists kill/clearState/cleanup/now/debug): O3 needs a place for "one warning" that a test can observe.
3. O2's "second `stopSpawnedChrome(readState())`" is modelled as `stopSpawnedChrome(store ?? {})`, because a real second `close` reads no state at all ("No active session") and never reaches the function.
4. O4's slow kill is a 150 ms fake that records the cap it was given (`KILL_CAP_MS`) rather than a 10 s wait.
5. Live verification of the new order against a real Chrome is S7 (R1 L1/L9/L12); not done here. Not verified live in S6b: only unit/source-guard/typecheck evidence.

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| S6b-1 | the unit tests exercise a copy of the logic, not what `cli.ts` runs | O6/O7 read the REAL `cli.ts` text (exactly 2 `await stopSpawnedChrome(`, `kill: killChromeTree`, `now: () => performance.now()`, brace-matched cmdClose structure); M-O4b, M-O5, M-O6 mutate `cli.ts` itself and the guards fail |
| S6b-1 | O8 passes because both sides use the same wrong clock | O8 uses NO injected `now` and measures `deadlineAt - performance.now()` in (14000, 15001]; M-O4a (default `Date.now`) fails it |
| S6b-2 | a mutant "caught" because the code no longer compiles or the whole file failed to load | each row has a normal `Tests N failed \| M passed (49)` line and the named test(s) failing; M-O1 is the strongest order mutant (state cleared in a `finally` after the cleanup) and fails O1 and O2 specifically |
| S6b-3 | the grep matches comments, or a call hidden behind another name | all 3 hits are code; `kill: killChromeTree` (reference, no paren) is covered by O6; M-O2 (`void deps.kill(...)`) is caught by O1 |
| S6b-4 | the exit statement was changed on a line the grep pattern misses | `cli-vs-S6a.diff` is short and read in full (3 hunks: import, self-heal, cmdClose + the new `sessionStopDeps`); no `process.exit`, `exitCode`, `printErrorAndExit` touched |
| S6b-5 | spec typecheck vacuous or the path check passes on an empty log | 0 TS6059 + 7 real semantic errors present + planted TS2322 + a new-file error caught in this very step; `cleanup-lines=165 > 0` and the wrong-root run exits 1 |
| Safety | a test touched real TEMP or killed a real process | the tests use fakes only (no `taskkill` is reachable: `kill` is an injected fake in `close-session.spec.ts`); every `[cleanup]` path is under the ISO dir; no live process was started in S6b; ISO dir deleted with the guarded form |
