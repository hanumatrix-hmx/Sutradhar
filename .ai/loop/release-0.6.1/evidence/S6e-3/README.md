# S6e-3 - F3: system-binary resolution, proven at the call sites and live (security; S4 rated it HIGH)

Source committed (`source.sha256`): `spawn-chrome.ts`, `temp-profile.ts` (unchanged in this step), `system-binaries.spec.ts`.
Modules: `module.sha256` (temp-profile bundle `d24edfa8...`, identical to S6e-2 because `temp-profile.ts` did not change here), `module-spawn-chrome.sha256` (`cf79041e...`, bundled with the
S6a `browser-stub.mjs` for `@sutradhar/browser`), `module-mutant-F3.sha256` (scratch-only mutant). The S4 probes (incl. `win-plant.mjs`) were unmodified (`probes-sha-check.txt`: 28 x OK, `win-plant.mjs: OK`).

## What changed
- Code already used the helpers since S6a (`powershellExe()`, `taskkillExe()`, `psBin()`, `SystemRoot` read on every call, A.4). This step adds proof and one seam:
  `killChromeTree(pid, timeoutMs = 10_000, spawnFn = spawn)` gets an optional TRAILING `spawnFn` (new exported `KillChild` type). Kill semantics are unchanged: same program (`taskkillExe()`), same
  arguments `/PID <pid> /T /F`, same `windowsHide`, same cap; POSIX branch untouched. `spawnDetachedChrome`'s local `spawnFn` is now a named const so the call site reads `spawnFn(chromePath, ...)`.
- `tests/unit/system-binaries.spec.ts`: F3-a (Windows scan runs `powershellExe()`, absolute, follows `SystemRoot`), F3-b (macOS scan runs absolute `psBin()`), F3-c (Windows: `killChromeTree` runs
  exactly `taskkillExe()` with `/PID 4242 /T /F`; POSIX variant: process-group kill, then pid fallback, no executable spawned), F3-d (a source guard that pins all 6 spawn/execFile call sites).
- `spawn-sites.md` + `spawn-sites-grep.txt`: every site and where its executable comes from.

## AC table
| AC | result | evidence |
|---|---|---|
| Unit test: executable argument is absolute and equals `powershellExe()` / `taskkillExe()` | PASS | `test-cli.log`: `Test Files 21 passed (21)`, `Tests 334 passed \| 2 skipped (336)`; `system-binaries.spec.ts (9 tests \| 1 skipped)` (the skip is the POSIX-only F3-c on this Windows host; the other skip in the run is Linux-only D11) |
| Coverage check: every spawn/execFile site lists a helper call, `process.execPath`, the resolved Chrome path or an injected seam; no bare tool name | PASS | `spawn-sites.md` (6 sites), `spawn-sites-grep.txt`; S6a-4's grep `['"](powershell\|taskkill\|ps)['"]` outside system-binaries.ts: exit 1 = no match (`greps.txt`) |
| Live: `win-plant.mjs` (sha256 matches `probes.sha256`) on HEAD module, v18, v20, v22, v25: BOTH `PLANT:` checks PASS | PASS | `summary-live.txt`: `win-plant head v25/v18/v20/v22  2 PASS 0 FAIL` (planted scan 510 ms on v18, reason `in-use`) |
| Mutant M-F3 (scan's `run` goes back to the bare `powershell.exe`): unit test fails AND `win-plant` on v18 FAILs | PASS | `mutants.txt`: M-F3 fails F3-a (+ M-F3b: F3-c and F3-d, M-F3c: F3-b, M-F3d: F3-d); `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 before = after. Live: `summary-live.txt`: `win-plant mutantF3 v18  1 PASS 1 FAIL` with `INFO planted scan took ms=8033` and `FAIL PLANT: scan unaffected by a powershell.exe in cwd` (the planted cmd.exe ran and hung until the 8 s scan timeout; fail-closed `scan-unavailable` kept the dir, so the second check still passes: same shape as S4's branch run). On v25 the mutant PASSES (`mutantF3 v25 2 PASS`): Node 25 no longer searches the cwd first, which is why v18/v20 are the discriminating runtimes |
| Extra live: `killChromeTree` ignores a planted `taskkill.exe` in the cwd | PASS | `win/kill-probe-head-v{25,18,20,22}.log`: `1 PASS 0 FAIL` each (`INFO killChromeTree resolved in ms=330 child-exited=true`), with S6a's builder-authored `kill-probe.mjs` (sha256 `kill-probe.sha256`); its negative control (pre-S6a module on v18: the planted taskkill ran, the child survived) is in `../S6a/win/kill-probe-old-v18.log` |
| tsc / spec typecheck / eslint / guard / path check | PASS | `tsc.txt` exit 0; `spec-tsc.txt` identical to the S5 baseline, 0 errors in `system-binaries.spec.ts`, planted TS2322 re-run; `floating.txt` `eslint-exit=0` (S6c-4 still holds after the new seam); 52 `[iso-guard]` lines, 0 `ISOLATION GUARD`; `pathcheck.txt` `cleanup-lines=275 outside-iso=0` exit 0, wrong-root control exit 1; `win-plant` runs `pathcheck=0`; the `kill-probe` runs print `pathcheck=1` ONLY because that probe executes no cleanup code (`cleanup-lines=0`, the checker requires at least one line); their `[iso-guard]` line is present |

## Deviations / notes
1. **No red-before run for F3-c (Windows).** The test hands a fake `spawnFn` to `killChromeTree`; on code WITHOUT the seam the argument would be ignored and the real `taskkill /PID 4242 /T /F` would run against whatever process holds PID 4242. I did not run it that way. The red evidence for this step is the mutants (F3-a, F3-b, F3-c, F3-d each fail under a bare-name mutant) and the live `win-plant` mutant run (v18 FAIL).
2. The mutants are applied with the CRLF-aware runner (`spawn-chrome.ts` is a CRLF file here). The live M-F3 module is a scratch-only copy (`MUTANT-F3-scratch-only.diff`, one line).
3. F3-d pins the exact list of call sites, so a legitimate new spawn site must be added to the list on purpose (with a review of its executable). That is intended.
4. `killChromeTree`'s `tk.on('exit'|'error')` handlers were deliberately left as `on` (my first edit used `once`; reverted so the function body matches the S5/S6a text apart from the `spawnFn` indirection).

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| Unit tests F3-a/b/c | the spy is called with the right value only because the test itself computed it with the same helper | F3-a drives `SystemRoot` to two different values and compares with literal strings; M-F3, M-F3b, M-F3c (bare names) each fail the matching test |
| Unit F3-d (source guard) | the regex misses a call hidden behind another name | the extended grep in `spawn-sites-grep.txt` found no other `child_process` user; the guard's first version caught that my regex missed the Chrome call (`(deps.spawnFn ?? ...)(chromePath`) and the source was reshaped so the call is visible; M-F3d (a literal added at an existing site) fails it |
| Live `win-plant` | the planted binary is not found first on this machine, so the probe passes for any code | the SAME probe on the mutant module on v18 FAILs (`ms=8033`, scan null), and S6a's branch-module run FAILed (`ms=20036`); v25 does not discriminate (as expected) |
| Live `kill-probe` | the child died for another reason | the child is a `setInterval` node process that cannot exit by itself; `INFO alive-before=true`, then `child-exited=true`; S6a's negative control shows the planted `taskkill.exe` really intercepts the OLD code |
| Stale module | the probes ran an older build | `win-plant` logs print the module path/sha in the first `# cmd` line; HEAD temp-profile bundle `d24edfa8...`, mutant `ec7e555d...` |
| Real TEMP | probes touched other sessions' dirs | `realtemp-same=yes` (45 = 45) for each run; all `[cleanup]` paths under the ISO dir |

Processes started: stand-ins and planted-binary children inside the probes, all ended by their own handles or by the execFile timeout (CIM query for `S6e-3-tmp` command lines: 0 left).
