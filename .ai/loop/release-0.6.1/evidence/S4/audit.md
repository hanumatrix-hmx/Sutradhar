# S4 - GAP-315 pre-merge independent audit (branch `fix/gap-315-temp-profile-cleanup`, d84b160 + 8ba1649)

Auditor: independent (did not build it). Date 2026-10-04. Worktree `$WT` @ e4670ed (`release/0.6.1`), read-only for source.
Module under test: `git show fix/gap-315-temp-profile-cleanup:packages/cli/src/temp-profile.ts` compiled with esbuild
(`module.sha256`: ts `aa96280d...`, mjs `2bb9570a...`; the same mjs hash is printed inside every WSL log).
Runtimes: Windows v25.0.0, v18.20.8, v20.20.2, v22.23.3 (`node-bins.txt`), all under the preamble; WSL Ubuntu Node 20.20.2
under the literal A9 guard. Guard tool hashes match S1 (`assert-tmp.mjs dff42280...`, `check-cleanup-paths.mjs bde6b533...`).

## 1. Verdict: **REOPEN** (small fixes; go to S5, then one S6e commit per blocking finding)

This is audit failure **#1** for GAP-315 (plan section 2, rule 4: fix it). Nothing here needs a redesign. Both
blocking section-5 failures are one-line causes, and a scratch-only patched module passes the same probes (section 5).

Blocking (section-5 [B] items that FAIL):
- **F1 (A2 [B], MEDIUM, data loss)**: on Windows, a junction or dir-symlink named like an auto-temp profile makes the
  rule-5 probe `rm(path.join(dir, "lockfile"))` follow the link and **delete the victim directory's `lockfile`**. Fails on
  all 4 Windows runtimes. POSIX passes (no lockfile probe there).
- **F2 (A5 [B], LOW in practice, data loss)**: the scan's post-filter `l.includes("sutradhar-cli-")` is case-sensitive,
  but WQL `LIKE` is not. A process that references the dir with a different case (`SUTRADHAR-CLI-...`) is dropped, so
  rule 2 says "not in use" and the dir is deleted. Fails on all 4 Windows runtimes. For a real Chrome on Windows, rule 5
  (the held `lockfile`) still saves it. A non-Chrome holder is not saved.

Blocking by auditor judgment (security; not a section-5 item, and the fix is already planned in S6a):
- **F3 (HIGH, code execution)**: on Node 18 and 20 the scan's bare `powershell.exe` resolves from the **current
  directory first**. A planted `powershell.exe` (a copy of cmd.exe) in the CLI's cwd was executed: the scan hung for
  exactly the 20 s timeout (20033 ms, against 587 ms on v25) and returned null. The branch runs this scan at **every fresh
  session start** (the sweep). S6a's `powershellExe()`/`psBin()` fixes it. S6a's AC-4 is only a grep, so the live
  `win-plant` probe must be added to S6a and S8 on v18 and v20.

## 2. Per-item results (each runtime)

| item | Win v25 | Win v18 | Win v20 | Win v22 | WSL v20 | evidence |
|---|---|---|---|---|---|---|
| A1 [B] scope | PASS 66/66 | PASS 66/66 | PASS 66/66 | PASS 66/66 | PASS 63/63 | win/win-a1-*.log, wsl/wsl-a1.log |
| A2 [B] link as candidate | **FAIL** 2/6 | **FAIL** 2/6 | **FAIL** 2/6 | **FAIL** 2/6 | PASS 4/4 | win/win-a2-*.log, wsl/wsl-a2.log |
| A3 [B] link inside candidate | PASS 12/12 | PASS | PASS | PASS | PASS 7/7 | win/win-a3-*.log, wsl/wsl-a3.log |
| A4-pre [B] lock signal (Chrome headless, Chrome headed, Edge headless, Edge headed) | PASS x4 | PASS x4 | PASS x4 | PASS x4 | n/a (no Chrome) | win/browser-*.log |
| A4 [B] no partial delete of a live profile | PASS x4 | PASS x4 | PASS x4 | PASS x4 | n/a | win/browser-*.log |
| A5 [B] rule 2 isolated | **FAIL** (upper-case variant) | **FAIL** | **FAIL** | **FAIL** | PASS | win/win-a5-*.log, win/win-a5case-v25.log, wsl/wsl-a5.log |
| A6 [B] rule 3 isolated | PASS 5/5 | PASS | PASS | PASS | PASS 3/3 | win/win-a6-*.log, wsl/wsl-a6.log |
| A7 [B] fail closed | PASS 7/7 | PASS | PASS | PASS | PASS 6/6 | win/win-a7-*.log, wsl/wsl-a7.log |
| A8 elevated invisible | code reading: limitation (N5) | | | | | section 3 |
| A9 [B] WSL guard | - | - | - | - | PASS | wsl-guard.txt, wsl-guard-literal.txt |
| B1 [B][S8] | N/A (S8) | | | | | |
| B2 [B] backdated long-lived kept | PASS x4 browsers | PASS x4 | PASS x4 | PASS x4 | PASS | win/browser-*.log, wsl/wsl-a5.log |
| B3, B4, B5 [S8] | N/A (S8) | | | | | |
| O1-O8 [B][S8] | N/A (S6b not written yet) | | | | | |
| G1-G6 [B][S8] | N/A (S6c not written yet) | | | | | |
| C1 0.6.0 state | PASS (code reading) | | | | | section 3 |
| C2 `--profile` | PASS (code reading) | | | | | section 3 |
| C3 self-heal order | FAIL vs target (known; S6b/S6a) | | | | | section 3 |
| C4 [S8] | N/A | | | | | |
| C5-live (a) argv > 4096 | - | - | - | - | PASS (pad 100/4200/70000) | wsl/wsl-c5a.log |
| C5-live (b) [B] SingletonLock, no marker | - | - | - | - | PASS 5/5 | wsl/wsl-c5b.log |
| C5-live (c) [B] symlink victims intact | - | - | - | - | PASS (A2 4/4 + A3 7/7) | wsl/wsl-a2.log, wsl/wsl-a3.log |
| C5-live (d) 19-case port | - | - | - | - | PASS 19/19 | wsl/wsl-port.log, port-map.md |
| C6 specs pass tmpRoot | PASS (6/6 calls) | | | | | section 3 |
| X1 [B] path check | PASS: 48 logs, every exit 0, cleanup-lines > 0, outside-iso=0 | | | | | x1-pathchecks.txt |
| D1 counts re-derived | PASS: 19/19 vitest (isolated) + 19/19 node:test | | | | | spec/branch-spec-vitest.log |
| D2 branch real-TEMP run | process finding (P-D2) | | | | | section 4 |

### Exact commands (all from Git Bash; `<HEADER>` per plan 0.2)
- Module and branch diff: plan S4 block verbatim (outputs: `module.sha256`, `branch.diff`, `node-bins.txt`).
- Windows probe, per runtime: `sh $SP/S4/run-win.sh <probe>`, i.e.
  `TEMP=$ISO TMP=$ISO TMPDIR=$ISO NODE_OPTIONS=--import=file:///$SP/iso/assert-tmp.mjs SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE=$SP/S4/mod/temp-profile.mjs timeout 600 <nodebin> $SP/S4/<probe>.mjs`,
  then `node $SP/iso/check-cleanup-paths.mjs $ISO <log>`. Each log's first line records the command.
- Live browser: `sh $SP/S4/run-browser.sh <chrome-headless|chrome-headed|edge-headless|edge-headed> <iso-suffix>`. The
  harness starts the browser on `<ISO>/r-XXXX/sutradhar-cli-<ms>-A<3>` and runs `win-a4child.mjs` once per runtime,
  with the path passed only through env. It kills only its own PID (`taskkill /PID <pid> /T /F`) and confirms the exit
  within 15 s, then runs a positive control: after the kill, the close path removes the dir.
- WSL: `sh $SP/S4/run-wsl.sh <probe...>`. Each call is self-contained:
  `D=$(mktemp -d) && cp ... && R=$(mktemp -d -p $PWD) && TMPDIR=$R PROBE_ROOT=$R TP_MODULE=$PWD/temp-profile.mjs node <probe>`,
  and it removes its own `/tmp/tmp.*` D in the same call. The path check runs with `MSYS_NO_PATHCONV=1` (see P2).
- Probe sources: `probes/` (`probes.sha256`, 28 files). S8 re-runs these with `TP_MODULE` set to the HEAD-compiled module.

### Key output excerpts
- F1, `win/win-a2-v25.log` (same on v18/v20/v22):
  `FAIL A2 sweep junction victim intact incl lockfile :: lockfile=false missing=["lockfile"] linkStillThere=false`,
  `FAIL A2 close junction victim intact incl lockfile :: lockfile=false missing=["lockfile"] ...`,
  `FAIL A2 sweep dir victim ...` and `FAIL A2 close dir victim ...` (same); `PASS A2 ... file ...` (x2).
  Only `lockfile` is lost. The rest of the victim survives, because `rm(dir,{recursive})` unlinks the link itself.
- F2, `win/win-a5-v20.log`: `FAIL A5 upper: in-use with real scan :: {"removed":true}`. The backslash, forward-slash and
  quoted-trailing-backslash variants PASS. `win/win-a5case-v25.log`: the raw WQL output contains the upper-case command
  line (ending `WIN-A5CASE-V25/A5C-YTHPFP/SUTRADHAR-CLI-1790000000777-ABC123`, separators shown as `/` here), but
  `scanCommandLines()` does not.
- F3, `win/win-plant-v18.log`: `INFO planted scan took ms=20033`, `scan ... -> null`. v20: `-> null`. v22: `array(35)`.
  v25: `ms=587`, `array(37)`. Fail-closed here only because cmd.exe hung. A planted binary that exits 0 with no output
  would turn rule 2 into `[]`, and it is code execution in any case.
- A4-pre/A4, `win/browser-chrome-headless.log`, `[v18] PASS A4-pre rm(lockfile) rejects EBUSY/EPERM :: code=EBUSY`,
  `[v18] PASS A4 close removed:false ...`, `[v18] PASS A4 close no file missing`,
  `[v18] PASS A4 /json/version still answers after close attempt`. Versions: Chrome/154.0.8037.97, Edg/154.0.4258.53.
- A5 attribution (Chrome headless): 9 hits, every one `<pid>/<ppid>/chrome.exe` under browser 77316, never the probe.
  Stand-in variants: exactly one hit, `<standin>/<probe>/node.exe`.
- A7 (Windows): `INFO real scan lines=47 selfLines=1`. The WQL query's own powershell.exe matches its own filter, so
  "matched nothing -> []" cannot be produced on Windows; it is shown on WSL: `PASS A7 query ran and matched nothing -> [] :: []`.
- A9: `/mnt/e/AI-Cache/tmp` root -> `WSL GUARD: refusing /mnt/e/AI-Cache/tmp`, exit=97. TMPDIR=/tmp outside the root ->
  `WSL GUARD: refusing /tmp`, exit=97. PROBE_ROOT unset -> 97. PROBE_TMPROOTS=/mnt/... -> 97. A mktemp root -> exit 0
  (9 runs). `PLAN-GUARD-LITERAL-MATCH`: the first 4 lines of every WSL probe are byte-identical to plan lines 579-582.
- C5-live (a): `INFO pad=70000 scan lines=1 longest=70147 hit=true` (procps-ng 4.0.4 does not truncate when piped).
- C5-live (b): `INFO readOwnerPid d1=1136 d2=1136 dummy=1136`, `PASS C5b live SingletonLock pid -> owner-alive (both)`,
  `PASS C5b dead pid -> removed`. d2 uses a hostname containing dashes (`my-host-name-<pid>`).
- D1: `Tests 19 passed (19)` (vitest 1.6.1, Windows v25, isolated). `# tests 19 # pass 19 # fail 0` (WSL node:test).
  The branch's `cli-vitest.log` claims 227 = 208 (fdae749) + 19. S1 at release HEAD = 243 in 16 files, so S5 should
  expect **262** in 17 files.

## 3. Code-reading items (branch cli.ts)
- C1: `cleanupSessionTempProfile` returns early when `!state.tempProfile || !state.userDataDir`, so a 0.6.0 state removes
  nothing. The kill is the same taskkill/POSIX call, now awaited (not a finding per plan). `clearState()` still runs.
  PASS.
- C2: `spawnDetachedChrome(..., profileUserDataDir)` sets `tempProfile = userDataDir === undefined` = false, so close
  skips cleanup. The sweep only lists `os.tmpdir()`; a named profile lives under `~/.sutradhar/profiles`. PASS.
- C3: self-heal on the branch is `killChromeTree` -> `cleanupSessionTempProfile(state)` (warn=false) -> `clearState()` ->
  respawn. The target is kill -> clearState -> cleanup (warn) -> respawn. FAIL against the target; this is the known
  window that S6b (order) and S6a (warn=true) fix. No new finding.
- C6: the spec's 2 `sweepStaleTempProfiles(` and 4 `removeSessionTempProfile(` calls all pass `tmpRoot: root`. PASS.
- A8: `Get-CimInstance` returns a null CommandLine for elevated or other-user processes, so rule 2 cannot see them.
  Rule 3 covers marker dirs (`process.kill(pid,0)` -> EPERM -> alive). Rule 5 covers any live Chrome on Windows.
  Limitation (N5).
- File modes: `git diff --summary fdae749 fix/gap-315-temp-profile-cleanup` shows only `create mode 100644`; no
  entry points. Commits: d84b160 = code + spec (one logical step); 8ba1649 = evidence + gaps.md. They map one-to-one.

## 4. Findings

| id | item | severity | blocking | required fix |
|---|---|---|---|---|
| F1 | A2 | MEDIUM (deletes an unheld `lockfile` in an arbitrary dir via a link in TEMP) | **yes, S6e** | Before any delete in `removeWithRetries` (or in `gatherFacts`), `lstat(dir)`; if `isSymbolicLink()` (junctions report true on Windows) or `!isDirectory()`, keep it (reason `not-a-directory`) or unlink only the link. Never `path.join` into the candidate before that check. Add Windows junction + dir-symlink unit tests (skip with a reason if symlinks are not permitted) and a POSIX symlink test. Also closes N3. |
| F2 | A5 | LOW (Chrome itself is still protected by rule 5 on Windows) | **yes, S6e** | Case-insensitive post-filter: `l.toLowerCase().includes(TEMP_PROFILE_PREFIX)` (prefix is lower-case). Add a unit test of the filter through a scan seam (raw output -> lines), with an upper-case line. |
| F3 | security (not section 5) | HIGH (code execution from cwd on Node 18/20; the branch adds it to every session start) | yes by auditor judgment; fix already planned in S6a | S6a `powershellExe()`/`psBin()` absolute paths. Add `probes/win-plant.mjs` on v18 and v20 to S6a AC and S8 (it must PASS: scan not affected by a planted cwd binary). |
| N1 | A7-adjacent | LOW | no | An unreadable or corrupt marker (`{"chromePid":"123"` -> `readOwnerPid` = undefined) is treated as "owner dead": rule 3 fails open, though rules 2 and 5 still apply. Suggest: marker present but unparseable -> keep (`owner-unknown`). |
| N2 | error path | LOW (only with a hand-corrupted state.json) | no; fold into S6b | `removeSessionTempProfile(123, ...)` throws `ERR_INVALID_ARG_TYPE`, and a rejecting scan propagates, despite the "Never throws" doc. readState does not validate types. On the branch the throw lands after the kill and before `clearState`, so close exits with an error and leaves the PID recorded (the S6b window). Guard `typeof state.userDataDir === "string"` and `.catch` the cleanup. |
| N3 | A1 observation | LOW | no (F1's fix covers it) | A regular **file** named `sutradhar-cli-<10+ digits>` in TEMP is removed by the sweep (`OBS file-named-like-profile removed=true`). |
| N4 | test gap | MEDIUM (test adequacy) | no | The branch spec catches mutants M1 (null scan fails open), M3 (owner check removed), M4 (age ignored) and M6 (root check removed). It **misses** M2 (Windows lockfile probe removed) and M5 (scan filter broken) (`spec/mutants.txt`). M2 is the only defence against partial deletion when rules 2 and 3 are wrong: the live A4 run against M2 deleted 106 of 200 entries of a live Chrome profile (`win/browser-chrome-headless-MUTANT-M2.log`). Add a Windows unit test that holds `lockfile` open with FileShare.None (child process) and asserts no entry is deleted. |
| N5 | A8 | info | no | Elevated or other-user processes are invisible to rule 2 (code reading); mitigated as described in section 3. |
| N6 | A7 | info | no | The Windows scan always includes its own powershell command line (it matches its own WQL filter). Harmless, but `[]` never occurs on Windows. |
| N7 | rule 3 | info | no | A reused marker PID keeps the dir forever (a leak, not a loss). |
| P-D2 | D2 | process | no (already handled: plan says never re-run `gap315-live.mjs`) | The branch's live harness used `TMP = os.tmpdir()` (the real shared TEMP), and its README records that the sweep "removed 6 pre-existing dead dirs" there. That is evidence produced by deleting other sessions' real-TEMP dirs. |

### Plan defects found while executing S4
- **P1** (WSL D reuse): the plan captures `D` in one `wsl.exe` call and reuses it later. The WSL VM idled out between my
  calls and `/tmp` was wiped (`cp: cannot create regular file ... Not a directory`). Every WSL call must be
  self-contained (mktemp, cp, run, guarded rm), as `probes/run-wsl.sh` does.
- **P2** (path-check root conversion): the plan's example `node check-cleanup-paths.mjs /tmp/tmp.X/tmp.Y <log>` in Git
  Bash has `/tmp/...` rewritten by MSYS path conversion, so every line was flagged `OUTSIDE-ISO` (a false FAIL). Prefix
  it with `MSYS_NO_PATHCONV=1`. The wrong-root negative control still exits 1 with it set.
- **P3** (Git Bash `/tmp` is REAL_TEMP): `cygpath -w /tmp` = `E:/AI-Cache/tmp`. Any `/tmp` in a Git Bash command writes
  into the shared real TEMP. (I wrote two non-`sutradhar-cli` files there by mistake, `s4-branch-cli.ts` and
  `s4-planguard.txt`, and removed exactly those two by name. The real-TEMP `sutradhar-cli-*` set was untouched.)
- **P4** (A4 wording): "file count and bytes unchanged" cannot hold on a live profile; Chrome itself grew 200 -> 238
  entries with no removal. The criterion I used is: no pre-existing entry missing, lockfile present, and /json/version
  answers. `removed:false` alone is a false-pass criterion, because mutant M2 returned `removed:false` while deleting 106
  entries.
- **P5** (path length): with `$SP` at 160 characters, a 257-character `--user-data-dir` made Chrome exit at once (first
  harness attempt). S7 and S8 harnesses must keep ISO and dir names short.
- **P6** (verdict rule): security findings such as F3 fall outside "data loss / wrong kill / error exit". The plan should
  classify code execution as blocking, and S6a AC-4 (a grep) should be backed by the live `win-plant` probe on v18/v20.
- **P7** (attribution hygiene): an attribution query also matches the orchestrating shell when the probed basename
  appears literally in the shell command text (seen in `win-a5case`: 2 extra `bash.exe` hits). Rule 0.3 ("a probe never
  carries a probed dir path in its own argv") should extend to the launching command text.

## 5. Probe validity (each FAIL is attributable, and each probe can PASS)
A scratch-only patched copy of the module (`probes/FIXCONTROL-scratch-only.diff`: an `lstat` guard plus a lower-cased
filter; the source is untouched) passes win-a2 on v25 and v18 (6/6), win-a5 on v25 (20/20), and still passes win-a1
(66/66) and win-a3 (12/12): `win/*-FIXCONTROL.log`. So F1 and F2 come from exactly those lines, and the probes have a
reachable PASS state.

## 6. False-pass analysis of my own checks
| check | how it could pass while the behaviour is broken | what rules it out (command -> output) |
|---|---|---|
| A1 | isolation not actually forcing "remove" (every candidate kept for some other reason) | the 2 positive controls in the same root are removed: `PASS A1 sweep removed exactly the 2 positive controls` |
| A2 (WSL) | victim kept by another rule, not by link handling | **This happened.** My first WSL run used `SingletonLock -> host-1`, so PID 1 was alive and the reason was `owner-alive`. Re-run with a verified-dead PID (`INFO victim SingletonLock uses dead pid 4190000`): the links are removed (`removed=true`) and the victims are intact. |
| A2/A3 (Windows) | links silently not created (not permitted) | creation errors would print `NOTE symlink ... not permitted` / `SKIP`; none were printed; junction, dir and file symlinks were all created |
| A4-pre/A4 | browser not actually holding the profile (crashed) | `/json/version` answers before and after; the attribution shows a live browser tree; mutant M2 deletes 106 entries under the same harness, so the probe detects partial deletion |
| A4 | file-count noise hides a deletion | the criterion is "no pre-existing entry missing", and the churn control shows growth only (`missing=[]`) |
| A5 | in-use from the stand-in's own process on the probe side, or stale scan | real scan, no injection; attribution shows the stand-in's PID (parent = probe), never the probe; after the stand-in is killed, the same call returns `removed:true` |
| A6/C5b | owner-alive from a reused PID | the dummy is killed by its PID and `isPidAlive` confirms it gone; then `removed` |
| A7 | null-scan keep caused by not-auto-temp | the reason is asserted to be exactly `scan-unavailable`; the same name pattern is removed by the isolated controls of A1/A6 |
| A9 | guard never reached (crash before it) | the exit code is exactly 97 with the `WSL GUARD: refusing <path>` text; positive runs print `[wsl-guard] root=/tmp/...` |
| B2 | dir not actually old | `INFO B2 dir ageMin=25.0` printed from a fresh `stat` before the sweep |
| C5a | stand-in argv not long | `longest=70147` measured from the scan output |
| X1 | checker vacuous | it exits 1 for the wrong root (`neg-exit=1`); `cleanup-lines > 0` in all 48 logs |
| X1 real TEMP | deletion attributed elsewhere | the before/after/after-cleanup name lists are **IDENTICAL** (45); every module path stayed under ISO |
| D1 | stale module | the WSL logs print the module sha `2bb9570a...`, identical to `module.sha256`; the spec copy is `cmp`-equal to the extracted ts after mutants (`restored`) |
| module provenance | testing the wrong code | the module comes from `git show fix/gap-315...:packages/cli/src/temp-profile.ts`; `branch.diff` is recorded |

## 7. Safety and process record
- PIDs started: 4 browsers (77316, 72088, 76552, 75872) plus 1 mutant-run Chrome (39016), all killed by their own PID
  with exit confirmed within 15 s. Two earlier harness attempts started no lasting browser (ENOENT; then Chrome
  self-exited on the 257-char path, `taskkill: process not found`). Stand-ins and dummies were killed by their own
  handle with exit confirmed. A final `Get-CimInstance` query for command lines under `S4-tmp-*` returned only this
  shell's own bash.exe.
- Nothing was killed by image name. No source file was edited. No commit, no merge. Writes went only to `$EV/S4` and
  `$SP/S4*` (plus deviation P3, cleaned up). One earlier ISO (`S4-tmp-browser-chrome-headless`, my own, no live PID)
  was deleted with a plain `rm -rf` of its exact path before I switched to the guarded form.
- ISO dirs: 40 `S4-tmp*` dirs deleted with the guarded `case` form (`iso-cleanup.txt`) after all PIDs were confirmed
  dead. WSL `/tmp/tmp.*` dirs were removed in-call.
- Real TEMP: 45 `sutradhar-cli-*` before, after, and after cleanup; the lists are identical (`snapshots/`).
