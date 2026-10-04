# S6e-5 - N4: the two missing unit tests (lockfile held open; scan substring filter) + S4 mutants M1..M6 against HEAD

Source committed (`source.sha256`): `temp-profile.ts` (unchanged in this step), `temp-profile.spec.ts`, `scan-command-lines.spec.ts`. No product code changed: this step only adds tests.

## What was added
- `temp-profile.spec.ts` **N4-a** (Windows only; `it.skipIf(platform !== 'win32')`, the title says "rule 5 is Windows-only, so this is skipped on POSIX"):
  1. a profile dir with 20 files plus `lockfile` (21 entries, `readdir` snapshot taken first);
  2. `lockfile` is held open with `FileShare.None` by a CHILD process: `powershellExe() -NoProfile -NonInteractive -Command "$f=[IO.File]::Open($env:LOCKPATH,'Open','ReadWrite','None'); 'ready'; [Console]::In.ReadLine()"`, path in env `LOCKPATH` only (never argv, P7);
  3. the test waits (hard 30 s cap) for the child's `ready` line before calling anything;
  4. `removeSessionTempProfile(dir, undefined, { scan: async () => [], deadlineMs: 2000 })` (no marker);
  5. asserts `removed:false`, that EVERY one of the 21 snapshot entries is still present, and that `lockfile` is present;
  6. ends the child by closing its stdin and confirms through its own handle that it exited (15 s cap, `child.kill()` of only that handle as the fallback);
  7. added positive control: with the lock released the very same call removes the dir.
- `scan-command-lines.spec.ts` **N4-b**: a line whose token merely CONTAINS the prefix (`...-ZZZextra`, `mysutradhar-cli-...`) is still returned by the substring pre-filter, while `commandLinesReference` (the word-boundary logic) says the longer token does not reference the shorter dir name (and does reference its own). F2-a/F2-b (S6e-2) cover the rest of N4-b.

## AC table
| AC | result | evidence |
|---|---|---|
| N4-a passes on Windows (and would be skipped on POSIX) | PASS | `test-cli.log`: `Test Files 21 passed (21)`, `Tests 349 passed \| 2 skipped (351)`; `test-cli-verbose.log` lists `S6e-5 (N4-a) ... N4-a (Windows only; ...)` as passed (the 2 skips: Linux-only D11, POSIX-only F3-c). 2 consecutive green runs (plus the mutant baseline) |
| N4-b passes | PASS | same run (`test-cli-verbose.log`) |
| S4 mutant M2 (`lockfile probe removed`) makes the cli unit suite FAIL | PASS | `mutants.txt`: `M2_no_win_lockfile_probe: Tests 1 failed \| 348 passed`, the single failure is `N4-a` (with the probe removed the retried recursive delete removed the 20 plain files while the held `lockfile` survived: exactly the S4 live A4 scenario, 106 of 200 entries), `must-fail=[N4-a] caught=true`. The spec/branch suite had missed it entirely (`S4 spec/mutants.txt`: 19/19 passed) |
| S4 mutant M5 (upper-cased filter) makes the suite FAIL | PASS | `M5_scan_case_sensitive_kept: Tests 4 failed`: F2-a, D1, D3, N4-b (re-anchored on HEAD, see 2) |
| S4 mutants M1, M3, M4, M6 against HEAD still fail | PASS | `M1_null_scan_fail_open` 6 failed (T8, T10, `sweep deletes nothing when the process scan fails`, ...); `M3_owner_alive_ignored` 5 failed; `M4_age_ignored` 2 failed; `M6_no_root_check` 1 failed (`isAutoTempProfileDir (rule 1) rejects ...`). `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 before = after for every run |
| tsc / spec typecheck / eslint / guard / path check | PASS | `tsc.txt` exit 0; `spec-tsc.txt` identical to the S5 baseline, 0 errors in the spec files, planted TS2322 re-run; `floating.txt` `eslint-exit=0`; 52 `[iso-guard]` lines, 0 `ISOLATION GUARD`; `pathcheck.txt` `cleanup-lines=404 outside-iso=0` exit 0, wrong-root control exit 1 |

## Deviations / notes
1. The red-before evidence for N4-a is the mutant M2 (the code under test already contains the lockfile probe); there is no pre-fix code to run.
2. S4's mutant definitions were re-anchored on HEAD's text: M2 uses `rmFn` (the S6a rm seam) instead of `rm`; M5 is `l.includes(TEMP_PROFILE_PREFIX.toUpperCase())` in `keepPrefixed` (the S4 anchor `.filter(...)\n  }` no longer exists). M1, M3, M4, M6 anchors are byte-identical to S4's. The whole cli suite runs under each mutant (`tests: []` in `S6e-5-defs.cjs`), not only the temp-profile specs.
3. A first run of this step's `test-cli.log` used `--reporter=verbose` and made `check-cleanup-paths` report 1 outside-iso line: it was a test TITLE that contains the text `[cleanup] ... path=<abs>` (T6) echoed by the verbose reporter, not a real cleanup line. The verbose log was kept separately as `test-cli-verbose.log` (not path-checked) and `test-cli.log` was regenerated with the default reporter (`outside-iso=0`).
4. N4-a starts one PowerShell child per run (~1 s). The path of the locked file travels only in the child's environment, so no probed basename appears in any command line.

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| N4-a | the lock is not really held (the child failed or exited early) and the dir is kept for another reason | the test first waits for the child's `ready` line and has `exited === false` semantics via its own handle; with the lock released the same call REMOVES the dir (positive control), and M2 (probe removed) fails the test, which can only happen if the lock really blocks the recursive delete (the lockfile survives while the 20 files vanish) |
| N4-a | all 21 entries "present" because the snapshot was taken after a deletion | the `readdir` snapshot (21 names) is taken BEFORE the child starts and before any call, and compared by name |
| N4-a (skip) | the test silently skips on Windows | `test-cli-verbose.log` shows it as passed on this host; on POSIX it is an explicit `it.skipIf` whose title carries the reason |
| M2/M5 | "caught" because the build broke | each mutant row shows a normal `Tests N failed \| M passed` line and the named failing tests; M2's single failure is N4-a only |
| N4-b | the filter keeps the lines only because it is case-insensitive | the lines are lower-case; N4-b asserts exact lists and both directions of `commandLinesReference` |
| Safety | the lock-holding child or a mutant run left something behind | CIM query for processes referencing `S6e-5-tmp`: 0; the child is ended through its stdin and confirmed through its own handle; mutated sources restored (sha256 equal); ISO dir deleted with the guarded form |

Processes started: one PowerShell lock-holder per N4-a run (and per mutant run that reaches it), each ended by closing its stdin and confirmed exited by its own handle in the test.
