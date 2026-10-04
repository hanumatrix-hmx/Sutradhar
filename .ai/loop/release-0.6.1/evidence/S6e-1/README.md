# S6e-1 - F1 (also N3): refuse links and non-directories before touching the candidate

Source committed (`source.sha256`): `temp-profile.ts 208fa80f...`, `temp-profile.spec.ts 8daffdf2...`.
Compiled modules for the probes: `module-pre.sha256` (S6d HEAD, `c7561ea1...`, the code BEFORE this fix) and `module.sha256` (after the fix, `9eb16c95...`),
both `esbuild --bundle --format=esm --platform=node --target=node18` (A.5 rule 1). The S4 probes were unmodified (`probes-sha-check.txt`: 28 x OK, 0 not OK).

## What changed (`temp-profile.ts`)
- `realDirectory(dir)`: `lstat` (never follows); true only for a non-symlink directory; any error is false. A Windows junction reports `isSymbolicLink() === true`.
- `gatherFacts` calls it FIRST (before `stat`, before the marker / `SingletonLock` read, before any `path.join(dir, ...)`); for a link or file it returns facts with `realDir: false` and reads nothing through it; new optional fact `realDir?`.
- `decideRemoval`: after rule 1 (`not-auto-temp`) and before every other rule, `realDir === false` -> `{remove:false, reason:'not-a-directory'}`; `undefined` = unchanged (the S4 `wsl-port` probe builds facts without the field and still passes: 19/19).
- `removeWithRetries` repeats `realDirectory(dir)` at the top of EVERY attempt, immediately before the Windows `lockfile` probe; on false it returns `{removed:false, error:'not-a-directory'}`. It never unlinks a link (a kept link is a harmless leak, never a loss).
- The new reason is in the `RemovalDecision` union and in the debug `decision` line.

## AC table
| AC | result | evidence |
|---|---|---|
| Unit tests F1-a, F1-b, F1-c, F1-d (+ F1-e re-check test, + decideRemoval test) | PASS | `test-cli.log`: `Test Files 21 passed (21)`, `Tests 327 passed \| 1 skipped (328)` (the skip is the Linux-only D11 from S6d); F1-b was NOT skipped (dir symlinks are permitted here; no `F1 link ... not permitted` line in the log). Red first on the unfixed code: `red-before-change.log` = `Tests 5 failed \| 36 passed (41)` (F1-a, F1-b, F1-c, F1-e, decideRemoval; F1-d, the positive control, passes before and after) |
| Mutants M-F1a, M-F1b, M-F1c fail | PASS | `mutants.txt`: M-F1a fails F1-a, F1-c (+F1-b, F1-e); M-F1b (`lstat` -> `stat`) fails F1-a (+F1-b, F1-e); M-F1c (re-check removed AND the gatherFacts check never sets false) fails F1-a via the rm spy / intact-victim assertions (+F1-b, F1-c, F1-e). Extras: M-F1c2 (only the re-check removed) fails F1-e; M-F1d-order (check after the scan rule) fails the decideRemoval test. `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 before = after |
| S4 `win-a2.mjs` 6/6 on v18, v20, v22, v25 (must flip FAIL -> PASS) | PASS | BEFORE (`summary-pre.txt`, module-pre): `2 PASS 4 FAIL` on all four runtimes (`FAIL A2 sweep junction victim intact incl lockfile :: lockfile=false missing=["lockfile"]`, same for close and for the dir symlink). AFTER (`summary-post.txt`): `6 PASS 0 FAIL` on v25, v18, v20, v22 (`win/win-a2-post-v*.log`: `lockfile=true missing=[] linkStillThere=true`) |
| Still passing: win-a1, win-a3, wsl-a1, wsl-a2, wsl-a3 | PASS | `summary-post.txt`: win-a1 `66 PASS 0 FAIL` x4, win-a3 `12 PASS 0 FAIL` x4, wsl-a1 63/63, wsl-a2 4/4, wsl-a3 7/7; also wsl-a6 3/3, wsl-c5b 5/5, wsl-port `# pass 19` |
| `win-a1` `OBS file-named-like-profile` now prints `removed=false` | PASS | before `win/win-a1-pre-v25.log`: `OBS file-named-like-profile removed=true`; after `win/win-a1-post-v25.log`: `removed=false` |
| tsc / spec typecheck / guard / path check | PASS | `tsc.txt` exit 0; `spec-tsc.txt` identical to the S5 baseline, 0 errors in `temp-profile.spec.ts`, planted TS2322 still reported; 52 `[iso-guard]` lines in `test-cli.log`, 0 `ISOLATION GUARD`; `pathcheck.txt`: `cleanup-lines=270 outside-iso=0` exit 0, wrong-root control exit 1; every probe run: `pathcheck=0`, `isoguardfail=0`, `realtemp-same=yes` (45 = 45) |

## Deviations / notes
1. Added F1-e (not in the plan): the swap between "facts gathered" and "delete" cannot be reached from outside, so the first rm attempt (via `rmFn`) swaps the real dir for a junction/symlink to a victim and fails with a simulated `EBUSY`; the retry must not call `rmFn` again. It is what actually tests the `removeWithRetries` re-check (M-F1c2).
2. M-F1c as written ("the gatherFacts check moved after `path.join(dir,'lockfile')`") is realised as: re-check removed AND the gatherFacts check made a no-op, which is the observable effect (the removal follows the link). "Checked before ANY `path.join(dir, ...)` in gatherFacts" is a code-structure property no black-box test can see; it is guaranteed by reading the code (the early return for `realDir === false` precedes `stat`/`readOwnerPid`).
3. A candidate that vanishes between the facts and the delete now yields `{removed:false, reason:'not-a-directory'}` (an `lstat` ENOENT is a `false`, as the plan specifies) instead of `removed:true`: a spurious warning in a rare race, never a loss. Left as specified.
4. The F1 tests create real junctions/symlinks under scratch dirs inside the ISO TEMP only; the unfixed code deleted a scratch victim's `lockfile` in the red run (inside the ISO, by design of the test).

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| F1-a | the link is kept for a different reason, or the victim is intact only because the link was never created | the link is asserted to still be a symlink (`lstat`), the reason is exactly `not-a-directory`, the rm spy shows no path under the link; before the fix the same test fails and `win-a2-pre-*.log` shows the lockfile really gone (`lockfile=false`); `F1 link ... not permitted` would be printed if creation failed (none) |
| F1-a/F1-b | the Windows junction is not seen as a link by `lstat` | M-F1b (`stat`) fails the tests and the live `win-a2` junction cases pass only with `lstat`; the post-fix probe logs `linkStillThere=true` for the junction on v18, v20, v22 and v25 |
| F1-c | the file was kept only because of age | the file is back-dated 2 x STALE_MIN_AGE and the sweep uses `minAgeMs:0`; M-F1a (always "real directory") makes F1-c fail; the live `win-a1` OBS flips `removed=true` -> `removed=false` |
| F1-d | everything is kept now (a vacuous pass) | the positive control removes a real dir with the same setup in both modes; `win-a1`/`wsl-a1` still remove their positive controls (66/66, 63/63) |
| F1-e | the re-check is exercised but the first rm never ran | `calls` must have exactly 1 entry and the result is `not-a-directory`; M-F1c2 (re-check removed) fails it |
| S4 probes | run against a stale or wrong module | each log's header prints the module sha256; pre = `c7561ea1...`, post = `9eb16c95...`; the pre run FAILs exactly the A2 cases S4 recorded, so the probe has a reachable FAIL state and the fix flips it |
| Real TEMP | probes touched other sessions' dirs | `realtemp-same=yes` (45 = 45) for every Windows run; WSL runs under `/tmp/tmp.*` with `mnt-cleanup-paths=0`; every `[cleanup]` path is under the ISO / probe root |

Processes started: none that outlive a probe (the probes' own stand-ins were killed by their handles); ISO dirs deleted with the guarded form.
