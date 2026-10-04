# S6e-2 - F2: case-insensitive scan post-filter (+ the scan seam), and the `wsl-a7b` probe

Source committed (`source.sha256`): `temp-profile.ts` (see file), `scan-command-lines.spec.ts`. Modules for the probes: `module-pre.sha256` (the code before the fix, `9eb16c95...`)
and `module.sha256` (after, `d24edfa8...`); both `esbuild --bundle --format=esm --platform=node --target=node18`. The S4 probes were unmodified (`probes-sha-check.txt`: 28 x OK, 0 not OK).
Orchestrator decision about the two `wsl-a7` PATH checks and the new probe: `../S6e/README.md` (also recorded in `../S6d/README.md`).

## What changed
- `temp-profile.ts`: the shared `keepPrefixed()` filter is `l.toLowerCase().includes(TEMP_PROFILE_PREFIX)` (the prefix is lower-case) for EVERY platform (Windows CIM output, the Linux `/proc` reader, macOS `ps`).
  The scan seam (`scanCommandLines(timeoutMs, { run?, platform?, readProc? })`, first parameter and return type unchanged) was introduced in S6d, so this step only changes the filter.
- `tests/unit/scan-command-lines.spec.ts`: F2-a, F2-b, F2-c.
- new probe `../S6e/probes/wsl-a7b.mjs` (see `../S6e/README.md`).

## AC table
| AC | result | evidence |
|---|---|---|
| F2-a: raw CRLF output with an upper-case, a lower-case and an unrelated line keeps exactly the two prefixed lines | PASS | `test-cli.log`: `Test Files 21 passed (21)`, `Tests 330 passed \| 1 skipped (331)`. Red first on the unfixed code: `red-before-change.log` = `Tests 3 failed \| 12 passed \| 1 skipped (16)` (F2-a, F2-b, F2-c) |
| F2-b: `removeSessionTempProfile` with that scan reports `in-use` for the dir referenced in upper case | PASS | same run |
| Mutants M-F2 (case-sensitive filter restored) fails F2-a and F2-b; M5 (S4's upper-cased filter) fails F2-a | PASS | `mutants.txt`: M-F2 (F2-a, F2-b, F2-c), M5 (F2-a, D1, D3), extra M-F2-linux-unfiltered (F2-c, D1, D2b); `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 before = after. M5 is S4's definition re-anchored on HEAD's text (the S4 anchor `.filter(...)\n  }` no longer exists after S6d moved the filter into `keepPrefixed`), same semantic: `includes(TEMP_PROFILE_PREFIX.toUpperCase())` |
| S4 `win-a5.mjs` PASS (incl. the `upper` variant) on all 4 runtimes | PASS | BEFORE `summary-win-pre.txt`: `18 PASS 2 FAIL` on v25, v18, v20, v22 (`FAIL A5 upper: in-use with real scan :: {"removed":true}`, `FAIL A5 upper: sweep keeps in-use`). AFTER `summary-win-post.txt`: `20 PASS 0 FAIL` on all four |
| S4 `win-a5case.mjs` PASS on v25 | PASS | before `1 PASS 1 FAIL` (`FAIL CASE: module scan keeps it`, `INFO module scanCommandLines() lines mentioning basename: 0`), after `2 PASS 0 FAIL` |
| No regression (unmodified S4 probes, HEAD module) | PASS except the sanctioned pairs | `summary-win-post.txt`: win-a1 66/66 (v25, v22), win-a2 6/6 (v25, v20), win-a3 12/12 (v25, v22), win-a6 5/5 x4, win-plant 2/2 x4 (v18, v20, v22, v25); win-a7 `5 PASS 2 FAIL` x4 = the two sanctioned PATH checks only (`got=array(35)`, `{"removed":true}`). `summary-wsl-post.txt`: a1 63, a2 4, a3 7, a5 6, a6 3, c5a 3, c5b 5, port 19/19, a7 `4 PASS 2 FAIL` (sanctioned) |
| `wsl-a7b` passes and can fail | PASS | `wsl/wsl-a7b-head.log` `18 PASS 0 FAIL`; `wsl/wsl-a7b-mutant.log` (scan failure treated as `[]`) `10 PASS 8 FAIL`; sha256 in `../S6e/probes/wsl-a7b.sha256` |
| tsc / spec typecheck / guard / path check | PASS | `tsc.txt` exit 0; `spec-tsc.txt` identical to the S5 baseline, 0 errors in the new spec (the first run caught a TS2322 in my F2-b `scan` helper, `ms: number` vs `number \| undefined`, fixed: the check bites), planted TS2322 re-run; 52 `[iso-guard]` lines, 0 `ISOLATION GUARD`; `pathcheck.txt` `cleanup-lines=275 outside-iso=0` exit 0, wrong-root control exit 1; every probe run `pathcheck=0`, `realtemp-same=yes` (45 = 45) |

## Deviations / notes
1. A.5 rule 5 fragility ("win-a7: every line carries the prefix" is case-sensitive): no upper-case holder was alive at the time (the `win-a5case` stand-in is killed by its own handle inside the probe); `win-a7 post` shows `PASS A7 real scan: every line carries the prefix` on all 4 runtimes. The probe was not edited.
2. The first mutant module built for the `wsl-a7b` negative control was NOT mutated (my anchor matched twice and the node edit threw, but the bundle step still ran), so its run was a false "mutant"; it was caught because the result was 18 PASS 0 FAIL, the anchor was corrected (`mkmutant.cjs`, the diff is `MUTANT-scanfail-as-empty-scratch-only.diff`) and the mutant log is from the corrected module only.
3. Probe dir names inside `wsl-a7b.mjs` contain the literal basename in the probe source but never in its argv/launch text (P7); the only argv carrying a path is the stand-in's.

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| F2-a/F2-b | the filter is right in the unit test but the real Windows output is different (line endings, encoding) | the live `win-a5` `upper` variant and `win-a5case` use the REAL CIM query: BEFORE they FAIL (`removed:true`, module scan 0 lines vs raw WQL 1 line) and AFTER they PASS on v18, v20, v22, v25 |
| F2-a | an unrelated line sneaks in or both prefixed lines are kept for the wrong reason | `toEqual([UPPER, LOWER])` (exact list, order, no unrelated line); M5 (upper-cased filter) and M-F2 (case-sensitive) each break it |
| F2-b | "in-use" comes from something other than the upper-case match | the only reference to the dir is the upper-case line; the dir is otherwise stale and unreferenced (no marker, scan is the only guard); M-F2 turns the result into a removal |
| F2-c | the filter is fixed for Windows only | the same helper serves Linux `/proc` and macOS `ps`: tested separately; M-F2-linux-unfiltered fails it |
| wsl-a7b | the "keeps" are caused by something other than the unavailable scanner | the controls use the same dir shape and are removed when the scanner works (`removed:true`), and the mutant run shows the keeps flip to `{"removed":true}` when a failed scan is treated as `[]` |
| Stale module | probes ran an old module | every log header prints the module sha256 (`9eb16c95...` for pre, `d24edfa8...` for post, `75dc608f...` for the mutant) |
| Real TEMP | probes touched other sessions' dirs | `realtemp-same=yes` (45 = 45) for each Windows probe run; WSL runs under `/tmp/tmp.*` (`wslguard=1`, `mnt-cleanup-paths=0`); all `[cleanup]` paths inside the ISO / probe root |

Processes started: stand-in `node` children inside the probes, each killed by its own handle (confirmed in the logs); none left (CIM query for `S6e-2-tmp` command lines: 0).
