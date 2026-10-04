# S6c - GAP-349: all spawn-failure leak paths remove their own dir, via deterministic seams

Source state tested and committed: `source.sha256` (spawn-chrome.ts, spawn-session.ts, cli.ts, temp-profile.ts, spawn-failure-cleanup.spec.ts).
Logs of every command are in this directory (`test-cli.log`, `mutants.txt`, `call-site-checks.txt`, `floating.txt`, `spec-tsc.txt`, `pathcheck.txt`).
Helper scripts used (copied here): `vt.sh` (cli vitest under the isolation preamble), `mut.sh` + `mutrun.cjs` + `S6c-defs.cjs` (mutants), `spectsc.sh`.

## What changed
- `spawn-chrome.ts`: `spawnDetachedChrome(..., deps: SpawnDeps = {})` with seams `executablePath, tmpRoot, spawnFn, probeEndpoint, startTimeoutMs, kill, removeProfile, isAlive`;
  new exported `discardSpawnedProfile(target, deps)` (kills only if `alive !== false`, passes the pid to the removal only when a kill was issued, never throws);
  P0 sync throw, P1 no PID (async `error` read after the awaited discard, plus an always-attached `error` listener: a missing Chrome binary used to be an unhandled `error` event),
  P2 timeout with the child alive, P2x child already exited (no kill; the start loop stops early once `exit` was seen); start loop on `performance.now()`.
  `kill` defaults to `killChromeTree` by reference (0.6.0 kill semantics unchanged).
- new `spawn-session.ts`: `attachOrDiscard(spawned, attach, discard)` (F8): awaits the discard, then rethrows the ORIGINAL error; a failing discard cannot replace it.
- `cli.ts` `spawnFreshSession`: the attach + setViewport block runs through `attachOrDiscard(..., discardSpawnedProfile)`; the un-awaited `killChromeTree(spawned.pid)` is gone.
- `temp-profile.ts`: `dlog` is exported (debug seam used by `discardSpawnedProfile`, I/O path only).
- `.ai/loop/field-report-2/gaps.md`: GAP-349 row set to DONE.
- new `tests/unit/spawn-failure-cleanup.spec.ts` (12 tests): G1, G2, G3, G3b, G4, G6, success path, G5 x3, discard x2.

## AC table
| AC | result | evidence |
|---|---|---|
| S6c-1: G1-G6 and G3b pass | PASS | `test-cli.log`: `Test Files 20 passed (20)`, `Tests 309 passed (309)`, `spawn-failure-cleanup.spec.ts (12 tests)`. Red first (pre-fix code, stub `attachOrDiscard`): `red-before-change.log` = `Tests 10 failed \| 2 passed (12)` |
| S6c-2: all 9 mutants fail (M-G1..M-G8, M-seam) | PASS | `mutants.txt`: M-G1 (G1), M-G2 (G2), M-G3 (G3, G3b, G6), M-G4 (G4), M-G5 (G5 order), M-seam (G1 + 4 more), M-G6 (G3b + 3), M-G7 (G3: `calls[0].opts.isAlive` is not the fake), M-G8 (G3: the fake's counter stays 0; harness mutant on the spec); `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 before = after for every run |
| S6c-3: `killChromeTree(` exactly once; `grep-exit=1`; every call site awaited | PASS | `call-site-checks.txt`: only the definition (spawn-chrome.ts:230); every `deps.kill(`/`discardSpawnedProfile(`/`attachOrDiscard(`/`stopSpawnedChrome(` non-definition line has `await`; fire-and-forget grep `grep-exit=1`; `date-now-wiring-grep-exit=1`; `Date.now()` only in the dir name and the mtime age (temp-profile.ts:96, 263) |
| S6c-4: ESLint `no-floating-promises` 0 findings | PASS | `floating.txt`: `eslint-exit=0`, no findings over `packages/cli/src/*.ts`; negative control `floating-negative-control.txt` (a planted `f();` is reported: `Promises must be awaited ...`) |
| S6c-5: spec typecheck, 0 errors in `spawn-failure-cleanup.spec.ts` | PASS | `spec-tsc.txt` identical to the S5 baseline (7 errors + 1 continuation line), 0 TS6059; `spec-tsc-negative.txt` planted TS2322 still reported. The first run caught 8 TS2532 in my new spec (`calls[0]` possibly undefined; fixed with a `first()` helper), so the check bites |
| S6c-6: `check-cleanup-paths` exits 0 | PASS | `pathcheck.txt`: `cleanup-lines=215 outside-iso=0`, exit 0; negative control (wrong root) `outside-iso=158`, exit 1. The first run FAILED with 1 outside-iso line (my test used a fake named dir `/some/named/profile` that is only logged, never touched); fixed by putting it under `os.tmpdir()` |
| tsc | PASS | `tsc.txt`: `tsc-exit=0` |
| Guard | PASS | every vitest log has `[iso-guard] tmpdir=...scratchpad/s6c-tmp` lines (51 in `test-cli.log`), 0 `ISOLATION GUARD` |

## Deviations / notes
1. **The red run on the pre-fix code started 7 real Chrome processes** (the old `spawnDetachedChrome` ignores the new `deps` argument, so the G tests launched the real Chrome into the isolated `S6c-tmp`). All were identified by command line (every one named `...\scratchpad\S6c-tmp\...`), killed one by one by PID with `taskkill /PID /T /F`, and a follow-up CIM query returned 0. Details: `red-run-stray-chromes.md`. The real TEMP was never involved; the green runs cannot do this (every G test injects `spawnFn`/`executablePath`).
2. `ChildLike`/`SpawnDeps` types are exported from `spawn-chrome.ts`; `dlog` is now exported from `temp-profile.ts`.
3. G4 additionally injects `isAlive: () => false` (the plan lists it for G3 only): with the default `isPidAlive`, fake PID 4242 could be a real process on Linux CI and keep the dir (a leak, not a loss, but a flaky assertion).
4. The mutation runner used is the scratchpad `mutrun.cjs` (CRLF-aware: it converts a mutant's `from`/`to` to CRLF when the file has CRLF); the S6a/S6b copy in the evidence dirs is not. `spawn-chrome.ts` and `cli.ts` are CRLF files in this working tree (git stores LF).
5. Live verification of the new spawn paths against real Chrome (L5a, L5b) is S7; not done here.
6. The G tests start no process (fake `spawnFn`, fake `kill`).

## False-pass analysis
| AC | way it could pass while broken | what rules it out |
|---|---|---|
| S6c-1 | the tests exercise only the helper, not `spawnDetachedChrome` itself | every G test calls the real `spawnDetachedChrome`; the red run on the unfixed code fails 10 of 12 (`red-before-change.log`) and M-G1..M-G4 each break exactly the matching path |
| S6c-1 (G3) | `removeSessionTempProfile` quietly used its default liveness probe, not the injected seam | `calls[0].opts.isAlive` is asserted with `toBe(fake)` AND the fake's call counter must be > 0; M-G7 (product drops it) and M-G8 (harness drops it) both fail G3 |
| S6c-1 (G3b) | the dir removed while the killed child is still "alive", or removed only because the kill pid was never passed | the event list must read `kill-end` -> `isAlive=false` -> `removed`, and no `rm-while-alive` event; M-G6 (pid not passed) fails it |
| S6c-1 (G4) | the child is killed anyway and the test only checks the dir | `killCalls` must equal `[]` and `calls[0].pid` must be undefined; M-G4 fails it |
| S6c-1 (G1/G2) | the dir is gone because it was never created under `tmpRoot` (e.g. in the real TEMP) | the wrapper records `existsSync(dir)` and `dirname(dir) === tmpRoot` at discard time; M-seam (tmpRoot ignored) fails G1 |
| S6c-1 (G5) | the discard is started but not awaited | order must be `attach, discard-start, discard-end, rethrow` with a 30 ms discard; M-G5 (`void discard`) fails |
| S6c-2 | a mutant is "caught" because it broke compilation or a different test | each row lists a normal `Tests N failed | M passed (12)` line and the named test(s); the first mutant run showed 3 `EDIT NOT APPLICABLE` (CRLF vs LF), which the runner reports instead of silently skipping, and they were re-run after normalising the file |
| S6c-3 | the grep misses a differently spelled fire-and-forget | `no-floating-promises` (ESLint, type aware, with a planted negative control) covers all promise-returning calls, not only the named symbols |
| S6c-6 | the checker passes vacuously | `cleanup-lines=215 > 0`, wrong-root control exits 1, and the checker FAILED once for real in this step (the fake named dir) |
| Real TEMP | a test touched another session's dirs | real-TEMP `sutradhar-cli-*` list identical before/after (45 = 45, `cmp`), every `[cleanup]` path under the ISO dir; the ISO dir was deleted with the guarded form after the CIM query showed no process referencing it |
