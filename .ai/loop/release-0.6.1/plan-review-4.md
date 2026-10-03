# Plan review 4: release 0.6.1 plan (revision 4)

Reviewer: independent adversarial plan reviewer, round 4 (Claude Opus 5.5), 2026-10-04. Read-only on the repo apart from
this file. Scratch trials were written only under `$SP/rev4check/`.

Location check: `git rev-parse --show-toplevel` printed `$WT`, and `git branch --show-current` printed `release/0.6.1`.
`git status --porcelain` printed only `?? .ai/loop/release-0.6.1/`.

Sources read:
- `plan.md` rev 4 (all 1457 lines) and `plan-review-1/2/3.md`.
- Master: `packages/cli/src/{cli.ts (withSession 403-509, cmdClose 1587-1679), spawn-chrome.ts, state.ts, warden-control.ts}`,
  `packages/cli/{package.json,tsconfig.json}`, and `packages/browser/src/session/{dialog-cdp.ts,index.ts}`.
- Branch `fix/gap-315-temp-profile-cleanup`: `temp-profile.ts` and the `cli.ts` call sites.
- puppeteer-core 25.5.0: `lib/puppeteer/cdp/BrowserConnector.js` and `node/NodeWebSocketTransport.js`.
- `tools/scenario-suite/*.mjs` and `.github/workflows/scenario-suite.yml`.
- `README`/`AGENT_SETUP`/`packages/cli/README.md` text about close, and `$SP/r4/measure.mjs`.

## Review-3 resolution check

| R3 | resolved in rev 4? | note |
|---|---|---|
| #1 MAJOR (close forgets an unverifiable PID) | **Yes for the main session; the design opens new gaps** | Findings 1-3 below are all in the new S6b machinery. |
| #2 MAJOR (real-TEMP protection) | yes | WSL guard is literal and self-tested (A9). The path-log checker has pos/neg/empty controls. `REAL_TEMP` is hard-coded. Git Bash form only. Guarded `rm`. The checker logic is correct (traced by hand, including WSL `/tmp` and `/mnt/` paths normalised on Windows). |
| #3 S6b-3 count | yes, but see finding 6c | |
| #4 deps.cleanup / signature / deadline origin | yes | |
| #5 M-c vs T3 | yes | T3 2000/1500 with exactly 0. T5 uses an absolute `deadlineAt`. |
| #6 grep / old options / spec typecheck | **No: the spec typecheck is vacuous** | Finding 4. |
| #7 P7 determinism | yes | |
| #8 phase timing | yes | In-process `phase kill`/`phase cleanup` lines. |
| #9 8.3 alias | **No: not executable on this volume** | Finding 6e. |
| #10 executablePath | yes | |
| #11 system binaries | **The grep conflicts with the plan's own helper API** | Finding 6a. |
| #12 guarded rm | yes | |
| #13 master hazard on revert | yes | S10b item 9. |
| #14 S1-6 | yes | |
| #15 small items | yes | |

## Findings

### 1. MAJOR: a gone PID is "unverifiable" whenever the PowerShell query fails, so `close` exits 1 forever and self-heal eventually refuses every new session

- **Gap.** In step 3, `isOwnedChrome` returns `gone` only when `readCmdline` returns `null`. On Windows that requires PowerShell to run and return empty stdout (plan.md 714-718, 740-747).
  - `isAlive(pid)` (`process.kill(pid, 0)`, no OS query) is used only in the step-2 wait and after a kill. It is never used to classify a dead PID.
  - So whenever the query is unavailable (PowerShell blocked by AppLocker/WDAC, or a cold start slower than `VERIFY_TIMEOUT_MS` = 3 s on an AV-scanned machine, the cases review-3 #1 named), a session whose endpoint is dead becomes `unverified` **even though its PID no longer exists**.
- **Common ways to get a dead endpoint:**
  - the user closes a `--headed` window;
  - Chrome crashes;
  - a reboot.
- **What follows:**
  - `close` keeps the record and exits 1 on every retry (step 4/6).
  - The plan's own remedy text ("run `sutradhar close` again, or stop the process yourself") cannot clear it: after the user kills the process, the next `close` is still `unverifiable`.
  - Every other command self-heals and appends an `unverifiedChrome` entry (step 7). After 5 entries, self-heal **refuses to start a new session** (exit 1). No `--force`/`--forget` exists, and deleting `state.json` is not documented.
  - 0.6.0 handles the same machine correctly, with a blind kill and a cleared state. This is a strict regression for that class of users, and P8b enshrines it.
  - Risk 3 in 6.2 ("only when the endpoint is dead **and** verification fails") understates it: with a failing query, every dead endpoint qualifies.
- **Fix:**
  - (a) In step 3, check `isAlive(pid)` first. `false` gives `gone` with no query, because a non-existent PID has nothing to kill. Specify the `EPERM` mapping: `EPERM` = alive.
  - (b) Replace the hard refusal at 5 entries with one of:
    - drop the oldest entry with a stderr warning naming its PID;
    - or a documented escape (`close --forget`, which prints the PIDs it forgets).
  - (c) New test P10: `readCmdline` returns `undefined` and `isAlive` is `false`. Expected outcome `gone`, state cleared, exit 0.
  - (d) Mutant: "drop the isAlive pre-check" must fail P10.
  - (e) L10 adds a second phase: kill the dummy by PID, then run `close` with the broken `SystemRoot` again. Expected exit 0 and a cleared state.

### 2. MAJOR: `unverifiedChrome` entries are wiped by step 4's `clearState()`, the schema is unspecified, and no test catches it

- **Gap.** Step 7 says `close` processes each `unverifiedChrome` entry, keeps the ones still unverified, and "exits 1 if any remain" (plan.md 773-774). Step 4 says that on `closed`, `killed`, `gone` or `mismatch` the main session does `await clearState()`, which deletes `state.json` (master `state.ts`).
  - The common sequence: main session `closed`, old entry still `unverified`.
  - Followed literally, that sequence deletes the file that holds the kept entry. The PID is forgotten, which is exactly the property decision A exists to guarantee.
  - The plan never says where the kept entries live after the main session is cleared. `CliState.sessionId` and `wsEndpoint` are required fields (`state.ts`), so a state that holds only leftover entries is not a valid `CliState`.
  - The next `nav` would try to reattach to it, or crash on parse.
  - P9 tests only the case where the later entry is `gone`, which is removed either way. The mutant "clearState wipes `unverifiedChrome`" therefore survives every listed test.
- **Fix:**
  - Specify the storage, for example a separate `unverified-chrome.json` beside `state.json`, read and written by `close` and self-heal and never touched by `clearState()`. Alternatively, define a "leftovers-only" state shape and make `readState` callers treat it as "no session".
  - Specify the `close` order: main session first, then the entries; write the leftovers file last.
  - Test P9b: main `closed`, one entry still `unverifiable`. Expected:
    - exit 1;
    - the entry is persisted with the same PID;
    - the next `nav` starts a fresh session without crashing.
  - Mutant M-P9b: "clearState removes the entries" must fail P9b.
  - Profile cleanup for an entry that later resolves to `gone`/`mismatch`/`killed` is also unspecified (steps 2-3 only, not 5). State whether its temp dir is removed or left to the sweep.

### 3. MAJOR: the fallback `match` path is never exercised against a real Chrome, and the token rule as written cannot match a real command line

- **Gap.** `isOwnedChrome` requires the basename of `userDataDir` to appear "as a whole token" (plan.md 720-722). A real Chrome command line never contains it that way. It contains `--user-data-dir=E:\...\sutradhar-cli-<ts>-<rand>`, quoted as `"--user-data-dir=E:\...\S7-tmp-sp dir\tmp\sutradhar-cli-..."` when the path has a space (L1s).
  - A natural reading (split on whitespace, compare tokens) therefore gives `mismatch` for **our own live Chrome**.
  - With `mismatch`, the outcome is: no kill, clear state, "nothing of ours is running", exit 0. That silently leaks Chrome and forgets its PID, which is the review-3 #1 regression class.
  - Self-heal runs exactly when reattach failed, so the endpoint is often unusable and this fallback is self-heal's **main** path for a live but unattachable Chrome, not a corner case.
- **What would catch it?** Nothing in the plan:
  - P5 uses a builder-written fixture, which will be shaped to fit whatever tokenizer the builder wrote.
  - P7b checks `readProcessCommandLine` against a node child, never `isOwnedChrome` against Chrome.
  - L1 takes the graceful path.
  - L8 and L10 expect `mismatch` against a dummy.
  - `$SP/r4/measure.mjs` line 17 checked only the port token, never the dir token.
- **Fix:**
  - Define the match precisely:
    - the port: exact `--remote-debugging-port=<port>` delimited by start/whitespace/quote;
    - the dir: the value of the `--user-data-dir=` argument, with quotes stripped, path-normalised, case-insensitive on Windows, equal to `state.userDataDir` (or ending in `<sep><basename>` for legacy/8.3 forms).
  - Add P7d: a fixture **captured from a real Chrome** during S6b (Windows CIM output, including one TEMP path with a space; plus a Linux `/proc` NUL-separated sample from WSL with a stand-in argv). Expected `match`.
  - Add live **L11**:
    - real session (bundle);
    - rewrite only the GUID in `state.wsEndpoint` (right port, wrong GUID);
    - run `close`.
    - Expected: `endpoint ... result=guid-mismatch`, `verify reason=match`, a `kill` line, the Chrome PID gone, the dir removed, exit 0.
    - Repeat once under the L1s space-containing TEMP.
  - Add L11 to blocking set B and to the S8 re-run.

### 4. MINOR (important): the spec typecheck (S6 preamble, S6a-5, S6c-5, S11-4) is vacuous, and new spec files make its AC unpassable

- **Evidence.** The plan's config: `extends packages/cli/tsconfig.json`, includes `src/**` and `tests/**`, `noEmit`, `exclude: []`, written to `$SP/rev4check/tsconfig.specs.json`. `tsc -p` printed **only `16 error TS6059`**, one per spec file: "is not under 'rootDir' .../packages/cli/src".
  - Negative control: adding a file containing `const x: number = 'not a number'` printed **17 TS6059 and no TS2322**. tsc reports no semantic diagnostics while option diagnostics exist, so a stale `exitTimeoutMs` would never surface. S6a-5's stated purpose fails.
  - Every new spec file (`chrome-owner`, `close-session`, `spawn-failure-cleanup`) adds a TS6059. The AC "no new errors" therefore fails for a reason unrelated to correctness.
- **Fix (trialled):**
  - `compilerOptions`: `rootDir` set to `$WT/packages/cli`; `typeRoots: ["$WT/packages/cli/node_modules/@types"]`; `types: ["node", "$WT/node_modules/vitest/globals"]`.
  - With those settings the planted error is reported (TS2322), and the real baseline is about 7 pre-existing errors: `dialog-cli.spec.ts`:122-123, `session-flow.spec.ts`:84/93, `direct-cdp-broker.spec.ts`:36.
  - Make S5 record that baseline, plus a planted-error negative control that must be reported.
  - Require 0 errors in the new spec files.

### 5. MINOR: the graceful close has no handshake timeout, so the "≤ 12 s" stop bound is not enforced by the design as written

- **Evidence.** Step 2 bounds the CDP step only with `protocolTimeout: min(CDP_CLOSE_MS, rem)` (plan.md 734).
  - In puppeteer-core 25.5.0, `NodeWebSocketTransport.create` opens the WebSocket with no timeout. It resolves on `open` and rejects on `error`.
  - `protocolTimeout` bounds CDP commands only.
  - A Chrome whose port accepts TCP but stalls the upgrade can hang `close`/self-heal until the 300 s CLI watchdog.
  - Also, `Browser.close` errors are swallowed (`connection.send('Browser.close').catch(debugCatchError)`), so "close failed" is only observable through the exit wait.
  - The repo already has the right pattern: `connectAtBrowserLevel(ws, timeoutMs)` in `dialog-cdp.ts` (outer `Promise.race`, timer cleared in `finally`).
- **Fix:**
  - Build `closeBrowserAtEndpoint` on `connectAtBrowserLevel`, and race `browser.close()` against the remaining time as well.
  - Also enforce the race in `teardownSpawnedChrome`, around `deps.cdpClose`.
  - Test P11: `cdpClose` never settles. Expected: teardown reaches the fallback and returns within `KILL_PHASE_DEADLINE_MS` + 250 ms.

### 6. MINOR: executability gaps a Sonnet builder will hit

- **(a) S6a-4/S6b-5 conflict with the helper API.** The regex `['"](powershell(\.exe)?|taskkill(\.exe)?|ps)['"]` matches the plan's own call form `systemBinary('powershell')` / `posixBinary('ps')` in `chrome-owner.ts`/`temp-profile.ts`.
  - Fix: export named helpers (`powershellExe()`, `taskkillExe()`, `psBin()`), or exclude `systemBinary(`/`posixBinary(` lines from the grep.
- **(b) S2 and S3a command blocks define no variables.** The S3a block does not `mkdir -p "$EV/S3a"`. In the S2 block `EV` is unset, so `mkdir -p "$EV/S2"` becomes `/S2`, which in Git Bash is under the Git install dir: a write outside the worktree.
  - S3b and S3a say "unchanged from revision 3", but revision 3 was never committed, so the builder has no text for S3b's commands.
  - Fix: inline the full blocks with the `SP=…; WT=…; EV=…` header.
- **(c) The `killChromeTree(` counts depend on unspecified wiring.** S6b-3 expects 4 lines at S6b, and S6c-3/S11-3 expect exactly 2. That only holds if `teardownSpawnedChrome`'s `deps.killTree` and `SpawnDeps.killOwned` both route through the single call inside `killOwnedChrome`.
  - If `cli.ts` supplies `killTree: (p, t) => killChromeTree(p, t)`, the count is 3 at S6c. If it supplies `killTree: killChromeTree`, the count is 3 at S6b.
  - Also state the new `killChromeTree(pid, timeoutMs): Promise<void>` signature. On master it is a fire-and-forget `void`.
  - Fix: state the wiring explicitly.
- **(d) The `mismatch` message is wrong for P6.** It says "its debugging port is closed", but in P6 the port is open and owned by another browser. Use neutral wording.
- **(e) The L1s 8.3 alias (and A5's "8.3 parent path" variant) cannot run on E:.**
  - `cmd /c 'for %I in ("E:\HMX_Projects\Internal_Projects") do @echo %~snxI'` printed `Internal_Projects`, and `%~sI` of `E:\AI-Cache\tmp\claude` printed the long path. 8.3 generation is off on this volume.
  - The plan's Git-Bash form `cmd //c "for %I in (\"…\") do @echo %~snxI"` printed only `"`.
  - Fix: precheck that the short name differs from the long name. Otherwise record the alias sub-case as N/A (volume has no 8.3 names). Run the command from PowerShell, not Git Bash; it is a read-only query.
- **(f) Warden PIDs are not in `our-pids.txt`.** S7's "no PID of ours alive" AC misses the detached warden (`$ISO/state/warden.json`). Add it.

### 7. MINOR: existing live close regressions are not re-run

- `tools/scenario-suite/verify-fr2-04-dialogs.mjs`:
  - N11 (named profile, confirm dialog open) asserts that `close` exits 0 in under 10 s;
  - N11b (dialog open) asserts the same;
  - plus about 40 other `cli(['close'])` cases.
- `verify-fr2-01-wait-states.mjs:882` asserts `teardown-close-kills-chrome` (exit 0, PID dead).
- S6b replaces exactly this code path: a Browser.close while a dialog is open, under `--profile`. The plan only has an auditor "extra" for `alert()`.
- Fix: run `verify-fr2-04-dialogs.mjs` (or at least its close cases) in S7 under the preamble with an isolated `HOME`/profile root. N11 writes `~/.sutradhar/profiles.json`, the same reason L6 is skipped. Or record why it is not run.
- Searched: nothing else in the repo (scripts, workflows, skills, docs) depends on `close` exiting 0 in the abnormal case. `run-cli.mjs` ignores the result.

### 8. MINOR: the behaviour change is under-documented for a patch release

- The changelog puts the `close` exit-1 behaviour under "Fixed", with no "Changed" or "Behaviour change" note.
- Self-heal refusing to start a session (exit 1 on `nav` etc.) appears only in S10b item 10. Neither the changelog nor the README mentions it.
- The changelog's "no API or tool changes" sentence is true for the SDK/MCP, but the CLI gains:
  - an exit-code contract;
  - two state fields;
  - a documented env switch.
- Fix:
  - add `### Changed` with both behaviours;
  - document the recovery path (finding 1b) in `packages/cli/README.md` "Exit codes";
  - update `packages/cli/README.md:287` ("`sutradhar close` kills that Chrome process tree").

### 9. MINOR: Linux close behaviour ships with no real-Chrome execution

- **Gap.** On Linux the new close path (graceful close, then `/proc` verify, then the zombie rule) is the code path for every Linux and Docker user. It is executed only through fakes:
  - P7b runs against a node child;
  - S7 runs on Windows only;
  - 6.4 item 5 is optional.
- `scenario-suite.yml`'s gate fails only on total breakage. `run-cli.mjs` ignores `close`'s exit code, so even that run would not flag "close exits 1 every time" or a leaked dir.
- **Fix:** before publishing, run the `workflow_dispatch` scenario-suite on `release/0.6.1`, then:
  - grep the CLI step log for `close` exit codes and for `Error: could not confirm`;
  - make "no such line" a user-owned publish precondition.
- If the user declines, keep it as S10b item 7.

### 10. MINOR (scope recommendation): defer the close redesign to 0.7.0 and ship the minimal ordering fix in 0.6.1

- **Reasons:**
  1. Both review 3 and this review found MAJOR defects in the close/recovery design. Findings 1-3 are all new failure modes introduced by S6b, so the design has not converged. The global escalation rule's spirit (re-derive after repeated audit failure) applies.
  2. The hazard S6b fixes, a blind kill of a recorded PID, is **pre-existing in 0.6.0** (master `cli.ts:482`, `:1665`).
     - The GAP-315-specific widening (review-2 #2: `chromePid` kept through a slow cleanup) is closed by ordering alone: kill (awaited, as the branch already does), then `clearState()`, then cleanup **without a PID wait**.
     - That is roughly 10 lines and keeps 0.6.0 semantics, with no new exit-code contract, state schema, PowerShell dependency or browser-package export.
  3. S6b couples GAP-315 shipping to itself (rule 5 reverts both). A minimal S6b removes most of the BLOCKED risk to the actual user-visible fix (temp-dir cleanup).
  4. A patch release normally does not change a command's exit-code contract or add a session-refusal mode.
- **Alternative if decision A stands:** fix findings 1-3 before S1, and treat S6b as its own audited item with its own escalation counter. S6b failures should not consume GAP-315's counter, and vice versa.
- Either way, log the 0.6.0 wrong-kill hazard as a gap, unconditionally rather than only on BLOCKED, if the redesign is deferred.

## Checked and found sound (no finding)

- **CDP identity check against an impostor or a reused port.**
  - `state.wsEndpoint` comes from `fetch('http://127.0.0.1:<port>/json/version')` (spawn-chrome.ts:87), and the probe uses the same host, so string equality on `webSocketDebuggerUrl` is a valid per-launch GUID comparison.
  - The graceful path **never kills**. An impostor that echoes the GUID can at most:
    - receive a `Browser.close`;
    - make us skip the fallback, but only if the port closes **and** `isAlive(pid)` is false, which already means nothing of ours runs under that PID;
    - or push us to the verified fallback.
  - A different Chrome on the port has a different GUID (P6). No wrong-kill path exists through step 2.
  - `followRedirects: true` in puppeteer's transport does not change this.
- **Linux zombies.** A detached Chrome whose parent exited, under a non-reaping PID 1 in Docker, stays `isAlive`. Step 3's `/proc/<pid>/stat` state `Z` maps it to `gone`. P7b's `await once(child,'exit')` makes CI deterministic.
- **Linux CI.** The new specs are platform-neutral (fake deps). Only P7b touches the OS, and its `/proc` read is sound right after `spawn`, since the PID is returned after exec. No repo test depends on `close`'s exit code.
- **WSL guard code.** It refuses `/mnt/`, anything outside `PROBE_ROOT`, and any `PROBE_ROOT` outside `/tmp/` (A9 self-test cases traced by hand).
- **`check-cleanup-paths.mjs`.** It applies to WSL logs when run on Windows, because both sides normalise identically and a `/mnt/` path falls outside the root.
- **`@sutradhar/browser` is `"private": true`**, and `packages/sutradhar/src/index.ts` does not re-export it, so `closeBrowserAtEndpoint` adds no public API.
- **The warden's cwd is `os.homedir()`** (warden-control.ts:282), so it cannot pin an ISO dir against the guarded `rm`.
- **The measured caps in 1.9** match `$SP/r4/measure.mjs`, and the CLI default is headless (`cli.ts:285`), which is the mode measured. The script used a slightly different PowerShell expression from the planned `ProcessId|CommandLine` one. P7b/P7c cover the planned one.

## False-pass notes for the auditor (from this review)

- The spec typecheck passes vacuously: it shows only TS6059 (finding 4). Before accepting S6a-5/S6c-5/S11-4, the auditor should check that the log contains at least one non-TS6059 diagnostic in the planted-error control.
- P5/P9 can pass with builder-shaped fixtures while the real-Chrome `match` (finding 3) and the leftover persistence (finding 2) are broken. The auditor should require L11 and P9b output, not only P1-P9.
- L10 can pass for the wrong reason, because a bogus `SystemRoot` can also break Winsock. The `verify reason=unverifiable` line plus the kept state (already in the plan) rule this out. Keep both mandatory.

## Verdict: REVISE

There are 3 MAJOR findings (1-3), all in the S6b close/recovery redesign, and 7 MINOR findings (4-10).
- Finding 1: on machines where the PowerShell query fails, a crashed or user-closed Chrome makes `close` fail forever, and the CLI eventually refuses new sessions. This is a regression against 0.6.0.
- Finding 2: the kept-PID guarantee is lost in the most common multi-entry sequence, and no test catches it.
- Finding 3: the fallback kill, self-heal's main path, is never run against a real Chrome, and its token rule as written cannot match one.

The cheapest resolution is finding 10: ship the ordering-only fix in 0.6.1 and move the redesign to 0.7.0. Otherwise, fix findings 1-3 with the tests named above before S1, and fold findings 4-9 into the same revision. Findings 4 and 6a would otherwise stop a builder at an AC it cannot meet as written.
