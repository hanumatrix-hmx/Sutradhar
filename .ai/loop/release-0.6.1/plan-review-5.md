# Plan review 5: release 0.6.1 plan (revision 5)

Reviewer: independent adversarial plan reviewer, round 5 (Claude Opus 5.5), 2026-10-04. Read-only on the repo apart
from this file. Scratch output only under `$SP/rev5/` (a `git merge-tree` dump).

Location check: `git rev-parse --show-toplevel` printed `$WT`; `git branch --show-current` printed `release/0.6.1`.

Sources read: `plan.md` rev 5 (all 1523 lines), `plan-review-4.md`; master `packages/cli/src/{cli.ts (spawnFreshSession
255-330, withSession self-heal 440-500, cmdClose 1587-1680), spawn-chrome.ts, state.ts}`; branch
`fix/gap-315-temp-profile-cleanup` `temp-profile.ts`, `spawn-chrome.ts`, `temp-profile.spec.ts`;
`scripts/check-release-ready.mjs`; `packages/sutradhar/package.json`; `.github/workflows/ci.yml`; `turbo.json`;
`tools/scenario-suite/verify-fr2-0{1,4}-*.mjs`; `packages/cli/tests/unit/help-text.spec.ts`.

## Facts re-derived (the plan's claims that hold)

| claim | command | result |
|---|---|---|
| one merge conflict, in `spawnFreshSession` | `git merge-tree $(git merge-base HEAD fix/gap-315…) HEAD fix/gap-315…` | 1 `<<<<<<<`, in cli.ts at the viewport/sweep lines; `spawn-chrome.ts` and `gaps.md` merge cleanly |
| S5-1 = 11 files | same dump + `git diff --name-only fdae749 fix/gap-315… \| wc -l` | 11 (5 evidence files, gaps.md, cli.ts, spawn-chrome.ts, state.ts, temp-profile.ts, temp-profile.spec.ts) |
| S5-2 "+19 tests" | `git show …:temp-profile.spec.ts \| grep -cE "^\s*(it\|test)\("` | 19 |
| S6b-3 = 3 lines | `git grep -n killChromeTree HEAD/branch -- packages/cli/src` | master calls at cli.ts:301 (F8), :482, :1665, spawn-chrome.ts:97; branch awaits :416/:1574 and does not touch :97/:301, so after S6b replaces self-heal and close: definition + F8 + timeout = 3 |
| S6a-4 grep targets | `git grep -nE "['\"](powershell…\|ps)['\"]"` | master: spawn-chrome.ts:107 `'taskkill'`; branch adds temp-profile.ts:148 `'powershell.exe'`, :151 `'ps'`. No other match in `packages/cli/src` |
| spec typecheck baseline | `tsc -p $SP/r5/tsconfig.specs.json` | exactly the 7 errors of 1.9 (6 TS2322 + 1 TS6133), 0 TS6059 |
| version sites | `git grep -nF 0.6.0 -- <S9 paths>`; `git show --stat a295834` | exactly the 4 sites; the 0.6.0 bump touched the same 4 files |
| dist version strings | `grep -oE "(SUTRADHAR_VERSION\|MCP_SERVER_VERSION) = …" dist/*.js`; `grep -cE "0\.6\.[01]" cli-bin.js` | `= "0.6.0"` in index.js and mcp-cli.js, double quotes; cli-bin.js 0 |
| in-range fast-uri is 3.1.8 | `npm view "fast-uri@^3" version`; `npm view ajv@8.20.0 dependencies` | 3.1.8 highest 3.x; ajv range `^3.0.1`. qs 6.16.0, hono 4.13.12, @hono/node-server 2.1.3, ip-address 10.7.3 are current |
| WSL node in a non-login `sh -c` | `wsl.exe -e sh -c 'command -v node; node -v'` | `/usr/bin/node`, v20.20.2, tmpdir `/tmp` |
| ESLint flags in S6c | `eslint --version`; root `.eslintrc.js` | v8.57.1 (eslintrc mode, so `--no-eslintrc`/`--resolve-plugins-relative-to` are valid); `@typescript-eslint/*` hoisted |
| `help-text.spec.ts` needs no build | file header | reads `src/cli.ts` text, so T7 works without rebuilding |
| R block is isolatable | verify-fr2-04 lines 57-94; verify-fr2-01 line 698-700 | both set `SUTRADHAR_CLI_STATE_DIR` per case; fr2-04 sets child `TEMP` to a dir under `os.tmpdir()`; the only kills are by PID of their own Chrome/warden |
| evidence is committable | `git check-ignore -v .ai/loop/release-0.6.1/evidence/S1/x.txt` | not ignored |

## Check 1: review-4 findings and leftovers from the removed redesign

Every review-4 finding is resolved in text (section 11): #1-#3 and #5 are removed with the redesign and carried into
section 10 as R-1..R-4; #4 (spec typecheck) is fixed and re-verified (above); #6a-#6f, #7, #8, #9 and #10 are each
mapped to concrete text. The deferral is recorded in section 10, 6.1, 6.2 item 2 and S10b item 9 (unconditional).

Leftovers: grep for `P8|ownership|SystemRoot|WS timeout|exit 1|killOwned|teardownSpawnedChrome|closeBrowserAtEndpoint|unverif|L8|L10|L11|chrome-owner`
finds them only in the banner (12-13), section 10, the historical sections 7-9 (under the "superseded" banner at
1335), the harness-only ownership check in 0.3, and the `SystemRoot` fallback of `system-binaries.ts` (legitimate).
Nothing in sections 0-6, which are what builder and auditor briefs carry, asks a builder to execute removed work.
0.6.1 no longer depends on the redesign: S6b uses `killChromeTree` by reference and adds no query, state field or exit
path. One wording leftover in section 5 can still produce a false REOPEN (finding 4).

## Findings

### 1. MINOR (important): the retained trailing `clearState()` in `cmdClose` now runs after the slow cleanup and can delete a session another command created during it

- **Evidence.** S6b says "The existing trailing `clearState()` stays. It is idempotent" (plan 770). Master `cmdClose`
  ends with `await clearState(); console.log('Session closed.')` (cli.ts ~1677). `clearState()` is
  `rm(STATE_FILE, {force:true})` (state.ts:109-111), and the CLI has no lock around state (grep for
  `lock|mutex|acquire` in cli.ts/state.ts: none).
- **Sequence.** `close` → kill → `clearState` (S6b step 2) → cleanup runs for up to 15 s (exit wait + scan + rm). A
  `nav` from the same cwd in that window finds no state, spawns a fresh Chrome, and writes `state.json`. `close` then
  reaches the trailing `clearState()` and deletes it. That Chrome keeps running with no state pointing at it, which is
  the leak class F8/GAP-349 exists to prevent.
- **Why it is new.** On 0.6.0 the state file still exists until the kill returns, and the kill is immediate, so a
  concurrent `nav` reattaches or self-heals the old record. The early clear plus a late clear opens a window of up to
  about 15 s. Same-cwd concurrency is not documented as supported, so this is MINOR, but "idempotent" holds only if
  nobody writes in between.
- **Fix.** In the `chromePid` branch, drop the trailing `clearState()`: `stopSpawnedChrome` already cleared it. Keep
  it in the attached-session (`else`) branch only. Add O7: the cleanup stub writes a new state record (simulating a
  concurrent `nav`); after `cmdClose`'s tail, the record must still exist. The test needs the tail to be a tested
  function, or an O6-style source guard: exactly one `clearState()` reachable after `stopSpawnedChrome(` in cmdClose.

### 2. MINOR (important): `deps.now()` has no stated clock, and mixing clocks makes the 15 s cleanup deadline unbounded

- **Evidence.** S6b: `deps.cleanup(..., deps.now() + CLOSE_CLEANUP_DEADLINE_MS)`. The deps list says only `now()`.
  `temp-profile.ts` deadlines are `performance.now()` based (branch `removeWithRetries`, `waitForPidExit`; S6a T5 uses
  `performance.now()`).
- **Failure.** If `cli.ts` wires `now: Date.now`, `deadlineAt` is about 1.7e12 ms away. The exit wait and scan are
  still capped (`min(cap, rem)`), but the rm retry loop (`while performance.now() < deadline`) retries EBUSY forever.
  A Chrome child that holds `lockfile` then hangs `close` until the 300 s watchdog.
- **Why no check catches it.** O1-O6 use fake `now`. The S6c `Date.now()` grep does not cover `cli.ts`. S7 L1 normally
  removes the dir on the first attempt.
- **Fix.** State `now: () => performance.now()` in the wiring. Extend the S6c grep to the `stopSpawnedChrome` deps
  literal in `cli.ts`. Add one unit test that runs `stopSpawnedChrome` with the real `now` and a `cleanup` that asserts
  `deadlineAt - performance.now()` lies in (14 000, 15 001].

### 3. MINOR (important): the S11 gate cannot pass on the plan's own fallback path (S8 BLOCKED, continue at S9)

- **Evidence.** Rule 4 #3 and the S8 revert procedure say "continue at S9" and ship the security fix. After those
  reverts the tree is master's code, which has 4 `killChromeTree(` calls (`git grep`: cli.ts:301/482/1665,
  spawn-chrome.ts:97) plus the definition, and a quoted `'taskkill'` (spawn-chrome.ts:107).
- **Effect.** S11-3 hard-codes `= 1` and `= 0`. S11-8c requires `phase kill`/`state-cleared` lines and a swept
  canary. The changelog tells S10 to write "not included", but S11 has no variant, and "fix nothing inside the gate"
  then blocks the release that rule 4 says should proceed.
- **Fix.** Add an S11 "BLOCKED variant":
  - item 3 counts equal master's (5 lines / 1 match), and `git diff origin/master -- packages/cli/src` is empty;
  - 8c is replaced by a plain `nav` + `close` exit-0 check plus the real-TEMP snapshot.

  Also mention the variant in 6.3.

### 4. MINOR: section 5's auditor check compares the kill function "against master", which forces a false REOPEN

- **Evidence.** Section 5 O: "the kill function and its arguments are unchanged against master, except for the
  absolute taskkill path". But master's `killChromeTree` is `function …: void` with a fire-and-forget `spawn`, while
  the branch version (kept by design, 1.5) is `async`, awaited, capped at `timeoutMs` and `windowsHide: true`
  (merge-tree dump, spawn-chrome.ts hunk @@ -101).
- **Effect.** A literal S8 auditor reports FAIL on a [B] item. That counts toward escalation (rule 4), and two such
  failures stop the work.
- **Fix.** Say "unchanged against the S5 merge commit (the branch's awaited form), except `taskkillExe()`; the
  `taskkill` arguments `/PID <pid> /T /F` and the POSIX `-pid`/`pid` SIGKILL fallback are identical to master".

### 5. MINOR: GAP-349 P2 removes the dir without waiting for the killed Chrome to exit; G3 cannot see it

- **Evidence.** `discardSpawnedProfile` calls `deps.removeProfile(dir, undefined, {tmpRoot})`, so `chromePid` is
  `undefined` and the bounded exit wait is skipped. Branch `removeSessionTempProfile` then gathers facts once:
  - the marker written by `spawnDetachedChrome` holds the PID just killed, so `ownerAlive` is true if the process has
    not finished dying;
  - or the scan still lists a child, which gives `in-use`.

  Either is a one-shot keep; only the `rm` is retried. On POSIX `killChromeTree` is a synchronous SIGKILL with no wait
  at all.
- **G3 cannot catch it.** G3 uses fake PID 4242 that nothing kills. It passes on Windows only because Windows PIDs are
  multiples of 4, so 4242 never exists. On Linux CI, PID 4242 can be a live runner process, which gives
  `owner-alive`: G3 then fails, and CI is red for a test-design reason.
- **Fix.**
  - In P2 (a kill was issued), pass `pid` so the bounded read-only exit wait runs.
  - Make G3's marker PID a guaranteed-dead PID, or inject `isAlive`.
  - Add a G3b: the kill fake resolves first and a fake `isAlive` stays true for 300 ms; the dir must still be removed.
  - Note in S10b that P2 has no live trigger, as F8 does.

### 6. MINOR: S6a debug seam vs an existing spec line can produce a spurious X1 failure

- **Evidence.** The branch spec, line 40: `isAutoTempProfileDir(path.join(os.homedir(), '.sutradhar', 'profiles', 'work'), ROOT)`.
  S6a requires every path the cleanup code "considers" to be logged. If the builder logs inside the pure predicates
  (`isAutoTempProfileDir`/`decideRemoval`), the cli matrix log contains `path="C:/Users/…"`, so `check-cleanup-paths`
  exits 1 (S6a-6, X1 [B]).
- **Fix.** Specify that the seam logs only in the I/O paths (`createTempProfileDir`, `removeSessionTempProfile`,
  `sweepStaleTempProfiles`, `removeWithRetries`, scan), never in the pure predicates. Alternatively, change that spec
  line to a fake home under `os.tmpdir()`.

### 7. MINOR: evidence-commit policy is unspecified, so S11's "clean tree" start condition is ambiguous

- S5 commits only `cli.ts`, and S5-1 requires exactly 11 files, so `$EV/S5` cannot go in the merge commit. S6a-S6d,
  S9 and S10 never say whether `$EV/<STEP>` is added. S11 item 1 then finds untracked evidence and has no rule for
  which commit takes it.
- **Fix.** State the policy: each step's commit adds `$EV/<STEP>` by name. S5's evidence goes into the S6a commit,
  or a separate `GAP-315 merge evidence` commit placed before S6a.

### 8. MINOR: executability gaps for a Sonnet builder

- **(a) Test-matrix template.** The template hard-codes `cd packages/<p>`. `apps/server` needs `cd apps/server`, and
  the log name `test-apps/server.log` contains a slash. Give the two special entries literally.
- **(b) S11 items lack commands.**
  - item 6: pack command, `--pack-destination "$SP/S11-pack"`, scratch install dir, `npm audit --json`;
  - item 7: which dir; how the 0.6.0 file list is obtained (`npm pack sutradhar@0.6.0 --dry-run --json`);
  - 8b: the SDK harness;
  - 8c: whether it reuses `$EV/S7/gap315-live-merged.mjs` with one iteration, and who creates the S11 canary.
- **(c) WSL probes.** On Windows a probe sits in `$SP/S4` and the module in `$SP/S4/mod/`, but in WSL both are copied
  flat into `$D`. A static `import './mod/temp-profile.mjs'` breaks in one of the two. Pass the module path in an env
  var (`TP_MODULE`) and use a dynamic `import()`.
- **(d) WSL logs and the path checker.** `check-cleanup-paths` on WSL logs must be given the WSL `PROBE_ROOT` as its
  root argument (both normalise to `e:/tmp/...` on Windows). With the Windows ISO as root, every WSL line is
  `OUTSIDE-ISO`. State this in S4/X1.
- **(e) R1's comparison run.** R1 says "compared against a run on the S5 commit" but not how. Say: a
  `git worktree add "$SP/S7-s5wt" <S5 sha>` plus a build there. Never check out S5 in `$WT`.
- **(f) Lint aborts early.** `turbo run lint` stops at the first failing task. GAP-314 (mcp-server lint) is still
  TODO, so the S1/S3b lint comparison covers a truncated task set. Add `--continue`.
- **(g) S11 item 4.** Use `turbo run typecheck --force`, so a cache replay cannot stand in for a run (global rule:
  cached build).
- **(h) S6a file list.** The "Files" list omits `spawn-chrome.ts`, but `killChromeTree` must switch to
  `taskkillExe()` there for S6a-4.
- **(i) Blocking set.** Set B says O1-O3; section 5 marks O1-O6 [B]. Align them.

### 9. MINOR: documentation and release-truth details

- **(a) Changelog versions.** S10 hard-codes `qs 6.16.0, hono 4.13.12, @hono/node-server 2.1.3, ip-address 10.7.3`,
  and S3a-4 hard-codes fast-uri 3.1.8, while S3a-2 allows newer in-range patches. Derive all of them from
  `$EV/S3a/moved-keys.txt`, and make S3a-4 read ">= 3.1.8 and the only fast-uri".
- **(b) Session-start latency.** Every fresh session now runs a CIM scan and a sweep of up to 15 s. Add it to
  `### Changed`. Only `close` latency is documented today.
- **(c) README heading.** `README.md:33` reads "Status (0.6.0)". S10-2 checks only "as of 0.6.0". Decide and record.
- **(d) A new advisory at S11.** If `audit --prod` is non-zero at S11 because a new advisory was published after S3a,
  the plan has no rule. Add: stop, record, re-plan; never ship around it.
- **(e) Publish location.** 6.4 does not say where to publish from. Say: from the S11-gated commit in the
  `release/0.6.1` worktree, or, after a PR merge, a fresh build plus S11 items 3/6/7 re-run in the publishing
  checkout. `check-release-ready` checks only mtimes and a clean tree, not version or content.

### 10. MINOR: global-rule compliance

- **False-pass analysis.** Only S7 has one (plan 990). The global rule requires one per AC per step. Add to 0.3:
  "every step's `$EV/<STEP>/README.md` has a false-pass analysis per AC with the ruling-out command and output".
- **Timeouts.** S3a/S3b/S7/S11 builds use `timeout 2400` and R1 uses 1800 s, above the ≤ 20 min cap the global rule
  sets for waits. Either cap at 1200 s or record the deviation (a build is not a poll loop) explicitly in 0.3.

## Check 3: order and one-step-one-commit

The order is valid:
- S3a installs before S4 uses `node_modules/.bin/esbuild`.
- The branch touches no lockfile.
- S6a changes the `cleanupSessionTempProfile` signature at its existing call sites before S6b rewires them.
- S9 follows the S8 acceptance.
- `check-release-ready` runs last, after the evidence-only commit, which touches no `src`, so the dists stay fresh.

Every code-changing step names its own commit. The exceptions are the evidence-only placement gaps in finding 7.

## Check 4: release gate completeness

| required | present | note |
|---|---|---|
| forced build | S11-3 ("Forced build"; command as in S7) | ok |
| all package tests incl. mcp-server/dev-runtime direct | S11-5 matrix (20 entries; both packages lack `test` scripts and are run directly) | template gap 8a |
| typecheck | S11-4 turbo + non-vacuous spec typecheck | add `--force` (8g) |
| release-gate script | S11-9 | ok |
| dry-run pack | S11-7 with `--ignore-scripts` (skips `postpack` shasum write) | dir and 0.6.0 list unspecified (8b) |
| live built-bundle checks | S11-8a/b/c | harness unspecified (8b) |
| prod audit = 0 shipped advisories | S11-6 (inventory 0 + `audit --prod` 0 + consumer rule) | new-advisory rule (9d) |
| CI green on PR before publish | 6.4 item 2 (user-owned precondition) | ok; finding 5 can turn CI red on Linux |

## False-pass notes for the auditor

- O1-O6 pass with a fake `now`. Require the real-clock deadline test (finding 2) before accepting S6b.
- G3 passes on Windows only because PID 4242 cannot exist there. Require G3b, or the injected `isAlive` (finding 5).
- L9 and O2 prove the early clear but not the trailing one. Require O7 (finding 1).
- X1 on WSL logs: confirm the root argument was the WSL `PROBE_ROOT` and `cleanup-lines > 0`, otherwise the run is
  either spuriously red or not checked at all (finding 8d).

## Verdict: APPROVE

There are no BLOCKER or MAJOR findings. Revision 5 resolves every review-4 finding. The executable sections carry no
leftover redesign work, 0.6.1 depends on nothing deferred, and the deferral is recorded with starting requirements. I
re-derived the plan's load-bearing facts (merge shape, file and test counts, kill-site counts, typecheck baseline,
version sites, in-range versions, WSL node) and they hold.

Recommended before the steps that use them:
- findings 1 and 2: fold into S6b before it starts;
- finding 3: fold into S11 before S8 could end BLOCKED;
- finding 5: fold into S6c.

The remaining findings are executability and documentation fixes that a builder would otherwise have to guess at.
