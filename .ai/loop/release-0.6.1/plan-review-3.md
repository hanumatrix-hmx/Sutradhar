# Plan review 3: release 0.6.1 plan (revision 3)

Reviewer: independent adversarial plan reviewer, round 3 (Claude Opus 5.5), 2026-10-04. Read-only on the repo apart from
this file. Location check: `git rev-parse --show-toplevel` printed `$WT`, and `git branch --show-current` printed
`release/0.6.1`.

Sources read:
- `plan.md` (rev 3, all 1401 lines), `plan-review-1.md`, `plan-review-2.md`
- `git show fix/gap-315-temp-profile-cleanup:packages/cli/src/{temp-profile,spawn-chrome,cli}.ts` and the branch
  `temp-profile.spec.ts`
- the merged `spawn-chrome.ts` (via `git merge-tree --write-tree origin/master fix/gap-315-temp-profile-cleanup`)
- master `cli.ts` call sites, `dialog-cli.ts` `deadlineFor`, `browser-launcher.ts` `findExecutablePath`
- `scripts/build-bundle.mjs`, `scripts/check-release-ready.mjs`, `turbo.json`, `.github/workflows/{ci,scenario-suite}.yml`
- `packages/cli/{package.json,tsconfig.json}`, `.gitignore`
- a read-only `ls` of the real TEMP: **45** `E:/AI-Cache/tmp/sutradhar-cli-*` entries, and none of the first 40 has a
  `.sutradhar-owner.json` (all are 0.6.0-style `sutradhar-cli-<epoch>` names).

## Review-1 / review-2 resolution check

| finding | resolved in rev 3? | note |
|---|---|---|
| R1 #1 Node versions | yes | Section 5 runtimes. |
| R1 #2 POSIX | yes | C5-live (a)-(d), port-map. The WSL path has no fail-closed guard (finding 2). |
| R1 #3 close bound | yes, with gaps | S6a/S6b bounds. The phase durations cannot be measured with `spawnSync` (finding 8). |
| R1 #4 gating | yes | |
| R1 #5 probe hygiene | yes | |
| R1 #6 GAP-349 | yes | S6c P0/P1/P2/P2x/F8. Tests need `executablePath` injected (finding 10). |
| R1 #7 real-TEMP check | **no** | (iii) is vacuous for markerless dirs, and all 45 real-TEMP dirs are markerless (finding 2). |
| R1 #8-#19 | yes | |
| R2 #1 isolation by `export` | yes on Windows | Preamble plus guard. Gaps remain for WSL, the PowerShell env, and the unguarded `rm -rf "$ISO"` (findings 2 and 12). |
| R2 #2 PID reuse | yes, but it creates a new regression | Finding 1. |
| R2 #3, #4 | yes | |
| R2 #5 escalation | yes | |
| R2 #6 bound wording | yes | |
| R2 #7 positive controls | partly | T3 cannot kill mutant M-c (finding 5). |
| R2 #8 scan timing, abs paths | partly | `chrome-owner.ts`'s PowerShell path is not covered by any AC (finding 11). |
| R2 #9 attribution | **no** | Finding 2. |
| R2 #10-#13, #15, #16 | yes | |
| R2 #14 call-site counts | partly | S6b-3 cannot pass at S6b (finding 4). |

## Findings

1. **MAJOR: `close` (and self-heal) now leaves Chrome running, and then forgets its PID, whenever the ownership query
   is slow or unavailable. 0.6.0 does not regress this way.**
   - Gap: S6b `teardownSpawnedChrome` step 2 treats `unverifiable` like `mismatch`: no kill. Step 4 then clears state
     **unconditionally**. Step 5 finds the dir `in-use` and keeps it.
     - The session's Chrome keeps running, holding 50-100+ MB of profile and its renderers.
     - No state file names it any more, so no later `sutradhar close` can stop it.
     - The command still prints "Session closed." and exits 0.
   - On 0.6.0 the same `close` always stops Chrome, using `taskkill /T /F` or `process.kill(-pid)`, with no external query.
   - The ways to reach `unverifiable` are realistic:
     - **Windows**: `VERIFY_TIMEOUT_MS = 3_000` covers a full Windows PowerShell 5.1 cold start plus a CIM query. The
       plan's own Risk 2 says "A verification query costs about 1-3 s", which puts the normal case at the cap. Risk 4
       already expects PowerShell to exceed 8 s on a loaded machine, and this machine runs 35+ Chrome sessions. AppLocker
       or WDAC policies that block `powershell.exe` make it fail every time.
     - **Linux**: `ps -ww -p <pid> -o args=`. Slim container images, such as the Debian `*-slim` Node images, ship without
       procps. `execFile('ps')` then gets ENOENT, so every `close` in such a container would leak Chrome. Headless
       Chrome in Docker is a primary deployment for an AI browser tool.
   - The plan never exercises this path: P4 only checks that no kill happens, and S7 L1 runs on a machine where
     PowerShell works. A variable verify time would surface as a sporadic L1 "Chrome PID is gone" failure. That failure
     counts toward escalation without the root cause being named.
   - Fix (S6b, before any code):
     - (a) **Prefer an ownership proof that needs no OS query.** `state.wsEndpoint` carries the per-launch browser GUID
       (`/devtools/browser/<uuid>`).
       - If `GET http://127.0.0.1:<port>/json/version` returns the same `webSocketDebuggerUrl`, the endpoint is
         provably ours. Send CDP `Browser.close` over that WebSocket; it targets the browser, not a page, so an open
         dialog does not block it.
       - Then wait for the PID to exit with a read-only `process.kill(pid, 0)` poll.
       - Use the PID-verify-then-kill path only when the endpoint does not answer, for example a hung or dead Chrome.
     - (b) On Linux, read `/proc/<pid>/cmdline` (NUL-separated) directly. Use `ps` only where `/proc` is absent (macOS).
     - (c) **Never clear `chromePid` on `unverifiable`.** Rewrite the state with the PID and a `closePending` marker,
       warn "could not verify Chrome PID <pid>; run `sutradhar close` again", and set a non-zero exit code. Keeping the
       PID is safe, because every later kill is verified again. Clear it only on `match` (after the kill), `gone` or
       `mismatch`.
     - (d) Size `VERIFY_TIMEOUT_MS` from measurement. S7 records p50/max of every verify, just as it does for the scan.
       AC: the max is no more than 50% of the cap.
     - Tests:
       - P8: the verify query is unavailable (ENOENT or timeout). With a live CDP endpoint, Chrome is still closed. With
         no endpoint, `chromePid` is still persisted and the exit code is non-zero.
       - Mutant: "clear state on `unverifiable`" makes P8 fail.
     - Update the changelog's "kill only after confirming" sentence to match.

2. **MAJOR: protection of the real TEMP has an unguarded execution path, and its only after-the-fact check cannot
   fail.**
   - (a) **WSL probes bypass the guard.** Preamble item 1 runs only in Windows Node processes. The WSL probes (S4/S8
     A1-A3, A6, C5-live) check `os.tmpdir()` only against `PROBE_ROOT`, and both values come from env, so a wrong
     `PROBE_ROOT`/`TMPDIR` passes the check.
     - WSL can address `/mnt/e/AI-Cache/tmp`, the real TEMP that holds 45 `sutradhar-cli-*` dirs.
     - On that path the POSIX branch runs: rule 2 uses WSL `ps`, which **cannot see any Windows process**, so all 35
       live sessions look unreferenced.
     - Rule 3 finds no marker (0 of 45 have one) and no `SingletonLock`. Rule 5 is Windows-only, so it is skipped.
     - With `minAgeMs:0` ("isolated" probes), every unlocked file in the live sessions' profiles is deleted, and the
       locked files fail on drvfs: the GAP-346 partial-delete pattern.
     - One wrong env value is enough.
   - (b) **S7 (iii) is vacuous.** It accepts a vanished entry with "no marker". Every real-TEMP entry is markerless, so
     (iii) passes even if our own code deleted one. It has no negative control, which the global rule requires for a
     security probe.
     - (iii) also runs only in S7/S11. The S4/S8 probe sessions, including the unguarded WSL ones, have no before/after
       check at all.
   - (c) The plan never says where S7 gets the "real %TEMP%" path. The harness runs with `TEMP=$ISO`, so
     `process.env.TEMP` or `os.tmpdir()` is the ISO dir, and (iii) would list ISO.
     - The PowerShell preamble form mutates `$env:TEMP`/`$env:NODE_OPTIONS` in the tool's own process. If that host
       process is reused, later calls inherit those values, and S7 (iii) "real TEMP" listings again point at ISO.
   - Fix:
     - (a) Every WSL probe hard-refuses, with exit 97, when `os.tmpdir()`, `PROBE_ROOT` or any `tmpRoot` it passes is
       not under the `mktemp -d` root, **or starts with `/mnt/`**. The refusal is a literal check in the probe source.
       S4 self-tests it once (`PROBE_ROOT=/mnt/e/AI-Cache/tmp` must give 97) and records it in `$EV/S4/wsl-guard.txt`.
     - (b) Replace the (iii) rule with a check based on the debug seam:
       - every `[cleanup] created|decision|rm-attempt|removed|kept` line in every S4/S7/S8/S11 log must name a path
         under the step's ISO (`grep -v` for the ISO prefix must print 0 lines);
       - any real-TEMP entry that disappears during a run is **unattributed until explained**, because 0.6.0 sessions
         never delete their own dirs;
       - negative control: one deliberate debug line naming a fake real-TEMP path must make the checker fail.
     - (b, continued) Take the real-TEMP snapshot (names plus a `find -maxdepth 1 -newer` stamp) before and after
       **every** S4/S8 probe session as well, not only in S7/S11.
     - (c) Hard-code the real TEMP as `E:/AI-Cache/tmp` in the S7/S11 attribution code. Assert that it is not ISO and
       that it has at least 1 entry.
     - (c, continued) Make the PowerShell preamble restore the previous TEMP/TMP/TMPDIR/NODE_OPTIONS in `try/finally`,
       or make Git Bash the only allowed form.

3. **MINOR: S6b-3 cannot pass at S6b.** At S6b the merged tree still has `killChromeTree(` in the F8 path (master
   `cli.ts:301`) and in the spawn timeout path (merged `spawn-chrome.ts:105`). S6c converts both. `grep -n
   "killChromeTree(" packages/cli/src/*.ts` will therefore print 4 lines at S6b, not 2.
   - Fix: at S6b expect 4 lines (definition, `killOwnedChrome`, F8, spawn timeout). Move the "exactly 2" check to S6c-3
     (it already appears there) and to the S11 checklist.

4. **MINOR: `close-session.ts` cannot call `cleanupSessionTempProfile`.** That function is a non-exported local in
   `cli.ts`, and `cli.ts` runs `main()` at module top level, so importing it would execute the CLI.
   - Fix: say explicitly that `teardownSpawnedChrome(state, deps)` takes `deps.cleanup(dir, deadlineAt)`, which `cli.ts`
     supplies.
   - Also state the new `cleanupSessionTempProfile(target, warn, deadlineAt)` signature.
   - Also state **when the cleanup deadline starts**: immediately after the kill phase returns, before the exit wait.
     The plan says "remaining-of-cleanup-deadline" but never defines its origin.

5. **MINOR: mutant M-c survives T3 as specified.** T3 uses `budgetMs: 1000` with `MIN_RM_START_MS = 1000`.
   - If the mutant starts the deadline *after* the scan, the first per-dir check sees `1000 − ε` (after `stat`,
     `readFile` and so on). That is less than 1000, so it still removes 0 and T3 still passes. M-c is not caught, and
     S6a-2 cannot be met.
   - Fix: change T3 to `budgetMs: 2000` with a 1500 ms scan, expecting exactly 0 removed. The mutant then has about
     2000 ms left and removes all 3.
   - Pass an absolute `deadlineAt` in T5, so the test and the implementation compute "remaining" from the same origin.
     Allow a 25 ms tolerance in the ≥ 1000 ms assertion.

6. **MINOR: the S6a-3 grep conflicts with existing code, and the old option names are left unspecified.**
   - The branch sweep has `Math.min(deadline, performance.now() + 1_000)` (the per-dir retry window), which matches
     `_000\b`.
   - `removeSessionTempProfile` takes `exitTimeoutMs`/`removeTimeoutMs` with `?? 10_000`/`?? 15_000`, and the branch
     spec test "close keeps the dir if Chrome does not exit within the timeout" passes `exitTimeoutMs: 200`.
   - `packages/cli/tsconfig.json` excludes `**/*.spec.ts`, so `tsc` will not flag a stale option name in a test. Only a
     5 s vitest timeout would surface it.
   - Fix:
     - Name the per-dir window (`SWEEP_PER_DIR_RETRY_MS = 1_000`) and add it to the S6a-3 expected list, making it 7
       lines.
     - State that `exitTimeoutMs`/`removeTimeoutMs` are removed, and that the branch test moves to `deadlineMs: 300`.
     - Add a one-off `tsc --noEmit` over the cli specs, for example a scratch tsconfig in `$SP` that includes
       `tests/**/*.ts`.

7. **MINOR: two new real-OS tests are not deterministic.**
   - P7 on Linux (CI): after `process.kill(child.pid)`, the child stays a zombie until libuv reaps it. `ps -p <pid>`
     then prints `[node] <defunct>`, a string rather than `null`.
     - Fix: `await once(child, 'exit')` before the `null` assertion.
   - P7 on Windows: with the production 3 s cap, PowerShell cold start can time out under load, giving `undefined`.
     - Fix: pass a test timeout of 15 s.
   - Specify the POSIX "gone" mapping: `ps` exit status 1 with empty stdout gives `null`, and anything else gives
     `undefined`. With finding 1(b) this becomes "`/proc/<pid>` absent gives `null`".

8. **MINOR: S7 cannot measure phase durations as specified.**
   - Every CLI call goes through `spawnSync`, which returns stderr only after the process exits, so the harness cannot
     timestamp the debug lines.
   - The debug format has no kill-phase timing. Only `scan <ms>ms` and `rm-attempt <n> <ms-remaining>` carry numbers.
   - So the L1 AC (kill ≤ 10.5 s, cleanup ≤ 15.5 s) and S10-4 cannot be derived.
   - Fix: S6a/S6b debug lines print `[cleanup] phase kill <ms>`, `[cleanup] phase cleanup <ms>` and `[cleanup] verify
     <pid> <reason> <ms>`, measured with `performance.now()` in the CLI process. S7 parses those.

9. **MINOR: the L1s 8.3-alias iteration trips the isolation guard.**
   - `for %I in ("<dir>") do @echo %~sI` shortens **every** path component, including
     `E--HMX-Projects-...`. The guard compares the lower-cased long `$SP` prefix, so the CLI child exits 97, and the
     "never an error exit" expectation fails for a harness reason.
   - Fix: build the alias only for the last component (`$SP/<long>/S7DIRW~1/tmp`), or set `SUTRADHAR_ISO_ROOT` to the
     8.3 form of `$SP` for that one invocation and record it.

10. **MINOR: the G1-G6 tests depend on a real browser being installed.**
    - `spawnDetachedChrome` calls `findExecutablePath()` before it creates the dir.
    - G1-G6 do not say that `deps.executablePath` is injected. On a runner without Chrome, every G test throws
      "No Chrome/Chromium/Edge found" before reaching its path. M-seam's "dir created in tmpRoot" would also be vacuous.
    - ubuntu-latest happens to ship `/usr/bin/google-chrome`, but CI is the first Linux run (6.4).
    - Fix: every G test passes `executablePath: 'fake-chrome'`.

11. **MINOR: absolute system-binary paths are only partly enforced.**
    - S6a-4 greps `powershell.exe` in `temp-profile.ts` only. `chrome-owner.ts` (S6b) launches PowerShell too, and no
      AC checks it.
    - Fix: one exported helper, `systemBinary('WindowsPowerShell\\v1.0\\powershell.exe' | 'taskkill.exe')`. The AC
      greps `packages/cli/src/*.ts` for `'powershell.exe'`, `"powershell.exe"`, `'taskkill'` and `'ps'` literals passed
      to `execFile`/`spawn`, and expects only the helper.

12. **MINOR: preamble item 6 ("clean only `$ISO` dirs") has no guarded delete.**
    - Shell variables do not persist between calls (the plan's own notation section). A builder's
      `rm -rf "$ISO"/*` or `rm -rf "$SP/$STEP-tmp"` with an empty or undefined variable expands to a root path.
    - Fix: mandate
      `set -u; case "$ISO" in "$SP"/?*-tmp) rm -rf -- "$ISO";; *) echo "REFUSE rm $ISO"; exit 1;; esac` as the only
      allowed form. The Windows equivalent checks `$ISO.StartsWith($SP + '/')` before `Remove-Item`.

13. **MINOR: a BLOCKED rollback reverts S6b, but the self-heal PID hazard exists on master too.**
    - On master/0.6.0, `withSession` self-heal runs `killChromeTree(state.chromePid)` (master `cli.ts:482`) whenever
      attach fails.
    - A `state.json` that outlives its Chrome, for example after a reboot or a Chrome crash, makes the next command
      `taskkill /T /F` whatever process now holds that PID.
    - That hazard does not depend on GAP-315. Rule 5's rationale ("depends on temp-profile") covers S6c, not S6b's
      `chrome-owner.ts`.
    - Fix: either order the work so `chrome-owner.ts` plus the self-heal/close verify does not depend on GAP-315 and
      survives a revert (its own commit, reverted only if it fails on its own), or log the pre-existing hazard as a new
      gap in S10b with severity "wrong kill" so the BLOCKED path does not hide it.

14. **MINOR: S1-6 (clean tree) will fail.** The S1 commit list names `plan-review-1.md` and `plan-review-2.md`. This
    file (`plan-review-3.md`), and any `decisions.md` or round-4 files, would be left untracked.
    - Fix: add `plan-review-*.md` by name, listing each existing file.

15. **MINOR: smaller executability gaps.**
    - S6c's one-off ESLint run with `-c "$SP/S6c/floating.cjs"` should add `--resolve-plugins-relative-to "$WT"`, so
      ESLint 8 resolves `@typescript-eslint` from the repo rather than from `$SP`.
    - The S4 WSL command contains a placeholder `<D printed above>`. Say "capture D from the first call's stdout and
      paste it literally".
    - `SUTRADHAR_CLI_DEBUG_CLEANUP` is a new user-reachable env var in the shipped bundle. Either list it in the CLI
      help env section and the CLI README as a diagnostics switch, or state that it is intentionally undocumented.
      `help-text.spec.ts` may pin the env list, so check it.
    - Optional, cheap evidence for S10b item 8 ("real Chrome on Linux not executed"): the user can `workflow_dispatch`
      `scenario-suite.yml` on `release/0.6.1`. It runs the CLI with real Chrome on ubuntu. Record it as a user-owned
      post-handoff item, not a gate.

## Checked and found sound (no finding)

- **Guard coverage on Windows.**
  - NODE_OPTIONS is inherited by vitest forks and threads (they share `process.env`), by CLI children (the S7 env
    spreads `process.env`), and by the warden.
  - No existing test spawns the CLI. Only `path-containment.spec.ts` uses `child_process`, and it runs `fsutil`.
  - Turbo test is not run locally.
  - `turbo run build`/`lint`/`typecheck` execute no GAP-315 code. The `rmSync` in `build-bundle.mjs` touches only
    workspace `dist/` dirs.
  - `check-release-ready.mjs` only runs `git status` and compares mtimes.
- **Seams stay out of the public API.**
  - `@sutradhar/cli` is `"private": true`, and `packages/sutradhar/src/index.ts` does not export CLI code.
  - `SpawnDeps` and the remove/scan options exist only as internal parameters inside `cli-bin.js`.
  - No env var changes safety behaviour. The guard's `SUTRADHAR_ISO_ROOT` lives outside the repo.
- **The CLI watchdog does not cut cleanup short.** `DEFAULT_CLI_DEADLINE_MS = 300_000`, which is far above
  10 + 15 s plus one in-flight rm. The 3 s force-exit sits in `.finally()`, after `main()` resolves.
- **The port token is a sound ownership token.** `spawnDetachedChrome` passes an explicit
  `--remote-debugging-port=<port>` from `getFreePort()`, not `=0`, so legacy 0.6.0 states verify through the port as C1
  assumes.
- **Mutant coverage, apart from M-c.** M-a fails T1, because the 20 s scan exceeds 2500 ms. M-b fails T5, because a
  third attempt would start with about 300 ms left. M-G4 fails G4 on both the kill and the timing. M-seam fails G1.
- **Rollback order** (newest first, then `-m 1`, then revert-the-revert noted) is correct. The evidence commits stay,
  which is fine.
- **Escalation counting** matches the global rule.
- `packages/sutradhar/AGENT_SETUP.md` (rewritten by every build) and `dist/cli-bin.mutant.js` are both gitignored, so
  neither dirties the S11 tree. S11-7 still catches a left-over mutant in the tarball.

## Verdict: REVISE

There are 2 MAJOR findings (1 and 2) and no BLOCKER.
- Finding 1 is a functional regression that the plan would ship: `close` can leave Chrome running and forget its PID.
  S7 might even catch it only as an unexplained L1 flake.
- Finding 2 leaves the "never touch the 35 live sessions" property with an unguarded path (WSL) and a backstop check
  that cannot fail.

Both have cheap, concrete fixes. Fix 1-2 before S1, because finding 2(a) affects S4. Findings 3-15 can be folded into the
same revision. Findings 3, 5, 6 and 8 would otherwise stop a Sonnet builder at an AC it cannot meet as written.
