# S7 - merged live verification (isolated), HEAD 4b12ad0 + fresh forced build

Everything below ran in Git Bash under the ISOLATION PREAMBLE (TEMP/TMP/TMPDIR/NODE_OPTIONS=--import guard/SUTRADHAR_CLI_DEBUG_CLEANUP=1 on the same command line).
No product code was changed. The CLI under test is `packages/sutradhar/dist/cli-bin.js` (sha256 `48c1756c0b7944351f9352151ab79c39d3ddc60382aa45278b3481e25a657ac4`, built from HEAD).
Isolated TEMP roots: `$SP/S7` (everything) and `$SP/S 7` (L1s, TEMP with a space). Both were created and deleted by this step (guarded form, adapted to the short names, see Deviations).

## Build (plan: forced build, 0 cached, fresh dist)
`build-evidence.txt`, `build-full.log`: `turbo run build --force --concurrency=1` (timeout 2400, start 06:45:27 end 06:46:12, 44.5 s), `Tasks: 20 successful, 20 total`, **`Cached: 0 cached, 20 total`**,
`df -h /e` 49G free before. dist mtimes moved from 04:43:51 (`dist-mtimes-before-build.txt`) to 06:46:06/08 (cli/dist, sutradhar/dist).
`grep -c "stopSpawnedChrome\|discardSpawnedProfile\|removeSessionTempProfile" dist/cli-bin.js` = **11** (>= 3).

## AC table
| AC | result | evidence |
|---|---|---|
| L1 (10x nav+close on the bundle: exits 0/0, tempProfile true, (ii), dir exists after nav and gone after close, Chrome PID gone, order phase kill -> state-cleared -> phase cleanup, state.json absent) | PASS (113 checks, 0 FAIL) | `harness.log` (`PASS L1 iter N: ...`), `logs/L1-*`, independently re-derived from the raw logs by `crosscheck-logs.txt` (10/10 pairs: created path == removed path, order true) |
| L1 timing AC: phase kill <= 10.5 s, phase cleanup <= 15.5 s, scan max <= 4 s | PASS | `harness.log` TIMING lines: kill p50 345.5 / max 425 ms; cleanup p50 515.5 / max 599 ms; scan p50 495 / max 574 ms (n=11); the in-flight-rm flag never occurred |
| L1s (TEMP `$SP/S 7`, 2 iterations, space in TEMP) | PASS (23) | `harness.log`, `logs/L1s-*`; 8.3 sub-case dropped per plan |
| L2 (3x on `packages/cli/dist/cli.js`) | PASS (33) | `harness.log`, `logs/L2-*`; `crosscheck-logs.txt` |
| L3 (in use) | PASS (19) | NEG315 survived 3 sessions with `decision ... reason=in-use` in each sweep log; direct `removeSessionTempProfile` -> `{removed:false, reason:'in-use'}`; P4 criteria: `pre=283 entries, missing=[]`, lockfile present, `/json/version` answers; attribution `L3-attribution.txt` (10 processes, all `inTree=true`, none is the harness); own Chrome killed only after the live CIM CommandLine ownership check, exited within 15 s; the same call then `{removed:true}` |
| L4 (stale sweep) | PASS (7) | STALE1 removed (`removed path=...STALE1` in the nav log); YOUNG1 (`too-young`), `not-sutradhar-1700000000003`, `sutradhar-downloads` kept |
| L5a (P0) | PASS (4) | exit 1, `Failed to spawn Chrome (EFTYPE)`, `created` and `removed` lines name the same path, no dir left |
| L5b (P2x) | PASS (5) | exit 1 in 1.17 s (< 8 s), `Chrome exited (code 9) before it was ready`, `discard ... alive=false` (the no-kill branch) and no `phase kill`, dir created then removed |
| L5c | N/A live | unit-only (G5), as planned |
| L7 (mutant `cli-bin.mutant.js`, cleanup call disabled, exactly 1 replacement, marker count 1) | PASS (7): the dir REMAINS after the mutant close | `harness.log` L7 lines; `crosscheck-logs.txt` last row: the mutant close log has `phase kill` + `state-cleared` but NO `phase cleanup`; leftover removed via `removeSessionTempProfile`; mutant file deleted; real `cli-bin.js` sha256 identical before/after (`48c1756c...`) |
| L9 (interrupted close) | PASS (7) | CLI child killed (`signal SIGTERM`) right after `state-cleared` appeared; cleanup had NOT finished (dir existed after the interrupt); `state.json` absent; second `close` -> `No active session.` exit 0, no `phase kill`; Chrome gone; dir removed afterwards by `removeSessionTempProfile` |
| L12 (legacy state + open dialog) | PASS (11) | close exit 0 in 238 ms, `Session closed.`, warning `a confirm dialog is open`, **`state.json` ABSENT**, the Chrome not killed (legacy, as on master), killed by the harness after the ownership check, dir removed |
| L12 mutant (M-O6 via `cli-bin.mutant-o6.js`, exactly 1 replacement) | PASS (12): L12 FAILS on the mutant as required | the same flow on the mutant leaves **`state.json` present** after `Session closed.` (`PASS L12m EXPECTED under M-O6: state.json REMAINS`); mutant deleted, real sha256 unchanged |
| R1 `verify-fr2-04-dialogs.mjs` | PASS: 111 passed, 0 failed, 2 skipped (skips are the script's own, parked-feature/covered-elsewhere) | `R1.log`, `R1-evidence/live-summary.json`; N11 `close-fast-with-warning` and N11b `legacy-no-chromePid-close-fast` + `GAP-227-no-profile-warning-correct` PASS. N11b state check: **not observable** (the script deletes its `STATE_ROOT` at exit), L12 is authoritative. No non-close failure, so the S5-worktree comparison is "not needed" |
| R2 `verify-fr2-01-wait-states.mjs` (whole script, it has no filter) | PASS: mcp 28, cli 12, sdk 8, 0 FAIL; `teardown-close-kills-chrome` and `cleanup-no-leaked-profile-dirs-left-by-us` PASS; lingering Chrome count 0 | `R2.log`, `R2-evidence/` |
| (i) canary swept by the first session start | PASS | `path-and-guard-checks.txt`: `removed path=...sutradhar-cli-1700000000009-CANARY` in `logs/L1-nav1-1.stderr` |
| (ii) dirname(userDataDir) == ISO | PASS | asserted in every L1/L1s/L2 iteration |
| (iii) check-cleanup-paths | PASS | `path-and-guard-checks.txt`: ISO root, 45 CLI logs + `harness.log`: `cleanup-lines=271 outside-iso=0` exit 0; `$SP/S 7` root, L1s logs: `cleanup-lines=20 outside-iso=0` exit 0; negative control (L1s logs against the wrong root) `outside-iso=1`, exit 1. R1 (the script keeps the CLI stderr only inside its result records): `R1-pathcheck.txt` 32 lines, 0 outside, exit 0 |
| (iv) real-TEMP snapshots | PASS | `realtemp-before.txt` (45) vs `realtemp-after.txt` (45): IDENTICAL (`final-state.txt`); per-case `REALTEMP ... disappeared=[] appeared=[]` lines in `harness.log`; R1/R2 before/after lists also identical |
| Guard lines present | PASS | 49 `[iso-guard]` lines in `logs/*.stderr`, plus one in each of `harness.log`, `R1.log`, `R2.log`; 0 `ISOLATION GUARD` lines in any log |
| No PID of ours is alive | PASS | `leftover-processes.txt`: CIM query for command lines referencing the S7 dirs = 0 (re-run after the last case) |

## Measured timings (for the S10 changelog placeholders; L1, n=10, Windows, Node 25, headless Chrome)
| value | measured |
|---|---|
| **`<CLOSE_P50>`** = p50 of the whole `close` command | **1092 ms (about 1.1 s)**, max 1254 ms |
| **`<SWEEP_P50>`** = p50 of `phase sweep ms=` across the 10 L1 session starts | **0 ms** (9 of 10 starts had no stale-named candidate, so no process query ran; the one with the canary took 496 ms) |
| `phase sweep` when a stale-named candidate exists (L1-nav1, L3 x3, L4; n=5) | 496, 502, 511, 513, 519 ms, so about 0.5 s (dominated by one Windows process query, `scan ms` 483-519) |
| whole `nav` that starts a session | p50 843 ms, max 1335 ms |
| `phase kill` | p50 345.5 ms, max 425 ms |
| `phase cleanup` | p50 515.5 ms, max 599 ms |
| `scan` (nav + close, n=11) | p50 495 ms, max 574 ms |

Worst cases vs the plan's caps: every observed maximum is far inside its cap (kill 425 ms vs 10.5 s; cleanup 599 ms vs 15.5 s; scan 574 ms vs 4 s; sweep 519 ms vs 15 s). The cap paths themselves (deadline hit, slow rm, 10 s kill cap) are NOT reachable live in a healthy run; they are covered by unit tests T1-T5, O4, O8 (not re-run here). Nothing is flagged for S8. Suggested wording for S10: "measured about 1.1 s in total" for close, and "typically under a millisecond when there is nothing to sweep, about half a second when a stale temp dir exists" for the sweep.

## Deviations from the plan text (all harness-side; no product code touched)
1. **Short isolation names (P5).** The CLI names its own profile `sutradhar-cli-<13 digits>-<6 chars>` (34 chars), so `$SP/S7-tmp` would give a 202-char `--user-data-dir` (> 200). ISO is `$SP/S7` (profile path 198) and the space case is `$SP/S 7` (199) instead of `$SP/S7-tmp-sp dir/tmp`. The harness asserts the length before every launch. The guarded delete uses `case "$ISO" in "$SP"/S[0-9]|"$SP"/"S "[0-9]` instead of `S[0-9]*-tmp`. The path checker is run once per root (the `S 7` logs against the `S 7` root).
2. **R block home isolation (plan says `USERPROFILE=$ISO/home HOME=$ISO/home`).** That cannot work: Chrome does not start when `USERPROFILE` is overridden (also documented in `packages/cli/src/state.ts`). Attempt 1 (kept as `R1.attempt1-USERPROFILE-override.log`) failed at `L0.nav` with `Timed out waiting for Chrome to start`. Root cause proven by `chrome-envprobe.txt` (plain Chrome, no CLI): E0 short/no override up; E1 USERPROFILE+HOME override NOT up; E2 217-char path/no override up (so it is not path length); E3 override NOT up; E4 USERPROFILE only NOT up; E5 HOME only up. Attempt 2 keeps the plan's intent (node-side `os.homedir()` points into `$ISO/home`, every `ProfileManager` write lands there) with a harness-side preload (`home-shim.mjs`, `--import` in NODE_OPTIONS, USERPROFILE untouched). `R-precheck-shim.txt`: `os.homedir()` prints `$ISO/home` for default and named imports. Proof that it worked: `$ISO/home/.sutradhar/profiles.json` (20 bytes) existed after R1 (`R1-post-checks.txt`), and the real `C:/Users/Varad M/.sutradhar/profiles.json` sha256 `1a6b10f3...` is identical before/after R1 and R2. The plan's other precheck (grep for write targets) passed (`R-prechecks.txt`: only `STATE_ROOT` under `os.tmpdir()`; evidence dirs default to `os.tmpdir()`).
3. **Page server is a child process** (`s7-pages-server.mjs`): the harness uses `spawnSync` and an in-process server would be blocked by it (first smoke run: nav timeouts). Its PID is in `our-pids.txt`; it is stopped through its own handle.
4. **L12 page** calls `confirm()` 300 ms after load (`setTimeout`) so `nav` itself is deterministic; the dialog really was open (the close warned `a confirm dialog is open`).
5. **R1 attempt 1 ran in an ISO that still held the harness's leftovers** (my process-existence pre-check script had a quoting bug, so the guarded delete in that command did not run). It failed before any case that matters and its output is kept only as the root-cause evidence in 2. The ISO was then deleted and recreated for attempt 2 and for R2.
6. Build took 44 s, nowhere near the 2400 s cap.
7. The P3 grep: `grep -n "/tmp" gap315-live-merged.mjs s7-pages-server.mjs` has one hit, the hard-coded Windows path `'E:/AI-Cache/tmp'` (REAL_TEMP, read-only snapshots); no Git Bash POSIX temp dir is used anywhere.

## Not verified / limits
- "No kill" on P2x (L5b) cannot be observed from outside (a kill of an exited PID leaves no trace). Live evidence is the `discard ... alive=false` line and no `phase kill`; the authority is unit test G4, re-run fresh here: `unit-g4-o2.log` (spawn-failure-cleanup + close-session specs, 26/26).
- The O2 race (L9): the cleanup had not finished when the kill landed, so L9 exercised the interrupt itself rather than the "already finished" branch.
- Slow/locked-dir paths (deadline reached, in-flight rm) are unit-only (T1-T5, N4-a); the S7 maxima are healthy-case numbers.
- Windows + Node 25 + Chrome headless only (S4/S6e-3 covered Node 18/20/22; WSL is not part of S7).
- A recorded Chrome PID (78676) briefly showed up as a `node.exe` in `tasklist` during the end-of-run PID sweep and was gone seconds later (PID reuse by an unrelated short-lived process; the CIM CommandLine rule decides ownership and nothing was killed).

## False-pass analysis (each query below was re-run live after the cases; outputs are in the named files)
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| L1/L2/L1s (dir gone after close) | the dir vanished through the next session's sweep, not through `close`; or the harness read a stale `existsSync` | L7: with the cleanup call disabled in a sibling bundle the dir REMAINS (`crosscheck-logs.txt` last row, `harness.log` L7). Independently of the harness's `exists()`, `node crosscheck-logs.mjs logs` re-derives from the raw logs that every close log contains `removed path=` for the SAME path the nav log `created` (pairs=16 bad=0), and its negative control (a log with the `removed` line deleted) exits 1 (`crosscheck-negative.txt`) |
| L1 order line | the order is only asserted in memory | the raw close logs are re-read by the cross-check (`order(kill<cleared<cleanup)=true` for every pair) |
| L1 timing | numbers taken from the wrong clock or a different phase | every number is the CLI's in-process `phase ... ms=` (performance.now) line; the whole-command time uses `performance.now()` in the harness; no wall-clock mixing |
| L3 in-use | the probe itself or another session's Chrome is what makes the dir "in use"; or `removed:false` for another reason (S4 mutant M2 returned `removed:false` while deleting 106 entries) | P4 criteria: the 283 pre-call entries are re-listed and `missing=[]`, lockfile present, `/json/version` answers; `L3-attribution.txt` lists every process whose live CommandLine references the basename: all `inTree=true` of OUR Chrome, none is the harness; after the kill the same call returns `removed:true`, so the dir was only kept because the Chrome was alive |
| L4 | STALE1 removed by accident of age | the sweep log shows `removed path=...STALE1` and `too-young` for YOUNG1; the non-matching names are listed as kept |
| L5a/L5b | the dir was never created, or it is left and just not looked at | `created path=` and `removed path=` lines name the same path; the ISO directory listing before/after is identical; the exit codes and EFTYPE / `Chrome exited (code 9)` text are from the CLI itself |
| L7 / L12 mutants | the mutant file did not really change behaviour | `occurrences-replaced=1 marker-count=1` printed by the harness for each; behaviour differs from the real bundle in the same flow (dir remains / state.json remains) and the real bundle's sha256 is identical before and after |
| L9 | the CLI child exited by itself before the kill (so nothing was interrupted) | the harness only kills after the streamed `[cleanup] state-cleared` line; exit info is `signal SIGTERM, code null`; the dir still existed afterwards (cleanup had not finished) |
| L12 | `state.json` absent because `close` was never run, or the dialog was not open | `close` exit 0 + `Session closed.` + the dialog warning; on the M-O6 mutant the identical flow leaves state.json present, so the check can fail |
| R1/R2 | ran against the real home or real TEMP | `R-precheck-shim.txt`, `$ISO/home/.sutradhar/profiles.json` created, real `profiles.json` sha256 unchanged (`R1-post-checks.txt`, `R2-post-checks.txt`); real-TEMP lists identical |
| (iii) path check | passes vacuously | `cleanup-lines` is 271 / 20 / 32 (not 0), the canary line exists, and the wrong-root control exits 1 |
| isolation guard | guard lines missing, so the step did not run isolated | 49 `[iso-guard]` lines in the CLI logs, one per harness/R log; the harness also asserts `os.tmpdir()` under the scratchpad in its own code |
| real-TEMP equality | another session happened to add and remove a dir | lists are byte-identical (`diff` empty); 4 pre-existing entries have a newer mtime (owners still running), recorded in `final-state.txt`; none was created by us (all 45 names pre-existed) |
| no leftovers | CIM query silently empty | the query script (`procs-under.mjs`, kept in the scratchpad) is not vacuous: before it was fixed it reported 3 hits that were the shell command lines containing the S7 path text (P7), so it does see command lines; the final run reports 0 and `leftover-processes.txt` is from after the last case |

## Reproduce
`gap315-live-merged.mjs` (sha256 in `harness.sha256`) + `s7-pages-server.mjs`, under the preamble with `S7_SP`, `S7_WT`, `S7_EV`, `CASES`, `ITER` (S11-8c can run it unmodified with `CASES=L1 ITER=1`). The harness prints per-check PASS/FAIL, a `results.json`, and `our-pids.txt`.
