# S8b - audit #3 (FINAL) of GAP-315 + GAP-349 + close/recovery ordering, after S6f/S6g/S6h (HEAD cb74d4a)

Auditor: independent (not the S4 or S8 auditor; built none of this). 2026-10-04, 08:28-09:10 IST. Worktree `$WT`
(`.claude/worktrees/project-understanding-696041`), branch `release/0.6.1`, HEAD `cb74d4a71cbd`. No tracked file edited, nothing
committed, dist not rebuilt. This is GAP-315 audit **#3**: any verdict other than ACCEPT would mean BLOCKED and revert (plan B.2/B.3).

## 1. Verdict: **ACCEPT**

Every scope item below was re-run or re-derived by me, with my own harnesses where the brief asked for independence, and every one
PASSES. The three S8 findings are fixed and the fixes are proven to be what catches them (each one is shown to fail with the fix
reverted). No blocking finding; 7 INFO items (S8b-1..S8b-7) (section "Findings"), none of which can make 0.6.1 ship broken, unsafe or falsely verified.

| # | scope item (brief / plan-review-B F10) | result | key evidence |
|---|---|---|---|
| pre | location, commits <-> steps, dist sha + freshness, modes, seam leakage | PASS | dist `9858726a` byte-identical to a scratch rebuild of HEAD source; S6f/S6g/S6h = 3 commits, 1:1 |
| 1 | S4 probes unmodified on v25/v18/v20/v22 + WSL Node 20; win-a7b/wsl-a7b; win-plant x4; N1; live A4 (Chrome + Edge, headless + headed) | PASS | 28/28 sha OK; only the 2 sanctioned PATH='' pairs fail; replacements 8/8 x4 and 18/18; browser 83/83 x4 modes |
| 2 | S7 live harness unmodified (`1b7091a9`) | PASS | 256 PASS / 0 FAIL |
| 3 | full mutant set: M-O6 i-v, M-B2a-g (+d2/e2), M-b (+b2/b4), S6a-S6e/A.7, S4 M1-M6, G/D | PASS | 58/58 caught, baseline green, WT source unchanged; + probe-level and live mutant controls fail as required |
| 4 | independent live A/B, close and self-heal: 0.6.0 vs HEAD vs bff46db control (F3 a-e, F4) | PASS | 0.6.0 = HEAD = `exit 1` + `Fatal: EBUSY ... state.json`; control and M-B2d/e live mutants exit 0 |
| 5 | S6h: T5 deterministic assertion + one load run (F6) | PASS | assertion on the module's own value; OLD T5 fails / NEW passes under injected latency; 10/10 under load |
| 6 | full package matrix + Linux (WSL Node 20) runs of the cli specs + tsc + spec typecheck | PASS | 20/20 entries exit 0, no regression; Linux 115 passed / 3 skipped x3; tsc 0; spec tsc = 7 baseline errors |
| 7 | adversarial read of the S6c..S6h diff and the full packages/cli diff | PASS | no data-loss / TOCTOU / fail-open / PID-reuse / exit-code / seam issue beyond INFO |
| 8 | S8 auditor's live cases B1/B4/B5/C4; CLR only F4-safe | PASS | `RESULT fails=0`; CLR replaced by the scope-4 harness (no stale-PID kill) |


## 2. Per-item results (exact commands and output excerpts)

### Pre-checks - location, commits <-> steps, dist freshness - **PASS**

- `git rev-parse --show-toplevel` = `$WT`, `git branch --show-current` = `release/0.6.1`, HEAD `cb74d4a`; tree clean except
  `evidence/S8b/` (re-checked at the end).
- Commits <-> plan B.1 steps, one each: `e19e189` S6f = `close-session.spec.ts` only (+ evidence); `fe71ceb` S6g =
  `close-session.ts` + `close-session.spec.ts` (+ evidence); `cb74d4a` S6h = `temp-profile.spec.ts` only (+ evidence); `8fa2516` =
  S8 evidence + Addendum B + plan-review-B + replan pointer (no package file). `git diff bff46db..HEAD -- packages/` touches exactly
  those three files.
- dist: `sha256sum packages/sutradhar/dist/cli-bin.js` = **`9858726a...`** (!= the control `48c1756c...`); contains `clearFailed`
  (3) and no `could not clear the session state`. **Freshness re-derived by content, not mtime**: a scratch-only esbuild of HEAD's
  `packages/cli/src/cli.ts` with the exact options of `scripts/build-bundle.mjs` (absWorkingDir `packages/sutradhar`, outfile
  `$SP/S8b/rebuild/cli-bin.js`) is **byte-identical** to dist (`dist-freshness.txt`: `BYTE-IDENTICAL-TO-DIST`; a first rebuild with the
  wrong working dir differed in 300 path-comment lines, so `cmp` can fail). INFO: `temp-profile.ts` has a newer *mtime* (08:20:49) than
  dist (08:07:22) because S6h's mutant apply/restore rewrote it; its content (`346572f5...`) is unchanged since `4f26526`.
- Seams do not leak: `dist/index.js` and `dist/mcp-cli.js`: `killChromeTree=0 sweepStaleTempProfiles=0 stopSpawnedChrome=0`.
- File modes: every tracked `*.sh` under `.ai/loop/release-0.6.1` is `100755`; new `packages/cli` files `100644`; no mode change in
  `packages/`.

### Scope 1 - S4 probes unmodified on 5 runtimes + win-a7b/wsl-a7b + win-plant + N1 + live A4 - **PASS**

- Probe integrity: `(cd evidence/S4/probes && sha256sum -c ../probes.sha256)` -> **28 x OK** (`probes-sha-check.txt`); N1 probes
  `sha256sum -c probes-s6e4.sha256` -> 3 x OK; `win-a7b.mjs` = `4cbca689...` (S8), `wsl-a7b.mjs` = `089482f3...` (S6e).
- Module (A.5-1): `node_modules/.bin/esbuild packages/cli/src/temp-profile.ts --bundle --format=esm --platform=node --target=node18
  --outfile=$SP/S8b/mod/temp-profile.mjs` -> `676162d0...` (`module.sha256`; source `346572f5...`). The same sha is printed inside
  every WSL log (10 x `676162d0...  temp-profile.mjs`).
- A.5-5 precondition: `upper-holders-before.txt` -> `total-prefixed=34 upper-case=0` (a first query counted 3 `bash.exe` = my own
  launching shell, whose heredoc contained the upper-case text: a P7 self-match; re-run from a script file -> 0).
- Runners: `run-win-s8b.sh` / `run-wsl-s8b.sh` / `run-browser-s8b.sh` = S8's runners with only output/ISO/module paths changed
  (copies in `scripts/`; the diffs vs S8's runners are path-only); probes executed in place from `evidence/S4/probes` (unmodified).

| probe | v25 | v18 | v20 | v22 | WSL Node 20.20.2 |
|---|---|---|---|---|---|
| win-a1 / wsl-a1 | 66/66 | 66/66 | 66/66 | 66/66 | 63/63 |
| win-a2 / wsl-a2 | 6/6 | 6/6 | 6/6 | 6/6 | 4/4 |
| win-a3 / wsl-a3 | 12/12 | 12/12 | 12/12 | 12/12 | 7/7 |
| win-a5 / wsl-a5 | 20/20 | 20/20 | 20/20 | 20/20 | 6/6 |
| win-a5case | 2/2 | - | - | - | - |
| win-a6 / wsl-a6 | 5/5 | 5/5 | 5/5 | 5/5 | 3/3 |
| win-a7 / wsl-a7 | 5/7 (the 2 sanctioned) | 5/7 (sanctioned) | 5/7 (sanctioned) | 5/7 (sanctioned) | 4/6 (the 2 sanctioned) |
| win-a7b (S8) / wsl-a7b (S6e) | 8/8 | 8/8 | 8/8 | 8/8 | 18/18 |
| win-plant | 2/2 | 2/2 | 2/2 | 2/2 | - |
| win-n1 / wsl-n1 | 14/14 | 14/14 | 14/14 | 14/14 | 14/14 |
| wsl-c5a / wsl-c5b / wsl-port | - | - | - | - | 3/3, 5/5, `# pass 19 # fail 0` |
| live browser (A4-pre/A4/B2/A5; child per runtime) chrome-headless, chrome-headed, edge-headless, edge-headed | 83/83 each mode, all four runtimes inside each run | | | | n/a |

- The only FAIL lines anywhere: `FAIL A7 powershell unresolvable -> scan null :: got=array(35)` and `... -> close keeps ::
  {"removed":true}` (x4 runtimes) and WSL `FAIL A7 ps unresolvable -> null :: got=[]` / `-> close keeps` = exactly the two
  sanctioned PATH='' pairs of A.5-3; their replacements win-a7b (8/8 x4) and wsl-a7b (18/18) pass.
- Flipped probes hold: win-a2 6/6 (F1), win-a5 incl. `PASS A5 upper: in-use with real scan :: {"removed":false,"reason":"in-use"}`
  and win-a5case 2/2 (F2), win-plant v18 `planted scan took ms=491 ... PASS PLANT: scan unaffected ... PASS PLANT: in-use stand-in
  dir kept` (F3); win-a1 `OBS file-named-like-profile removed=false` x4 (N3). A5 attribution = stand-in only (`["81956/79232/node.exe"]`).
- A4 with the A.6 P4 criteria, e.g. `[v22] PASS A4 close removed:false :: ...EBUSY ... lockfile`, `[v22] PASS A4 close no file missing
  :: count 336->339 ... missing=[]`, `[v22] PASS A4 /json/version still answers after close attempt`, `PASS A4-pre lockfile still
  there`; browsers `Chrome/154.0.8037.97`, `Edg/154.0.4258.53`; every browser killed by the probe by its own PID
  (`PASS browser pid exited within 15 s`) and the post-kill positive control `{"removed":true}`.
- A9: `wsl/a9-guard-negative.log`: PROBE_ROOT=/mnt/... -> `case1-exit=97`; TMPDIR outside PROBE_ROOT -> `case2-...-exit=97`; mktemp
  root -> `[wsl-guard] root=/tmp/tmp...`; every WSL log `wslguard=1 mnt-cleanup-paths=0`; every WSL `D` removed by its own guarded rm
  (`# removed own D=/tmp/tmp.*` x11).
- X1: every Windows probe log `pathcheck=0`, every browser log `outside-iso=0`, every WSL log checked against its own PROBE_ROOT with
  `MSYS_NO_PATHCONV=1` -> `outside-iso=0`; wrong-root control on a WSL log -> `outside-iso=19`.
- Real TEMP: every per-probe before/after pair identical (`realtemp-same=yes` in every summary line).

### Scope 2 - S7 live harness re-run unmodified - **PASS (256 PASS / 0 FAIL)**

- `sha256sum evidence/S7/gap315-live-merged.mjs` = `1b7091a9...` (= `evidence/S7/harness.sha256`), page server `6af4b612...`;
  run in place under the preamble: `TEMP=TMP=TMPDIR=$SP/Q7 NODE_OPTIONS=--import=<guard> SUTRADHAR_CLI_DEBUG_CLEANUP=1
  S7_SP=$SP S7_WT=$WT S7_EV=evidence/S8b/s7rerun timeout 1150 node evidence/S7/gap315-live-merged.mjs` (ISO `Q7`: profile path 198).
- `s7rerun/harness.log`: header `cli-bin sha256=9858726a...`; `PASS=256 FAIL=0`, `ALL PASS`, `# exit=0`; `REALTEMP end count=45
  baseline=45 disappeared=[] appeared=[]`, outer `REALTEMP-IDENTICAL`.
- Timings (CLI's own performance.now lines): `phase kill n=10 p50=342 max=389`, `phase cleanup p50=516 max=602`, `scan max=583`,
  whole close p50 1092.5 ms. L1 110 iteration checks, L3 P4 `pre=283 missing=[]`, L5a `EFTYPE` created==removed, L5b `Chrome exited
  (code 9)` in 1230 ms with `alive=false` and no kill phase, L7 mutant leaves the dir, L9 `state.json absent` + second close
  `No active session.`, L12 `state.json ABSENT`, L12m (M-O6 dist patch, `occurrences-replaced=1` on the post-S6g bundle = F8 anchor
  re-check) `state.json REMAINS`.
- X1: `s7rerun/pathcheck-s8b.txt`: Q7 root `cleanup-lines=271 outside-iso=0` exit 0; `S 7` root `cleanup-lines=20 outside-iso=0`;
  wrong-root control exit 1; 49 `[iso-guard]` lines, 0 `ISOLATION GUARD`.

### Scope 4 - independent re-derivation of the S6g live close A/B and self-heal A/B - **PASS**

My own harness (`ab/ab8b.mjs`, written from the F3/F4 text, not the builder's `s6g-ab.mjs`), one run = one binary x one case in its
own ISO (`$SP/A1..A8`) and own `SUTRADHAR_CLI_STATE_DIR`:
- binaries: 0.6.0 = `$SP/verify060/inst/node_modules/sutradhar/dist/cli-bin.js` `d71da592...` (identity: tarball `c803dab1...` = the
  row on master `324ee8f`, and the tarball's own `package/dist/cli-bin.js` = `d71da592...`, version 0.6.0: `v060-identity.txt`);
  HEAD = `packages/sutradhar/dist/cli-bin.js` `9858726a...`; control = `$SP/S6g-ctl/cli-bin.bff46db.js` `48c1756c...`, copied to
  `$SP/S8b/bins/` and loaded with a resolve hook (`bins/pp-hook.mjs`, maps only `puppeteer-core` to the real dist's parent URL; no
  junction). **Control identity re-derived by content**: `diff` control vs HEAD bundle = exactly the S6g hunk (6 lines:
  `clearFailed`/`clearError`/`throw clearError` vs the old `Warning: could not clear the session state`) (`ctl-vs-head-bundle.diff`),
  and `git diff bff46db HEAD -- packages/ ':!packages/cli/tests'` = `close-session.ts` only.
- live mutants (my own dist patches, anchor count 1 each): M-B2e (cmdClose `.catch(() => {})`) `bffe2201...`, M-B2d (self-heal
  `.catch`) `4e9af6a8...` (both byte-identical to the builder's, built independently).
- procedure (F4): `nav` -> (self-heal: rewrite `wsEndpoint` to a closed port, keep our live `chromePid`) -> lock holder
  (`holder.ps1`, `[IO.File]::Open(..,'ReadWrite','ReadWrite')` = no Delete share, path via env) -> ready -> **measured command** ->
  `measuredDone=true` (any later `cli()` throws `F4 VIOLATION`) -> holder released and exit confirmed -> **harness deletes state.json**
  -> Chrome check (read-only wait) -> ownership-checked kills only -> leaked dirs removed by exact-path guarded delete -> leftover
  query with a positive control. No CLI command ever ran on a state dir after its measured command; no stale PID was ever signalled.

`ab/compare.txt` (`compare8b.mjs` re-evaluates the AC from the saved JSON; `compare-exit=0`, `compare-bad=0`):

| run | exit | Fatal line | "Session closed." | debug (HEAD-type builds) | dir at return | state.json after |
|---|---|---|---|---|---|---|
| 0.6.0 close | 1 | `Fatal: EBUSY: resource busy or locked, unlink '...\A1\st\state.json'` | absent | n/a (no seam) | leaked (harness removed) | chromePid 76796 |
| HEAD close | 1 | `Fatal: EBUSY ... '...\A2\st\state.json'` | absent | `phase kill` yes, `state-cleared` no, `removed path=<dir>` at line 6 < `Fatal:` at line 8, no "could not clear" | removed by the CLI | chromePid 83668 |
| ctl (bff46db) close | **0** | none | **printed** | `Warning: could not clear the session state (EBUSY ...)` | removed | chromePid 75068 |
| 0.6.0 self-heal (`nav`) | 1 | `Fatal: EBUSY ... A4\st\state.json` | absent | `Note: previous session was unreachable` | leaked | chromePid 83712 |
| HEAD self-heal | 1 | `Fatal: EBUSY ... A5\st\state.json` | absent | unreachable note; `removed` line 7 < `Fatal` line 9 | removed | chromePid 59564 |
| ctl self-heal | **0** | none | - | swallowed, fresh session started | removed | fresh chromePid 84768 |
| M-B2e close (live) | **0** | none | **printed** | - | removed | chromePid 81220 |
| M-B2d self-heal (live) | **0** | none | - | fresh session started | removed | fresh chromePid 83428 |

- `typeof status === 'number'`, `signal=null`, `timedOut=false` in all 8; Chrome not alive when each CLI returned
  (`aliveAtReturn=false`, live CIM ownership check), `chromeGoneFinal=true`.
- Kills: exactly two, both ownership-checked (CIM CommandLine contains the run's ISO) and both of a FRESH Chrome started by a
  swallowing build (ctl self-heal 84768, M-B2d 83428): `PASS owned pid ... exited within 15 s`. 8/8 positive controls found the
  dummy; 8/8 `no process references the ISO at the end`; real TEMP identical per run and for the batch (`REALTEMP-BATCH-IDENTICAL`).
- Path check (`ab/pathcheck.txt`): every HEAD/ctl/mutant run `outside-iso=0` (9-11 lines each); 0.6.0 has no seam (0 lines);
  wrong-root control `outside-iso=5`; 2 `[iso-guard]` lines per run, 0 `ISOLATION GUARD`.
- Disclosure: my first `compare8b.mjs` reported 4 FAILs that were my own regex bug (the shell tool collapsed the doubled backslash inside a regex character class, so it
  matched only `/`); kept as `ab/compare-attempt1-regex-bug.txt`; fixed regex, same JSON -> 0 FAIL.

This independently re-derives the S6g README's live claims (close A/B, self-heal A/B, negative control, M-B2d/M-B2e live, 0.6.0
identity) - the brief asked for at least 3.

### Scope 3 - full mutant set - **PASS (58/58 caught; baseline green; 0 anchors missed)**

Method: `mutrun8b.cjs` mutates ONLY a scratch copy (`$SP/S8b/mut/packages/cli`, src+tests copied from WT, `COPY-IDENTICAL 41 files`);
per mutant: restore from WT, apply each edit (anchor must occur exactly once, CRLF files keep CRLF), run vitest (JSON reporter) on the
five GAP-315/349 spec files, list failed tests, restore, sha-compare with WT. CAUGHT = >=1 failure AND every `mustFail` substring
matched by a failed test. Defs = `defs8b.cjs`: S8's 41 definitions re-run as-is (minus its M-O1/M-O6, superseded) + 19 written by me.
Nothing else ran during the batch (no load-induced "catch"). Output: `mutants.txt` (every failed test listed per mutant).

| group | mutants | result (failed tests) |
|---|---|---|
| BASELINE (copy, no change) | - | `0 failed / 118 passed` |
| S6f: M-O6 placements | i (last stmt in `if (!closeBlocked)`), ii (inside nested try), iii (first stmt after `{`), iv (inside `catch {}`), v (before the `if` in the else) | each `1 failed / 117 passed` = exactly `(b) exactly one clearState( ...` |
| S6g: M-B2 | a-swallow (6 failed: G6g-1,1b,3,4,5,6), a-old-warn = the exact bff46db code (6), b rethrow-before-cleanup (5 incl. G6g-1b), c wrapped error (5 incl. G6g-6 identity), d `.catch` at self-heal (1 = O6b self-heal), e `.catch` at cmdClose (1 = O6b cmdClose), d2/e2 `try {} catch {}` at the call sites (1 each, the matching O6b test), f1 cleanup error thrown instead (1 = G6g-3), f2 rethrow skipped when cleanup fails (1 = G6g-3), g rethrow only on the tempProfile path (1 = G6g-4) | all CAUGHT |
| S6b/O (post-S6g anchors) | M-O1-s6g (10 failed incl. O1, O2), M-O2, M-O3, M-O4-default (O8), M-O4-wiring (O6), M-O5 ((a) + (b)), M-O7 (O9), M-O7-pid (O10), M-T10 | all CAUGHT |
| S6h / S6a deadline | M-b `remaining < 0` (T5: `expected 656 to be greater than or equal to 1000`), M-b2 `/ 2` (T5: `expected 653 ...`), M-b4 rm-attempt log removed (T5 `expected 0 to be greater than or equal to 1` + T6: T5 cannot pass vacuously), M-a (T1), M-c (T3), M-d (T6), M-e (T8), M-f (T6b) | all CAUGHT |
| A.7 / S6e | M-F1a, M-F1b, M-F1c, M-F1c-only-recheck (F1-e), M-F2 (F2-a/b/c), M5, M-F3 (F3-a), M-F3-kill (F3-c, F3-d), M-N1 (9 N1 tests), S4 M1, M2 (= N4-a only), M3, M4, M6 | all CAUGHT |
| S6c / S6d | M-G1..M-G8, M-seam, M-D-proc-empty, M-D-noread-empty (D7) | all CAUGHT |

Summary line: `58 x "CAUGHT=true restored=true"`, `BASELINE-GREEN=true`, `runner-exit=0`, **`WT-SRC-UNCHANGED`** (sha256 of
`packages/cli/src/*.ts` identical before/after).

Additional controls (`controls-t5-guard.txt`, same runner):
- `OLDGUARD-M-O6-i`: the PRE-S6f guard line (`toBeGreaterThan(cb + cbBlock.length - 1)`, = `git show 8fa2516`) + placement (i) ->
  `0 failed / 25 passed` (survives), i.e. S6f's fix is what catches it (re-derives S6f's RED-BEFORE claim); `OLDGUARD-only` green.
- `LAT80-*` (behaviour-preserving 80 ms await between the module's deadline check and the rm call): NEW T5 `0 failed` (passes);
  OLD T5 (from `fe71ceb`) `1 failed`: `expected 952.9148 to be greater than or equal to 975`; OLD T5 without latency passes (re-derives
  S6h's loadsim claim with my own edit).
- Probe-level (`negative-controls.txt`): fail-open scan module -> win-a7b v25 `5 PASS 3 FAIL` (`got=array(0)`, close `{"removed":true}`);
  M-F3 module (bare `powershell.exe`) -> win-plant v18 `planted scan took ms=8032 ... FAIL PLANT: scan unaffected`; M2 module (lockfile
  probe removed) -> live chrome-headless `FAIL A4 close no file missing :: count 230->119` (+ v18/v20 fails); real modules pass all three.
- Live (scope 4): M-B2e and M-B2d dist patches FAIL the live A/B predicate.

### Scope 5 - S6h: T5 deterministic assertion + one load run - **PASS**

- Deterministic assertion: T5 collects the module's own `[cleanup] rm-attempt ... path="<dir>" ... remaining-ms=N` lines (spy on
  `process.stderr.write`, debug env restored in `finally`) and asserts `N >= MIN_RM_START_MS` with zero slack and `>= 1` attempt.
  `N` is `Math.round(remaining)` of the very value the `< MIN_RM_START_MS` check used; an attempt only starts when `remaining >= 1000`,
  so the assertion can only fail if the module itself starts an attempt too late. Mutants: M-b, M-b2, M-b4 all fail T5 (scope 3).
- Latency control (mine): NEW T5 passes and OLD T5 fails with 80 ms injected between check and rm (scope 3 controls).
- Load run (`load/load10.log`, my generator `load/gen.mjs`, F6): 32 logical cores -> 8 workers (quarter, <= half), self-terminate
  after 180 s, random marker only in worker argv, PIDs logged (`load/loadgen-pids.txt`); positive control `marker-processes=8`;
  `RESULT pass=10 fail=0` (module remaining-ms per run `1999,13xx`); stop: `marker confirmed, taskkill ok` x8 by PID; final query
  `marker-processes=0`. Measured CPU was only 17% during the runs: this is supporting evidence only (as B.3 F5 says); determinism
  rests on the assertion design + the latency control.
- Residual (INFO, as S6h recorded): T5 could still fail if more than ~1 s of latency hit BEFORE the first attempt (then `attempts=[]`);
  that is a generous bound, not a tight threshold. M-b's detection relies on the third attempt landing in [0,1000) ms (true here).

### Scope 8 - S8 auditor's own live cases (`evidence/S8/s8-live.mjs`, sha `90d76249...` = S8's record) - **PASS**

Run unmodified with `CASES=B1,B5,C4,B4` under the preamble (ISO `$SP/Q8`; the script itself creates `$SP/S8y` for B5); **CLR was not
re-run in its unmodified form** (it issues a second `close` on stale state = a stale-PID kill, F4); its F4-safe form is my scope-4 A/B
(`head close` row). `live/harness.log`: `RESULT fails=0`, `# exit=0`:
- B1: concurrent navs exit 0/0, distinct dirs; both live dirs backdated 25 min; third session's sweep `A=in-use,in-use B=in-use,in-use`,
  `missA=[] missB=[]`; both still evaluate (`A=0:42 B=0:42`); concurrent closes remove only their own dir; third survives; 3 Chromes gone.
- B5: close with a different TEMP: exit 0, `Warning: could not remove temp profile ... (not-auto-temp)`, dir kept, state cleared,
  Chrome gone, leftover removed via the module with the right root.
- C4: `.sutradhar.json` viewport applied `901x677`, close exit 0, dir removed.
- B4: 50 small + 1 x ~200 MB stale dirs: `phase sweep ms=779 removed=51 kept-deadline=0` (<= 15 s).
- X1 `live/pathcheck.txt`: `cleanup-lines=276 outside-iso=0` exit 0, wrong-root control exit 1; 16 `[iso-guard]` lines; real TEMP
  identical (`REALTEMP-IDENTICAL`, 45 per case).

### Scope 6 - full package matrix, Linux specs, tsc, spec typecheck - **PASS (no regression)**

- Matrix: `bash evidence/S1/matrix.sh.txt S8b` (unmodified, sha in `matrix-script.sha256`; preamble inside; ISO `$SP/S8b-tmp`):
  `matrix-run.out` all 20 entries `exit=0`. `test-totals.txt` (re-derived from each log with ANSI stripped):

| package | S8 | S8b |
|---|---|---|
| agent / apps-server / browser / capability-runtime / capability | 56 / 28 / 938 / 505 / 6 | 56 / 28 / 938 / 505 / 6 |
| **cli** | 349 passed, 2 skipped | **360 passed, 2 skipped** (+11 = S6g's close-session spec 14 -> 25; S6f/S6h change no counts) |
| config / contracts / dev-runtime / events / frontend / llm | 6 / 7 / 4 / 6 / 29 / 11 | identical |
| mcp-server / memory / observability / sdk / storage / sutradhar / utils / workflow | 156 / 8 / 13 / 16 / 7 / 64 / 20 / 5 | identical |

  Every log has `[iso-guard]` lines (32-52) and 0 `ISOLATION GUARD`; cli log path check `cleanup-lines=395 outside-iso=0`.
- Linux (the builder did not run S6f-S6h on Linux): `wsl/linux-specs.log`, my script `wsl/linux-specs.sh` (one self-contained
  `wsl.exe` call: `mktemp -d` under `/tmp`, copy of HEAD `packages/cli` src+tests - sha256 printed: `temp-profile.ts 346572f5`,
  `close-session.ts 2feb90a4`, `cli.ts 740552c7`, `close-session.spec.ts 47882fec` = the committed blobs - vitest 1.6.1 (= repo), Node
  v20.20.2, guarded rm `# removed own D=/tmp/tmp.KtSxEW8TDQ`): the 5 GAP-315/349 spec files 3 times -> `Test Files 5 passed (5)`,
  `Tests 115 passed | 3 skipped (118)` each run; G6g-1..6, O6b x4, guard (b), T5 (`module remaining-ms at each attempt=1999,1348`)
  all pass. Skips are the documented platform skips (N4-a, F3-c Windows, D10); Windows runs the same 118 as `116 passed | 2 skipped`
  (D11, F3-c POSIX) (`win-5specs-verbose.log`).
- `tsc --noEmit -p packages/cli` -> exit 0 (`tsc.txt`). Spec typecheck (`$SP/r5/tsconfig.specs.json`, = `$SP/S6` copy): 7 errors,
  `SPEC-TSC-SAME-AS-S5-BASELINE`, 0 TS6059, 0 errors in new/changed specs; planted control reports
  `planted.ts(1,7): error TS2322` (`spec-tsc.summary`).

### Scope 7 - adversarial read of `git diff 71f2f6c..cb74d4a -- packages/` and `git diff origin/master...HEAD -- packages/cli` - **PASS (no blocking finding)**

Read in full: `temp-profile.ts` (653 lines), `close-session.ts`, `spawn-session.ts`, `system-binaries.ts`, the `cli.ts` /
`spawn-chrome.ts` / `state.ts` diffs vs master, and the S6f/S6g/S6h test diffs.
- **S6g semantics.** `stopSpawnedChrome`: kill (awaited, only a positive-integer PID) -> `clearState` (error kept) -> cleanup (only
  `typeof userDataDir === 'string' && tempProfile === true`, cleanup errors -> warning) -> `if (clearFailed) throw clearError` (same
  object). The rethrow happens strictly after the cleanup; a kill or cleanup error can never replace it. Both call sites
  (`cli.ts:496` self-heal, `cli.ts:1720` cmdClose) are bare `await` (no `.catch`, no enclosing `try`), so the rejection reaches
  `main().catch` -> `Fatal: <message>`, exit 1, exactly as 0.6.0's unguarded `await clearState()` (live-proven above). Only behavioural
  difference vs 0.6.0 on that path: the dir is removed (0.6.0 leaked it) and the kill is awaited - both improvements, already in scope.
- **Data loss.** Every delete still requires: rule 1 (name regex + direct child of `os.tmpdir()`), `lstat` real-dir check in
  `gatherFacts` *and* again right before each rm attempt, scan success (reject/timeout -> `null` -> keep), owner marker valid-and-dead
  (corrupt -> `owner-unknown`, keep), age for sweeps, and the Windows `lockfile` probe. S6f-S6h changed none of this (temp-profile.ts
  unchanged since 4f26526). Residual TOCTOU between the re-check and `rm(<dir>/lockfile)` needs a same-user attacker who could delete
  the victim directly anyway (as S8 noted) - not a finding.
- **Fail-open.** None found: `runScan` maps a rejecting scan to `null`; `readProcCommandLines` returns `null` when nothing is readable or
  on timeout; `removeSessionTempProfile` / `sweepStaleTempProfiles` catch-all keep.
- **Wrong kills / PID reuse.** Kill sites: `deps.kill` in `stopSpawnedChrome` and `(deps.kill ?? killChromeTree)` in
  `discardSpawnedProfile` only (`grep -rn chromePid / killChromeTree packages/cli/src`). P2x never kills an exited child; malformed
  `chromePid` is never killed. `killChromeTree` vs the S5 merge `254b1ed`: only `'taskkill'` -> `taskkillExe()` and the optional seam
  parameter; POSIX branch identical to master. After a failed clear the recorded `chromePid` survives on 0.6.0 and on HEAD alike (live:
  `state.json after` column) - this is the pre-existing plan-1.5 hazard, not widened (F11 INFO; S10b logs it).
- **Exit codes.** `git diff origin/master...HEAD -- packages/cli/src | grep -cE '^[+-].*(process\.exit|exitCode|printErrorAndExit)'` = 0.
- **Clocks.** All deadlines/loops on `performance.now()`; `Date.now()` only for the dir name, the marker `createdAt` and mtime age.
  T5 now asserts on the module's own `remaining-ms` value (the same variable its `< MIN_RM_START_MS` check used; `Math.round` of a
  value >= 1000 is >= 1000, so rounding cannot false-fail); NaN (unparsable line) fails closed.
- **Seam leakage.** Test seams are optional trailing params / option bags; none reachable from the published library or MCP bundles.
- **Test-guard soundness.** O7 guard (b) now measures from the block's `{` and pins `elseBlock[cbClose] === '}'`; a clear moved out of
  the `else` gives `clearAt=-1` and fails. O6b's detector is itself tested with positive controls (`.catch`, `.then`, `try {}`,
  `try/finally`) and a negative control (a try elsewhere).

## Safety and process record

- Location verified before writing (`$WT`, `release/0.6.1`). No tracked file edited, nothing committed, dist not rebuilt (only a
  scratch-only bundle under `$SP/S8b/rebuild/`). Writes: `evidence/S8b/` and my own `$SP` dirs: `S8b/` (scripts, scratch copy,
  bins, mod, modmut, rebuild, load, mutjson, draft), ISOs `S8b-tmp-*`, `Qb`, `Q7`, `S 7` (created by the unmodified S7 harness),
  `Q8`/`S8y` (created by the S8 live script), `A1..A8` (A/B).
- **Process deviation (disclosed):** one early command of mine contained a stray `cp ... "$WT/scripts/.s8b-rb-tmp.mjs"` that
  created an untracked helper file in the repo's `scripts/` dir; the same command line removed it (`rm -f`) and `git status
  --porcelain` immediately after showed only `evidence/S8b/`. No tracked file was touched.
- Mutants ran only in `$SP/S8b/mut` (a copy of `packages/cli` src/tests; `node_modules` via two junctions created with
  `fs.symlinkSync(..., 'junction')`); WT `packages/cli/src/*.ts` sha256 identical before/after (`src-sha-before/after-mutants.txt`).
- Kills: browsers by the S4 probe by its own PID; CLI Chrome by the CLI itself; my A/B harness made exactly 2 ownership-checked kills
  (fresh Chromes of swallowing builds); load workers killed by PID only after a live CIM marker check. Nothing killed by image name.
- Real TEMP (`E:/AI-Cache/tmp/sutradhar-cli-*`): see "Real TEMP" below.

### Real TEMP and leftovers

- `snapshots/realtemp-start.txt` (08:28) = `snapshots/realtemp-end.txt` (09:10): 45 = 45, byte-identical (`REALTEMP-START-END-IDENTICAL`);
  basenames also identical to S8's end list and S6h's after list. Every per-probe / per-run / per-case before/after pair identical.
  4 entries have an mtime newer than my start stamp (`snapshots/compare.txt`; all pre-existing names = other sessions' live dirs,
  the same pattern S7/S8 recorded); no `[cleanup]` path in any of my logs lies outside my own roots (all path checks above).
- `leftover-processes.txt`: positive control (a dummy node with `$SP/Q7/...` in argv) `found=true`, then **0** processes referencing
  any of my roots. Load workers: final marker query 0. All my ISO roots (32) deleted afterwards with an exact-path guard after a link
  scan (24 links, all pointing inside their own tree), the two scratch junctions unlinked as links first and the WT `node_modules`
  confirmed intact (`iso-cleanup.txt`; attempt 1 of the delete refused everything because my guard compared `/` and `\` paths: failed
  closed, recorded).
- No background process of mine is running (S7 harness, mutant batch and matrix all completed; load workers stopped and confirmed gone).

## Findings

Severity discipline: blocking = a concrete way 0.6.1 could ship broken, unsafe (data loss, deleting another session's profile,
killing an unrelated PID, security) or falsely verified. None of the items below meets that bar.

| id | severity | blocking? | finding | evidence | required fix |
|---|---|---|---|---|---|
| F-S8-1 (S8) | was MEDIUM | **resolved** | O7 guard (b) measured from the `if` keyword | placements i-v all fail the HEAD guard; placement i survives the pre-S6f guard (`OLDGUARD-M-O6-i` green) | none |
| F-S8-2 (S8) | was LOW | **resolved** | failed state clear exited 0 | live A/B: 0.6.0 and HEAD both `exit 1` + `Fatal: EBUSY ... state.json`, close and self-heal; bff46db control and M-B2d/e live mutants exit 0 | none |
| F-S8-4 (S8) | was LOW | **resolved** | T5 load-sensitive | T5 asserts the module's own `remaining-ms`; OLD T5 fails / NEW T5 passes under an injected 80 ms latency; 10/10 under load | none |
| S8b-1 | INFO | no | `temp-profile.ts` mtime (08:20:49) is newer than dist (08:07:22) | S6h mutant apply/restore rewrote the file; content `346572f5...` unchanged since `4f26526`; scratch rebuild byte-identical to dist | none (an mtime-only freshness gate, e.g. `check-release-ready.mjs`, may flag it at S11; a rebuild there is harmless) |
| S8b-2 | INFO | no | after a failed state clear, `state.json` still records `chromePid` on 0.6.0 and on HEAD alike; the next command's self-heal re-kills that stale PID | `ab/compare.txt` "both left chromePid recorded"; plan 1.5 / F11 | none in 0.6.1 (pre-existing hazard, not widened; S10b entry per F11) |
| S8b-3 | INFO | no | `system-binaries.ts` trusts `%SystemRoot%`: a relative/attacker-chosen value would defeat the "absolute system path" property | code read | none: whoever controls the CLI's environment already controls `NODE_OPTIONS`/`PATH`; not a privilege boundary |
| S8b-4 | INFO | no | T5 can still fail if > ~1 s of latency lands before the FIRST rm attempt (then 0 attempts); M-b detection needs the 3rd attempt in [0,1000) ms | design read; load run 10/10 | none (generous bound, recorded) |
| S8b-5 | INFO (carry F-S8-6) | no | the unmodified S4 `win-browser.mjs` cannot keep `--user-data-dir` <= 200 under `$SP` (205 here) | browser logs; Chrome 154 / Edge 154 started normally in all modes | none |
| S8b-6 | INFO (process, builder) | no | S6g README deviation 2: the builder's `iso-rm.sh` deleted its own scripts dir (`$SP/S6g`), not an ISO | S6g README; copies were in evidence; nothing else touched | none |
| S8b-7 | INFO (process, me) | no | (a) a stray `cp` into `$WT/scripts/` removed in the same command (untracked, `git status` clean right after); (b) my first upper-case-holder query self-matched my shell (P7) - re-run from a script file = 0; (c) my first `compare8b.mjs` had a regex bug (4 false FAILs) - fixed, attempt kept | `upper-holders-before.txt`, `ab/compare-attempt1-regex-bug.txt` | none |

## False-pass analysis of my own checks

| check | how it could pass while broken | what rules it out (command -> output) |
|---|---|---|
| dist under test | stale bundle (pre-S6g) or a build not from HEAD source | scratch esbuild of HEAD source with the build script's options is byte-identical to dist (`BYTE-IDENTICAL-TO-DIST`); wrong-cwd rebuild differs (cmp can fail); dist != control (`9858726a` vs `48c1756c`), control-vs-HEAD diff = exactly the S6g hunk |
| S4 probes | wrong module (e.g. S4 branch), or probes edited | module built from HEAD (`676162d0`, printed inside every WSL log), probes `sha256sum -c` 28 OK before running; probe-level mutant modules flip them (row "probe-level negative controls") |
| A4 live | `removed:false` while entries were deleted (S4 M2) | P4 criteria (`missing=[]` against a pre-call snapshot, lockfile present, `/json/version` answers); the M2 module run makes the same probe FAIL |
| A/B close + self-heal | an unrelated failure (attach error, timeout, `status=null`) satisfies "non-zero, no Session closed." | predicate also needs a numeric status, no timeout/signal, a `Fatal: EBUSY` line naming `st\state.json`, equal on 0.6.0 and HEAD, and on HEAD `phase kill` + no `state-cleared` + `removed(dir)` BEFORE `Fatal:`; the bff46db control and both live call-site mutants FAIL the same predicate in the same harness |
| A/B lock real? | state.json deletable, failure from elsewhere | the CLI's own Fatal text is `EBUSY ... unlink '...state.json'`; the control prints the same EBUSY as its swallowed warning |
| A/B teardown | a 2nd CLI command re-kills a stale PID | structural `F4 VIOLATION` throw after the measured command; `pids-*.txt`: the only kills are 2 ownership-checked fresh Chromes |
| mutants | anchor not applied / copy differs from WT / load-induced failure counted as "caught" | anchor must occur exactly once (`NOT APPLIED` otherwise: none); BASELINE copy green (118/118) before; each file restored and sha-compared (`restored-identical=true` every row); WT `src` sha256 identical before/after (`WT-SRC-UNCHANGED`); nothing else ran during the batch; every failure list is the intended test(s) (e.g. M-B2d -> exactly the O6b self-heal test, 1 failed / 117 passed) |
| M-O6 i-v | the placements do not actually put the clear inside the block | M-O6-i with the PRE-S6f guard survives (`OLDGUARD-M-O6-i` green), with the HEAD guard it fails: same edit, only the guard differs |
| T5 determinism | "usually passes" | asserted value is the module's own `remaining-ms`; with an 80 ms behaviour-preserving latency injected the OLD T5 fails and the NEW one passes (`LAT80-*` rows); load run is supporting only |
| load run | generator did nothing | positive control finds the workers before the runs, CPU% recorded during load, final marker query 0 |
| Linux specs | tests skipped instead of run | counts per run (passed + skipped = total) and the skip list are recorded; skips are the documented platform skips only |
| real TEMP | another session added and removed a dir in between | start/end lists byte-identical by name; every `[cleanup]` path of every log under my own roots (path checks with wrong-root controls that fail) |
| leftover processes | CIM query vacuous | positive control (a dummy with my ISO path in argv is found) before every final 0 |

## Files (evidence/S8b/)

`audit.md` (this), `dist-freshness.txt`, `module.sha256`, `module-mutants.sha256`, `probes-sha-check.txt`, `upper-holders-before.txt`,
`win/` + `win-summary.txt`, `wsl/` + `wsl-summary.txt` (+ `a9-guard-negative.log`, `linux-specs.sh/.log`), `browser-summary.txt`,
`negative-controls.txt`, `s7rerun/`, `ab/` (`compare.txt`, `result-*.json`, `run-*.log`, CLI stdout/stderr, `pids-*.txt`,
`pathcheck.txt`, `binaries-and-harness.sha256`), `ctl-vs-head-bundle.diff`, `v060-identity.txt`, `mutants.txt`,
`controls-t5-guard.txt`, `src-sha-before/after-mutants.txt`, `load/`, `live/`, `test-*.log`, `test-totals.txt`, `matrix-run.out`,
`matrix-script.sha256`, `win-5specs-verbose.log`, `tsc.txt`, `spec-tsc.txt`, `spec-tsc.summary`, `snapshots/`, `leftover-processes.txt`,
`iso-cleanup.txt`, `scripts/` (copies of every harness/runner/defs file I wrote).
