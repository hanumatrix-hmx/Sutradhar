# Plan review 1: release 0.6.1 plan

Reviewer: independent adversarial plan reviewer (Claude Opus 5.5), 2026-10-04. Read-only on the repo except this file.
Worktree `$WT` = `E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041`
(`git rev-parse --show-toplevel` printed `$WT`; `git branch --show-current` printed `release/0.6.1`).

## Claims I re-verified and found correct (no finding)

- **Only fast-uri ships.** `grep -c` over the on-disk bundles gave `dist/cli-bin.js fasturi=0 express=0 hono=0 qs=0 ip=0`,
  `dist/index.js` all 0, `dist/mcp-cli.js fasturi=6 express=0 hono=0 qs=0 ip=0`. The esbuild path markers in mcp-cli.js are
  exactly the 12 packages the plan lists. I listed every bare-specifier `import(`/`__require(`/`from '...'` in all three
  bundles. Apart from node builtins, the only external is `puppeteer-core`. The `'ajv'`, `'ajv-formats'` and
  `'@modelcontextprotocol/sdk/validation/ajv'` strings in mcp-cli.js are JSDoc comments (lines 53827-53832), not runtime
  imports. No `.js.map` files are produced (only `*.d.ts.map`). `scripts/build-bundle.mjs` uses `external: ['puppeteer-core']`
  only, and `packages/sutradhar/package.json` has one runtime dependency. The conclusion holds.
- **Audit inventory.** `npx --yes pnpm@9.1.0 audit --json` gave `{"moderate":16,"high":17,"critical":1},"totalDependencies":518`.
  The fast-uri/qs/hono/ip-address paths all run through `packages\mcp-server > @modelcontextprotocol/sdk@1.30.0`. No
  advisory sits under `puppeteer-core`.
- **Merge shape.** `git merge-tree --write-tree origin/master fix/gap-315-temp-profile-cleanup` reported a conflict only in
  `packages/cli/src/cli.ts` (lines 281-289, `spawnViewport` vs `sweepStaleTempProfiles`). `spawn-chrome.ts` and `gaps.md`
  auto-merge. In the merged tree, `killChromeTree` is un-awaited at cli.ts:308 (F8) and at spawn-chrome.ts:105 (timeout).
  The self-heal (:491-492) and cmdClose (:1687-1688) sites are awaited. The GAP-356 guard (project-config-cli.spec.ts:419)
  checks only `resolveCliSettings`/download-roots text, so the merge will not trip it.
- **Version sites.** `git grep -n "0\.6\.0" -- ':!*.md' ':!pnpm-lock.yaml' ':!.ai'` lists exactly the 4 files (plus an
  unrelated emoji-regex 10.6.0 in tools/). `packages/mcp-server` and `packages/dev-runtime` have no `"test"` script
  (`grep -c '"test"'` gave 0 and 0).
- **FR2-11 row.** Branch b861d3a's row 17 says HELD. Master's row 17 is stale SPEC. The branch also differs on row FR2-14
  (it is older there), so copying only row 17 is correct.

## Findings

1. **MAJOR: the deletion-safety probes run only on Node 25, but the package supports Node >= 18 and CI runs Node 20.**
   - Gap: A2 (junction as candidate), A3 (junction inside a candidate) and A4 (no partial delete) test how
     `fs.promises.rm({recursive:true})` and `stat`/`readdir` behave on Windows junctions and locked files. Node has
     reimplemented `rm` across majors (JS rimraf vs native). A pass on v25 says nothing about what users on 18/20/22 run.
   - Evidence: `grep -n engines packages/sutradhar/package.json` gives `"engines": { "node": ">=18.0.0" }`. ci.yml gives
     `node-version: 20`. The plan (1.1) records `node -v` = v25.0.0 and A3 says "Record `node -v`" but runs nothing else.
   - Fix: run the S4/S8 A1-A4 probe harness (the extracted `temp-profile` module) under Node 20 and Node 22 on Windows as
     well as v25. Node 18 is also needed if it stays in `engines`. Fetch each binary into `$SP`, for example
     `npx --yes node@20 probe.mjs` or a portable zip. Record `process.version` in every probe log. Any version where the
     victim loses a file is a REOPEN.

2. **MAJOR: POSIX is marked "code reading only", but a Linux environment is available here and CI is Linux.**
   - Gap: C5 accepts the POSIX branch untested: `ps -A -o args=` scan, `SingletonLock` PID parse, no rule-5 equivalent,
     symlink candidates in a shared `/tmp`. A data-deleting feature ships to Linux and macOS users with zero executed
     evidence. The new spec also first runs on Linux in CI, after the PR, so nothing in the plan shows Linux parity.
   - Evidence: `wsl.exe -l -v` shows `Ubuntu Running 2`. `wsl.exe -e sh -c "command -v node; node -v"` gives
     `/usr/bin/node v20.20.2`, which is the CI Node version. No Chrome is installed in WSL.
   - Fix: add an S4/S8 item "C5-live (WSL, Node 20)". Copy the extracted module into a WSL-native scratch dir (not `/tmp`
     itself; use `mktemp -d` and pass `tmpRoot` explicitly). Then probe:
     - (a) the real `scanCommandLines()` sees a dummy long-lived process whose argv carries
       `--user-data-dir=<root>/sutradhar-cli-1700000000000-X` with a path longer than 200 chars, so a truncated `ps` would
       be caught;
     - (b) a hand-made `SingletonLock -> <hostname>-<live pid>` gives `owner-alive`, and a dead PID gives removal;
     - (c) a symlink candidate `sutradhar-cli-1700000000001-L -> victim` leaves `victim` intact;
     - (d) the unit spec logic under Node 20.

     Consider `ps -A -ww -o args=` as cheap hardening. Add a gate/handoff item: "CI (ubuntu, Node 20) green on the
     release PR before `npm publish`".

3. **MAJOR: the `close` latency bound (45-55 s, plus up to ~35 s at session start) is accepted, not bounded. The changelog
   number is also wrong.**
   - Gap: the timeouts are separate and add up: taskkill 10 s (`killChromeTree(pid, timeoutMs = 10_000)`) +
     `waitForPidExit` 10 s + `scanCommandLines` 20 s + `removeWithRetries` 15 s = 55 s. Session start adds the scan (20 s)
     plus a 15 s sweep budget, and one `rm` of a huge dir has no bound (B4). The S10 changelog draft says "~45 s", which
     disagrees with the 55 s sum and with Risk 2. The scenario-suite cap is 90 s per case. Every `close` also launches
     PowerShell for a CIM query, even in the normal path.
   - Evidence: `git show fix/gap-315-temp-profile-cleanup:packages/cli/src/temp-profile.ts` shows
     `scanCommandLines(timeoutMs = 20_000)`, `exitTimeoutMs ?? 10_000`, `removeTimeoutMs ?? 15_000`, and a sweep
     `budgetMs ?? 15_000` that is checked only between dirs.
   - Fix (better bound for a patch release): give `removeSessionTempProfile` one overall deadline. For example, 15 s from
     entry covers wait + scan + remove, the scan gets `min(8 s, remaining)`, and anything left over means keep + warn, so
     the next sweep retries. In the sweep, start the deadline before the scan and give the scan `min(8 s, budget)`. Then
     close worst case = 10 s taskkill + 15 s, about 25 s; session start worst case is about 15 s plus one rm. This is a
     small, auditable change (its own commit in S6, re-audited in S8). Add an S7 AC: L1 close-time p50/max, recorded
     monotonically, with max <= the computed bound. Correct the changelog figure to the computed bound.

4. **MAJOR: the S4 -> S5 gate is self-contradictory, and the blocking set differs between sections.**
   - Gap: S4's AC says a FAIL in A1-A6 "is a REOPEN that blocks S5 until it is fixed (the fix lands after the merge as
     its own commit in S6...)". A fix cannot both block the merge and land after it. The S5 precondition then allows
     merging with open REOPENs. Section 3's verdict rule makes A1-A7 **and B1-B2** blocking, while S4's AC names only
     A1-A6. So the plan has no single rule saying whether unsafe deletion code may enter `release/0.6.1`.
   - Evidence: plan lines 358-359, 365-366 and 674-675.
   - Fix: state one rule. A FAIL in A1-A7/B1-B2 may be merged only together with its S6 fix commit, and no CLI built from
     an intermediate commit is ever run outside an isolated TEMP. The S8 audit must re-run every previously failed probe
     unmodified and show it now passes. Make S4's AC list the same blocking set as section 3.

5. **MAJOR: the in-use probes (L3, A5) can pass for the wrong reason. A4's isolation of rule 5 lacks a precondition.**
   - Gap: rule 2 matches the dir basename on *any* process's command line. The branch's own evidence found that "the
     first retry returned `in-use` because the dir's name was on the command line of the invoking `bash`/`node -e`
     processes". If the probe script, or the shell that started it, carries the dir name in argv, then L3/A5 print
     `reason:'in-use'` without Chrome being detected at all. That is exactly the false pass the plan's false-pass analysis
     claims to rule out. For A4, rule 5 only means anything if Chrome actually created `lockfile` and holds it without
     share-delete. The CLI defaults to `--headless=new` (spawn-chrome.ts:80), and the branch never isolated rule 5:
     its negative case passed through rule 2. GAP-346 confirms that a recursive delete of a live profile partially
     succeeds on Windows ("most files survived (locked or in subdirectories)").
   - Evidence: branch `evidence/GAP-315-fix/README.md`, "Side observation from that cleanup". `gaps.md:346` (GAP-346).
   - Fix: every probe passes dir paths through env vars or files, never argv, and logs the scan output it used. L3/A5 must
     print the matching scan line and show that it is the Chrome process (the PID matches the one we started). A4 must
     first assert that `<dir>/lockfile` exists and that an `fs.rm` of it fails with EBUSY/EPERM while Chrome runs. Run A4
     for both `--headless=new` and headed (`--headed` is a supported CLI mode). If either mode has no locked lockfile,
     rule 5 does not protect that mode, and the finding must say so.

6. **MAJOR: GAP-349 is under-specified, and the changelog claim built on it is wrong.**
   - Gap:
     - (a) `spawnDetachedChrome` creates the temp dir before `spawn`. The `if (!pid) throw new Error('Failed to spawn
       Chrome — no PID returned.')` path (spawn-chrome.ts:86 merged), and an async spawn `error` such as ENOENT or EACCES,
       still leak the new empty dir. The changelog's "a failed spawn removes its own dir" would therefore be false.
     - (b) The proposed helper `discardSpawned(s: SpawnedChrome, ...)` cannot be called from the timeout path, because no
       `SpawnedChrome` (wsEndpoint) exists there. It needs `{pid?, userDataDir, tempProfile}`.
     - (c) The F8 path now inherits the full close-cleanup latency (finding 3) before `exit 1`.
     - (d) S6-1's grep (`grep -v "await \|export async function"`) misses `void killChromeTree(` and
       `killChromeTree(x).then(`, and it matches any line that merely contains "await ".
   - Evidence: merged `spawn-chrome.ts` (from the merge-tree): `73: const resolvedUserDataDir = userDataDir ?? (await
     createTempProfileDir());`, `86: if (!pid) throw ...`, `105: killChromeTree(pid);`.
   - Fix: make the helper take `{ pid?: number; userDataDir: string; tempProfile: boolean }`. Call it on all three
     failure paths: no-PID, timeout and F8. Add a unit test for the no-PID path (the dir is removed with no kill).
     Replace the S6-1 grep with a TypeScript-aware check: enable `@typescript-eslint/no-floating-promises` for
     `packages/cli` just for this check, or use
     `grep -nE "killChromeTree\(" | grep -vE "^\s*(\S+:)?\s*(export async function|.*await killChromeTree\()"`. Also
     state in the evidence that there are exactly 4 call sites.

7. **MINOR: the real-%TEMP "listing identical before/after" check is flaky on a shared machine and has no positive
   control.**
   - Gap: other sessions create and remove `sutradhar-cli-*` in the real TEMP (`$env:TEMP` = `E:\AI-Cache\tmp`), so
     "identical" can fail spuriously. A sweep against the real TEMP that found nothing eligible would also leave the
     listing identical, which is a false pass. For the S5/S11 vitest runs nothing proves the tests used the isolated root.
   - Fix: define the check as "no entry present before is missing after, and any disappearance is attributed". The proof
     is a positive assertion: CLI runs assert `dirname(state.userDataDir) === isolated TEMP`, and the vitest runs
     `grep -n "tmpRoot: root"` and confirm that every `sweep`/`removeSessionTempProfile` call in the spec passes an
     explicit root (C6). Also put a stale canary `sutradhar-cli-1700000000009-CANARY` (dead marker, mtime -1 h) inside
     the *isolated* TEMP and assert that it is swept. That proves the sweep ran against the isolated root.

8. **MINOR: the baseline and gate measure tests differently.** S1 runs `vitest run --globals` per package directly, while
   S11 runs `turbo run test`, which uses each package's own script and flags. "Totals >= baseline" therefore compares
   different command sets. Fix: S1 must also run `turbo run test --concurrency=1` with the isolated TEMP, plus the direct
   mcp-server/dev-runtime runs, and S11 compares like with like. Export the isolated `TEMP/TMP/TMPDIR` for the S1 loop
   unconditionally, not "if tests spawn".

9. **MINOR: S5-1 uses `git show --stat HEAD` on a merge commit.** That prints a combined (`--cc`) stat, not the diff
   against the first parent, so the "11 files" check is unreliable. Use `git diff --stat HEAD^1 HEAD` and
   `git diff --name-only HEAD^1 HEAD | wc -l`.

10. **MINOR: S11-3's version check is loose.** `grep -c "0.6.1"` is a regex (the dot matches any character) and skips
    `cli-bin.js`. Fix: `grep -cF "SUTRADHAR_VERSION = \"0.6.1\"" dist/index.js`, `grep -cF "0.6.1" dist/mcp-cli.js
    dist/cli-bin.js`, and assert `grep -cF "'0.6.0'"`/`"\"0.6.0\""` for the version constants is 0 in all three bundles.

11. **MINOR: the consumer `npm audit` = 0 (S11-6) has no rule for when it fails.** The consumer resolves puppeteer-core's
    tree fresh at install time, which is outside this release's control. Fix: if it is not 0, record the advisories and
    their paths. It is a gate FAIL only if a path is not under `puppeteer-core`, or the advisory is fixable within
    `^25.5.0`. Otherwise it is a documented note for the user.

12. **MINOR: the S7 L7 mutant edits the real `dist/cli-bin.js` in place.** Fix: write the mutant to a sibling path in the
    same dir (for example `packages/sutradhar/dist/cli-bin.mutant.js`, gitignored; module resolution of `puppeteer-core`
    still works) and delete that one file afterwards. The real dist is then never modified, and the sha256-restore step
    goes away.

13. **MINOR: S7's spawnSync timeout path lacks a defined Chrome cleanup.** If `spawnSync` times out, the CLI child is
    killed, but its detached Chrome survives. Section 0 says to kill "only PIDs the step itself started", which is
    ambiguous for a Chrome the CLI started. Fix: on timeout, read `chromePid` from `$T/state/*/state.json` or from the
    dir's `.sutradhar-owner.json`, kill only that PID tree (`taskkill /PID <pid> /T /F`), and log it.

14. **MINOR: the dev-only advisory deferral rationale is partly wrong.** The current audit gives brace-expansion patched
    `>=1.1.21` / `>=2.1.7`, js-yaml `>=4.3.2` and nanoid `>=3.3.18`. All of these satisfy their parents' existing caret
    ranges, so they do not need an eslint 9 or vite 6 migration. Fix: either add them to the same `--lockfile-only`
    update (dev-only, zero shipped impact), or keep them deferred with the corrected reason ("out of scope for a
    shipped-code patch"). Only vitest, vite, esbuild and braces really need major upgrades or have no fix.

15. **MINOR: GAP-ID and pointer hygiene for S2.** The copied FR2-11 row points to `decisions.md "FR2-11 HELD"` and to
    `evidence/FR2-11/run-1 + fix-1..3 + audit-1..4`, and most of those exist only on the branch (master has `fix-1/`,
    `audit-reruns-fix-3/`, `spec.md`). The branch's `gaps.md` also reuses GAP-349 and GAP-353 for different gaps than
    master's: branch `GAP-349 | FR2-11 run-1 | ... checkInvalidTimeoutMs` vs master `GAP-349 | FR2-14 fix-1 | ...
    profile directory`. Fix: title the new master decisions entry so it contains the phrase "FR2-11 HELD", which makes
    the row's pointer resolve. Have it state that the evidence paths and GAP-339..378 cited on that branch live only
    there and collide with master's GAP numbering.

16. **MINOR: missing A1 negative names.** Add `sutradhar-downloads` (the default download root under the OS temp
    dir) and the download lock file names (AGENT_SETUP.md:355) to A1. Also add a TEMP path that contains a space and its
    8.3 alias (the user dir is `C:\Users\Varad M`) to B5/L1. A one-off live case with
    `TEMP=$SP/S7 dir with space/temp` exercises rule 1's `norm()` comparison.

17. **MINOR: the S8 revert path is in the wrong order and misses a later cost.** Revert the S6 commits newest-first
    *before* `git revert -m 1 <merge>`, so each revert applies cleanly. Note that a later re-merge of the GAP-315 branch
    then needs "revert the revert". Record that in `decisions.md`.

18. **MINOR: git through Git Bash vs the global rule.** The global CLAUDE.md says "On Windows, run git and anything that
    needs exec bits through WSL". The plan runs git from Git Bash. No touched file needs exec bits (`git ls-files -s`
    shows cli.ts and spawn-chrome.ts as 100644), so the practical risk is low. State the deviation and its reason in
    section 0, or route the merge/commit steps through WSL.

19. **MINOR: docs and follow-ups.** The CLI README should tell users that the CLI now deletes its own
    `sutradhar-cli-*` dirs in the OS temp dir, that `close` can take up to the bound from finding 3, and that a session
    start may sweep stale dirs. Also log a follow-up gap: mcp-server/dev-runtime have no `test` script, so CI never runs
    `tools.spec.ts`.

## Verdict: REVISE

Six MAJOR findings (1-6). None of them is a BLOCKER: the bundle and lockfile analysis is sound, and the GAP-315 risks are
already partly guarded by the audit structure. The plan should be revised for 1-6 before any builder starts S4/S5.
