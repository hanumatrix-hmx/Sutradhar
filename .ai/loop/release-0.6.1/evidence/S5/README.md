# S5 - Merge GAP-315 (conflict only) + spec-typecheck baseline

Merge commit: `254b1ed` (parents 2c81072 = release HEAD incl. S4 evidence + Addendum A, 8ba1649 = branch tip).
Precondition: S4 REOPEN, `precondition.md`. The S4 evidence + Addendum A were committed first as 2c81072 (plan 0.3 evidence policy).
This README and the rest of `$EV/S5` are committed in the separate `GAP-315 merge evidence` commit.

Commands: `git merge --no-ff --no-commit fix/gap-315-temp-profile-cleanup` (one conflict: packages/cli/src/cli.ts,
spawnFreshSession). Resolved by deleting only the three marker lines, keeping master's `spawnViewport` lines first and the
branch's `sweepStaleTempProfiles()` lines second (`merge-checks.txt`, lines of the resolved block). Then
`tsc --noEmit -p packages/cli` (`tsc.txt`, exit 0) and the cli matrix entry under the preamble (`test-cli.log`).

## AC table
| AC | result | evidence |
|---|---|---|
| S5-1: merge commit touches exactly 11 files, all branch hunks | PASS | `merge-files.txt` (11 names); `git diff --name-only HEAD^1 HEAD \| wc -l` = 11; cli.ts diff vs parent 1 is the branch hunks only (`merge-checks.txt`, 22 insertions / 2 deletions) |
| S5-2: tsc clean; cli = 262 in 17 files (S1 243 + 19); temp-profile.spec.ts in log; project-config-cli.spec.ts passes | PASS | `tsc.txt` `tsc-exit=0`; `test-cli.log`: `Test Files 17 passed (17)`, `Tests 262 passed (262)`, `temp-profile.spec.ts (19 tests)`, `project-config-cli.spec.ts (32 tests)` |
| S5-3: every sweep/remove call in the specs passes `tmpRoot` | PASS | `spec-calls.txt`: 6 calls (2 sweep, 4 remove), every one has `tmpRoot: root` |
| S5-4: guard line present; check-cleanup-paths N/A (no seam until S6a) | PASS | `test-cli.log`: 48 `[iso-guard] tmpdir=...scratchpad/s5-tmp` lines, 0 `ISOLATION GUARD`; `check-cleanup-paths`: N/A (no seam until S6a) |
| S5-5: spec baseline 7 errors (same as 1.9), 0 TS6059, negative control TS2322 | PASS | `spec-tsc-baseline.txt` (7 `error TS`: dialog-cli 122,123; direct-cdp-broker 36; session-flow 84,93,142,148 - identical to 1.9), `grep -c TS6059` = 0; `spec-tsc-negative.txt` `planted.ts(1,7): error TS2322` |

`writeState` fields (step 1): `userDataDir: spawned.userDataDir`, `tempProfile: spawned.tempProfile`, `viewport: viewportFlag`,
`dialogPolicy` all present (`merge-checks.txt`). No conflict markers remain (`marker-grep-exit=1`).

## Mutants (S5 has no planned mutants; two checks that would catch a wrong resolution)
- Keeping only the branch side drops `spawnViewport`: tsc fails (undefined identifier at the `spawnDetachedChrome` call). Keeping only master's side drops the sweep: `grep "await sweepStaleTempProfiles" cli.ts` would print nothing. Both are present (`merge-checks.txt`).

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| S5-1 | 11 files counted but a branch hunk lost in the resolution | `git diff HEAD^1 HEAD --stat -- packages/cli/src/cli.ts` = 22+/2- and `git diff HEAD^1 HEAD` shows all 5 branch hunks (import, sweep, writeState fields, withSession kill/cleanup, cmdClose kill/cleanup); the live diff was re-read after the commit |
| S5-2 | vitest passing on a stale or partial tree; tsc passing because cli.ts is excluded | tsc and vitest ran after the merge commit's content was staged; test count 262 = 243 + 19 equals the planned total; the log names temp-profile.spec.ts (19 tests), which only exists post-merge |
| S5-3 | grep matching a comment | `spec-calls.txt` lines are code lines with `tmpRoot: root` |
| S5-4 | guard not active (NODE_OPTIONS dropped) | 48 guard lines naming the s5-tmp scratch dir in the log; real-TEMP run is exit 97 (S1 self-test) |
| S5-5 | vacuous tsc config (only TS6059) | 0 TS6059, 7 semantic errors, and the planted-error control prints TS2322 from the same config chain |

Processes started: none. ISO `S5-tmp` deleted with the guarded form (no PIDs were started).
