# S6d - POSIX process scan via `/proc` on Linux; `ps -A -ww -o args=` on macOS

Source state tested and committed (`source.sha256`): `temp-profile.ts 2494adc0...`, `scan-command-lines.spec.ts 23cdde2a...`.
Compiled module used by the WSL/Windows probes (`module.sha256`): HEAD bundle `c7561ea1...` (esbuild `--bundle --format=esm --platform=node --target=node18`,
A.5 rule 1) and, for the comparison the plan asks for, the S5 merge module (`git show 254b1ed:packages/cli/src/temp-profile.ts`, bundled the same way) `6bdb3441...`.
The S4 probes were checked unmodified before use: `probes-sha-check.txt` (28 x OK, 0 not OK).

## ORCHESTRATOR DECISION (recorded here, applies to S6d/S6e/S8)
The two unmodified S4 `wsl-a7.mjs` checks that set `PATH=''` to make the POSIX scanner unresolvable
(`A7 ps unresolvable -> null`, `A7 ps unresolvable -> close keeps`) are **APPROVED as a second sanctioned exception**, with the same
rationale as win-a7 -> win-a7b (an absolute binary / `/proc` makes PATH irrelevant). In exchange a new additive probe
`evidence/S6e/probes/wsl-a7b.mjs` proves "scanner unavailable -> null -> dir KEPT" with a negative control (written and recorded in S6e-2; its sha256 is for S8).
Observed here, on the HEAD module, exactly as predicted: `wsl/wsl-a7-head.log` = 4 PASS, 2 FAIL (the two PATH checks, `got=[]` and `{"removed":true}`) because the Linux scan no longer uses `ps` at all.

## What changed
- `temp-profile.ts`: `scanCommandLines(timeoutMs = SCAN_TIMEOUT_MS, deps: ScanDeps = {})` (first parameter and return type unchanged; `deps = { run?, platform?, readProc? }`):
  - win32: unchanged query, now via the injectable `run` (default `execFile` of the absolute `powershellExe()`);
  - linux: new exported `readProcCommandLines(timeoutMs, procFs?)` reads `/proc/<pid>/cmdline` (NUL -> space, kernel threads dropped); `null` if `/proc` cannot be listed,
    if NOT A SINGLE cmdline could be read (a directory that merely looks like /proc must not become `[]`), or if the deadline ran out; a process that exits between listing and read is skipped;
  - other POSIX (macOS): `psBin() -A -ww -o args=` (`-ww` = no width limit);
  - one shared post-filter helper `keepPrefixed()` for every platform (S6e-2 makes it case-insensitive in that one place).
- new `tests/unit/scan-command-lines.spec.ts` (13 tests, D1-D11 incl. D2b and D9b).

## AC table
| AC | result | evidence |
|---|---|---|
| S6d spec: fake `/proc` reader injected on Linux, darwin argument list asserted | PASS | `test-cli.log`: `Test Files 21 passed (21)`, `Tests 321 passed \| 1 skipped (322)`, `scan-command-lines.spec.ts (13 tests \| 1 skipped)` (the skip is D11, which needs a real Linux `/proc`). D1 (linux: only prefixed lines, the injected `run` must NOT be called, timeout passed through), D2 (unreadable -> null, and a close with that scan keeps the dir with `scan-unavailable`), D3 (darwin: absolute `/bin/ps`, args exactly `['-A','-ww','-o','args=']`). Red first: `red-before-change.log` (`Tests 11 failed \| 1 skipped (12)`) |
| S6d AC: WSL C5-live(a) passes with an argv longer than 4096 characters | PASS | `wsl/wsl-c5a-head.log` (HEAD module, WSL Node 20.20.2): `pad=100/4200/70000 -> in-use`, `3 PASS 0 FAIL`, `longest=70147 hit=true`. **The S5 module's result is recorded too**: `wsl/wsl-c5a-s5module.log`: the same `3 PASS 0 FAIL` (with `ps` available in this WSL, procps does not truncate when piped, as S4 noted) |
| Mutants (builder-added, 8) | PASS | `mutants.txt`: M-D1 linux uses ps (D1), M-D2 `-ww` dropped (D3), M-D3 null treated as [] (D2), M-D4 "nothing readable" allowed (D8), M-D5 deadline check removed from the loop (D9b), M-D6 NUL join removed (D5), M-D7 numeric filter removed (D5), M-D8 unreadable /proc treated as [] (D7); `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 before = after |
| No regression, WSL (HEAD module, unmodified S4 probes) | PASS except the sanctioned pair | `wsl-summary.txt`: a1 63/63, a2 4/4, a3 7/7, a5 6/6, a6 3/3, c5a 3/3, c5b 5/5, port 19/19 (`# tests 19 # pass 19`), a7 4 PASS + 2 sanctioned FAIL; every run `wslguard=1`, `mnt-cleanup-paths=0`, pathcheck 0 |
| No regression, Windows (Windows scan path refactored through `run`) | PASS (baseline FAILs unchanged) | `win-summary.txt`: `win-plant` v25 and v20 `2 PASS 0 FAIL`; `win-a5` v25 and v18 `18 PASS 2 FAIL` = the S4 F2 upper-case failures (`A5 upper: in-use with real scan`, `A5 upper: sweep keeps in-use`), fixed in S6e-2 |
| 1 ms scan is null on WSL (the unmodified `wsl-a7` check `A7 scanCommandLines(1) -> null` depends on it) | PASS | `wsl-a7-head.log` PASS, and builder probe `probes/wsl-scan1ms.mjs` (sha256 `probes-s6d.sha256`): `null=300/300` for `scanCommandLines(1)`, and `scanCommandLines(8000)` returns an array. Honest limit: the reader is deadline-based, so on a host with very few processes a 1 ms scan could in principle finish; that would be a valid `[]`, not a fail-open |
| tsc / spec typecheck / guard / path check | PASS | `tsc.txt` exit 0; `spec-tsc.txt` identical to the S5 baseline, 0 errors in the new spec, planted TS2322 still reported; 52 `[iso-guard]` lines, 0 `ISOLATION GUARD`; `pathcheck.txt` `cleanup-lines=220 outside-iso=0` exit 0, wrong-root control exit 1; S6a-4 grep (`['"](powershell|taskkill|ps)['"]` outside system-binaries.ts) exit 1 = no match |

## Deviations / notes
1. The plan says S6d "uses the case-insensitive filter of F2" while F2 is S6e-2: S6d routes every platform through one `keepPrefixed()` helper (still case-sensitive at this commit, same as before) so that S6e-2 changes the filter in exactly one place, including the `/proc` reader.
2. The scan spec is a new file instead of `temp-profile.spec.ts` (that file is CRLF and the plan names no file for S6d).
3. `ScanDeps`/`ProcFs`/`readProcCommandLines` are new exports of `temp-profile.ts`.
4. The WSL run script `run-wsl-s6x.sh` copies the UNMODIFIED S4 probes straight from `evidence/S4/probes` (not from the scratchpad copies used at S4/S6a) and the compiled module from the scratchpad; one self-contained `wsl.exe` call per probe with `timeout 300`, guarded `rm` of its own `/tmp/tmp.*`, path check with `MSYS_NO_PATHCONV=1`.
5. `wsl-port` prints `0 PASS 0 FAIL` in the one-line summary because it is a `node:test` file; its own TAP summary is `# tests 19 # pass 19 # fail 0`.
6. Not verified: macOS (no host available); only the argument list is asserted (D3).

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| spec (D1) | the Linux branch silently still shells out to `ps` and the fake reader is ignored | the injected `run` throws if called; M-D1 (linux branch disabled) fails D1, D2, D2b |
| spec (D2) | "null" caused by something other than `/proc` being unreadable | D2 asserts `removeSessionTempProfile` reason is exactly `scan-unavailable` and the dir still exists; M-D3 (null -> []) fails it |
| spec (D3) | the args are right in the test but wrong in the code path used on macOS | D3 drives the real `scanCommandLines` with `platform: 'darwin'` and compares the recorded call to `[psBin(), ['-A','-ww','-o','args='], 777]`; M-D2 fails it |
| D5-D9b | the reader under test is a copy | the tests call the exported `readProcCommandLines` with an injected `ProcFs`; each of M-D4..M-D8 flips exactly the matching test |
| WSL c5a | the stand-in was found via an old `ps`, not `/proc` | `wsl-a7-head.log`: with `PATH=''` the HEAD scan still returns `[]` instead of `null` (FAIL of the two ps-PATH checks) which can only happen if `ps` is no longer used; and `longest=70147 hit=true` is read from the scan output itself |
| WSL a7 1 ms | the 1 ms scan is null only by luck of one run | 300 repeats, all null (`wsl-scan1ms-head.log`) |
| stale module | the probes ran the old module | the WSL log prints the module sha256 (`c7561ea1...`, equal to `module.sha256`) and the S5 module run prints `6bdb3441...` |
| Real TEMP | WSL/Windows probes touched real dirs | `win-summary.txt`: `realtemp-same=yes` (45 = 45); WSL probes ran under `/tmp/tmp.*` with `wslguard=1`, `mnt-cleanup-paths=0`; no `[cleanup]` path outside the probe root (`outside-iso=0`) |

Processes started: stand-in `node` children inside the WSL/Windows probes (killed by their own handle by the probes: `stop()`/`INFO stand-in exited`). No other processes.
