# S8 - post-merge independent acceptance audit: GAP-315 + GAP-349 + close/recovery ordering (merged HEAD bff46db)

Auditor: independent (built none of it; not the S4 auditor). 2026-10-04. Worktree `$WT`, branch `release/0.6.1`, HEAD `bff46dbcf009...`.
No tracked file was edited, nothing committed. Writes: `evidence/S8/` and `$SP/S8*` only (all `$SP/S8*` ISO dirs deleted with the guarded form, `iso-cleanup.txt`).
This is GAP-315 audit **#2** (S4 was REOPEN).

## 1. Verdict: **REOPEN** (one blocking finding, test-only; no product defect found)

- **F-S8-1 (BLOCKING by the [B] O-item rule; severity MEDIUM, test adequacy):** the O7 source guard (b) in
  `packages/cli/tests/unit/close-session.spec.ts` gives a **false pass** for the plan's own mutant **M-O6** ("the no-chromePid
  `clearState()` moved inside `if (!closeBlocked) {}`") when the clear is placed as the **last statement** of that block (the most
  natural form of the move). Root cause: line 177 compares `clearAt` with `cb + cbBlock.length - 1`, where `cb` is the index of the
  `if` keyword, not of the block's `{` (19 characters later); a clear in the last ~19 characters of the block passes. The builder's
  M-O6 put the clear deep inside the `try`, so the off-by-offset was never exercised. Product code is correct today (live L12 re-run
  PASS, L12m mutant detected), but the CI regression net for N11b/L12 has a hole. The spec is wrong, not the implementation.
- Everything else re-derived independently PASSES (table 2): every S4 probe on 4 Windows runtimes + WSL (only the two sanctioned PATH
  pairs fail and their replacements pass), live Chrome/Edge headless/headed A4 with the A.6 P4 criteria, win-plant on v18/v20/v22/v25,
  N1 probes, 40 of 41 independently written mutants, full test matrix (no regression), S7 harness re-run unmodified (256/256),
  auditor live cases B1/B4/B5/C4, Linux (Node 20) runs of the new specs (4x, deterministic).
- Non-blocking: F-S8-2 (exit code on a failed state clear differs from 0.6.0), F-S8-3..F-S8-6 (section 4).

**Required fix for F-S8-1** (test only, one hunk): in guard (b) use the block's opening brace:
`const cbOpen = elseBlock.indexOf('{', cb); expect(clearAt).toBeGreaterThan(cbOpen + cbBlock.length - 1);`
Re-verify with the variant in `M-O6-variant-cmdClose.txt` (must FAIL (b)) and the builder's variant (must still FAIL).
Under section 2 rule 4 this is failure #2: the orchestrator decides on the re-plan; my root-cause hypothesis is above.

## 2. Per-item results (checklist section 5 + A.5-A.7, on merged HEAD)
| item | result | evidence (command -> output excerpt) |
|---|---|---|
| Probe integrity A.5-2 | PASS | `(cd evidence/S4/probes && sha256sum -c ../probes.sha256)` -> 28 x `OK` (`probes-sha-check.txt`); `wsl-a7b.mjs` sha `089482f3...` (matches), N1 probes `sha256sum -c probes-s6e4.sha256` 3 x OK |
| Module A.5-1 | PASS | `esbuild packages/cli/src/temp-profile.ts --bundle ... --outfile=$SP/S8/mod/temp-profile.mjs` -> `676162d0...` (`module.sha256`); same sha printed inside every WSL log; equals S6e-4's post module |
| dist freshness | PASS | `cli-bin.js` sha `48c1756c...` (= S7, unchanged after all runs); dist mtime 06:46:08 > newest src mtime 06:40:01 / last src commit 06:41:18; dist contains `not-a-directory`, `owner-unknown`, `skip-kill reason=invalid-chromePid`, `readProcCommandLines` |
| A1 [B] scope | PASS | win-a1 66/66 x4 runtimes; `OBS file-named-like-profile removed=false` x4 (N3 fixed); wsl-a1 63/63 |
| A2 [B] link as candidate | PASS (flipped) | win-a2 6/6 on v25/v18/v20/v22 (S4: 2/6); wsl-a2 4/4 |
| A3 [B] link inside candidate | PASS | win-a3 12/12 x4; wsl-a3 7/7 |
| A4-pre [B] lock signal | PASS | 4 modes x 4 runtimes: `[v18] PASS A4-pre rm(lockfile) rejects EBUSY/EPERM :: code=EBUSY`; Chrome/154.0.8037.97, Edg/154.0.4258.53 |
| A4 [B] no partial delete (P4) | PASS | each mode 83/83: `PASS A4 close no file missing :: count 222->263 ... missing=[]`, `A4 close removed:false`, `/json/version still answers`; lockfile is in the pre-call snapshot. Discriminates: M2 mutant module -> `FAIL A4 close no file missing :: count 222->114` (`browser-chrome-headless-MUTANT-M2.log`) |
| A5 [B] rule 2 | PASS (flipped) | win-a5 20/20 x4 incl. `PASS A5 upper: in-use with real scan`; win-a5case v25 2/2 (`module scan keeps it`); wsl-a5 6/6; attribution = stand-in only |
| A6 [B] rule 3 | PASS | win-a6 5/5 x4; wsl-a6 3/3 |
| A7 [B] fail closed | PASS (with sanctioned pairs) | win-a7 `5 PASS 2 FAIL` x4; the 2 FAILs are exactly `A7 powershell unresolvable -> scan null` / `-> close keeps`; wsl-a7 `4 PASS 2 FAIL` = the 2 sanctioned `ps unresolvable` checks. Replacements: **win-a7b (auditor-written, `probes-s8/win-a7b.mjs`, sha `4cbca689...`) 8/8 x4**; wsl-a7b 18/18. win-a7b discriminates: fail-open module -> `FAIL A7b ... got=array(0)`, `close keeps ... {"removed":true}` |
| A9 [B] WSL guard | PASS | every WSL log `[wsl-guard] root=/tmp/tmp.*`, `mnt-cleanup-paths=0`, roots under `/tmp/` |
| F3 / win-plant (A.7) | PASS (flipped) | v18: `planted scan took ms=526 ... -> array(35)`, both PLANT checks PASS (S4: 20033 ms, null); v20/v22/v25 PASS. M-F3 module on v18 -> `ms=8035 ... -> null`, `FAIL PLANT: scan unaffected` |
| N1 probes | PASS | win-n1 14/14 x4; wsl-n1 14/14 |
| B1 [B][S8] two sessions | PASS | `live/harness.log`: concurrent navs exit 0, distinct dirs; both dirs backdated 25 min, third session's sweep: `A=in-use,in-use B=in-use,in-use`, `missA=[] missB=[]`; both still `eval` 42; concurrent closes remove only their own dir; third session survives |
| B2 [B] | PASS | browser runs `B2 real-scan sweep keeps backdated live dir as in-use` x16; wsl-a5 B2 |
| B3 [S8] bounds | PASS | S7 re-run: `phase-kill p50=370 max=411`, `phase-cleanup p50=555 max=630`, `scan max=611`, whole close p50 1174.5 ms; all loops `performance.now()` (code review section 3) |
| B4 [S8] 50 + ~200 MB | PASS | `INFO B4 phase sweep ms=825 removed=51 kept-deadline=0` |
| B5 [S8] TEMP mismatch | PASS | close exit 0, `Warning: could not remove temp profile ... (not-auto-temp)`, dir kept, state cleared, Chrome gone |
| O1-O10 [B][S8] | PASS | close-session.spec 14/14 (Windows and Linux) |
| O mutants M-O1..M-O6 (+M-O7, M-O7-pid) | **FAIL (M-O6 variant survives)** | `mutants.txt`: M-O1 (5 failed), M-O2, M-O3, M-O4-default (O8), M-O4-wiring (O6), M-O5 ((a)) CAUGHT; **`## M-O6: vitest-exit=0 0 failed | 107 passed ... CAUGHT=false`**; re-confirmed on close-session.spec alone: `(b) ... OUTSIDE if (!closeBlocked)` passes with the clear inside the block (`M-O6-variant-close-session.log`) |
| O live (L1 order, L9, L12, L12m) | PASS | S7 harness re-run: L1 order lines 10/10; L9 `state.json absent`, `second close ... No active session.`; L12 state.json absent; L12m detects M-O6 live |
| O auditor checks | PASS | kill function vs merge: only `'taskkill'` -> `taskkillExe()` (+ optional seam param); `/PID <pid> /T /F` and the POSIX `-pid`->`pid` SIGKILL fallback identical to master; `git diff origin/master...HEAD -- packages/cli/src | grep -E "^[+-].*(process\.exit|exitCode|printErrorAndExit)"` -> nothing; kill sites: only `deps.kill` in `stopSpawnedChrome` and `(deps.kill ?? killChromeTree)` in `discardSpawnedProfile`; `grep -n "killChromeTree(" src/*.ts` = 1 (definition) |
| G1-G6, G3b [B][S8] + M-G1..M-G8, M-seam | PASS | spawn-failure-cleanup.spec 12/12 (Windows, Linux x4); all 9 mutants CAUGHT; live L5a (EFTYPE, created==removed) and L5b (`Chrome exited (code 9)` in 1253 ms, `alive=false`, no kill phase) PASS in the S7 re-run |
| C4 [S8] FR2-14 | PASS | project-config-cli.spec (GAP-356 guard) 32/32; live `.sutradhar.json` viewport -> `eval innerWidth+'x'+innerHeight` = `901x677`, close exit 0, dir removed (`live/harness-C4.log`; first attempt was a harness bug, see 6) |
| C5-live (a)(b)(c)(d) | PASS | wsl-c5a 3/3 (pad 70000), wsl-c5b 5/5, A2/A3 WSL victims intact, wsl-port `# pass 19` |
| C6 | PASS | every `sweepStaleTempProfiles(`/`removeSessionTempProfile(` in specs passes `tmpRoot` (multi-line calls read) |
| A.7 mutants (F1, F2, F3, N1, N2, N4, S4 M1-M6) | PASS | M-F1a, M-F1b, M-F1c, M-F1c-only-recheck (F1-e), M-F2, M5, M-F3, M-F3-kill, M-N1, M-O7, M-T10, M1, M2 (N4-a), M3, M4, M6 all CAUGHT; S6a M-a..M-f CAUGHT; S6d `/proc`->`[]` mutants CAUGHT. 40/41 total |
| X1 [B] | PASS | every Windows log `pathcheck=0`; live harness `cleanup-lines=302 outside-iso=0` (neg. control wrong root `outside-iso=252`, exit 1); S7 re-run `272/0` + `S 7` root `20/0` (neg. exit 1); matrix cli log `404/0`; WSL logs checked against their own `PROBE_ROOT` with `MSYS_NO_PATHCONV=1` |
| Real TEMP | PASS | `snapshots/realtemp-start.txt` = `realtemp-end.txt` (45 = 45, byte-identical); every per-probe before/after pair identical; 4 entries have a newer mtime than my start stamp (pre-existing names; owners running; same 4 as S7 recorded) |
| Full suite / regressions | PASS | `bash evidence/S1/matrix.sh.txt S8`: all 20 entries exit 0; every package total equals S1 except cli 243 -> `349 passed | 2 skipped` (+108 new tests) (`test-totals.txt`) |
| tsc / spec typecheck | PASS | `tsc --noEmit -p packages/cli` exit 0; spec typecheck = the 7 baseline errors (`SAME-AS-S5-BASELINE`), 0 TS6059, planted TS2322 reported |
| Linux CI determinism | PASS | WSL Ubuntu Node 20.20.2, vitest 1.6.1, `@sutradhar/browser` aliased to a stub: 7 files `122 passed | 3 skipped`; the 5 new spec files 3 more times `104 passed | 3 skipped` each (skips: N4-a, F3-c Windows, D10) |
| Leakage of test seams | PASS | `dist/index.js` and `dist/mcp-cli.js`: `killChromeTree`=0, `sweepStaleTempProfiles`=0; cli `index.ts` exports only state helpers; `@sutradhar/cli` is private |
| Commits <-> steps | PASS | 12 commits map 1:1 to S5, S5-evidence, S6a, S6b (incl. N2), S6c, S6d, S6e-1..5, S7; S5 merge = 11 files; new src files mode 100644, evidence `.sh` 100755 |

## 3. Probe matrix (PASS/total per runtime; HEAD module `676162d0...`)
| probe | v25 | v18 | v20 | v22 | WSL Node 20 |
|---|---|---|---|---|---|
| win-a1 / wsl-a1 | 66/66 | 66/66 | 66/66 | 66/66 | 63/63 |
| win-a2 / wsl-a2 | 6/6 | 6/6 | 6/6 | 6/6 | 4/4 |
| win-a3 / wsl-a3 | 12/12 | 12/12 | 12/12 | 12/12 | 7/7 |
| win-a5 / wsl-a5 | 20/20 | 20/20 | 20/20 | 20/20 | 6/6 |
| win-a5case | 2/2 | - | - | - | - |
| win-a6 / wsl-a6 | 5/5 | 5/5 | 5/5 | 5/5 | 3/3 |
| win-a7 / wsl-a7 | 5/7 (2 sanctioned) | 5/7 (2 sanctioned) | 5/7 (2 sanctioned) | 5/7 (2 sanctioned) | 4/6 (2 sanctioned) |
| win-a7b (S8) / wsl-a7b (S6e) | 8/8 | 8/8 | 8/8 | 8/8 | 18/18 |
| win-plant | 2/2 | 2/2 | 2/2 | 2/2 | - |
| win-n1 / wsl-n1 | 14/14 | 14/14 | 14/14 | 14/14 | 14/14 |
| wsl-c5a / c5b / port | - | - | - | - | 3/3, 5/5, 19/19 |
| browser chrome-headless / chrome-headed / edge-headless / edge-headed (child per runtime) | PASS | PASS | PASS | PASS | n/a (83/83 per mode) |
| mutant controls | M2 -> A4 FAIL; FAILOPEN -> a7b FAIL | M-F3 -> plant FAIL | | | |

## 4. Adversarial diff review (`git diff origin/master...HEAD -- packages/`) and findings
Reviewed: data-loss paths, symlink/junction/TOCTOU, fail-open branches, PID reuse / wrong kills, deadline clock, exit codes, Linux
determinism, API leakage.
- Data loss: every delete is gated by rule 1 (name regex + direct child of `os.tmpdir()`), `lstat` real-dir check (facts and again
  right before each rm attempt), scan-null keeps, invalid marker keeps, Windows lockfile probe. `rm(dir,{recursive})` unlinks inner
  links without following (A3). Residual: a sub-millisecond window between the re-check and `rm(<dir>/lockfile)`; exploitable only by
  the same user who can delete the victim directly. Not a finding.
- Fail-open: none found. Scan reject/timeout/unreadable `/proc`/no readable cmdline -> `null` -> keep; `isAlive` throwing -> `error`
  (keep) or sweep aborted (keep).
- Wrong kills: no new kill site; P2x does not kill an exited child; malformed `chromePid` is never killed. The pre-existing stale-PID
  hazard (plan 1.5) is unchanged, logged for S10b.
- Clocks: all deadlines/loops on `performance.now()` (`waitForPidExit`, `readProcCommandLines`, spawn start loop, `removeWithRetries`,
  sweep, `stopSpawnedChrome` default and `cli.ts` wiring). `Date.now()` only for the dir name, marker `createdAt`, mtime age.

| id | severity | blocking | evidence | required fix |
|---|---|---|---|---|
| F-S8-1 | MEDIUM (regression net; O-item [B]) | **yes** | `mutants.txt` `M-O6 ... CAUGHT=false`; `M-O6-variant-cmdClose.txt` (clear is the last statement inside `if (!closeBlocked)`); `M-O6-variant-close-session.log` 14/14 pass | guard (b): compare with the block's `{` index (section 1); re-run both M-O6 variants |
| F-S8-2 | LOW | no | `live/harness.log` CLR: state.json held open without delete-share -> `close exit=0`, `Session closed.`, `Warning: could not clear the session state (EBUSY ...)`, state.json still has `chromePid=75560`; second close exit 0 with `phase kill` (re-kills the stale PID). 0.6.0 `cmdClose` ends in an unguarded `await clearState()` -> `main().catch` -> exit 1. Same for self-heal (0.6.0 failed the command; 0.6.1 continues) | keep 0.6.0's exit code (rethrow / `process.exitCode = 1` after the cleanup) or state it in the changelog, which as planned claims "CLI exit codes are unchanged"; the stale-PID consequence is the existing 1.5 hazard |
| F-S8-3 | INFO | no | win-plant's 2nd PLANT check also passes under M-F3 (a hung planted binary makes the scan `null`, so close keeps): `win-plant-mutF3-v18.log` `1 PASS 1 FAIL` | none; only the 1st PLANT check discriminates |
| F-S8-4 | LOW (test robustness) | no | T5 asserts each rm attempt starts with >= 975 ms left, but an awaited `lstat` sits between the 1000 ms check and the fake's measurement; on an overloaded runner the 2nd attempt can land in the 25 ms gap. 4 Linux + 2 Windows runs passed | measure inside the module (debug line) or relax to >= 900 |
| F-S8-5 | INFO | no | P2x: the start loop now stops as soon as the child exits. A launcher stub that exits after handing off (not observed for Chrome/Edge with a fresh profile) would fail fast instead of polling 10 s | none; note in the changelog |
| F-S8-6 | INFO (process) | no | P5 <= 200 cannot be met by the unmodified S4 `win-browser.mjs` under `$SP` (minimum 203); ran at 205 (S4 ran at 213), Chrome and Edge started normally | none |

## 5. Builder claims spot-re-derived (skeptically)
1. S7 "`cli-bin.js` sha256 `48c1756c...`, marker grep 11": re-derived identical before and after all S8 runs.
2. S7 "close p50 ~1.1 s, kill max 425, cleanup max 599, scan max 574 ms": S7 harness re-run unmodified (sha `1b7091a9...`) gives close
   p50 1174.5 / kill max 411 / cleanup max 630 / scan max 611 ms, 256 PASS 0 FAIL. Consistent.
3. S6e-5 "S4 M1-M6 all fail against HEAD": re-derived with my own anchors: all CAUGHT (M2 only by N4-a, as claimed).
4. S6c "killChromeTree( once, no void/then, 0 floating promises": `greps.txt` and ESLint re-run `floating.txt` (empty, exit 0).
5. S6e "wsl-a7b 18/18 on HEAD": re-derived 18/18. S6e-4 "win-n1/wsl-n1 14/14": re-derived on all 5 runtimes.
6. S6b "no exit path changed": literally true (no exit statement diff) but incomplete: a failing `clearState` no longer exits 1 (F-S8-2).
7. S6b "all 6 mutants fail": true only for the builder's M-O6 placement (F-S8-1).

## 6. False-pass analysis of my own checks
| check | how it could pass while broken | what rules it out |
|---|---|---|
| S4 probes on HEAD | stale or wrong module (e.g. the S4 branch module) | module built from HEAD source (`module.sha256`: ts `346572f5...`, mjs `676162d0...`); mjs sha printed inside each WSL log; probes verified 28/28 OK before running |
| flipped probes (a2, a5, plant) | probe cannot fail | mutant modules flip them back: FAILOPEN -> win-a7b FAIL, M-F3 -> win-plant v18 FAIL (8035 ms, null), M2 -> browser A4 FAIL (222 -> 114 entries) |
| A4 live | `removed:false` while entries were deleted | P4 criteria, pre-call snapshot `missing=[]`, lockfile in the snapshot; M2 control shows the probe detects partial deletes |
| win-a7b (new) | scanner "unresolvable" but some other rule keeps the dir | reasons asserted to be exactly `scan-unavailable`; same dir removed once SystemRoot is restored; in-use control `in-use` |
| mutants | anchor did not apply, or the copy differed from WT | anchor must occur exactly once (else `ANCHOR-COUNT`); `mut-baseline-copy.log` = 349 passed / 2 skipped (= WT); each file restored and sha-compared (`restored-identical=true`); WT source sha256 unchanged before/after (`src-sha-*-mutants.txt`, 21 OK) |
| F-S8-1 itself | my variant is not a real M-O6 | `M-O6-variant-cmdClose.txt`: the only `clearState()` now sits inside `if (!closeBlocked) {}`; on a dialog-blocked no-chromePid close, state.json would be left while "Session closed." prints (the L12m behaviour) |
| B1 | sweep never looked at the live dirs (too young) | both dirs backdated 25 min first; C's stderr has `decision`/`kept` lines for both paths with `in-use` |
| B4 | dirs not stale or not candidates | names match rule 1, mtime -60 min; `removed=51` lines in the CLI's own log |
| C4 | config silently ignored | first attempt FAILED (800x600) because my harness's default parameter set `SUTRADHAR_CONFIG=none`; fixed and re-ran: 901x677; `doctor` shows `viewport=config`; `--viewport 902x678` control works (`live/c4-diagnosis.log`) |
| CLR (F-S8-2) | clearState did not actually fail | the CLI itself printed `Warning: could not clear the session state (EBUSY ...)` and state.json still exists afterwards |
| Linux determinism | tests skipped instead of run | counts: 104 passed + 3 skipped of 107; the 3 skips are the documented platform skips |
| leftover processes | CIM query vacuous | control: a dummy `node` with an `S8h` path in argv was found (`leftover-query-control.txt`), then the final query = 0 lines |
| real TEMP | another session added+removed a dir | start/end lists byte-identical, per-probe pairs identical, every `[cleanup]` path under my ISO roots |
| timing (B3/B4) | wall-clock mixing | numbers are the CLI's own `phase ... ms=` (performance.now) lines; harness durations use performance.now |

## 7. Safety and process record
- Location checked (`$WT`, `release/0.6.1`). No source edit (mutants applied only to `$SP/S8/mut`, a copy; its two node_modules
  junctions were unlinked as links before the guarded delete, and the WT `node_modules` was confirmed intact). No commit, no push.
- Processes: browsers started by the S4 browser probe (pids 80328, 68720, 83436, 56964, 83484) were killed by their own PID by the
  probe and confirmed exited; CLI-spawned Chrome closed by the CLI or, never needed, by the ownership-checked kill; stand-ins by handle.
  Final CIM query for command lines under my dirs: 0. Nothing killed by image name.
- Deviations: the S4 runner scripts hard-code `$EV/S4` outputs and `$SP/S4` probe copies, so I used `run-win-s8.sh`/`run-wsl-s8.sh`/
  `run-browser-s8.sh` (same commands; probes executed unmodified from `evidence/S4/probes`; only `TP_MODULE` and output paths differ).
  ISO names `S8L/S8b/S8h/S8y` (P5) deleted with an exact-path guard; `S 7` was created by the unmodified S7 harness and deleted the same way.
- Files: `audit.md`, `probes-s8/win-a7b.mjs`(+sha), `run-*.sh`, `mutants-s8.cjs`, `mutrun-s8.cjs`, `mutants.txt`, `s8-live.mjs`, `live/`,
  `s7rerun/`, `win/`, `wsl/`, `snapshots/`, `test-*.log`, `test-totals.txt`, `greps.txt`, `floating.txt`, `tsc.txt`, `spec-tsc*.txt`.
- **Process deviation to disclose (CLR case).** The second `close` in CLR, run to show F-S8-2's consequence, made the CLI re-issue
  `taskkill /PID 75560 /T /F` on the stale recorded PID about 4 s after that Chrome (ours) had exited (`OBS CLR second close ...
  phase-kill-line=true`). The CLI's taskkill output is discarded, so I cannot prove PID 75560 was not reused in those seconds on this
  shared machine. Reuse within 4 s is unlikely but not excluded. This is exactly the pre-existing hazard (plan 1.5); a re-run of such a
  demonstration must first rewrite state.json without `chromePid`.
