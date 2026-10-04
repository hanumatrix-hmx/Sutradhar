# S6a - One cleanup deadline, path-logging debug seam, system-binary helpers, honest wording

Source state tested and committed (sha256 in `source.sha256`): `temp-profile.ts 538c543d...`, `system-binaries.ts 4c4db6d3...`,
`spawn-chrome.ts 4521e127...`, `cli.ts 86a652a2...`. The compiled module used by the live probes
(`module.sha256`, `1e47c6c2...`) was bundled with esbuild from exactly these sources (A.5 rule 1:
`esbuild packages/cli/src/temp-profile.ts --bundle --format=esm --platform=node --target=node18`).

## What changed
- `packages/cli/src/temp-profile.ts`: the 7 exported constants; ONE deadline on `performance.now()` for `removeSessionTempProfile`
  (`deadlineAt`/`deadlineMs`, exit wait `min(cap, rem)`, scan `min(SCAN_TIMEOUT_MS, rem)`, no rm attempt starts with < 1 s left,
  reason `deadline`); `exitTimeoutMs`/`removeTimeoutMs` stay as caps clamped to the deadline (Addendum A.4; the branch test is
  unchanged); `sweepStaleTempProfiles` deadline starts before readdir+scan, per-dir retry window `min(deadline, now + 1 s)`;
  `isAlive` single liveness seam (exit wait + ownerAlive); `rmFn` seam; `[cleanup]` debug seam (I/O paths only, never in the
  three pure predicates); `scanCommandLines` uses `powershellExe()` / `psBin()`.
- new `packages/cli/src/system-binaries.ts`: `powershellExe()`, `taskkillExe()`, `psBin()`; `SystemRoot` read on every call (A.4).
- `packages/cli/src/spawn-chrome.ts`: `killChromeTree` spawns `taskkillExe()` (same program and arguments).
- `packages/cli/src/cli.ts`: `cleanupSessionTempProfile(target, chromePid, warn, deadlineAt)`; new warning text; self-heal now
  `warn=true`; `--help` Environment documents `SUTRADHAR_CLI_DEBUG_CLEANUP`. Order is still kill -> cleanup -> clearState (S6b reorders).
- `packages/cli/README.md`: Environment row for `SUTRADHAR_CLI_DEBUG_CLEANUP` (+ the 15 s bounds, in-flight rm caveat).
- tests: `temp-profile.spec.ts` (+12), `help-text.spec.ts` (+1, T7), new `system-binaries.spec.ts` (4).

## AC table
| AC | result | evidence |
|---|---|---|
| S6a-1: T1-T8 and T6b pass | PASS | `test-cli.log`: `Test Files 18 passed (18)`, `Tests 279 passed (279)` (262 + 17 new). Red first: `red-before-change.log` (10 failures on the old code, tests written before the implementation) |
| S6a-2: all 6 plan mutants fail | PASS | `mutants.txt`: M-a (T1,T4), M-b (T5), M-c (T3), M-d (T6), M-e (T8 + the branch test "sweep deletes nothing when the process scan fails"), M-f (T6b); `restored=true` and equal sha256 for each. Extra mutants (not in the plan): M-exitclamp (A.4, T2), M-isalive (isAlive seam), M-sysroot (SystemRoot read at load), M-helptext (T7): all caught |
| S6a-3: `grep -nE "_000\b" temp-profile.ts` = exactly the 7 constant lines | PASS | `grep-000.txt`: lines 48,50,52,54,56,58,60 |
| S6a-4: no bare `powershell`/`taskkill`/`ps` names outside system-binaries.ts; **plus live `win-plant` on v18/v20/v22/v25** | PASS | `grep-binaries.txt` empty (0 lines); `spawn-sites.txt`: 3 spawn/execFile sites (Chrome path, `taskkillExe()`, `execFile(file,...)` fed only by `powershellExe()`/`psBin()`). Live: `win/win-plant-h-v{25,18,20,22}.log` `2 PASS 0 FAIL` each (planted scan 538-621 ms, reason now `in-use`); negative control `win/win-plant-b-v18.log` (S4 branch module) FAILs the scan check with `planted scan took ms=20036` |
| S6a-4 extra: `killChromeTree` ignores a planted `taskkill.exe` | PASS | `kill-probe.mjs` (builder-authored): pre-S6a HEAD module on v18 `FAIL ... child-exited=false` (planted taskkill ran, child NOT killed); new module `1 PASS` on v25/v18/v20/v22 (`win/kill-probe-*.log`) |
| S6a-5: tsc, spec typecheck, guard | PASS | `tsc.txt` exit 0; `spec-tsc.txt`: 7 errors identical to S5 baseline (`SPEC-TSC-SAME-AS-S5-BASELINE`), 0 TS6059, 0 errors in temp-profile/system-binaries/help-text specs; planted control still prints TS2322 (re-run in this step); 49 `[iso-guard]` lines, 0 `ISOLATION GUARD` |
| S6a-6: `check-cleanup-paths` exits 0, lines > 0 | PASS | cli log: `cleanup-lines=134 outside-iso=0` exit 0; wrong-root negative control exit 1 (`pathcheck-neg.txt`, 101 OUTSIDE-ISO); win-plant logs `cleanup-lines=8 outside-iso=0` |

## Mutant table
See `mutants.txt` (runner `mutrun.cjs`, definitions `S6a-defs.cjs`). Each mutant edits the source, runs the three spec files
under the isolation preamble, restores the original bytes in a `finally`, and records sha256 before and after.

## Deviations (and why)
1. The mutants are applied/reverted by a script (`mutrun.cjs`) with exact-string replace and byte-for-byte restore, not by hand-Edit;
   it asserts each `from` occurs (once, or all) and records sha256 before/after. Same procedure, less risk of a mis-revert.
2. `system-binaries.ts` was written before its spec (the helper is 3 trivial functions); its red state is demonstrated by the
   mutant M-sysroot (spec fails) instead of by a pre-change run. The first red run also shows an unrelated spec typo (unterminated
   string) in `system-binaries.spec.ts`, fixed before the green run.
3. `scan ms= result=` is logged at the call sites (`runScan`) so it covers injected scans too; `scanCommandLines` itself stays silent.
4. A time-out of the rm retries (window exhausted by the overall deadline) returns reason `deadline`; a non-lock error returns the
   error message; a retry window shorter than the deadline (`removeTimeoutMs`, sweep per-dir) returns the last error message.
5. A stray interactive `python -` was started by a mistyped command (my own bash child, PID 70960); it was killed by that PID only.

## OPEN ISSUE for the orchestrator (S8 risk, plan contradiction; not an S6a failure)
`wsl-a7.mjs` (S4 probe, unmodified) has two checks, `A7 ps unresolvable -> null` and `A7 ps unresolvable -> close keeps`,
that set `PATH=''` to make `ps` unresolvable. With `psBin()` = absolute `/bin/ps` (S6a, as written) they now **FAIL on the HEAD module**
(`S6a/wsl/wsl-a7.log`: `FAIL A7 ps unresolvable -> null :: got=[]`, `FAIL ... close keeps :: {"removed":true}`; the other 4 pass,
and `wsl-a1` 63/63 passes). Addendum A.5 item 3 sanctions this exception ONLY for the two Windows `win-a7` checks (and `win-a7b`).
The same reasoning applies to the POSIX pair, but the plan neither sanctions it nor provides a `wsl-a7b`. S6d (Linux `/proc`
reader, no `ps` at all) would also make them meaningless. Needs an orchestrator decision before S8 (sign-off plus an additive probe that proves "scanner
unavailable -> null -> dir kept" through an injected `run`/`readProc` seam, which S6e-2/S6d add). I did not change any probe.

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| S6a-1 | tests pass because they do not exercise the new code (e.g. imports undefined, fakes ignore options) | `red-before-change.log`: 10 failures on the old code (missing exports, no clamp, no logging); each of 10 mutants flips a specific test to FAIL (`mutants.txt`), so the tests are sensitive to the behaviour |
| S6a-2 | a mutant "caught" only because it did not compile, or the file was left mutated | each mutant row shows a normal vitest `Tests N failed \| M passed` line and named failing tests; `restored=true` with identical sha before/after; `sha256sum` re-run after the whole mutant run equals `source.sha256` |
| S6a-3 | a constant defined with another spelling (`15000`) slips past the grep | the grep prints only the 7 constant lines and `T: exports the seven constants with the planned values` asserts the values |
| S6a-4 (grep) | the bare name appears in another form (template string, variable) | `spawn-sites.txt` lists every spawn/execFile call; the only execFile receives `file` from `powershellExe()`/`psBin()`; AND the live `win-plant` run, which does not care how the code is spelled, passes on 4 runtimes while the S4 module on v18 FAILs the same probe (`ms=20036` vs `538`) |
| S6a-4 (live) | win-plant passes because the planted binary is not found first on this machine | the negative control (branch module, same probe, same machine, v18) executes the planted cmd.exe (20 s wait, scan null); the kill-probe negative control shows the planted `taskkill.exe` actually ran (child survived) |
| S6a-5 | the spec typecheck is vacuous | 0 TS6059, 7 baseline semantic errors found, and the planted-error control prints TS2322 (`tsconfig.neg.json`, re-run this step) |
| S6a-6 | the path checker passes vacuously or against the wrong root | `cleanup-lines=134 > 0`; the wrong-root run exits 1 with 101 OUTSIDE-ISO; every live run's `[iso-guard]` line names the `s6a-tmp-*` scratch dir |
| Real TEMP | a test deleted another session's `sutradhar-cli-*` dirs | win-plant/kill-probe runs: real-TEMP list before/after identical (45 = 45, `snapshots/*`, `realtemp-same=yes` in `win-summary.txt`); final `ls E:/AI-Cache/tmp \| grep -c ^sutradhar-cli-` = 45; every `[cleanup]` path is under the ISO dir |

Processes started and confirmed ended: stand-in/dummy `node` children (win-plant, kill-probe) by their own handles/PIDs (`INFO stand-in exited=true`,
`child-exited=true`; the negative control's survivor was killed by its own handle: `INFO cleanup: killed own child by handle, exited=true`);
WSL probes removed their own `/tmp/tmp.*` in the same call. All `S6a-tmp*` ISO dirs deleted with the guarded form.
