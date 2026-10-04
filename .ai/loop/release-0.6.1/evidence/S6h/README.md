# S6h - T5 made deterministic (F-S8-4; test only; plan-review-B F5 + F6)

Only file changed besides evidence: `packages/cli/tests/unit/temp-profile.spec.ts` (the T5 test). No product file changed (`temp-profile.ts` sha256 `346572f5...` before, after every mutant run, and at commit).
The injected-`now` option of B.1 is NOT possible test-only (`removeWithRetries` reads `performance.now()` directly); per B.3 F5 the debug-line method is used.

## Change
T5 sets `SUTRADHAR_CLI_DEBUG_CLEANUP=1` (restored in `finally`), spies on `process.stderr.write`, and asserts on the `[cleanup] rm-attempt ... path="<dir>" ... remaining-ms=N` lines the MODULE wrote:
at least one attempt, and every `N >= MIN_RM_START_MS` with zero slack (`remaining-ms` is the very variable the module's `remaining < MIN_RM_START_MS` check used). The fake `rmFn`'s own clock reading is only
`console.info`-logged (`T5 INFO: module remaining-ms at each attempt=1999,1322; the fake's own reading=...`), never asserted. The fake now fails after 400 ms (was 600), so (400 ms + the 250 ms retry pause) a third
attempt would start at about 700 ms left: that is what lets a deadline check weaker than `MIN_RM_START_MS` be caught. `MIN_RM_START_MS === 1000` is pinned by the existing "exports the seven constants" test.

## AC table
| AC | result | evidence |
|---|---|---|
| T5 passes on the real code | PASS | `t5-green-unloaded.log`: `T5 INFO: module remaining-ms at each attempt=1999,1322 ... Tests 1 passed`; full cli suite `test-cli-full.log`: `Test Files 21 passed`, `Tests 360 passed \| 2 skipped` |
| Deterministic: no wall-clock threshold; asserted on the module's own value | PASS | the assertion is `remaining-ms >= MIN_RM_START_MS` on logged values; see "RED BEFORE" for the demonstration that the OLD T5 fails on a behaviour-preserving latency and the NEW one does not |
| RED BEFORE (old T5 is load-sensitive) | PASS (confirmed) | `loadsim-OLD-t5.txt`: with `LOAD-SIM-80ms-gap` (the module unchanged except 80 ms of extra latency between its own deadline check and the fake's reading, i.e. what a loaded runner does) the verbatim OLD T5 FAILS (`1 failed`, `caught=true`) while it passes on the real code (control A); `old-t5-control.spec.ts.txt` is that verbatim old test (a scratch spec, deleted, never committed) |
| NEW T5 survives the same simulated latency | PASS | `loadsim-NEW-t5.txt`: `LOAD-SIM-80ms-gap: exit=0 ... 1 passed` (`MUTANT-RUN-PROBLEM` there is only the runner's "no failure" flag: this is a must-PASS control) |
| Mutant M-b (`remaining < MIN_RM_START_MS` -> `remaining < 0`) still fails T5 | PASS | `mutants-S6h.txt`: `M-b: 1 failed \| 54 passed (55)`, FAILED T5, `restored=true`; `M-b-detail.txt`: `AssertionError: expected 661 to be greater than or equal to 1000` |
| M-b's detection depends on a third attempt landing in [0, 1000) ms: it does in the unloaded run | PASS (recorded) | `M-b-detail.txt`: the third attempt's logged remaining-ms is 661; also M-b2 (`< MIN_RM_START_MS / 2`) fails T5 (the attempt at ~700 ms is above 500), M-b3 (constant 1000 -> 100) fails "exports the seven constants" (+T3), M-b4 (the `rm-attempt` debug line removed) fails T5 and T6. Under a very loaded runner the third attempt could land after the deadline and M-b/M-b2 would then not be detected by T5 on that run; the real-code assertion can never fail from load |
| 20/20 consecutive runs of T5 under a CPU-load generator (supporting evidence only) | PASS | `load/load20.log`: `RESULT pass=20 fail=0 elapsed=58s`; generator: 32 logical cores -> 16 workers (= half), CPU `6%` idle -> `63%` under load (`load/load20.log`), positive control `marker-processes=16` before the runs |
| F6 generator safety | PASS | workers self-terminate after 270 s (< 5 min, `LOAD_SELF_MS`, `load/s6h-load.mjs`), 16 PIDs logged (`load/loadgen-pids.txt`), stopped by PID only after a live CIM CommandLine marker check (`load/s6h-load-stop.mjs`: `ownership confirmed by marker, taskkill status=0` x16), marker random per run and never in a launching command text; final leftover query `marker-processes=0`; nothing killed by image name |
| tsc, spec typecheck, isolation | PASS | `tsc.txt` empty (exit 0); `spec-tsc.txt.summary` `SPEC-TSC-SAME-AS-S5-BASELINE`, 0 errors in changed specs, planted TS2322 reported; 52 `[iso-guard]` lines, 0 `ISOLATION GUARD`; `pathcheck.txt` `cleanup-lines=395 outside-iso=0` (404 before: T5 now captures its own stderr; T5 itself asserts the logged path equals `path.resolve(d)` under its own scratch root) |
| Real TEMP untouched | PASS | `realtemp-compare.txt`: before/after sorted `sutradhar-cli-*` identical (45) |

## Deviations
1. **First load run was vacuous and was caught by the positive control.** The generator's workers read the duration from the wrong `argv` index (NaN) and exited at once, then (second bug) plain children die with the controller on this machine (`detached: true` needed). The positive control (`marker-processes=0`, CPU 5%) exposed both; the first run's log is kept in `load/attempt1-vacuous-load/`. The reported 20/20 is from the fixed generator (16 workers found, CPU 63%).
2. The load run (20 vitest invocations) is supporting evidence; the determinism claim rests on the module-value assertion plus the old-fails/new-passes latency control.

## False-pass analysis
| AC | how it could pass while broken | what rules it out |
|---|---|---|
| T5 green | the debug lines never reach the spy (so a vacuous loop passes) | `attempts.length >= 1` is asserted on lines filtered by `path="<this dir>"`; M-b4 (the `rm-attempt` line deleted) fails T5; the INFO line shows the real values `1999,1322` |
| T5 detects a weakened deadline | the mutant ends before a third attempt starts | `M-b-detail.txt`: the third attempt is logged at 661 ms and trips the assertion; M-b2 (threshold 500) also fails; recorded that this needs the third attempt before the deadline (true here, 4+ runs) |
| deterministic | it is only "usually passes" | the NEW assertion has no wall-clock bound at all (values from the module); the 80 ms latency control proves the OLD form fails where the NEW form passes; 20/20 under load is supporting only |
| load run is real | the generator did nothing (it did, in attempt 1) | positive control `marker-processes=16` + CPU 63% in `load20.log`; attempt 1's log shows what a vacuous run looks like |
| mutants restore | a mutant stays in the tree | `restored=true` for each; `sha256sum packages/cli/src/temp-profile.ts` = `346572f5...` after the runs |
| real TEMP / leftovers | another session masked a change; leftover query is vacuous | lists identical; load query has a positive control (16 found) before the final `0`; CIM queries for the S6g/S6h ISO paths = 0 |
