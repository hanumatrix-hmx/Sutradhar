# S6e-4 - N1: an unreadable or corrupt owner marker fails CLOSED

Source committed (`source.sha256`): `temp-profile.ts`, `temp-profile.spec.ts`. Modules: `module-pre.sha256` (before, `d24edfa8...`) and `module.sha256` (after, `676162d0...`),
`esbuild --bundle --format=esm --platform=node --target=node18`. S4 probes unmodified (`probes-sha-check.txt`: 28 x OK). Builder-added probes: `probes/win-n1.mjs`, `probes/wsl/wsl-n1.mjs`
(+ an unmodified copy of S4's `common.mjs`), hashes in `probes/probes-s6e4.sha256`.

## What changed (`temp-profile.ts`)
- internal `readOwnerMarker(dir)` -> `{state:'absent'} | {state:'valid', pid} | {state:'invalid'}`: ENOENT = `absent`; any other read error (EACCES, EISDIR, EBUSY, ...) = `invalid`;
  JSON parse failure = `invalid`; `chromePid` not a positive integer (string, 0, negative, fractional, missing, JSON `null`, empty file) = `invalid`.
- `readOwnerPid` keeps its exported signature AND behaviour (a corrupt marker still returns `undefined`; the S4 probes call it); the lock fallback was factored into a shared `readLockPid`.
- `gatherFacts` uses `readOwnerMarker` (valid -> its pid, else the `SingletonLock` pid) and sets the new optional fact `ownerState`.
- `decideRemoval`: `ownerState === 'invalid'` -> `{remove:false, reason:'owner-unknown'}`, after `in-use`/`scan-unavailable` and before `owner-alive`; `absent` falls back to `SingletonLock` exactly as before;
  `undefined` is unchanged (the S4 `wsl-port` probe builds facts without the field: still 19/19).

## AC table
| AC | result | evidence |
|---|---|---|
| N1-a (corrupt JSON), N1-b (`chromePid:"abc"`), N1-c (marker path is a directory, EISDIR): kept with `owner-unknown` by BOTH sweep and close | PASS | `test-cli.log`: `Test Files 21 passed (21)`, `Tests 347 passed \| 2 skipped (349)`. Also covered (more than the plan): `chromePid` 0 / negative / fractional / missing, JSON `null`, empty file. Red first: `red-before-change.log` = `Tests 10 failed \| 44 passed (54)` (every bad-marker test + the decideRemoval test) |
| N1-d positive control: no marker and no lock is still removed | PASS | same run; also a VALID marker with a dead owner is removed and with a live owner is `owner-alive` (unchanged behaviour); `readOwnerPid` regression test |
| Mutant M-N1 (`invalid` treated as `absent`): N1-a, N1-b, N1-c fail | PASS | `mutants.txt`: M-N1 `9 failed` incl. N1-a, N1-b, N1-c; extras M-N1b (read error = absent: N1-c), M-N1c (any number valid: zero/negative/fractional), M-N1d (parse failure = absent: N1-a, empty file), M-N1e (rule order: decideRemoval test), M-N1f (valid marker ignored: valid-marker test); `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 before = after |
| Matching S4 probe FAILs before and PASSes after, on all 4 Windows runtimes and WSL | PASS, with a caveat (see 1) | S4 has no CHECK for N1 (only the observation `OBS corrupt marker -> readOwnerPid=...`, unchanged by design). The additive probe `win-n1.mjs` / `wsl-n1.mjs` (5 bad-marker kinds x close + sweep = 10 checks, plus 4 controls) BEFORE (`summary-pre.txt`): `4 PASS 10 FAIL` on v25, v18, v20, v22 and WSL (`FAIL N1 [corrupt JSON] close keeps (owner-unknown) :: {"removed":true}` ...; the 4 controls pass); AFTER (`summary-post.txt`): `14 PASS 0 FAIL` on all four Windows runtimes and WSL Node 20.20.2 |
| No regression (unmodified S4 probes, post module) | PASS except the sanctioned pairs | `summary-post.txt`: win-a1 66/66, win-a2 6/6, win-a3 12/12, win-a5 20/20, win-a6 5/5, win-plant 2/2 (v25, v18); win-a7 `5 PASS 2 FAIL` = the two sanctioned PATH checks only; wsl a1 63, a2 4, a3 7, a5 6, a6 3, c5a 3, c5b 5, port `# pass 19`, a7 `4 PASS 2 FAIL` (sanctioned). `win-a7`'s `OBS corrupt marker -> readOwnerPid=undefined` is unchanged |
| tsc / spec typecheck / guard / path check | PASS | `tsc.txt` exit 0; `spec-tsc.txt` identical to the S5 baseline, 0 errors in the spec files, planted TS2322 re-run; 52 `[iso-guard]` lines, 0 `ISOLATION GUARD`; `pathcheck.txt` `cleanup-lines=388 outside-iso=0` exit 0, wrong-root control exit 1; probe runs `pathcheck=0`, `realtemp-same=yes` (45 = 45) |

## Deviations / notes
1. The orchestrator asked for "the relevant S4 probe" to FAIL before and PASS after for N1. No S4 probe has an N1 check (`win-a7`/`wsl-a7` only PRINT an observation, and its label text "unknown owner is treated as not alive" is a static string), so I could not run an S4 probe in that role. I added the additive probes `win-n1`/`wsl-n1` (own guard copied from the S4 probe headers, sha256 recorded) and ran them on all 4 Windows runtimes and WSL, before and after. The unmodified S4 probes were still run as regression.
2. Consequence to flag (not changed here, per the spec): a dir whose marker is corrupt is now kept by BOTH close and every later sweep, i.e. it leaks permanently (a leak, never a loss). A truncated marker from a crash during the non-atomic `writeFile` is the realistic source. Candidate for S10b as a leak-severity gap.
3. `readOwnerPid` was deliberately NOT changed (the plan says it keeps its behaviour): it still treats a corrupt marker as "no marker" for callers that use it directly; the removal rules no longer call it.
4. A marker is `invalid` for EVERY non-ENOENT read error, so a transient EBUSY/EACCES (e.g. an antivirus scan on Windows) keeps the dir this time and a later sweep retries (fail-closed direction).

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| N1-a/b/c | the dir is kept for another reason (age, scan, lock), not the marker | the reason is asserted to be exactly `owner-unknown`; the control with the same dir shape and NO marker is removed (N1-d), and the VALID-marker/dead-owner control is removed; M-N1 (invalid -> absent) flips all of them to removals |
| N1-c (EISDIR) | `mkdir` of the marker path silently failed | the dir is kept with `owner-unknown` only if the read really failed with a non-ENOENT code; M-N1b (every read error = absent) makes exactly this test fail |
| decideRemoval | the order of the rules is accidentally right | explicit cases for `invalid` + alive owner, + `in-use`, + null scan; M-N1e (rule moved after `owner-alive`) fails it |
| Live `win-n1`/`wsl-n1` | the probe cannot fail | before the fix it FAILs 10 checks on all 5 runtimes (`removed:true`), the 4 controls PASS both before and after; the post run is on the compiled module whose sha256 is printed in each log header |
| S4 regression probes | stale module | module sha256 in every log header (`676162d0...` post, `d24edfa8...` pre) |
| Real TEMP | probes touched other sessions' dirs | `realtemp-same=yes` (45 = 45) for each Windows run; WSL under `/tmp/tmp.*` (`wslguard=1`, `mnt-cleanup-paths=0`); every `[cleanup]` path under the ISO / probe root |

Processes started: one short-lived `node -e 0` child per probe run (to obtain a dead PID; exited and awaited by the probe); none left (CIM query for `S6e-4-tmp` command lines: 0).
