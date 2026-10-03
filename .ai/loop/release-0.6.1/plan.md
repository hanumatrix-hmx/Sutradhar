# Release 0.6.1 plan (patch): bundled-dependency security fix, GAP-315 merge after audit, GAP-349, FR2-11 ledger fix, release prep

Planner: Claude Opus 5.5, 2026-10-04. **Revision 7.** Review-5 approved revision 5, and revision 6 resolved its 10 MINOR
findings (section 12). Review-6 approved revision 6. Revision 7 resolves review-6's five MINOR findings, A-E, in section
13. Each earlier review's resolutions are mapped in its own section:

| review | where it is resolved |
|---|---|
| `plan-review-1.md` | section 7 |
| `plan-review-2.md` | section 8 |
| `plan-review-3.md` | section 9 |
| `plan-review-4.md`, plus the orchestrator's **final scope decision** | section 11 |

The **close/recovery redesign** has been removed from 0.6.1 entirely: CDP `Browser.close`, ownership verification,
"unverified" PID retention, close exit 1, the refusal mode, and the self-heal carry. Section 10, "Deferred to 0.7.0",
holds it, with the review-3 and review-4 findings as its starting requirements.

**0.6.1 `close` keeps 0.6.0's kill semantics.** It is the same `killChromeTree` (taskkill `/T /F`, or POSIX
`process.kill(-pid)`), with the same exit codes. There is one change: the order. Chrome is killed (awaited), then the
recorded PID/state is cleared, then the bounded profile-dir cleanup runs (15 s overall deadline). Session recovery
(self-heal) uses the same order.

Branch `release/0.6.1` (cut from `origin/master` 7ff6cbd), worktree
`E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041`. This file is the plan only.
Nothing in it has been implemented.

The user publishes to npm and opens or merges the PR; those are not steps here. **CI must be green on the release PR
before publishing** (6.4).

Notation:
- `$WT` = `E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041`
- `$SP` = `E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad`
- The WSL view of `$SP` is always written literally inside WSL commands:
  `/mnt/e/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad`
- `$EV` = `$WT/.ai/loop/release-0.6.1/evidence`
- `REAL_TEMP` = `E:/AI-Cache/tmp`. This value is hard-coded and never derived from `TEMP` or `os.tmpdir()`.
- **Shell state does not persist between tool calls.** Every code block is ONE Git Bash invocation and **begins with
  the header**
  `SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT"`
  (written below as `<HEADER>`; paste it literally).
- `export MSYS_NO_PATHCONV=1` must come before any `git show <rev>:.ai/...`.

---

## 0. Hard safety rules and the mandatory isolation preamble

### 0.1 Safety rules (every builder and auditor step carries these VERBATIM)
```
SAFETY RULES (non-negotiable, apply to every command in this step):
- Never kill processes by image name (no taskkill /IM chrome.exe, no Stop-Process -Name); only PIDs the step itself started.
- Never `git stash`, `reset --hard`, `checkout -- .`, `clean -f`, force-push. One logical step = one commit, message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Never delete with globs or recursive deletes outside a directory the step itself created; live tests set TEMP/TMP to a fresh dir under E:\AI-Cache\tmp\claude\E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041\37c49594-f3f4-44c7-b8d5-a5f569bf406f\scratchpad\ and only clean that dir. Other sessions' `sutradhar-cli-*` dirs in the real TEMP must never be touched by tests.
- Check `df -h /e` before builds (abort under 10 GB free). Every wait has a hard timeout.
- Evidence goes under `.ai/loop/release-0.6.1/evidence/<STEP>/` with exact commands and output excerpts.
```

### 0.2 ISOLATION PREAMBLE (mandatory; copy VERBATIM into every brief that runs tests, probes, the CLI, or anything importing `temp-profile`)
```
ISOLATION PREAMBLE
1. Guard file, created once in S1 OUTSIDE the repo:
   E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad/iso/assert-tmp.mjs
   It exits 97 ("ISOLATION GUARD: ...") unless os.tmpdir() is strictly under the scratchpad; otherwise it prints
   "[iso-guard] tmpdir=<path> pid=<pid>".
2. ONLY the Git Bash form is allowed for anything that can run GAP-315 code. Never use PowerShell for it: `$env:`
   assignments can leak into a reused host process. TEMP, TMP, TMPDIR and NODE_OPTIONS go on the SAME command line:
     <HEADER>; ISO="$SP/<STEP>-tmp"; mkdir -p "$ISO"; \
     TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 <command>
   Never rely on an `export` made in an earlier tool call.
3. Every harness or probe script also asserts os.tmpdir() under the scratchpad at startup, in its own code. CLI
   children get TEMP/TMP/TMPDIR/NODE_OPTIONS/SUTRADHAR_CLI_DEBUG_CLEANUP passed explicitly in `env`. The harness asserts
   that dirname(state.userDataDir) is under ISO.
4. Non-default Node binaries (18/20/22) run directly. Get each path once with `npx --yes node@18 -p process.execPath`.
   Do not use the npx wrapper under NODE_OPTIONS: it fails with "Could not determine Node.js install directory"
   (observed).
5. WSL probes (POSIX) run under WSL's own literal guard in the probe source. Exit 97 when os.tmpdir(), PROBE_ROOT or any
   tmpRoot starts with "/mnt/", is not under PROBE_ROOT, or PROBE_ROOT is not under "/tmp/".
6. Path-log check: every run that executes cleanup code sets SUTRADHAR_CLI_DEBUG_CLEANUP=1, so every path the cleanup
   code considers, creates, decides on, attempts to remove, removes or keeps is printed as `[cleanup] ... path="<abs>"`.
   After the run:
     node "$SP/iso/check-cleanup-paths.mjs" "$ISO" <log files...>
   This must exit 0. It exits 1 if any [cleanup] path is outside ISO, or if no [cleanup] line exists.
7. AC for every such step:
   - at least one "[iso-guard] tmpdir=<...scratchpad/...>" line and no "ISOLATION GUARD" line;
   - check-cleanup-paths exits 0 wherever the seam exists;
   - a missing guard line means the step did not happen: rerun it.
8. Deleting a step dir. The ONLY allowed form:
     set -u; [ -n "${SP:-}" ] && [ -d "$SP" ] || { echo "REFUSE: SP unset"; exit 1; }
     case "$ISO" in "$SP"/S[0-9]*-tmp|"$SP"/S[0-9]*-tmp-*) rm -rf -- "$ISO" ;; *) echo "REFUSE rm $ISO"; exit 1 ;; esac
   Run it only after every PID the step started is confirmed dead.
```
**Guard file content.** The guard is fixed. S1 writes it byte-for-byte and records its sha256. It was verified during
planning:
- real TEMP: exit 97;
- isolated: exit 0;
- Node 18 binary: exit 0;
- `packages/utils` vitest isolated: 20/20;
- `packages/utils` vitest against the real TEMP: exit 97 before any test ran.
```js
import os from 'node:os'; import path from 'node:path';
const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const root = norm(process.env.SUTRADHAR_ISO_ROOT ?? 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad');
const got = norm(os.tmpdir());
if (!got.startsWith(root + '/')) { process.stderr.write(`ISOLATION GUARD: os.tmpdir()=${got} is not under ${root}; aborting pid ${process.pid}\n`); process.exit(97); }
if (!process.env.SUTRADHAR_ISO_QUIET) process.stderr.write(`[iso-guard] tmpdir=${got} pid=${process.pid}\n`);
```
**Path-log checker** `$SP/iso/check-cleanup-paths.mjs`. S1 writes it and records its sha256. Review-4 traced its logic
as correct.
```js
// usage: node check-cleanup-paths.mjs <isoRoot> <log...>; exit 0 = every [cleanup] path under isoRoot and >=1 such line
import { readFileSync } from 'node:fs'; import path from 'node:path';
const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const [iso, ...logs] = process.argv.slice(2); const root = norm(iso);
let lines = 0, bad = 0;
for (const f of logs) for (const l of readFileSync(f, 'utf-8').split(/\r?\n/)) {
  if (!l.includes('[cleanup]')) continue; lines++;
  for (const m of l.matchAll(/path=("([^"]+)"|(\S+))/g)) { const p = norm(m[2] ?? m[3]); if (p !== root && !p.startsWith(root + '/')) { bad++; console.log('OUTSIDE-ISO', p, '<=', l.trim()); } }
}
console.log(`cleanup-lines=${lines} outside-iso=${bad}`);
process.exit(lines > 0 && bad === 0 ? 0 : 1);
```

### 0.3 Other standing rules (every brief)
- **Location check before writing.** `git -C $WT rev-parse --show-toplevel` must print `$WT`, and
  `git -C $WT branch --show-current` must print `release/0.6.1`. Never write into `.claude/worktrees/peaceful-boyd-a324b8`
  or into the main checkout.
- **Commits.** Add paths by name; never `-A` or `.`. Record `git status --porcelain` before every commit.
- **Probe arguments.** A probe never carries a probed dir path in its own argv. Pass paths through env vars or a file.
  Only the Chrome or stand-in under test may have the path in argv. Every probe logs the scan output it used.
- **Real-TEMP snapshot around every S4/S7/S8/S11 probe or live session.**
  - Record read-only: the names and count of the `sutradhar-cli-*` entries in `REAL_TEMP`, plus
    `find "$REAL_TEMP" -maxdepth 1 -name 'sutradhar-cli-*' -newer <stamp>`.
  - Assert `REAL_TEMP` ≠ ISO and that it has at least 1 entry.
  - A disappearance is **unattributed until explained**. The proof that we did not delete it is the path-log check
    (preamble 6). A disappearance whose path-log check passed is recorded as "external", for example another session
    running a GAP-315 build.
- **Indirectly started Chrome.** If a CLI `spawnSync` times out:
  1. Find the PID from `<ISO>/state/state.json` or from the dir's `.sutradhar-owner.json`.
  2. Confirm ownership in the harness, which is not product code: the `Get-CimInstance` CommandLine must contain our dir
     basename.
  3. `taskkill /PID <pid> /T /F`.
  4. Confirm the exit within 15 s.

  Never kill unconfirmed, and never kill twice. PIDs get reused: 66960 was a `bash.exe` seconds after our Chrome died.
- **Git from Git Bash** is a stated deviation from the global "git through WSL" rule. `node_modules` and the hooks are
  Windows-native, and no touched file needs exec bits. A step that would create or modify an executable entry point
  stops and uses WSL.
- **No push** between S5 and S8 ACCEPT. Autopush is suspended until S11 passes; the user pushes.
- **Tools.** Helpers go in `$SP/<step>/`, evidence in `$EV/<STEP>/`. Use `npx --yes pnpm@9.1.0`. Put `timeout 300` on
  every `wsl.exe` call.
- **Evidence-commit policy (review-5 #7).** Every step's own commit adds `$EV/<STEP>` by name, together with its
  source paths. There are two exceptions:
  - S4's evidence goes in the orchestrator's `GAP-315 pre-merge audit evidence` commit.
  - S5's evidence cannot go in the merge commit (S5-1 requires exactly 11 files). It gets a separate commit,
    `GAP-315 merge evidence`, directly after the merge and before S6a.

  So S11 item 1 starts from a tree with **no untracked evidence**. Anything still untracked there is an S11 FAIL.
- **False-pass analysis in every step (global rule; review-5 #10).** Every step writes `$EV/<STEP>/README.md`. For
  **each AC** it states one way the check could pass while the behaviour is broken (a stale read, a mocked path, a
  wrong root, clock mixing, a cached build), plus the command and output excerpt that rules it out. A step without this
  README is not done.
- **Timeouts (global rule ≤ 20 min for waits/polls; review-5 #10).**
  - Every wait or poll loop in harnesses and probes is capped at ≤ 1200 s.
  - **Recorded deviation**: these are single foreground commands with a hard `timeout`, not poll loops: the forced
    builds (`timeout 2400`, S3a/S3b/S7/S11; `--concurrency=1` builds took longer than 20 min before, GAP-376) and the R1
    scenario script (`timeout 1800`).
  - Each such command records its start and end time in its log.

---

## 1. Context and verified findings (re-derived 2026-10-04 from `$WT` @ 7ff6cbd)

### 1.1 Repo and environment
- **Repo.** The location check prints `$WT` / `release/0.6.1`. `.ai/loop/release-0.6.1/` (plan + reviews; 1-6 exist as of revision 7) is
  untracked, and S1 commits it. `df -h /e` shows 50G free.
- **Node.** Windows Node is v25.0.0. 18.20.8, 20.20.2 and 22.23.3 are available as binaries via `npx -p process.execPath`.
- **CI.** ubuntu, Node 20, pnpm 9.1.0. It runs a frozen install, typecheck, build and turbo test.
- **Engines.** `node >=18.0.0`.
- **WSL.** Ubuntu with Node 20.20.2 and no Chrome. The esbuild-compiled `temp-profile.mjs` runs there and needs only
  builtins.
- **Test scripts.** `packages/mcp-server` and `packages/dev-runtime` have no `test` script (an S10b gap).
- **Shared machine** (read-only observations): 35 processes with `sutradhar-cli-` on their command line, 134
  `chrome.exe` processes, and 45 `E:/AI-Cache/tmp/sutradhar-cli-*` dirs, all 0.6.0-style and all markerless.
- **No 8.3 short names on drive E:.** These outputs were observed from PowerShell:

  | command | output |
  |---|---|
  | `cmd /c 'for %I in ("E:\HMX_Projects\Internal_Projects") do @echo %~snxI'` | `Internal_Projects` |
  | `%~sI` of `E:\AI-Cache\tmp\claude` | the long path |
  | `%~sI` of `C:\Program Files` | `C:\PROGRA~1` |

  An isolated TEMP must live under `$SP` on E:, so **8.3-alias cases cannot run in this environment**. They are dropped,
  with this reason (section 11, #9).

### 1.2 Advisory inventory (`npx --yes pnpm@9.1.0 audit --json` @ 7ff6cbd)
The full audit reports 16 moderate, 17 high and 1 critical, with `totalDependencies` 518. `--prod` reports 16, all
under `packages/mcp-server > @modelcontextprotocol/sdk@1.30.0`:

| module (locked) | advisories (GHSA) | patched | path |
|---|---|---|---|
| fast-uri 3.1.5 | 5jgf-p345-68v8, f65p-4m7j-42xc, fph4-wmhf-6fwf, jqff-g426-hqxp, qw65-cvwx-89v3 (high); hrr3-gc8f-f4qj (mod) | >=3.1.8 | sdk > ajv@8.20.0 > fast-uri; sdk > ajv-formats@3.0.1 > ajv > fast-uri |
| qs 6.15.3 | x5fp-wj9c-mxmx, 4mjr-xmp4-gh2g | >=6.16.0 | sdk > express@5.2.1 (> body-parser@2.3.0) > qs; sdk > express-rate-limit@8.6.2 > express > qs |
| hono 4.13.1 | gqvv-2mrq-wpjv, g6gw-c38x-mqfc, crvj-82cr-hjcx, hxh3-vqpv-xpqv | >=4.13.7 | sdk > hono; sdk > @hono/node-server@2.1.0 > hono |
| ip-address 10.3.1 | rpw4-54j3-4h4q, 2vr4-cq9g-pvrc, j6r3-76f7-8jcv, h3mg-xc3c-68pw | >=10.7.1 | sdk > express-rate-limit@8.6.2 > ip-address |

Dev-only advisories:
- Fixable within range: brace-expansion (9), js-yaml (2), nanoid (1).
- Need a major upgrade or have no fix: vitest (critical), vite x3, esbuild via vite, braces (no fix).

### 1.3 What ships (the esbuild metafile is the ground truth)
There are three bundles, built with `external: ['puppeteer-core']` only. The one runtime dependency is
`puppeteer-core ^25.5.0`.

| bundle | third-party packages inlined |
|---|---|
| dist/index.js | pdf-parse@2.4.5, pdfjs-dist@5.4.296, pixelmatch@7.2.0, pngjs@7.0.0 |
| dist/cli-bin.js | the same four |
| dist/mcp-cli.js | the four + @modelcontextprotocol/sdk@1.30.0, ajv@8.20.0, ajv-formats@3.0.1, **fast-uri@3.1.5**, fast-deep-equal@3.1.3, json-schema-traverse@1.0.0, zod@3.25.76, zod-to-json-schema@3.25.2 |

This is confirmed by the dist markers and by `grep -c fast-uri` (6/0/0). **Only the 6 fast-uri advisories reach the
tarball.**

### 1.4 Mechanism: lockfile refresh within existing ranges
- SDK versions 1.30.1 through 1.32.0 declare the same dependency ranges as 1.30.0.
- A scratch trial of `update -r --lockfile-only fast-uri qs hono @hono/node-server ip-address` gave:
  - no manifest change;
  - a 44-line diff touching exactly the 5 packages;
  - `audit --prod` = 0.
- Rejected: an SDK bump, and pnpm overrides.
- A second trial, `update -r --lockfile-only brace-expansion js-yaml nanoid`, moved only those 3. This is S3b, and it is
  conditional.
- Shipped behaviour surface: fast-uri, through ajv. It is covered by `tools.spec.ts`, `project-config.spec.ts`, and the
  live MCP run.

### 1.5 GAP-315 branch, merge facts, and the kill paths
- `fix/gap-315-temp-profile-cleanup` consists of d84b160 and 8ba1649 on top of fdae749.
  - The merge has one conflict, in `cli.ts` `spawnFreshSession`; keep both sides.
  - Branch timeouts add up to about 55 s for close and about 35 s for the sweep, plus an unbounded `rm`. S6a replaces
    them.
  - Branch option names are `exitTimeoutMs` / `removeTimeoutMs`. The branch spec passes `exitTimeoutMs: 200`.
  - The branch's per-dir retry window is `Math.min(deadline, performance.now() + 1_000)`.
- **Order in the merged `cmdClose`:**
  1. `stopWarden`
  2. `await killChromeTree(state.chromePid)`
  3. `await cleanupSessionTempProfile(state, true)` (waits up to 10 s for exit, scans for up to 20 s, removes for up to
     15 s)
  4. `clearState()`

  Self-heal follows the same order, with `warn=false`. If the cleanup is slow or interrupted, the recorded `chromePid`
  survives in `state.json`. A later self-heal or `close` then runs `taskkill /T /F` on whatever process reuses that PID.
  **S6b fixes this window by reordering only** (orchestrator decision).
- `cleanupSessionTempProfile` is a non-exported local in `cli.ts`, and `cli.ts` runs `main()` when imported.
- **Pre-existing master/0.6.0 hazard (not widened by 0.6.1, not fixed in 0.6.1).** Self-heal runs
  `killChromeTree(state.chromePid)` whenever reattach fails. A `state.json` that outlives its Chrome (after a reboot or a
  crash) kills whatever process now holds that PID. **S10b logs this gap unconditionally** (severity "wrong kill"). The
  fix is part of the 0.7.0 redesign (section 10).
- **`killChromeTree`.**
  - On master it is a fire-and-forget `void`.
  - The branch makes it `killChromeTree(pid: number, timeoutMs = 10_000): Promise<void>`. On Windows it resolves when
    `taskkill /PID <pid> /T /F` exits or after `timeoutMs`. On POSIX it uses `process.kill(-pid,'SIGKILL')` with a
    fallback to `process.kill(pid,'SIGKILL')`.
  - **The kill semantics stay exactly as they were.** The only change in 0.6.1 is that the taskkill executable is
    resolved by absolute path (`taskkillExe()`, S6a): the same program, never a planted `taskkill.exe` from the cwd.
- **`spawnDetachedChrome`.**
  - The dir is created before `spawn`.
  - `CHROME_PATH` is honoured only if the file exists.
  - The start loop uses `Date.now()`.
  - Observed spawn behaviour:

    | spawn target | result |
    |---|---|
    | non-executable existing file | sync throw: `EFTYPE` on v25, `UNKNOWN` on v18 |
    | missing file | `pid` undefined, then async `ENOENT` |
    | `node.exe` copy | real PID, exits 9 at once |

  - **GAP-349 leak paths:**

    | path | trigger |
    |---|---|
    | P0 | sync throw |
    | P1 | no PID |
    | P2 | timeout while the child is alive (un-awaited kill) |
    | P2x | timeout after the child already exited (a kill would hit a possibly reused PID) |
    | F8 | attach or setViewport failed (un-awaited kill) |

  - The viewport trigger fails after `writeState`, so it is not F8.

### 1.6 Chrome lock signal (observed)
- What was observed: Windows, v25, our own Chrome on a scratch dir, both `--headless=new` and headed. `lockfile` exists,
  and `rm` of it fails with **EBUSY** in both modes.
- Cleanup: each Chrome was killed by its PID.
- Node 18/20/22 and Edge are covered by A4-pre.

### 1.7 FR2-11 ledger
- Master row 17 is stale ("SPEC").
- Branch `claude/fr2-11-action-history` @ b861d3a has the HELD row and the HELD decision entry.
- The branch's GAP numbering collides with master's (GAP-349 and GAP-353).

### 1.8 Version sites and docs
- Version sites:
  - `packages/mcp-server/src/version.ts:2`
  - `packages/sutradhar/package.json:3`
  - `packages/sutradhar/src/index.ts:39`
  - `packages/sutradhar/tests/unit/api.spec.ts:42`
- `cli-bin.js` contains no version string.
- 0.6.0 is still named in: README:33,35,46; SECURITY:39; the browser, cli, mcp-server and sutradhar READMEs; and the
  changelog.
- The `cli.ts` help has an `Environment:` section (line 2011), and `help-text.spec.ts` pins some env names there.
- `packages/cli/README.md:287` says "`sutradhar close` kills that Chrome process tree", which is still true in 0.6.1.
- `check-release-ready.mjs` requires a clean tree and fresh dists. Every pack uses `--ignore-scripts`.

### 1.9 Spec typecheck (non-vacuous; reviewer-4's config, re-verified during planning)
`packages/cli/tsconfig.json` excludes `**/*.spec.ts`, so `tsc` never checks the specs. Reviewer 4 showed that the naive
config (`extends` + `include tests`) reports only TS6059 rootDir errors and **no semantic errors**, so it is vacuous.

The working config is `$SP/r5/tsconfig.specs.json`. It was re-run during planning:
```json
{ "extends": "<WT>/packages/cli/tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": "<WT>/packages/cli", "typeRoots": ["<WT>/packages/cli/node_modules/@types"], "types": ["node", "<WT>/node_modules/vitest/globals"] },
  "include": ["<WT>/packages/cli/src/**/*.ts", "<WT>/packages/cli/tests/**/*.ts"], "exclude": [] }
```
- **Baseline at 7ff6cbd: 7 pre-existing errors.**

  | file | lines | error |
  |---|---|---|
  | `dialog-cli.spec.ts` | 122, 123 | TS2322 |
  | `direct-cdp-broker.spec.ts` | 36 | TS6133 |
  | `session-flow.spec.ts` | 84, 93, 142, 148 | TS2322 |
- **Negative control (planted error).** A second config extends the first, sets `rootDir: "E:/"`, and adds
  `$SP/r5/planted.ts` containing `const x: number = 'not a number'`. tsc reports
  `planted.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.`, so the check can fail.

---

## 2. Order, gating, escalation

```
S1 baseline + guard + path checker + commit plan/reviews -> S2 FR2-11 ledger -> S3a shipped-dep lockfile -> S3b dev-only lockfile (conditional)
-> S4 GAP-315 audit PRE-merge (extracted module; Windows Node 18/20/22/25 + WSL Node 20)
-> S5 merge (conflict only) + spec-typecheck baseline
-> S6 fix commits: S6a cleanup deadline + path-logging + system-binary helpers, S6b close/recovery ORDER (kill -> clear state -> bounded cleanup),
   S6c GAP-349 (4 paths, seams), S6d POSIX scan via /proc, S6e.. one per S4 blocking finding
-> S7 merged live verification (+ existing close regressions) -> S8 post-merge audit (ACCEPT required)
-> S9 version -> S10 docs, S10b gaps -> S11 gate -> handoff (user: PR, CI green, publish)
```

**Blocking set B** (section-5 items, on every runtime): A1, A2, A3, A4-pre, A4, A5, A6, A7, A9, B1, B2, O1-O8, G1-G6 (incl. G3b),
C5-live(b), C5-live(c), and X1.

**Gating rules**
1. **S4 decides whether S5 runs.**
   - BLOCKED: skip S5-S8. 0.6.1 ships without GAP-315/349. Record this in `.ai/loop/release-0.6.1/decisions.md`, and
     commit that file together with `$EV/S4` in the `GAP-315 pre-merge audit evidence` commit. S11 then runs in its
     BLOCKED variant (review-6 B).
   - ACCEPT, or REOPEN with small fixes: go to S5.
2. A blocking FAIL may exist in the branch only between S5 and the S6 commit that fixes it. While it does, the CLI runs
   only under the preamble, and nothing is pushed.
3. **S8 re-runs every S4 probe** from `$EV/S4/probes.sha256`. Changes are allowed only for API adaptation, and each one
   must be listed in `$EV/S8/probe-diffs.md`. No assertion may be weakened. Every previously failing probe must pass.
4. **Escalation (global rule).** Count every independent audit failure of the GAP-315/349 work (S4, S8, re-audits):
   - #1: fix it.
   - #2: **stop**. Re-derive the root cause, write `replan-gap315.md`, and get orchestrator approval.
   - #3: **BLOCKED**. Revert per S8, record the root-cause hypothesis with evidence, and continue at S9.
5. **If GAP-315 does not ship**:
   - GAP-349 waits for the next release, because its fix depends on `temp-profile.ts`.
   - S6b is reverted too, because the reordering only matters for GAP-315's slow cleanup.
   - The pre-existing wrong-kill hazard (1.5) is logged in S10b **unconditionally**, whether or not GAP-315 ships.

Builder briefs contain section 0 verbatim plus the step text, and none of the other builders' reasoning. Auditor briefs
contain the ACs, section 5, and pointers.

---

## 3. Steps S1-S5

### S1 - Baseline, guard, path checker, commit planning files
**Test matrix** (fixed; S1, S3b, S5 and S11 use exactly this list):
- `vitest run --globals` in agent, browser, capability, capability-runtime, cli, config, contracts, dev-runtime, events,
  llm, mcp-server, memory, observability, sdk, storage, sutradhar, utils, workflow, and `apps/server`.
- `vitest run --config vitest.config.ts` in `packages/frontend`.

Each entry is one invocation. The 18 `packages/<p>` entries that use `--globals` take this form:
```bash
<HEADER>; ISO="$SP/<STEP>-tmp"; mkdir -p "$ISO" "$EV/<STEP>"; (cd packages/<p> && TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 timeout 900 ../../node_modules/.bin/vitest run --globals 2>&1 | tee "$EV/<STEP>/test-<p>.log" | tail -8)
```
The two special entries are written out literally (review-5 #8a):
```bash
<HEADER>; ISO="$SP/<STEP>-tmp"; mkdir -p "$ISO" "$EV/<STEP>"; (cd apps/server && TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 timeout 900 ../../node_modules/.bin/vitest run --globals 2>&1 | tee "$EV/<STEP>/test-apps-server.log" | tail -8)
<HEADER>; ISO="$SP/<STEP>-tmp"; mkdir -p "$ISO" "$EV/<STEP>"; (cd packages/frontend && TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 timeout 900 ../../node_modules/.bin/vitest run --config vitest.config.ts 2>&1 | tee "$EV/<STEP>/test-frontend.log" | tail -8)
```
Turbo test runs only in CI (6.4).

**Commands**
```bash
<HEADER>; git rev-parse --show-toplevel; git branch --show-current; git rev-parse HEAD; df -h /e; mkdir -p "$EV/S1" "$SP/iso"
# write $SP/iso/assert-tmp.mjs and $SP/iso/check-cleanup-paths.mjs with the exact contents of section 0.2, then:
sha256sum "$SP/iso/"*.mjs | tee "$EV/S1/iso-tools.sha256"; cp "$SP/iso/"*.mjs "$EV/S1/"
NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" node -e 1; echo "neg-exit=$?" | tee "$EV/S1/guard-selftest.txt"
ISO="$SP/S1-tmp"; mkdir -p "$ISO"; TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" node -e 1 2>&1 | tee -a "$EV/S1/guard-selftest.txt"; echo "pos-exit=${PIPESTATUS[0]}" | tee -a "$EV/S1/guard-selftest.txt"
(cd packages/cli && NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" timeout 120 ../../node_modules/.bin/vitest run --globals 2>&1 | tail -2; echo "vitest-neg-exit=${PIPESTATUS[0]}") | tee -a "$EV/S1/guard-selftest.txt"
printf '[cleanup] decision path="%s/sutradhar-cli-1700000000000-A" reason=in-use\n' "$ISO" > "$ISO/pos.log"
printf '[cleanup] decision path="E:/AI-Cache/tmp/sutradhar-cli-1790000000000" reason=too-young\n' > "$ISO/neg.log"
: > "$ISO/empty.log"
for f in pos neg empty; do node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$ISO/$f.log"; echo "$f-exit=$?"; done | tee "$EV/S1/pathcheck-selftest.txt"
cp "$ISO/neg.log" "$EV/S1/pathcheck-neg.log"
timeout 180 npx --yes pnpm@9.1.0 audit --json > "$EV/S1/audit-full.json"; timeout 180 npx --yes pnpm@9.1.0 audit --prod --json > "$EV/S1/audit-prod.json"
```
**`$EV/S1/bundle-inventory.mjs`** (dry-run verified; it printed 6 `SHIPPED-ADVISORY fast-uri@3.1.5` lines):
```js
// Usage (from $WT): node .ai/loop/release-0.6.1/evidence/S1/bundle-inventory.mjs [auditJson]
import * as esbuild from 'esbuild';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const root = process.cwd();
const entries = { 'dist/index.js': 'packages/sutradhar/src/index.ts', 'dist/cli-bin.js': 'packages/cli/src/cli.ts', 'dist/mcp-cli.js': 'packages/mcp-server/src/cli.ts' };
const inlined = new Map();
for (const [out, entry] of Object.entries(entries)) {
  const r = await esbuild.build({ entryPoints: [path.join(root, entry)], outfile: path.join(root, '.inventory-not-written', out), bundle: true, platform: 'node', format: 'esm', target: 'node18', external: ['puppeteer-core'], write: false, metafile: true, logLevel: 'error' });
  const pk = new Set();
  for (const inp of Object.keys(Object.values(r.metafile.outputs)[0].inputs)) {
    const m = inp.match(/node_modules[\\/]\.pnpm[\\/]((?:@[^+\\/]+\+)?[^@\\/]+)@([^_\\/]+)/);
    if (m) { const name = m[1].replace('+', '/'); pk.add(`${name}@${m[2]}`); (inlined.get(name) ?? inlined.set(name, new Set()).get(name)).add(m[2]); }
  }
  console.log(`== ${out}: ${[...pk].sort().join(', ')}`);
}
if (process.argv[2]) {
  const a = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
  let hits = 0;
  for (const v of Object.values(a.advisories ?? {})) {
    for (const ver of new Set(v.findings.map((f) => f.version))) if (inlined.get(v.module_name)?.has(ver)) { hits++; console.log(`SHIPPED-ADVISORY ${v.module_name}@${ver} ${v.github_advisory_id} ${v.severity}`); }
  }
  console.log(`shipped advisories: ${hits}`);
}
```
```bash
<HEADER>; node .ai/loop/release-0.6.1/evidence/S1/bundle-inventory.mjs "$EV/S1/audit-full.json" | tee "$EV/S1/bundle-inventory.txt"
grep -o "// \.\./\.\./node_modules/\.pnpm/[^/]*" packages/sutradhar/dist/mcp-cli.js | sort -u > "$EV/S1/existing-dist-markers.txt"; stat -c '%y %n' packages/sutradhar/dist/*.js >> "$EV/S1/existing-dist-markers.txt"
timeout 900 node_modules/.bin/turbo run lint --force --continue --concurrency=1 2>&1 | tee "$EV/S1/lint.log" | tail -40
```
Then:
1. Run the full test matrix with `<STEP>`=S1, and write the totals to `$EV/S1/test-totals.txt`.
2. Delete `$ISO` (guarded form).
3. Commit `0.6.1: plan, reviews, baseline evidence`, adding these **by name**:
   - `.ai/loop/release-0.6.1/plan.md`;
   - each existing `plan-review-*.md` (list them with `ls`, then pass each path explicitly; 1-6 exist as of revision 7, plus any later round);
   - `decisions.md`, if present;
   - `.ai/loop/release-0.6.1/evidence/S1`.

**AC**
- S1-1: the guard self-test shows `neg-exit=97`, `pos-exit=0` with a guard line, and `vitest-neg-exit=97`.
- S1-2: the path-checker self-test shows `pos-exit=0`, `neg-exit=1` with `OUTSIDE-ISO`, and `empty-exit=1`.
- S1-3: the inventory shows fast-uri@3.1.5 only in mcp-cli.js, `shipped advisories: 6`, and no express, qs, hono or
  ip-address. The markers match.
- S1-4: all 20 matrix logs have a guard line and none says `ISOLATION GUARD`. Every log has a non-zero `Tests` line.
  The mcp-server log names `tools.spec.ts`. Pre-existing failures are listed.
- S1-5: the audit sanity checks pass (`totalDependencies` ≈ 518, vitest critical present).
- S1-6: `git status --porcelain` is empty after the commit, and `git ls-files .ai/loop/release-0.6.1` is shown.

**Mutants**
- A guard that does not normalise paths fails `pos-exit`.
- A checker that ignores quoted paths fails `neg-exit`.

### S2 - FR2-11 ledger reconciliation (docs only)
```bash
<HEADER>; export MSYS_NO_PATHCONV=1; mkdir -p "$EV/S2"
git show "claude/fr2-11-action-history:.ai/loop/field-report-2/ledger.md" | grep "^| FR2-11 " > "$EV/S2/branch-row.txt"
git show "claude/fr2-11-action-history:.ai/loop/field-report-2/decisions.md" | sed -n '/^## 2026-10-01 -- FR2-11 HELD after audit-4/,/^## /p' > "$EV/S2/branch-held-entry.txt"
wc -l "$EV/S2/"*.txt
```
1. Replace row 17 byte-for-byte with `branch-row.txt` (Edit with the exact old line).
2. Append the entry
   `## 2026-10-04 -- FR2-11 HELD (record lives on branch claude/fr2-11-action-history; ledger row reconciled for 0.6.1)`.
   It states:
   - b861d3a;
   - the `git show` pointer;
   - the evidence paths that exist only on the branch;
   - the GAP-339..378 collision (GAP-349, GAP-353), which needs renumbering if that branch is ever merged;
   - that no FR2-11 code is merged.
3. Commit `FR2-11: reconcile ledger row with the branch's HELD record (no code merged)`.

**AC**
- S2-1: `diff <(grep "^| FR2-11 " .ai/loop/field-report-2/ledger.md) "$EV/S2/branch-row.txt"` is empty, `wc -l` is 1 on
  both sides, and the row contains `HELD`.
- S2-2: `git diff --stat HEAD^ HEAD` lists only `ledger.md` (1 line), `decisions.md` (additions only;
  `git diff HEAD^ HEAD -- .ai/loop/field-report-2/decisions.md | grep -c '^-[^-]'` = 0) and `$EV/S2`.
- S2-3: `git diff origin/master...HEAD --name-only -- packages apps` is empty.
- S2-4: `grep -c "FR2-11 HELD" .ai/loop/field-report-2/decisions.md` ≥ 1.

### S3a - Shipped-path security: refresh 5 SDK-subtree packages in the lockfile
```bash
<HEADER>; mkdir -p "$EV/S3a"; df -h /e
timeout 300 npx --yes pnpm@9.1.0 update -r --lockfile-only fast-uri qs hono @hono/node-server ip-address 2>&1 | tee "$EV/S3a/update.log"
git status --porcelain | tee "$EV/S3a/status.txt"; git diff pnpm-lock.yaml > "$EV/S3a/lock.diff"
grep -E "^[-+]  '?[@a-z][^ ]*@[0-9][^:]*:" "$EV/S3a/lock.diff" | sort -u | tee "$EV/S3a/moved-keys.txt"
timeout 600 npx --yes pnpm@9.1.0 install --frozen-lockfile 2>&1 | tail -20 | tee "$EV/S3a/install.log"
timeout 180 npx --yes pnpm@9.1.0 audit --prod --json > "$EV/S3a/audit-prod.json"; timeout 180 npx --yes pnpm@9.1.0 audit --json > "$EV/S3a/audit-full.json"
timeout 2400 node_modules/.bin/turbo run build --force --concurrency=1 2>&1 | tail -30 | tee "$EV/S3a/build.log"; stat -c '%y %n' packages/sutradhar/dist/*.js | tee -a "$EV/S3a/build.log"
grep -o "// \.\./\.\./node_modules/\.pnpm/fast-uri@[^/]*" packages/sutradhar/dist/mcp-cli.js | sort -u | tee "$EV/S3a/dist-fast-uri.txt"
node .ai/loop/release-0.6.1/evidence/S1/bundle-inventory.mjs "$EV/S1/audit-full.json"  | tee "$EV/S3a/inventory-vs-OLD-audit.txt"
node .ai/loop/release-0.6.1/evidence/S1/bundle-inventory.mjs "$EV/S3a/audit-full.json" | tee "$EV/S3a/inventory-vs-NEW-audit.txt"
```
Then:
- Run the mcp-server and capability-runtime matrix entries with `<STEP>`=S3a.
- Run **the live MCP probe** `$EV/S3a/mcp-probe.mjs` under the preamble (S11 reuses it).
  - At startup it asserts the tmpdir guard.
  - It spawns `process.execPath` with the absolute path `$WT/packages/sutradhar/dist/mcp-cli.js`, logs that path, sets
    env `SUTRADHAR_CONFIG=none`, and uses cwd `$ISO`.
  - In order, it sends `initialize` (2025-06-18), `notifications/initialized`, `tools/list`,
    `browser.launch {"headless":true}`, a `browser.navigate` to its own 127.0.0.1 server, and `browser.shutdown_all`.
  - It times out after 120 s (`performance.now()`), kills only the child PID, and confirms the exit.
- Commit `0.6.1 security: refresh fast-uri/qs/hono/@hono/node-server/ip-address in the lockfile (within existing ranges)`.

**AC**
- S3a-1: only the lockfile and evidence changed. No manifest changed, no overrides were added, and the SDK is still
  1.30.0.
- S3a-2: the moved keys are exactly the 5 packages. Newer in-range patches of these 5 are allowed. If anything else
  moves, stop.
- S3a-3: the prod audit is 0, with sanity checks.
- S3a-4: the dist contains **exactly one fast-uri version, ≥ 3.1.8** (the version comes from `dist-fast-uri.txt`), the
  mtime is fresh, and both inventories report 0. Every version S10 quotes is taken from `moved-keys.txt` and
  `dist-fast-uri.txt`, never hard-coded (review-5 #9a).
- S3a-5: the matrix entries equal S1.
- S3a-6: the probe shows 0.6.0, 73 tools, `wait_for`, a working navigate, and the child exited.

**Mutants**
- `install` skipped: S3a-4 catches it.
- `--latest`: S3a-1 catches it.

### S3b - Dev-only in-range advisories (conditional, separate commit)
```bash
<HEADER>; mkdir -p "$EV/S3b"; df -h /e; cp pnpm-lock.yaml "$SP/S3b-lock-before.yaml"
timeout 300 npx --yes pnpm@9.1.0 update -r --lockfile-only brace-expansion js-yaml nanoid 2>&1 | tee "$EV/S3b/update.log"
git status --porcelain | tee "$EV/S3b/status.txt"; git diff pnpm-lock.yaml > "$EV/S3b/lock.diff"
grep -E "^[-+]  '?[@a-z][^ ]*@[0-9][^:]*:" "$EV/S3b/lock.diff" | sort -u | tee "$EV/S3b/moved-keys.txt"
timeout 600 npx --yes pnpm@9.1.0 install --frozen-lockfile 2>&1 | tail -10 | tee "$EV/S3b/install.log"
timeout 180 npx --yes pnpm@9.1.0 audit --json > "$EV/S3b/audit-full.json"
timeout 2400 node_modules/.bin/turbo run build --force --concurrency=1 2>&1 | tail -20 | tee "$EV/S3b/build.log"
timeout 900 node_modules/.bin/turbo run lint --force --continue --concurrency=1 2>&1 | tee "$EV/S3b/lint.log" | tail -40
node .ai/loop/release-0.6.1/evidence/S1/bundle-inventory.mjs | grep '^== ' > "$EV/S3b/inventory-eq.txt"
grep '^== ' "$EV/S3a/inventory-vs-NEW-audit.txt" | diff - "$EV/S3b/inventory-eq.txt" && echo INVENTORY-SAME | tee "$EV/S3b/inventory-same.txt"
diff <(grep -E "error|warning" "$EV/S1/lint.log" | sed -E 's/[0-9]+(\.[0-9]+)?m?s//g' | sort) <(grep -E "error|warning" "$EV/S3b/lint.log" | sed -E 's/[0-9]+(\.[0-9]+)?m?s//g' | sort) && echo LINT-SAME | tee "$EV/S3b/lint-same.txt"
```
Then run the full matrix with `<STEP>`=S3b.

**Keep condition** (all must hold):
1. Only those 3 packages moved.
2. No manifest changed.
3. Matrix totals are at least S1's, with 0 new failures and the guard lines present.
4. `LINT-SAME` is printed, and the turbo lint task count equals S1's.
5. `INVENTORY-SAME` is printed.

If all hold, commit `0.6.1: refresh dev-only brace-expansion/js-yaml/nanoid in the lockfile (no shipped impact)`.

Otherwise:
1. Run `cp "$SP/S3b-lock-before.yaml" pnpm-lock.yaml` (one file this step changed), then a frozen install.
2. `git status` must show evidence only.
3. Write `$EV/S3b/deferred.md` and record the item as deferred (6.1).

### S4 - GAP-315 independent audit, PRE-merge (auditor; repo read-only)
```bash
<HEADER>; export MSYS_NO_PATHCONV=1; mkdir -p "$SP/S4/mod" "$EV/S4"
git show "fix/gap-315-temp-profile-cleanup:packages/cli/src/temp-profile.ts" > "$SP/S4/mod/temp-profile.ts"
node_modules/.bin/esbuild "$SP/S4/mod/temp-profile.ts" --format=esm --platform=node --target=node18 --outfile="$SP/S4/mod/temp-profile.mjs"
sha256sum "$SP/S4/mod/"* > "$EV/S4/module.sha256"; git diff fdae749 fix/gap-315-temp-profile-cleanup -- packages/cli > "$EV/S4/branch.diff"
for v in 18 20 22; do echo "node$v=$(timeout 300 npx --yes node@$v -p process.execPath)"; done | tee "$EV/S4/node-bins.txt"
```
**Windows runtimes.** Use v25 plus the 18, 20 and 22 binaries, each under the preamble. The branch module has no debug
seam, so every probe logs each path it passes to or receives from the module as `[cleanup] probe path="<abs>"`.
`check-cleanup-paths` therefore applies to S4 as well.

**WSL runtime** (Node 20.20.2). The orchestrator captures `D` from the first call's stdout and pastes it literally into
the later calls:
```bash
timeout 300 wsl.exe -e sh -c 'D=$(mktemp -d) && cp "/mnt/e/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad/S4/mod/temp-profile.mjs" "/mnt/e/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad/S4/"*.mjs "$D"/ && echo "$D"'
# example D=/tmp/tmp.Ab12Cd34; paste the printed value literally:
timeout 300 wsl.exe -e sh -c 'cd /tmp/tmp.Ab12Cd34 && R=$(mktemp -d -p "$PWD") && TMPDIR="$R" PROBE_ROOT="$R" node probe-a1.mjs'
```
Every WSL probe starts with this literal guard (A9):
```js
import os from 'node:os'; import path from 'node:path';
const ROOT = process.env.PROBE_ROOT ?? ''; const chk = (p) => { const r = path.resolve(p); return r.startsWith('/mnt/') || !(ROOT && (r === ROOT || r.startsWith(ROOT + '/'))) || !ROOT.startsWith('/tmp/'); };
for (const p of [os.tmpdir(), ROOT, ...(process.env.PROBE_TMPROOTS ?? '').split(':').filter(Boolean)]) if (!p || chk(p)) { console.error(`WSL GUARD: refusing ${p}`); process.exit(97); }
console.error(`[wsl-guard] root=${ROOT}`);
```
**A9 self-test.** `PROBE_ROOT=/mnt/e/AI-Cache/tmp TMPDIR=/mnt/e/AI-Cache/tmp node probe-a1.mjs` must exit 97, and a
`mktemp` root must exit 0. Both results go in `$EV/S4/wsl-guard.txt`.

**How a probe loads the module (review-5 #8c).**
- The module path is never a static import. Every probe (Windows and WSL) loads it with
  `const TP = await import(pathToFileURL(process.env.TP_MODULE).href)`, after the guard.
- `TP_MODULE` is the absolute module path:
  - Windows: `$SP/S4/mod/temp-profile.mjs`, and at S8 the module compiled from HEAD at `$SP/S8/mod/temp-profile.mjs`.
  - WSL: `<D>/temp-profile.mjs`. The `cp` above copies module and probes flat into `$D`.
- Example: `timeout 300 wsl.exe -e sh -c 'cd /tmp/tmp.Ab12Cd34 && R=$(mktemp -d -p "$PWD") && TMPDIR="$R" PROBE_ROOT="$R" TP_MODULE="$PWD/temp-profile.mjs" node probe-a1.mjs'`.

**Path-log check on WSL logs (review-5 #8d).** Save each WSL probe's stdout and stderr to `$EV/S4/wsl/<probe>.log`.
Then run `check-cleanup-paths` on Windows with **that probe's WSL `PROBE_ROOT` as the root argument**, for example
`node "$SP/iso/check-cleanup-paths.mjs" /tmp/tmp.Ab12Cd34/tmp.Xy "$EV/S4/wsl/probe-a1.log"`. Both sides normalise to
`e:/tmp/...` on Windows. Using the Windows ISO as the root would flag every WSL line, so never do that. Require
`cleanup-lines > 0`.

**Probe hygiene**
- Paths come through env or a file.
- In-use probes run an attribution query that lists the processes holding the basename, with PID, parent PID and name:
  on Windows `Get-CimInstance ... -like "*$env:PROBE_BASE*"`, on POSIX `/proc/*/cmdline`.
- The probe asserts that the matches are only our browser or stand-in and its descendants, never the probe itself.

**Real-TEMP snapshots**: taken before and after each probe session (0.3).

**Output**
- `$EV/S4/audit.md` with the verdict: ACCEPT, REOPEN (findings tagged with the section-5 item, blocking or not, command
  and output) or BLOCKED.
- `$EV/S4/probes.sha256`, the logs, the snapshots, and the path-check results.

The orchestrator commits `GAP-315 pre-merge audit evidence`. [S8] items are recorded as N/A.

**AC**
- PASS/FAIL for each item on each runtime.
- Guard lines present: `[iso-guard]` on Windows, `[wsl-guard]` on WSL.
- `check-cleanup-paths` exits 0 for every log.
- An S4 FAIL counts toward escalation.

### S5 - Merge GAP-315 (conflict resolution only) + spec-typecheck baseline
Precondition: S4 is ACCEPT or REOPEN, recorded in `$EV/S5/precondition.md`.
```bash
<HEADER>; mkdir -p "$EV/S5"; git merge --no-ff --no-commit fix/gap-315-temp-profile-cleanup; git diff --name-only --diff-filter=U
```
Resolve the conflict by keeping both sides, master's first:
```ts
  // flag > config > Chrome default. Only the FLAG is persisted below (D10), so a later edit of the
  // config file keeps taking effect.
  const spawnViewport = resolveViewport({ flag: viewportFlag, config: activeConfig }).value;
  // GAP-315: work off temp profile dirs left behind by crashed/killed sessions. Best-effort,
  // time-boxed, and fail-closed (see temp-profile.ts for the safety rules).
  await sweepStaleTempProfiles().catch(() => {});
```
Then:
1. Confirm the `writeState` fields: `userDataDir`, `tempProfile`, `viewport`, `dialogPolicy`.
2. Confirm no conflict markers remain.
3. Run tsc and the cli matrix entry (`<STEP>`=S5).
4. `git add packages/cli/src/cli.ts`, then commit "Merge fix/gap-315-temp-profile-cleanup into release/0.6.1 (GAP-315;
   conflict in spawnFreshSession resolved by keeping both)".
5. After the spec-typecheck baseline below, make a **separate** commit, `GAP-315 merge evidence`, that adds
   `$EV/S5` by name (evidence policy, 0.3).

**Spec-typecheck baseline (non-vacuous, section 11 #6).** Write two scratch configs:
- `$SP/S6/tsconfig.specs.json`, with exactly the 1.9 content and `<WT>` replaced by `$WT`;
- `$SP/S6/tsconfig.neg.json`, which extends the first, sets `"rootDir": "E:/"`, and adds `"$SP/S6/planted.ts"` to
  `include`.

`planted.ts` = `const x: number = 'not a number'; export { x };`
```bash
<HEADER>; node_modules/.bin/tsc -p "$SP/S6/tsconfig.specs.json" 2>&1 | tee "$EV/S5/spec-tsc-baseline.txt"; grep -c "error TS" "$EV/S5/spec-tsc-baseline.txt"
node_modules/.bin/tsc -p "$SP/S6/tsconfig.neg.json" 2>&1 | grep "planted.ts" | tee "$EV/S5/spec-tsc-negative.txt"
grep -c "TS6059" "$EV/S5/spec-tsc-baseline.txt"     # must be 0 (no rootDir option errors masking semantic ones)
```
**AC**
- S5-1: `git diff --name-only HEAD^1 HEAD | wc -l` = 11, all of them branch hunks.
- S5-2: tsc is clean. cli tests = S1 + 19, 0 failures. `temp-profile.spec.ts` is in the log, and
  `project-config-cli.spec.ts` passes.
- S5-3 (C6): every `sweepStaleTempProfiles(` and `removeSessionTempProfile(` call in the specs passes `tmpRoot`.
- S5-4: the guard line is present. The merged branch code has no seam yet, so `check-cleanup-paths` is recorded as
  "N/A (no seam until S6a)".
- S5-5: the spec baseline shows **7 errors**, the same 7 listed in 1.9 (the branch adds no spec errors; any extra one is
  listed). It shows **0 TS6059**. `spec-tsc-negative.txt` contains `TS2322`.

The branch's `gap315-live.mjs` is never re-run.

---

## 4. Steps S6-S11

Every test, probe and CLI run below goes through the preamble. Each S6 sub-step is its own commit, and before
committing it runs all of:
- `tsc --noEmit -p packages/cli`.
- The **spec typecheck** `node_modules/.bin/tsc -p "$SP/S6/tsconfig.specs.json"`:
  - its error lines must equal the S5 baseline (the 7 pre-existing errors);
  - **0 errors in any new spec file**;
  - 0 TS6059;
  - the planted-error control from S5 is re-run once per step and must still report TS2322.
- The cli matrix entry.
- The step's mutants.

Mutant procedure: apply the mutant with Edit, run the tests, and revert with Edit. Record the source `sha256sum` before
and after (they must be equal) and the failing output.

### S6a - One cleanup deadline, path-logging debug seam, system-binary helpers, honest wording
**Files**:
- `packages/cli/src/temp-profile.ts`
- new `packages/cli/src/system-binaries.ts`
- **`packages/cli/src/spawn-chrome.ts`**: `killChromeTree` switches to `taskkillExe()` (review-5 #8h)
- `cli.ts`: the warning text, self-heal `warn=true`, and the new `cleanupSessionTempProfile` signature
- `tests/unit/temp-profile.spec.ts`
- `tests/unit/help-text.spec.ts`

**Constants.** These are the only `_000` literals in `temp-profile.ts`, all exported:
```ts
export const STALE_MIN_AGE_MS = 10 * 60_000;
export const CLOSE_CLEANUP_DEADLINE_MS = 15_000;
export const SCAN_TIMEOUT_MS = 8_000;
export const SWEEP_BUDGET_MS = 15_000;
export const EXIT_WAIT_CAP_MS = 10_000;
export const MIN_RM_START_MS = 1_000;
export const SWEEP_PER_DIR_RETRY_MS = 1_000;
```

**`removeSessionTempProfile(dir, chromePid, opts)`**
- `opts` is `{ tmpRoot?, scan?, rmFn?, deadlineAt?, deadlineMs?, isAlive? }`.
- `isAlive` defaults to `isPidAlive`, which is the read-only `process.kill(pid, 0)`. It is the single liveness seam,
  used both by the exit wait and by the `ownerAlive` fact. S6c's G3 and G3b depend on it.
- `exitTimeoutMs` and `removeTimeoutMs` are **removed**. The branch test "close keeps the dir if Chrome does not exit
  within the timeout" moves to `deadlineMs: 300`.
- Every phase is clamped to the remaining time (`rem`):
  - the exit wait is `min(EXIT_WAIT_CAP_MS, rem)`. It is a read-only `process.kill(pid, 0)` poll and never kills.
  - the scan gets `min(SCAN_TIMEOUT_MS, rem)`.
  - an `rm` attempt starts only while `rem ≥ MIN_RM_START_MS`.
- When time runs out it returns `{removed:false, reason:'deadline'}`.

**`sweepStaleTempProfiles`**
- The deadline starts **before** `readdir` and the scan.
- The per-dir window is `min(deadline, now + SWEEP_PER_DIR_RETRY_MS)`.
- The same `MIN_RM_START_MS` rule applies.
- One `rm` attempt that has already started may finish after the deadline. Document this in code, the README and the
  changelog.

**In-use detection fails closed (unchanged rule, re-asserted).** If the scan fails or times out, it returns `null`, and
the result is `scan-unavailable`: **the dir is not deleted**.

**`system-binaries.ts`** (review-4 #6a). It exports **named** helpers, so call sites contain no quoted binary names:
- `powershellExe()` returns `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`;
- `taskkillExe()` returns `%SystemRoot%\System32\taskkill.exe`;
- `psBin()` returns `/bin/ps`.

`SystemRoot` falls back to `C:\Windows`. `killChromeTree` (spawn-chrome.ts) and the scan use these helpers. The kill
semantics are unchanged: it is the same program with the same arguments.

**Debug seam (`SUTRADHAR_CLI_DEBUG_CLEANUP=1`)**
- Output goes to stderr as `[cleanup] <event> key=value...`, and every path is written as `path="<abs>"`.
- Events:
  - `consider`, `created`, `decision` (with `reason=`), `rm-attempt` (`n=`, `remaining-ms=`), `removed`, `kept`
    (`reason=`): each with `path=`;
  - `scan ms= result=<count|null>`;
  - `phase cleanup ms=` (close) and `phase sweep ms=` (session start).
- Without the variable, nothing is printed.
- **Where it logs** (review-5 #6). Logging happens only in the I/O paths:
  - `createTempProfileDir`
  - `removeSessionTempProfile`
  - `sweepStaleTempProfiles`
  - `removeWithRetries`
  - the scan
  - `stopSpawnedChrome` (S6b)
  - `discardSpawnedProfile` (S6c)

  It **never** logs in the pure predicates `isAutoTempProfileDir`, `commandLinesReference` or `decideRemoval`. The branch
  spec calls `isAutoTempProfileDir` with a real home path (`os.homedir()/.sutradhar/profiles/work`, spec line 40), and a
  log line from there would make X1 fail spuriously. Test T6b asserts that calling the three predicates with the debug
  env set prints nothing.
- Document it as a diagnostics switch in the CLI `--help` Environment section and in `packages/cli/README.md`.

**Wording**
- Warning: `Warning: could not remove temp profile <dir> (<reason>); a CLI session started 10 or more minutes from now will retry it.`
- Signature: `cleanupSessionTempProfile(target: { userDataDir?: string; tempProfile?: boolean }, chromePid: number | undefined, warn: boolean, deadlineAt: number)`.
  `chromePid` is used only for the read-only exit wait.

**Tests** (fake scan and fake `rmFn`; `performance.now()` only)

| test | setup | expected |
|---|---|---|
| T1 | the scan resolves only when its own timeout fires; `deadlineMs: 1500` | returns in ≤ 2500 ms; dir exists; reason is `deadline` or `scan-unavailable`; the fake recorded a timeout arg ≤ 1500 |
| T2 | owner never exits; `deadlineMs: 1000` | kept; returns in ≤ 2000 ms; the test's own `process.kill` spy shows signal `0` only (never a kill) |
| T3 | `budgetMs: 2000`, 1500 ms scan, 3 stale dirs | **exactly 0 removed** |
| T3b | `budgetMs: 5000`, 800 ms scan, 3 stale dirs | **all 3 removed** |
| T4 | sweep and close | the scan argument is ≤ the remaining time at the call (both values recorded) |
| T5 | absolute `deadlineAt = performance.now() + 2000`; `rmFn` throws EBUSY after 600 ms | each attempt starts with `deadlineAt - start ≥ 975`; at least 1 attempt |
| T6 | debug env on and off | lines appear only with the env set; every path line matches `path="[^"]+"` |
| T6b | debug env set; call `isAutoTempProfileDir`, `commandLinesReference` and `decideRemoval` | stderr spy records 0 writes |
| T7 | help text | `help-text.spec.ts` asserts that `SUTRADHAR_CLI_DEBUG_CLEANUP` appears in `--help` |
| T8 | scan returns `null` | the dir is kept, `scan-unavailable` (fail closed) |

**Mutants**

| mutant | change | must fail |
|---|---|---|
| M-a | scan default 20 s, no clamp | T1 |
| M-b | no `MIN_RM_START_MS` check | T5 |
| M-c | sweep deadline starts after the scan | T3 |
| M-d | `decision` line without `path=` | T6 |
| M-e | `null` scan treated as `[]` | T8 |
| M-f | debug log added inside `isAutoTempProfileDir` | T6b |

**AC**
- S6a-1: T1-T8 and T6b pass.
- S6a-2: all 6 mutants fail.
- S6a-3: `grep -nE "_000\b" packages/cli/src/temp-profile.ts` prints exactly the 7 constant lines.
- S6a-4: `grep -nE "['\"](powershell(\.exe)?|taskkill(\.exe)?|ps)['\"]" packages/cli/src/*.ts | grep -v "^packages/cli/src/system-binaries.ts:"`
  **prints nothing**. Any other match must be listed and justified as not being an executable invocation.
- S6a-5: the spec typecheck passes per the S6 rules.
- S6a-6: `check-cleanup-paths` exits 0 on the cli log, and `cleanup-lines` is greater than 0.

Commit: `GAP-315 hardening: one cleanup deadline (15 s), sweep deadline before scan, no rm attempt with <1 s left, system-binary helpers, path-logging debug seam`.

### S6b - `close`/recovery ORDER: kill (awaited, 0.6.0 semantics) -> clear state -> bounded cleanup
**Orchestrator scope decision.** The kill semantics, the kill function and the exit codes stay exactly as in 0.6.0.
Only the order changes.

**Files**: new `packages/cli/src/close-session.ts`, `cli.ts` (the cmdClose chromePid branch and self-heal), and new
`tests/unit/close-session.spec.ts`.

**Design.** `close-session.ts` exports
`stopSpawnedChrome(state: CliState, deps: StopDeps): Promise<void>`, with
`export const KILL_CAP_MS = 10_000`. The deps:
- `kill(pid, timeoutMs): Promise<void>`. **`cli.ts` supplies `killChromeTree` itself, by reference** (`kill: killChromeTree`),
  which is the same function and the same semantics as 0.6.0.
- `clearState(): Promise<void>`.
- `cleanup(target, chromePid, deadlineAt): Promise<void>`. `cli.ts` supplies a closure over its local
  `cleanupSessionTempProfile(target, pid, /*warn*/ true, deadlineAt)`.
- `now()`. It is **pinned to the monotonic clock**: the default and the `cli.ts` wiring are both
  `now: () => performance.now()` (review-5 #2). All `temp-profile.ts` deadlines are `performance.now()` values. With
  `Date.now`, `deadlineAt` would land about 1.7e12 ms in the future and the rm retry loop would never end. Test O8 and
  mutant M-O4 cover this.
- `debug(line)`.

The function never throws. Exit codes are therefore decided by the caller exactly as before.

The steps:
1. If `state.chromePid` is set: `await deps.kill(pid, KILL_CAP_MS)`. This is awaited (the branch already awaits it) and
   is the same blind kill as 0.6.0. Then log `[cleanup] phase kill ms=`.
2. `await deps.clearState()`, then log `[cleanup] state-cleared`. **From here on no `chromePid` is persisted**, so an
   interrupted or slow cleanup can never leave a stale PID for a later command to kill.
3. If `tempProfile && userDataDir`:
   `await deps.cleanup({userDataDir, tempProfile}, pid, deps.now() + CLOSE_CLEANUP_DEADLINE_MS).catch(warn)`.
   **The cleanup deadline starts after the state is cleared.** The `pid` is used only for the read-only exit wait.

**Wiring in `cli.ts`**
- **cmdClose, chromePid branch.** Replace `await killChromeTree(state.chromePid); await cleanupSessionTempProfile(state, true);`
  with `await stopSpawnedChrome(state, deps)`.
  - Everything that ran before the kill on master stays unchanged and in the same order: profile save, dialog gate,
    `stopWarden`, and so on.
  - **The trailing `clearState()` is removed from the chromePid branch** (review-5 #1). `stopSpawnedChrome` has
    already cleared the state. A late second clear would delete a `state.json` that a concurrent `nav` wrote during
    the up-to-15 s cleanup, leaving that Chrome orphaned.
  - **Exact target shape** (review-6 A). In the merged code one trailing `clearState()` serves three paths:
    1. the chromePid path;
    2. no chromePid, not blocked;
    3. no chromePid, dialog-blocked (`closeBlocked`).

    The builder writes exactly this, with nothing else changed:
    ```ts
    if (state.chromePid) {
      await stopSpawnedChrome(state, deps);          // kill -> clearState -> bounded cleanup
    } else {
      if (!closeBlocked) { /* unchanged: attach + shutdown */ }
      await clearState();                            // still runs for BOTH no-chromePid paths, incl. dialog-blocked
    }
    console.log('Session closed.');
    ```
    **Never** move the clear into `if (!closeBlocked) {...}`. Doing so would leave `state.json` behind on the
    no-chromePid + dialog-open path (legacy state files, N11b), while still printing `Session closed.`.
  - The builder lists every statement between the old kill and the old `clearState` in `$EV/S6b/cmdclose-before-after.md`
    and shows that each one is preserved. The one exception is the removed trailing clear.
- **Self-heal** (`withSession` on reattach failure): `await stopWarden(...)`, then `await stopSpawnedChrome(state, deps)`,
  then `return spawnFreshSession(...)`. This replaces the kill, cleanup and `clearState` sequence. The cleanup now warns
  (`warn=true`).
- **Bound**: kill ≤ 10 s, then cleanup ≤ 15 s, plus one in-flight `rm` attempt, so about 25 s worst case. The normal
  case is measured in S7.

**Tests** (`close-session.spec.ts`; fake deps and an in-memory state store):

| test | scenario | expected |
|---|---|---|
| O1 (order) | normal close | the event log is exactly `[kill-start, kill-end, clearState, cleanup]`; the cleanup stub asserts the store has **no `chromePid`** when called |
| O2 (interrupt) | the cleanup stub never settles (the test races it with a 200 ms timer); a second `stopSpawnedChrome(readState())` | the store is already cleared; the second call makes **0 kill calls** |
| O3 (cleanup failure) | the cleanup rejects | the function resolves; one warning; kill was called once; the state is cleared |
| O4 (slow kill) | the kill fake resolves only at its cap | `clearState` and cleanup still run, after `kill-end` |
| O5 (attached session) | no `chromePid` | 0 kill calls; the state is cleared; no cleanup when `tempProfile` is false |
| O6 (wiring) | source-level guard (same idea as GAP-356, because `cli.ts` runs `main()` on import) | `cli.ts` text has exactly 2 `await stopSpawnedChrome(` calls, `kill: killChromeTree`, and `now: () => performance.now()` |
| O7 (concurrent nav during cleanup) | the cleanup stub writes a **new** state record into the store, simulating a `nav` from the same cwd during cleanup | after `stopSpawnedChrome` resolves, the new record is **still present**. A companion **two-part source guard** in `close-session.spec.ts` reads `cli.ts` and cuts out the `cmdClose` body by matching braces from `async function cmdClose`. **(a)** The text from `await stopSpawnedChrome(` to the closing `}` of the enclosing `if (state.chromePid)` block contains **no `clearState(`**. **(b)** The `cmdClose` body contains **exactly one** `clearState(`. It lies inside the `else` block of `if (state.chromePid)` and **outside** the `if (!closeBlocked) { ... }` block, found by brace matching from `if (!closeBlocked)` (review-6 A) |
| O8 (real clock) | real default `now`; the cleanup stub records `deadlineAt - performance.now()` | the value lies in (14 000, 15 001] |

**Mutants**

| mutant | change | must fail |
|---|---|---|
| M-O1 | `clearState` after cleanup | O1, O2 |
| M-O2 | kill not awaited (fire-and-forget) | O1 (`clearState` before `kill-end`) |
| M-O3 | cleanup error propagates | O3 |
| M-O4 | `now: Date.now` (in the default or in the `cli.ts` wiring) | O8 (default) / O6 (wiring) |
| M-O5 | trailing `clearState()` re-added to the chromePid branch | O7 guard (a) |
| M-O6 | the no-chromePid `clearState()` moved inside `if (!closeBlocked) {}` | O7 guard (b), and live R1 N11b state check (S7) |

**AC**
- S6b-1: O1-O8 pass.
- S6b-2: all 6 mutants fail.
- S6b-3: `grep -n "killChromeTree(" packages/cli/src/*.ts` prints exactly **3** lines at S6b: the definition
  (spawn-chrome.ts), the F8 call (cli.ts) and the spawn-timeout call (spawn-chrome.ts). S6c converts the last two.
  References without `(`, such as `kill: killChromeTree` or the import, do not match.
- S6b-4: no exit-code change. `git diff HEAD~1 -- packages/cli/src/cli.ts | grep -nE "process\.exit|exitCode"` shows no
  added or removed exit statement.
- S6b-5: spec typecheck, the guard, and `check-cleanup-paths` all pass.

Commit: `CLI close/recovery: clear the recorded Chrome PID right after the (unchanged) kill, before the bounded profile cleanup`.

### S6c - GAP-349: all spawn-failure leak paths remove their own dir, via deterministic seams
**Files**: `spawn-chrome.ts`, new `spawn-session.ts` (F8), `cli.ts`, new `tests/unit/spawn-failure-cleanup.spec.ts`, and
the GAP-349 row.

**Design**
- **Seams.** `SpawnDeps` is the last parameter of `spawnDetachedChrome`. Its fields are `executablePath?`, `tmpRoot?`,
  `spawnFn?`, `probeEndpoint?`, `startTimeoutMs?` (default 10_000), `kill?` and `removeProfile?`.
  - `kill` defaults to `killChromeTree` **by reference**, the same 0.6.0 kill.
  - `removeProfile` defaults to `removeSessionTempProfile`.
- **`discardSpawnedProfile({pid?, alive?, userDataDir, tempProfile}, deps)`.**
  - If `pid` is set and `alive !== false`: `await deps.kill(pid, KILL_CAP_MS)`.
  - If `tempProfile`:
    `await deps.removeProfile(dir, killed ? pid : undefined, {tmpRoot, isAlive: deps.isAlive}).catch(() => {})`.
    **When a kill was issued (P2 and F8), the PID is passed**, so the bounded, read-only exit wait runs before the
    delete (review-5 #5). Without it, the just-killed Chrome would still be alive, the facts would read `owner-alive`
    or `in-use`, and the keep would be one-shot. On POSIX `killChromeTree` is a synchronous SIGKILL with no wait.
  - It never throws.
  - `SpawnDeps` gains an `isAlive?` seam (default `isPidAlive`), which is passed through to `removeProfile`.
- **The four paths.** P2x is a variant of the timeout path.

  | path | when | handling |
  |---|---|---|
  | P0 | `spawnFn` throws synchronously | `await discard({})`, then throw with the error code |
  | P1 | `!pid` | `await discard({})`, then throw; the async `error` is read after the await |
  | P2 | timeout, child alive | `await discard({pid, alive: true})` |
  | P2x | child already exited | `await discard({pid, alive: false})`; **no kill** of a PID that may already be reused |
  | F8 | attach or setViewport fails | `attachOrDiscard(spawned, attach, discard)` awaits the discard, then rethrows the original error |

- The start loop uses `performance.now()` and stops early once `exited` is set.
- **Keep** the `killChromeTree` import in `cli.ts`: it stays in use through `kill: killChromeTree`, which O6 requires.

**Tests.** **Every G test passes `executablePath: 'fake-chrome'`** and its own
`tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'g349-'))`. Each uses a `removeProfile` wrapper that records
`existsSync(dir)`, `path.dirname(dir)`, the `chromePid` it received and **the received `opts` object** before
delegating to the real `removeSessionTempProfile`.

It must **forward** what it received (review-6 D):
```ts
const removeProfile = async (dir, pid, opts) => { calls.push({ exists: existsSync(dir), parent: path.dirname(dir), pid, opts });
  return removeSessionTempProfile(dir, pid, { ...opts, tmpRoot, scan: async () => [] }); };
```
Never build a fresh opts object: that would drop the injected `isAlive`, and on Linux CI G3 would quietly fall back to
`isPidAlive(4242)`.

| test | path | expected |
|---|---|---|
| G1 | P0: `spawnFn` throws EFTYPE | EFTYPE in the message; the wrapper saw the dir under tmpRoot; no `sutradhar-cli-*` left; `kill` not called |
| G2 | P1: `pid: undefined` plus `error` ENOENT via `setImmediate` | ENOENT in the message; dir gone; no kill |
| G3 | P2: never exits, the probe never succeeds, `startTimeoutMs: 300`, **injected `isAlive: () => false`** (deterministic on Linux CI, where fake PID 4242 can be a real process) | `kill(4242, KILL_CAP_MS)` called once, then remove with `chromePid = 4242`; **`calls[0].opts.isAlive` is the injected fake** (`toBe` identity), and **the fake was actually called** (call counter > 0, which proves the forwarded seam reached `removeSessionTempProfile`); dir gone in < 2000 ms |
| G3b | P2 with a dying child: the kill fake resolves first, and `isAlive` returns true for 300 ms after it, then false | the dir is still removed; the recorded order is `kill-end` → `isAlive`=false → `removed`; no rm attempt while `isAlive` was true |
| G4 | P2x: `exit` 9 on the next tick, `startTimeoutMs: 5000` | **no kill**; dir gone; rejects in < 1000 ms |
| G5 | F8 | order `[attach, discard-start, discard-end, rethrow-original]`; on attach success, no discard |
| G6 | named profile | nothing created in tmpRoot; `removeProfile` not called |

**Mutants**

| mutant | change | must fail |
|---|---|---|
| M-G1 | no discard on P0 | G1 |
| M-G2 | no discard on P1 | G2 |
| M-G3 | no discard on P2 | G3 |
| M-G4 | P2x kills anyway | G4 |
| M-G5 | rethrow before the discard | G5 |
| **M-seam** | `createTempProfileDir()` ignores `tmpRoot` | G1 (`dirname` ≠ tmpRoot; under the preamble the dir lands in ISO) |
| M-G6 | P2 passes `undefined` instead of `pid` to `removeProfile` | G3b (the dir is kept: `owner-alive` while `isAlive` is true) |
| M-G7 | product: `discardSpawnedProfile` omits `isAlive` from the opts it passes | G3 (`calls[0].opts.isAlive` is not the fake) |
| M-G8 | test harness: the wrapper builds fresh opts `{tmpRoot, scan}` (drops `isAlive`) | G3 (the fake's call counter stays 0) |

**Call-site checks** (`grep-exit=1` means nothing found):
```bash
<HEADER>; grep -n "killChromeTree(" packages/cli/src/*.ts                     # exactly 1: the definition
grep -n "deps\.kill(\|discardSpawnedProfile(\|attachOrDiscard(\|stopSpawnedChrome(" packages/cli/src/*.ts   # each non-definition line contains "await"
grep -nE "void (killChromeTree|discardSpawnedProfile|stopSpawnedChrome)\(|(killChromeTree|discardSpawnedProfile|stopSpawnedChrome|deps\.kill)\([^)]*\)\.then" packages/cli/src/*.ts; echo "grep-exit=$?"
grep -n "Date.now()" packages/cli/src/spawn-chrome.ts packages/cli/src/temp-profile.ts packages/cli/src/close-session.ts packages/cli/src/spawn-session.ts   # only: dir name, marker createdAt, mtime age
grep -nE "now: *(\(\) *=> *)?Date\.now" packages/cli/src/*.ts; echo "date-now-wiring-grep-exit=$?"   # must be 1 (none): every deps.now is performance.now
node_modules/.bin/eslint --no-eslintrc --resolve-plugins-relative-to "$WT" -c "$SP/S6c/floating.cjs" packages/cli/src/*.ts 2>&1 | tee "$EV/S6c/floating.txt" | tail -20
```
`floating.cjs` enables only `@typescript-eslint/no-floating-promises`, with `parserOptions.project` set to
`$WT/packages/cli/tsconfig.json`. It must report 0 findings on these symbols.

The GAP-349 row is set to DONE.

Commit: `GAP-349: spawn-failure paths (sync throw, no PID, timeout alive/exited, failed attach) remove their own temp dir; no kill of an exited child`.

**AC**
- S6c-1: G1-G6 and G3b pass.
- S6c-2: all 9 mutants fail (M-G1..M-G8 and M-seam).
- S6c-3: `killChromeTree(` appears exactly once, and `grep-exit=1`.
- S6c-4: ESLint reports 0 on these symbols.
- S6c-5: the spec typecheck passes with 0 errors in `spawn-failure-cleanup.spec.ts`.
- S6c-6: `check-cleanup-paths` exits 0.

### S6d - POSIX process scan via `/proc` on Linux; `ps -ww` on macOS
- On Linux, `scanCommandLines` reads `/proc/*/cmdline` (NUL becomes a space) and keeps lines containing the prefix. If
  `/proc` is unreadable the result is `null`, which fails closed.
- On macOS it runs `psBin() -A -ww -o args=`.
- Spec: a fake `/proc` reader is injected on Linux, and the darwin argument list is asserted.
- AC: WSL C5-live(a) passes with an argv longer than 4096 characters. The S5 module's result is recorded too.

Commit: `GAP-315 hardening: Linux scan reads /proc (no procps dependency); macOS ps -ww`.

### S6e.. - One commit per S4 blocking finding
Each fix is minimal and comes with a regression test that fails on the S5 module and passes after the fix. Commit
message: `GAP-315 S4-Fk: ...`. If A2 failed, the likely fix is to `lstat` the candidate first and keep any non-directory
(`reason:'not-a-directory'`).

### S7 - Merged live verification (builder; preamble)
**Build**: `df -h /e`, then `turbo run build --force --concurrency=1`. Record the dist mtimes.
`grep -c "stopSpawnedChrome\|discardSpawnedProfile\|removeSessionTempProfile" packages/sutradhar/dist/cli-bin.js` must be
≥ 3.

**Harness** `$EV/S7/gap315-live-merged.mjs`, run under the preamble.
- It checks the tmpdir guard at startup.
- Each CLI call:
  - runs `process.execPath` with the absolute `cli-bin.js` (`packages/cli/dist/cli.js` in L2);
  - gets env `{...process.env, SUTRADHAR_CLI_STATE_DIR: $ISO/state, SUTRADHAR_CONFIG:'none', SUTRADHAR_CLI_DEBUG_CLEANUP:'1'}`
    and cwd `$ISO`;
  - runs through `spawnSync` with `timeout: 120_000`. On a timeout, apply the 0.3 indirect-Chrome rule.
- stderr from each call goes to `$EV/S7/logs/<case>-<n>.stderr`. Phase durations come from the CLI's in-process
  `[cleanup] phase ... ms=` lines.
- Pages come from the harness's own 127.0.0.1 server.
- The harness takes `CASES` (a comma list, default all) and `ITER` (overrides L1's iteration count) from env. S11-8c
  reuses it unmodified with `CASES=L1 ITER=1`.
- `$EV/S7/our-pids.txt` records:
  - every PID the harness spawns;
  - every `chromePid` read from `state.json`;
  - **every warden PID read from `$ISO/state/warden.json`** (review-4 #6f).

**Isolation proof**
- (i) Canary: `$ISO/sutradhar-cli-1700000000009-CANARY` (dead-PID marker, mtime -1 h) is swept by the first session
  start. Its `removed path=` line must exist.
- (ii) Each iteration asserts `dirname(state.userDataDir)` = `$ISO`.
- (iii) `node "$SP/iso/check-cleanup-paths.mjs" "$ISO" $EV/S7/logs/*.stderr` exits 0 with `cleanup-lines` > 0.
- (iv) Real-TEMP snapshots (0.3); every disappearance is explained.

**Cases**
- **L1**: 10x `nav` then `close` on the bundle. Each iteration:
  - exit codes 0/0;
  - `tempProfile` true;
  - (ii) holds;
  - the dir exists after nav and is gone after close;
  - the Chrome PID is gone. Check with `tasklist /FI "PID eq <pid>"` (read-only), plus the CIM CommandLine check for our
    basename when the PID shows up as reused;
  - the debug log order is `phase kill` → `state-cleared` → `phase cleanup`.

  Report p50 and max for `phase kill`, `phase cleanup`, `scan`, and the whole command. **AC**: phase kill ≤ 10.5 s,
  phase cleanup ≤ 15.5 s (one in-flight rm is flagged if it occurs), and scan max ≤ 4 s. A larger scan max is recorded
  and flagged for S8; the constant is not changed in S7.
- **L1s**: TEMP containing a space (`$SP/S7-tmp-sp dir/tmp`), 2 iterations. Expected: the dir is removed, with no error
  exit. *The 8.3 alias sub-case is dropped.* Drive E: has no 8.3 short names (1.1), and an isolated TEMP must live on E:
  under `$SP`.
- **L2**: 3x L1 on `packages/cli/dist/cli.js`.
- **L3** (in use): our own Chrome runs on `$ISO/sutradhar-cli-1700000000000-NEG315` (dead-PID marker, mtime -1 h).
  - 3 sessions run; the dir survives.
  - A direct `removeSessionTempProfile` returns `in-use`. The attribution shows our PID tree only. File count and bytes
    are unchanged.
  - Kill our Chrome after the ownership check. The next call returns `removed:true`.
- **L4** (stale sweep): create `STALE1`, `YOUNG1`, `not-sutradhar-1700000000003` and `sutradhar-downloads`. Only STALE1
  goes.
- **L5a** (P0): `CHROME_PATH=$ISO/notchrome.txt`. Expected exit 1, `EFTYPE`, `created` and `removed` lines for the same
  path, and no dir left.
- **L5b** (P2x): `CHROME_PATH=$ISO/fakechrome.exe`, a copy of `process.execPath`. Expected exit 1 well under 10 s, a
  "child exited" line, **no kill**, and the dir removed.
- **L5c** (F8): unit-only (G5). There is no deterministic live trigger (1.5).
- **L6** (named profile): covered in the R block below with an isolated home; otherwise unit tests and C2.
- **L7** (mutant): make a sibling copy `dist/cli-bin.mutant.js` with the cleanup call inside `stopSpawnedChrome`
  disabled, and confirm exactly 1 replacement with `grep -c`.
  - Expected: the dir remains after close.
  - Delete only the mutant file, and remove the leftover dir through `removeSessionTempProfile`.
  - The real `cli-bin.js` sha256 is the same before and after.
- **L9** (interrupted close): a real session, with `close` started via `spawn`. Stream stderr, and when
  `[cleanup] state-cleared` appears, kill the CLI child by its PID. Then:
  - `state.json` is absent or has no `chromePid`;
  - a second `close` reports no session and kills nothing;
  - the dir is removed afterwards by `removeSessionTempProfile`.
  - If the cleanup finished before the kill landed, record that. O2 is the authority.
- **L12** (legacy state + open dialog; review-6 A). This reproduces N11b's path with a state-file check.
  1. Real session: `nav` to a harness page that opens `confirm()` on load.
  2. Record its `chromePid` in `our-pids.txt`, then rewrite `$ISO/state/state.json` **without `chromePid`**. This is
     the legacy shape; master writes `chromePid` only in `spawnFreshSession`.
  3. Run `close`.

  Expected:
  - exit 0;
  - `Session closed.` printed;
  - **`$ISO/state/state.json` absent**.

  Then the harness kills that Chrome, after the 0.3 ownership check. The legacy no-chromePid close never kills, as on
  master. Remove its dir through `removeSessionTempProfile`.

  Mutant M-O6 (S6b) must make L12 fail: run it once through a sibling `cli-bin.mutant.js`, exactly as L7 does.

**R. Existing close regressions** (review-4 #7). These run under the preamble with an **isolated home**: add
`USERPROFILE="$ISO/home" HOME="$ISO/home"` to the command line. `os.homedir()` follows `USERPROFILE` on Windows, and
`ProfileManager` writes `<homedir>/.sutradhar/profiles.json`.
- **Precheck**: `USERPROFILE="$ISO/home" HOME="$ISO/home" node -p "require('os').homedir()"` must print `$ISO/home`.
- **Precheck**: `grep -nE "STATE_ROOT|os\.homedir|USERPROFILE|C:\\\\|/Users/" tools/scenario-suite/verify-fr2-04-dialogs.mjs tools/scenario-suite/verify-fr2-01-wait-states.mjs`
  confirms that no write target sits outside `os.tmpdir()`, the home dir, or the repo's own `tools/scenario-suite/results`.
  If either precheck fails, record why and skip **R** rather than run it unisolated.
- **R1**: `node tools/scenario-suite/verify-fr2-04-dialogs.mjs` (timeout 1800 s). Required:
  - all `close` cases pass, including N11 and N11b (exit 0 in under 10 s with a dialog open);
  - **N11b state check** (review-6 A). The script itself asserts only the exit code and the time, so add a check after
    R1: take the script's per-case state dir from its `STATE_ROOT` (resolved in the precheck) and confirm that
    `<STATE_ROOT>/N11b/state.json` is **absent**. If the script removes `STATE_ROOT` at exit, this check would pass
    vacuously, so record it as "not observable" and rely on L12 below, which is authoritative either way;
  - any non-close failure is compared against a run on the S5 commit (review-5 #8e). That comparison never checks out
    S5 in `$WT`. Instead:
    1. Run `git worktree add "$SP/S7-tmp-s5wt" <S5 merge sha>`, then in that dir
       `npx --yes pnpm@9.1.0 install --frozen-lockfile` and `node_modules/.bin/turbo run build --force --concurrency=1`.
    2. Run the same script there under the same preamble, with its own ISO `$SP/S7-tmp-s5iso`.
    3. Remove the worktree with `git worktree remove --force "$SP/S7-tmp-s5wt"`. This removes only the worktree this step
       created, and it leaves the branch and commits untouched.
    4. Confirm with `git worktree list`.

    Run this comparison only if R1 shows a non-close failure. Otherwise record "not needed".
- **R2**: the `teardown-close-kills-chrome` case of `verify-fr2-01-wait-states.mjs`, or the whole script if it cannot
  be filtered: it must pass.
- Any file these scripts rewrite under `tools/scenario-suite/results` is restored by Edit/`git diff` review and never
  committed.

**Cleanup**: every PID in `our-pids.txt` is confirmed gone or not ours. Then the guarded `rm` of each ISO dir.

**AC**
- L1-L5b, L7, L9, L12 (and its mutant run failing), R1 and R2 PASS. A skip of R is allowed only with a recorded
  reason. L12 is never skipped.
- (i)-(iv) hold.
- Guard lines present.
- No PID of ours is alive.

**False-pass analysis**
- L1 passing through the sweep instead of close: L7 rules that out.
- L3's attribution including the probe itself: the attribution query rules that out.
- An L9 race: O2 decides.
- (iii) passing vacuously: `cleanup-lines` > 0 plus the canary line.
- R passing against the real home: the precheck plus `$ISO/home/.sutradhar/profiles.json` existing afterwards.

Commit: `GAP-315/349 + close ordering merged: live verification (isolated), phase bounds, interrupted close, spawn-failure cases, mutant, existing close regressions`.

### S8 - Post-merge independent audit (fresh auditor; acceptance)
- Re-run all S4 probes on the same runtimes, with HEAD's `temp-profile.ts` compiled, under section 2 rule 3.
- Re-run the S7 harness unmodified and record its sha256.
- Run the [S8] items: B1, B3-B5, C4, O1-O8, G1-G6 (incl. G3b) and X1.
- Add at least one probe the auditor designs.
- Review the S6a-S6e diffs.
- Run `check-cleanup-paths` on every log.
- Write the verdict to `$EV/S8/audit.md`. On ACCEPT, commit
  `GAP-315: accepted after independent pre- and post-merge audits for 0.6.1` and update the GAP-315 row.

**Revert procedure** (BLOCKED):
1. `git revert --no-edit` S6e.. (newest first), then S6d, S6c, S6b, S6a.
2. `git revert -m 1 --no-edit <merge>`.
3. Set GAP-315 and GAP-349 back to OPEN.
4. In `decisions.md`, note that a later re-merge must revert the revert first.
5. In the changelog, write "not included".
6. Commit `$EV/S8`, the GAP-315/GAP-349 row changes and `decisions.md` by name, as
   `GAP-315: post-merge audit BLOCKED, evidence` (review-6 B). This leaves no untracked evidence for S11-1.
7. Continue at S9, and run S11 in its **BLOCKED variant**.

### S9 - Version bump 0.6.0 -> 0.6.1 (exactly 4 files)
1. Edit `packages/sutradhar/src/index.ts` first. The sutradhar matrix entry **must FAIL** on `api.spec.ts`.
2. Edit `api.spec.ts`, `packages/mcp-server/src/version.ts` and `packages/sutradhar/package.json`.
3. Check:
   - `git diff --stat` shows 4 files, 4(+), 4(-);
   - `git grep -nF "0.6.0" -- packages/mcp-server/src packages/sutradhar/src packages/sutradhar/tests packages/sutradhar/package.json`
     finds nothing;
   - `grep -n "from '../../src" packages/sutradhar/tests/unit/api.spec.ts` matches;
   - the sutradhar matrix entry passes.
4. Commit `Bump version to 0.6.1 (not published)`.

### S10 - Changelog and docs
Under `## [Unreleased]` / `Nothing yet.`:
```
## [0.6.1] - unreleased

Prepared on branch `release/0.6.1`; the date and the published-to-npm line are filled in after `npm publish`.
A patch release: no SDK or MCP API or tool changes (still 72 `browser.*` tools plus `agent.runGoal`); CLI exit codes
are unchanged.

### Security
- The MCP server bundle (`sutradhar-mcp`, `dist/mcp-cli.js`) inlines `fast-uri` (through the MCP SDK's `ajv`); it is
  now <FAST_URI>, fixing GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp,
  GHSA-qw65-cvwx-89v3 and GHSA-hrr3-gc8f-f4qj. These were the only advisories that reached the published package (the
  SDK's HTTP transports, which pull in express/qs/hono/ip-address, are not bundled). The monorepo lockfile also moves qs
  to <QS>, hono to <HONO>, @hono/node-server to <HONO_NODE> and ip-address to <IP_ADDRESS> within the SDK's existing
  ranges; `@modelcontextprotocol/sdk` stays at 1.30.0. [If S3b kept: dev-only brace-expansion, js-yaml and nanoid were
  refreshed too; none of them ship.]

### Fixed
- **The CLI removes its own temp Chrome profiles (GAP-315, GAP-349).** Without `--profile`, the CLI starts Chrome in a
  throwaway `sutradhar-cli-*` directory in the OS temp dir. `close` now deletes it once Chrome has exited; a failed
  start deletes its own; and each new session sweeps leftovers older than 10 minutes that no running process uses
  (owner process gone; on Windows, Chrome's lock file free). If the CLI cannot tell whether a directory is in use, it
  leaves it alone. Named `--profile` directories are never touched.

### Changed
- `close` (and recovery from a dead session) now forgets the recorded Chrome process ID immediately after stopping
  Chrome, before cleaning up the profile directory, so an interrupted cleanup can never leave a stale ID behind. How
  Chrome is stopped is unchanged.
- `close` can take longer: stopping Chrome is capped at about 10 s and the directory cleanup at about 15 s more
  (measured: <CLOSE_P50> in total); one delete already in progress may run past that. A directory that cannot be removed is
  reported and retried by a CLI session started 10 or more minutes later.
- Starting a new CLI session can take longer: it first sweeps old temp profiles, which on Windows includes a process
  query, capped at about 15 s in total (measured: <SWEEP_P50> typical).
- New diagnostics switch `SUTRADHAR_CLI_DEBUG_CLEANUP=1` prints what the cleanup considers and deletes.
```
Fill in these placeholders (review-5 #9a/#9b):
- `<FAST_URI>`, `<QS>`, `<HONO>`, `<HONO_NODE>`, `<IP_ADDRESS>`: from `$EV/S3a/dist-fast-uri.txt` and
  `$EV/S3a/moved-keys.txt` (the `+` lines). Never type a version by hand.
- `<CLOSE_P50>` and `<SWEEP_P50>`: from S7.
  - `<CLOSE_P50>` is the p50 of the whole `close` command across L1.
  - `<SWEEP_P50>` is the p50 of the `phase sweep ms=` lines alone, across L1's session starts. That line already
    includes the scan, so do not add `scan ms=` to it (review-6 C).
- AC S10-5 (review-6 C). This check is **case-insensitive**, and it matches **exactly the placeholder names**, so the
  changelog's legitimate `<defs>`, `<ref>` and `<state>` tokens never match:
  `grep -niE "<(fast_uri|qs|hono|hono_node|ip_address|close_p50|sweep_p50|p50)>" docs/22-changelog.md` must print
  nothing. Negative control, recorded in `$EV/S10/`: before filling anything in, save the unfilled template block to
  `$EV/S10/template.txt`. Then run the same pattern with `-o`, which prints one line per match:
  `grep -oiE "<(fast_uri|qs|hono|hono_node|ip_address|close_p50|sweep_p50|p50)>" "$EV/S10/template.txt" | wc -l`.
  It must print **7**: `<FAST_URI>`, `<QS>`, `<HONO>`, `<HONO_NODE>`, `<IP_ADDRESS>`, `<CLOSE_P50>` and `<SWEEP_P50>`.

If S8 ends BLOCKED, write "not included" for the Fixed and Changed entries.

**Docs**
- `packages/cli/README.md`:
  - the cleanup rules and bounds, including the in-flight rm;
  - the 10-minute retry;
  - in-use unknown means kept;
  - named profiles are never touched;
  - the debug switch.
  - Leave `:287` ("kills that Chrome process tree") as is, because it is still true.
- Change "as of 0.6.0" to "as of 0.6.1" in SECURITY.md:39 and the browser, cli, mcp-server and sutradhar READMEs, after
  re-checking each.
- **README.md:33 heading** (review-5 #9c). Change `### Status (0.6.0) and known limitations` to
  `### Status (0.6.1) and known limitations`. Add one sentence: "0.6.1 is a security and cleanup patch: <one line>." Keep
  the existing 0.6.0 feature paragraph unchanged; it describes what 0.6.0 added, which is still true.
- AGENT_SETUP.md: add a line if it describes CLI temp dirs.

Commit `0.6.1 docs: changelog, CLI temp-profile cleanup and close ordering, version references`.

**AC**
- S10-1: the heading order is correct, including `### Changed`.
- S10-2: `git grep -n "as of 0\.6\.0\|Status (0\.6\.0)" -- README.md SECURITY.md packages/*/README.md` prints nothing,
  or each remaining hit is justified in `$EV/S10/notes.md`.
- S10-3: the GHSA set equals the S1 shipped set, compared by script; count = 6.
- S10-4: the bounds equal the constants (10 s / 15 s), and the p50 comes from S7.

### S10b - Follow-up gaps (next free master numbers; never reuse numbers from the FR2-11 branch)
1. mcp-server and dev-runtime have no `test` script.
2. There is no CI guard against shipped-bundle advisories.
3. One in-flight `rm` cannot be cancelled.
4. The remaining dev advisories (+ S3b's three, if deferred).
5. POSIX has no rule-5 equivalent.
6. There is no deterministic live trigger for F8, nor for P2 (timeout with a live child). Both are unit-only (G5, G3,
   G3b).
7. Not executed: macOS, and real Chrome on Linux (6.4 item 5).
8. Scan timing margin (S7 max against the 8 s cap).
9. **Unconditional**: the pre-existing master/0.6.0 close/self-heal blind kill of a recorded PID (1.5), severity
   "wrong kill". The fix is the 0.7.0 redesign (section 10).
10. Not testable here: 8.3 short-name TEMP paths, because this volume has none (1.1).

Commit `0.6.1: log follow-up gaps`.

### S11 - Final release gate (fix nothing inside the gate)
Every item that runs code uses the preamble, with ISO = `$SP/S11-tmp`.
1. Location check, a clean tree, and at least 10 GB free.
2. `pnpm install --frozen-lockfile`.
3. Forced build, then:
   ```bash
   <HEADER>; grep -cF 'SUTRADHAR_VERSION = "0.6.1"' packages/sutradhar/dist/index.js        # >= 1
   grep -cF '0.6.1' packages/sutradhar/dist/mcp-cli.js                                       # >= 1
   grep -cE "0\.6\.[01]" packages/sutradhar/dist/cli-bin.js                                  # = 0 (the CLI embeds no version)
   grep -cE "(SUTRADHAR_VERSION|MCP_SERVER_VERSION) = [\"']0\.6\.0[\"']" packages/sutradhar/dist/*.js   # 0 for each
   grep -n "killChromeTree(" packages/cli/src/*.ts | wc -l                                   # = 1 (definition)
   grep -nE "['\"](powershell(\.exe)?|taskkill(\.exe)?|ps)['\"]" packages/cli/src/*.ts | grep -v "^packages/cli/src/system-binaries.ts:" | wc -l   # = 0
   ```
4. Typecheck:
   - `timeout 1200 node_modules/.bin/turbo run typecheck --force --concurrency=1`. `--force` stops a cache replay from
     standing in for a real run (review-5 #8g).
   - The spec typecheck: equal to the baseline, 0 errors in new specs, and the planted control reports TS2322.
5. The full test matrix: totals ≥ S1 with the expected increases listed, 0 new failures, guard lines present, and
   `check-cleanup-paths` exits 0 on the cli log.
6. Advisories (review-5 #8b, #9d):
   ```bash
   <HEADER>; mkdir -p "$EV/S11" "$SP/S11-tmp-pack" "$SP/S11-tmp-consumer"
   timeout 180 npx --yes pnpm@9.1.0 audit --json > "$EV/S11/audit-full.json"; timeout 180 npx --yes pnpm@9.1.0 audit --prod --json > "$EV/S11/audit-prod.json"
   node .ai/loop/release-0.6.1/evidence/S1/bundle-inventory.mjs "$EV/S11/audit-full.json" | tee "$EV/S11/bundle-inventory.txt"
   (cd packages/sutradhar && npm pack --ignore-scripts --pack-destination "$SP/S11-tmp-pack") | tee "$EV/S11/pack.txt"
   (cd "$SP/S11-tmp-consumer" && npm init -y >/dev/null && timeout 600 npm install "$SP/S11-tmp-pack/sutradhar-0.6.1.tgz" --ignore-scripts && node -p "require('./node_modules/sutradhar/package.json').version" && timeout 180 npm audit --json > "$EV/S11/consumer-audit.json"; echo "consumer-audit-exit=$?")
   ```
   - The inventory prints `shipped advisories: 0`.
   - `audit-prod.json` reports 0 vulnerabilities, with `totalDependencies` ≈ 518.
   - The consumer install prints `0.6.1`.
   - **Consumer rule**: an advisory is a gate FAIL only if its path is not rooted at `puppeteer-core`, or it is fixable
     within `puppeteer-core ^25.5.0`. Anything else is recorded in `$EV/S11/consumer-audit-notes.md`.
   - **New-advisory rule**: if `audit --prod` or the inventory is non-zero because an advisory was published after S3a:
     **stop**. Record it in `$EV/S11/new-advisory.md` and re-plan, starting from S3a for that package. Never ship
     around it, and never change the gate.
7. Dry-run pack:
   ```bash
   <HEADER>; (cd packages/sutradhar && npm pack --dry-run --json --ignore-scripts) > "$EV/S11/pack-0.6.1.json"
   (cd "$SP/S11-tmp-pack" && timeout 300 npm pack sutradhar@0.6.0 --dry-run --json) > "$EV/S11/pack-0.6.0.json"
   node -e 'const f=(p)=>new Set(require(p)[0].files.map(x=>x.path));const a=f(process.argv[1]),b=f(process.argv[2]);console.log("added:",[...a].filter(x=>!b.has(x)));console.log("removed:",[...b].filter(x=>!a.has(x)))' "$EV/S11/pack-0.6.1.json" "$EV/S11/pack-0.6.0.json" | tee "$EV/S11/pack-diff.txt"
   ```
   Expected: `version` is 0.6.1; no `cli-bin.mutant.js`; the added and removed lists are empty, or each entry is
   explained.
8. Live bundle (review-5 #8b):
   - **a.** Run `$EV/S3a/mcp-probe.mjs` unmodified (sha256 recorded) under the preamble with ISO `$SP/S11-tmp`.
     Expect 0.6.1, 73 tools, `wait_for` present, navigate works, and the child exited.
   - **b.** The new harness `$EV/S11/sdk-waitfor.mjs`, run under the preamble.
     - It asserts the guard, then
       `import { launch, ActionFailedError } from 'file:///<WT>/packages/sutradhar/dist/index.js'`, then
       `launch({headless:true})`.
     - It serves a page from its own 127.0.0.1 server. The page adds `READY-0.6.1` after 500 ms.
     - `page.waitFor({text:'READY-0.6.1', timeout:5000})` must resolve after ≥ 400 ms (`performance.now()`).
     - `page.waitFor({text:'NEVER-THERE', timeout:1000})` must throw `ActionFailedError`.
     - Then `browser.close()`. An attribution query over the ISO path must show no Chrome left.
     - Watchdog: 60 s.
   - **c.** Re-run `$EV/S7/gap315-live-merged.mjs` unmodified (sha256 equal to S7's) with `CASES=L1 ITER=1` and ISO
     `$SP/S11-tmp`. The S7 harness reads those two env vars; S7 must implement that filter. The harness itself creates
     the canary, as in S7 (i). Expected:
     - (ii) holds;
     - the dir appears and is gone;
     - the order `phase kill` → `state-cleared` → `phase cleanup`;
     - the canary is swept;
     - **`check-cleanup-paths` exits 0 on all S11 logs, and its negative control
       (`node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$EV/S1/pathcheck-neg.log"`) exits 1**;
     - the real-TEMP snapshot is explained;
     - the phases are within bounds.
9. Commit the gate evidence (`$EV/S11` by name), then run `node scripts/check-release-ready.mjs`, which must print OK.
10. Handoff (6.4).

**S11 BLOCKED variant** (review-5 #3, widened by review-6 B). It is used **whenever GAP-315 did not ship**, in either
case:
- **S4 BLOCKED**: S5-S8 were skipped. The S4 evidence and `decisions.md` were committed in the orchestrator's
  `GAP-315 pre-merge audit evidence` commit, so nothing is left untracked.
- **S8 BLOCKED**: the revert procedure ran, including its evidence commit (step 6).

Same items, with these replacements:
- **Item 3**, against master's code:
  - `grep -n "killChromeTree(" packages/cli/src/*.ts | wc -l` must be **5**: the definition plus cli.ts F8, self-heal
    and close, plus spawn-chrome.ts timeout.
  - The system-binary grep (without the exclusion) must give **1** match: spawn-chrome.ts `'taskkill'`.
  - `git diff origin/master -- packages/cli/src` must be **empty**.
  - The dist version checks are unchanged.
- **Item 4**: the spec typecheck baseline is master's (the 7 errors in 1.9).
- **Item 5**: matrix totals equal S1 plus nothing (no temp-profile tests). The path-log check is N/A, because the seam
  is reverted.
- **Item 8c**: a plain `nav` + `close` on `cli-bin.js` under the preamble, with exit 0/0, plus the real-TEMP snapshot
  (no disappearance attributable to us). There is no canary, no order lines and no path-log check.
- **The changelog** says "GAP-315/GAP-349 fix not included". The S10b hazard gap is present.

Record which variant ran in `$EV/S11/README.md`.

**Mutants the gate catches**

| mutant | caught by |
|---|---|
| `version.ts` bump forgotten | items 3, 8a |
| install skipped | item 6 |
| cleanup lost | item 8c |
| tool count drift | items 5, 8a |
| mutant file left over | item 7 |
| unconverted kill site | item 3 count |
| bare system binary | item 3 grep |
| order regression | item 8c order |

---

## 5. GAP-315/349 and close-ordering adversarial audit checklist (S4 on the extracted module; S8 on merged HEAD)

**Runtimes**
- Windows: v25, 18.20.8, 20.20.2 and 22.23.3, using the binaries directly under the preamble.
- WSL: Node 20.20.2 under the WSL guard, for C5-live and the POSIX variants of A1-A3 and A6.

Each log starts with the Node version, the platform and `os.tmpdir()`. A FAIL on any runtime counts as a FAIL.

"Isolated" means the other rules are forced to "remove": the scan returns `[]` unless rule 2 is under test, the marker
PID is dead, and `minAgeMs` is 0. Every probe prints its `reason`.

**[B]** marks a blocking item. **[S8]** marks an item that runs only post-merge.

**A. Deletion safety**
- **A1 [B] Scope.** None of these may be removed (Windows and WSL):
  - `sutradhar-cli-123`
  - a matching name one level down
  - a matching name in another root
  - `sutradhar-cli-1790000000000-` followed by 17 characters
  - names containing `..`
  - `sutradhar-cli-1790000000000.lnk`
  - `sutradhar-downloads`
  - `sutradhar-download-locks` and the lock names taken from `download-lock.ts`
  - a look-alike of a named profile
- **A2 [B] Link as the candidate.**
  - Windows: `mklink /J`, and `/D` if permitted; otherwise record "not permitted".
  - WSL: `ln -s`.
  - The victim, including its `lockfile`, must be intact afterwards.
- **A3 [B] Link inside a real stale candidate.** The candidate is removed, and the link target is intact.
- **A4-pre [B] Lock signal**, on each Windows Node version: Chrome `--headless=new`, Chrome headed (off-screen), and
  **Edge** (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`). For each:
  - `lockfile` exists;
  - `rm` rejects with EBUSY or EPERM;
  - the file is still there afterwards.
- **A4 [B] No partial delete of a live profile**, with rule 5 isolated:
  - `removed:false`;
  - file count and bytes unchanged;
  - `/json/version` still answers.
- **A5 [B] Rule 2 isolated.** Returns `in-use`. The attribution shows only our PID tree and never the probe. Variant: a
  forward-slash path. The 8.3 variant is N/A because E: has no short names.
- **A6 [B] Rule 3 isolated.** A live dummy gives `owner-alive`. After that dummy is killed by PID, the dir is removed.
- **A7 [B] Fail closed.**
  - A `null` scan keeps the dir.
  - `scanCommandLines(1)` returns `null`.
  - A query that ran and matched nothing returns `[]`.
  - Unknown in-use status **never** leads to a delete.
- A8 Elevated processes are invisible to rule 2. Code reading only.
- **A9 [B] WSL guard.**
  - `/mnt/...` gives 97, and a TMPDIR outside PROBE_ROOT gives 97.
  - A `mktemp` root gives 0.
  - The guard is literal in every WSL probe (check with grep).
  - No WSL log path is under `/mnt/`.

**B. Races and timing**
- **B1 [B][S8]** Two sessions at once: neither removes the other's live dir.
- **B2 [B]** A long-lived session backdated by more than 10 min is kept.
- B3 [S8] Bounds:
  - close cleanup ≤ 15 s + 1 s;
  - kill phase ≤ 10 s;
  - all loops use `performance.now()`;
  - S7 maxima within bounds.
- B4 [S8] Sweep: 50 small dirs plus one dir of about 200 MB finish in ≤ 15 s plus one in-flight rm.
- B5 [S8] TEMP mismatch: TEMP A and TEMP B are both scratch dirs. Expect `not-auto-temp`, kept, a warning, and no error
  exit.

**O. Close and recovery ordering (S6b) [B][S8]**
- O1-O8 and their mutants (M-O1..M-O6) are re-run, plus live L12 (legacy state + dialog: state file removed).
- Live S7 L1 order lines and L9 (interrupted close).
- Auditor check: `git diff <merge>..HEAD -- packages/cli/src/cli.ts packages/cli/src/spawn-chrome.ts`:
  - the kill function is unchanged **against the S5 merge commit** (the branch's awaited form,
    `killChromeTree(pid, timeoutMs = 10_000): Promise<void>`), except for `taskkillExe()` (review-5 #4). Compared with
    master, the `taskkill` arguments `/PID <pid> /T /F` and the POSIX `process.kill(-pid,'SIGKILL')` → `process.kill(pid,'SIGKILL')`
    fallback must be identical. The async/await form, the cap and `windowsHide` come from the branch and are **not** a
    finding;
  - no exit statement was added or removed;
  - the state is cleared before every cleanup;
  - `grep -rn "chromePid" packages/cli/src` lists every use, and no kill site exists outside `stopSpawnedChrome` and
    `discardSpawnedProfile`.

**G. GAP-349 paths [B][S8]**
- G1-G6 and their mutants are re-run.
- L5a and L5b run live.
- Every path is reached through its seam, and every G test injects `executablePath`.

**C. Integration**
- C1: a 0.6.0 `state.json` without `userDataDir`. `close` kills exactly as in 0.6.0, clears the state and removes
  nothing.
- C2: with `--profile`, `tempProfile:false` and nothing removed. Live coverage in S7-R (N11).
- C3: self-heal order: kill, clearState, cleanup (warn), respawn.
- C4 [S8]: FR2-14 intact. The GAP-356 guard passes, and `nav` with `.sutradhar.json` works.
- **C5-live** (WSL Node 20, A9 guard):
  - (a) A stand-in whose argv is longer than 4096 characters is detected as `in-use`, both on the S5 module and after
    S6d.
  - **(b) [B]** `SingletonLock` set to `<hostname>-<live pid>`, **no marker**, scan `[]`: result `owner-alive`. With a
    dead PID, the dir is removed.
  - **(c) [B]** Both kinds of symlink victim stay intact.
  - (d) The 19-case `node:test` port, with `$EV/S4/port-map.md` (count asserted as 19) and an assertion diff.
- C6: every sweep and remove call in the specs passes `tmpRoot`.

**X. Real-TEMP protection**
- **X1 [B]** `check-cleanup-paths` exits 0 for every log from S4 and S6 through S11 (S5 is N/A). The negative control
  exits 1 (in S1 and S11). Every real-TEMP disappearance is explained.

**D. Evidence integrity**
- D1: test counts are re-derived.
- D2: the branch's real-TEMP live run is recorded as a process finding.

**Verdict rule**: any FAIL on a [B] item is blocking. Any other FAIL is blocking only if it causes data loss, a wrong
kill, or an error exit. Otherwise it is recorded as a limitation.

---

## 6. Deferred, risks, gate checklist, post-handoff

### 6.1 Deferred
| item | reason |
|---|---|
| **Close/recovery redesign** (CDP close, ownership verification, unverified-PID retention, exit 1, refusal mode, self-heal carry) | **Orchestrator scope decision: 0.7.0.** See section 10. |
| vitest critical GHSA-5xrq-8626-4rwp; vite x3; esbuild via vite | Dev/test only. Fixing them needs a major toolchain upgrade. |
| braces GHSA-vfj7-8cjw-p6xm | No fix exists. |
| brace-expansion, js-yaml, nanoid | Deferred only if S3b's keep condition fails. |
| SDK 1.32.0 | No security need, and it changes shipped MCP code. |
| FR2-11 code | HELD. |
| GAP-314, GAP-346 remainder, GAP-347/350/353/355/357 | Out of scope. |
| CI advisory guard, test scripts, macOS, Linux Chrome execution, live F8 trigger, 8.3 paths | S10b. |
| GAP-349 if GAP-315 is BLOCKED | Section 2, rule 5. |

### 6.2 Risks
1. **Data deletion.** Guarded by:
   - two audits across 4 Windows Node versions plus WSL;
   - rule isolation;
   - the lock signal for Chrome and Edge;
   - fail-closed in-use detection;
   - the WSL guard;
   - the path-log check with a negative control;
   - the revert path.
2. **Wrong kill.** 0.6.1 does not change the blind kill, which keeps 0.6.0 semantics by decision. It removes the
   GAP-315 window in which a slow cleanup kept a stale PID (S6b). The pre-existing hazard is logged (S10b 9) and fixed in
   0.7.0.
3. **Close latency.** Kill ≤ 10 s, then cleanup ≤ 15 s, plus one in-flight rm. S7 measures the p50.
4. **Registry or pnpm drift.** Only named packages may move. pnpm is 9.1.0, with a frozen lockfile both locally and in
   CI.
5. **Shared machine** (35 sessions, 134 Chrome processes, 45 real-TEMP dirs). Covered by the preamble, the guard, the
   path-log check, the snapshots and ownership-checked harness kills.
6. **Forced builds.** Always use `--concurrency=1`.
7. **An empty audit.** The sanity checks catch it.
8. **The consumer audit depends on puppeteer-core.** The S11-6 rule handles it.
9. **Turbo test runs only in CI.** The local matrix uses the same packages and flags.
10. **S7-R scripts may write outside ISO.** The prechecks catch that; otherwise R is skipped with a reason.

### 6.3 Final release gate checklist (copy into `$EV/S11/README.md`)
- [ ] Location, clean tree, ≥ 10 GB, nothing pushed by the builder; every log has `[iso-guard]` and none has `ISOLATION GUARD`
- [ ] S1 self-tests: guard (97/0/vitest 97), path checker (pos 0 / neg 1 / empty 1); planning files committed
- [ ] FR2-11 row byte-identical; "FR2-11 HELD" entry exists; no FR2-11 code
- [ ] S3a: only 5 packages, SDK 1.30.0, no overrides; S3b kept or deferred with a reason
- [ ] Inventory 0; `audit --prod` 0; consumer rule passes
- [ ] GAP-315/349: S4 verdict, S8 ACCEPT, escalation count recorded (or BLOCKED + reverted)
- [ ] Close ordering: O1-O8 + mutants (no trailing clearState in the chromePid branch; exactly one clearState outside `if (!closeBlocked)`; monotonic now); L1 order lines; L9; L12; R1/R2 (or a recorded skip reason); kill semantics and exit codes unchanged
- [ ] GAP-349: G1-G6 + G3b + 9 mutants; L5a/L5b; `killChromeTree(` = 1; no void/then; ESLint 0
- [ ] Bounds: S6a T1-T8 + mutants; S7 phases within bounds; changelog matches
- [ ] X1: path-log check 0 on every log; negative control re-run; real-TEMP disappearances explained; WSL guard self-test
- [ ] Spec typecheck non-vacuous: baseline 7, 0 TS6059, planted error reported, 0 errors in new specs
- [ ] Version in 4 files; dist checks; system-binary grep 0
- [ ] Docs: changelog (Security / Fixed / Changed), README, GHSA set = 6, debug switch documented, gaps logged
- [ ] Build, typecheck, matrix ≥ S1
- [ ] `npm pack --dry-run` OK, no mutant file
- [ ] Live MCP / SDK / CLI items
- [ ] `check-release-ready` OK (last)
- [ ] Which S11 variant ran (normal or BLOCKED) is recorded; no untracked evidence at item 1; every step's `README.md` has a per-AC false-pass analysis; `audit --prod` re-checked with the new-advisory rule

### 6.4 Post-handoff (user-owned; publish blocked until items 1-2 are done)
1. Push `release/0.6.1` and open the PR to `master`.
2. **CI must be green on the PR before `npm publish`.** CI runs on ubuntu with Node 20: frozen install, typecheck, build,
   turbo test.
3. `npm publish` from `packages/sutradhar`, after an explicit `cd` and a `pwd` check. **Where to publish from**
   (review-5 #9e) is one of:
   - the S11-gated commit in this `release/0.6.1` worktree, with an unchanged tree;
   - or, after a PR merge, a checkout of the merge commit. There, first re-run S11 items 2, 3, 6 and 7 (frozen install,
     forced build plus version checks, advisories, dry-run pack).

   `check-release-ready` checks only a clean tree and dist mtimes. It does not check version or content.
4. After publishing: add the shasum row, set the changelog date, and install 0.6.1 in an isolated dir to verify it.
5. **Recommended before publishing** (review-4 #9; user-owned, not a gate): `workflow_dispatch` of
   `scenario-suite.yml` on `release/0.6.1`. In the CLI step log, check that:
   - every `close` exits 0;
   - no `Warning: could not remove temp profile` line repeats across sessions;
   - the runner's TEMP has no `sutradhar-cli-*` dirs left (this needs a `ls` step, or inspect the log).

   If the user declines, S10b item 7 stands.

---

> Sections 7-9 are carried forward from revisions 3-4 as the historical record. **Revision 5 supersedes every entry that concerns the S6b close/recovery redesign** (CDP close, ownership verification, `unverified`/`closePending`/`unverifiedChrome`, close exit 1, P1-P9, L8/L8b/L10, the `SystemRoot` override, the 1.9 caps). That work moved to section 10 (Deferred to 0.7.0). In revision 5, S6b = close/recovery **ordering** only, S6c = GAP-349, S6d = POSIX scan via /proc. Section 11 maps the revision-5 changes.

## 7. Changes from review-1 (`plan-review-1.md`), as resolved in revision 3 (carried forward; revision-4 changes are in section 9)

| # | sev | finding | resolution |
|---|---|---|---|
| 1 | MAJOR | Deletion probes ran on Node 25 only | Section 5 runtimes: Windows v25/18/20/22 (binaries called directly) and WSL Node 20. A FAIL on any runtime counts. S8 uses the same runtimes. |
| 2 | MAJOR | POSIX was "code reading only" | C5-live (a)-(d) in WSL, including the 19-case `node:test` port with a fidelity map. S6d adds `-ww`. CI-green-before-publish is in 6.4. |
| 3 | MAJOR | Close latency accepted, not bounded | S6a: one 15 s cleanup deadline, scan clamp, no rm attempt with < 1 s left, for close and sweep alike. S6b: kill phase ≤ 10 s. S7 measures the phases. The changelog quotes the bounds and the measured p50 (review-2 #6). |
| 4 | MAJOR | S4/S5 gating contradiction | Section 2: one order, one blocking set B, probe re-run rules. Escalation counts every audit failure (review-2 #5). |
| 5 | MAJOR | In-use probes could pass via the probe's own argv; rule 5 unproven | Paths go only through env vars or files. An attribution query is required. A4-pre observes the lock for Chrome (both modes) and Edge on every Windows Node version. Already observed on v25 (1.6). |
| 6 | MAJOR | GAP-349 under-specified | S6c: seams `SpawnDeps` (including `tmpRoot`), and paths P0 (sync throw, observed EFTYPE/UNKNOWN), P1, P2, P2x (exited child, no kill), F8. Tests G1-G6, 6 mutants including M-seam. Live L5a/L5b with stand-ins verified during planning. Call-site greps and an ESLint floating-promise pass. |
| 7 | MINOR | Real-TEMP check flaky | Canary (i), `dirname` check (ii), and the pre-recorded marker-PID attribution (iii) (review-2 #9). |
| 8 | MINOR | Baseline and gate used different commands | One fixed 20-entry test matrix, used in S1, S3b, S5 and S11. Turbo test runs only in CI. S1 adds a lint baseline. |
| 9 | MINOR | `git show --stat` on a merge | S5-1 uses the first-parent diff. |
| 10 | MINOR | Loose version grep | S11-3: fixed-string checks. `cli-bin.js` is expected to contain no version (review-2 #13). |
| 11 | MINOR | Consumer audit had no failure rule | S11-6 rule. |
| 12 | MINOR | Mutant edited the real dist | S7 L7 uses a sibling file and checks the sha256 of the real dist. S11-7 checks that the mutant file is absent. |
| 13 | MINOR | A spawnSync timeout could leave Chrome running | 0.3 rule, now with an ownership check before any kill. |
| 14 | MINOR | Wrong dev-advisory rationale | S3b, conditional keep. 6.1 corrected. |
| 15 | MINOR | FR2-11 pointer and GAP collisions | S2 entry title contains "FR2-11 HELD"; collision note; S10b uses master's next free numbers. |
| 16 | MINOR | A1 names; TEMP with space or 8.3 alias | A1 list. S7 L4 and L1s. B5 uses two scratch dirs. |
| 17 | MINOR | Revert order | S8 procedure: newest first, then `-m 1`, revert-the-revert note. |
| 18 | MINOR | Git through Git Bash | Deviation stated in 0.3. |
| 19 | MINOR | Docs and follow-ups | S10 CLI README; S10b gaps. |

---

## 8. Changes from review-2 (`plan-review-2.md`) and orchestrator round-2 decisions (revision 3; carried forward)

| # | sev | finding | resolution in revision 3 |
|---|---|---|---|
| 1 | MAJOR | Isolation relied on `export`, which does not persist between tool calls | **Decision 1.** The 0.2 ISOLATION PREAMBLE is mandatory and copied verbatim: TEMP/TMP/TMPDIR plus `NODE_OPTIONS=--import=<guard>` on the same command line (Bash and PowerShell forms given). Every harness also asserts `os.tmpdir()` at startup. Every step's AC requires the guard line. The guard was verified during planning: real TEMP exit 97, isolated exit 0, Node 18 binary OK, vitest isolated 20/20, vitest against the real TEMP exit 97. The npx `node@N` wrapper breaks under NODE_OPTIONS, so binaries are called directly. Every code block defines its own variables. |
| 2 | MAJOR | `close` kept `chromePid` through the slow cleanup, a PID-reuse kill hazard | **Decision 2.** New S6b: `teardownSpawnedChrome` runs verify, then kill, then wait, then **clearState before cleanup**, in both close and self-heal. `killOwnedChrome` kills only after a command-line ownership check (port token and dir basename; fail closed). Tests P1-P7, mutants M-P1/M-P3/M-P4. Live L8/L8b (forged state pointing at a live dummy, which survives) and L9 (interrupted close). Audit items P1-P4 are in set B. |
| 3 | MAJOR | GAP-349 cases did not exercise the claimed paths; the timeout path was untested | **Decision 3.** S6c: deterministic seams (`spawnFn`, `probeEndpoint`, `startTimeoutMs`, `killOwned`, `removeProfile`, `tmpRoot`) and an `attachOrDiscard` helper for F8. Tests G1-G6 cover P0 (a sync throw, discovered during planning: a non-executable file throws EFTYPE/UNKNOWN synchronously), P1 (error read after an await), P2, **P2x (child already exited, so no kill)**, F8 and named profiles. Live: L5a uses `CHROME_PATH` set to an existing non-executable file, which is honoured because the file exists; L5b uses `CHROME_PATH` set to a node.exe copy, observed to exit with code 9. The viewport trigger is dropped (it fails after `writeState`). F8 live is unit-only, with the reason recorded. |
| 4 | MAJOR | Test (5) had no `tmpRoot` seam and a false-pass assertion | **Decision 4.** `SpawnDeps.tmpRoot` feeds both creation and removal. The tests make their own `g349-*` root. The removal wrapper records `exists` and `dirname` before delegating. **Mutant M-seam** (no tmpRoot passed) makes G1 fail. C6 covers `spawn-failure-cleanup.spec.ts`. |
| 5 | MAJOR | Escalation count conflicted with the global rule | **Decision 5.** Section 2 rule 4 counts every independent audit failure of GAP-315/349 (S4 + S8 + re-audits): #2 means stop and re-plan with approval, #3 means BLOCKED, revert, and the release proceeds with the security fix and housekeeping. |
| 6 | MINOR | Close bound and wording | The `MIN_RM_START_MS` rule now applies to close too, with the in-flight rm stated. The changelog separates the cleanup bound (15 s) from the kill bound (10 s) and quotes the measured p50. The warning now says "a CLI session started 10 or more minutes from now will retry it". Self-heal warns too. |
| 7 | MINOR | S6a tests lacked positive controls; constants not checkable | T3 asserts exactly 0 removed; T3b is the positive control (all 3 removed); T4 checks the scan argument ≤ remaining; T5 the rm-start rule. S6a-3 lists the exact constant lines and the exact grep. |
| 8 | MINOR | Scan timeout unmeasured; bare `powershell.exe` and `taskkill` names | A debug seam (`SUTRADHAR_CLI_DEBUG_CLEANUP`) logs every scan's duration and result. S7 reports p50/max and the null/deadline counts, flagged if max > 4 s. Absolute `%SystemRoot%` paths for PowerShell (S6a) and taskkill (S6b). |
| 9 | MINOR | S7(iii) attribution not executable | Pre-run record of each real-TEMP entry's marker PIDs. Post-run, a missing entry is attributed if its PIDs are not in `our-pids.txt`. |
| 10 | MINOR | Probe re-run, B-items, B5, C5(b), Edge | Section 2 rule 3: `probe-diffs.md`, and no weakened assertions. B1/B3/B4/B5/C4 marked [S8]. B5 uses two scratch dirs. C5(b) requires no marker. A4-pre/A4 include Edge. |
| 11 | MINOR | WSL commands not executable; port fidelity; busybox | Literal `/mnt/e/...` paths inside single-quoted `sh -c`, and `timeout 300` on every `wsl.exe` call. `port-map.md` maps the 19 tests and asserts the count. The busybox `-ww` limit is noted in S6d and S10b. |
| 12 | MINOR | Commands did not match the prose (`--force`, lint baseline, condition 5) | Turbo test was replaced by the fixed vitest matrix (no cache). The S1 lint baseline uses `--force`. S3b condition 5 compares only `==` lines. |
| 13 | MINOR | S11-3 could never pass for `cli-bin.js` | `cli-bin.js` is expected to contain no version string (same as 0.6.0). The checks apply to `index.js` and `mcp-cli.js` only. The `--version` sub-item is dropped. |
| 14 | MINOR | Inconsistent call-site expectations | S6b-3: `killChromeTree(` must give exactly 2 lines (the definition and the one call inside `killOwnedChrome`). S6c lists every await-call site. The echo is renamed `grep-exit` (1 = none). |
| 15 | MINOR | Commit hygiene for untracked files | S1 commits the plan, reviews and baseline. Every step adds paths by name and records `git status --porcelain`. |
| 16 | MINOR | An S4-BLOCKED rollback dropped GAP-349 | Section 2 rule 5: GAP-349 explicitly waits for the next release, because its fix depends on `temp-profile`. Recorded in decisions.md, row kept OPEN. |
| review-1 #3/#6/#7/#8/#10 (partial) | - | - | Now resolved by review-2 #6/#2, #3/#4, #9, #12 and #13 above. Section 7 shows the final state. |

---

## 9. Changes from review-3 (`plan-review-3.md`) and orchestrator round-3 decisions (revision 4)

| # | sev | finding | resolution in revision 4 |
|---|---|---|---|
| 1 | MAJOR | `close` could leave Chrome running and forget its PID when the ownership query was slow or unavailable (a regression vs 0.6.0) | **Decision A**, new S6b. (1) Primary path: graceful `Browser.close` over the session's own endpoint, only when `/json/version` returns the **same** `webSocketDebuggerUrl` (per-launch GUID). This needs no OS query. Exit is confirmed by port closed + PID not alive. (2) Fallback kill only on a positive token match. The query is PowerShell CIM on Windows (it prints `ProcessId\|CommandLine` to tell gone from unreadable) and **`/proc/<pid>/cmdline` on Linux, never `ps`**. (3) `unverifiable`: no kill, **the PID is kept** with `closePending`, and `close` **exits 1** with an explicit "Chrome may still be running" message. This is justified in S6b step 6. Self-heal carries `unverifiedChrome` (P9). (4) Measured on this machine (1.9): verify p50 560 / max 595 ms; graceful close→exit p50 1882 / max 1919 ms; `/proc` read max 0.55 ms. The caps are sized at 2x or more, and S7 requires max ≤ 50% of cap. (5) Tests P8a/P8b plus mutants M-P8a/M-P8b, and L10 live (with a precheck). The changelog sentence is rewritten. |
| 2 | MAJOR | Real-TEMP protection: unguarded WSL path, a vacuous (iii), an ambiguous "real TEMP", PowerShell env leakage | **Decision B.** (a) The WSL guard is literal in every probe: it refuses `/mnt/` and anything outside the `mktemp` root, and is self-tested in S4 (A9). (b) A path-logging debug seam prints every considered, created or deleted path as `path="..."`. `check-cleanup-paths.mjs` must exit 0 on every log of S4-S11 (X1, in set B). Its **negative control** (a fake real-TEMP line → exit 1; an empty log → exit 1) runs in S1 and again in S11. The real-TEMP snapshot is taken around every S4/S7/S8/S11 session, and any disappearance is "unattributed until explained". (c) `REAL_TEMP` is hard-coded and asserted to differ from ISO and to have ≥1 entry. **Only the Git Bash preamble form** is allowed for GAP-315 code. Every `rm -rf "$ISO"` goes through the guarded `case` form (preamble 8). |
| 3 | MINOR | S6b-3 cannot pass at S6b | S6b-3 expects **4** lines at S6b. "Exactly 2" is checked at S6c-3 and S11-3. |
| 4 | MINOR | `close-session.ts` cannot call `cleanupSessionTempProfile` | `deps.cleanup` is supplied by `cli.ts`, with the new signature `cleanupSessionTempProfile(target, warn, deadlineAt)` stated. The cleanup deadline starts when the stop phase returns. |
| 5 | MINOR | M-c survives T3 | T3 is now `budgetMs: 2000` with a 1500 ms scan, expecting exactly 0. Under M-c about 2000 ms remain, so all 3 are removed and T3 fails. T5 uses an absolute `deadlineAt` with 25 ms tolerance. |
| 6 | MINOR | The S6a-3 grep conflicted with the code; old option names; specs not typechecked | `SWEEP_PER_DIR_RETRY_MS` is named, giving **7** expected lines. `exitTimeoutMs`/`removeTimeoutMs` are removed, and the branch test moves to `deadlineMs: 300`. A scratch `tsconfig.specs.json` typechecks the specs; its baseline is taken at S5 and must gain no new errors. |
| 7 | MINOR | P7 is non-deterministic | P7b uses `await once(child,'exit')` and a 15 s test timeout. P7c is a parse fixture. The POSIX gone mapping is stated (`ENOENT` or a zombie `Z` gives `null`). |
| 8 | MINOR | Phase durations could not be measured with `spawnSync` | The CLI prints `[cleanup] phase kill|cleanup ms=`, `endpoint`, `graceful` and `verify ... ms=` lines, measured in-process with `performance.now()`. S7 parses the saved stderr. |
| 9 | MINOR | The 8.3 alias tripped the guard | Only the last component is shortened (`%~snxI`), and the `$SP` prefix stays long. |
| 10 | MINOR | G tests needed a real browser | Every G test passes `executablePath: 'fake-chrome'`. |
| 11 | MINOR | Absolute system binaries were only partly enforced | `system-binaries.ts` (`systemBinary`, `posixBinary`). The S6a-4 grep over all `packages/cli/src/*.ts` must match only in that file, and it is re-checked in S6b-5. |
| 12 | MINOR | Unguarded `rm -rf "$ISO"` | Preamble 8: the `set -u`, non-empty, under-scratchpad `case` form is the only allowed delete. |
| 13 | MINOR | The master self-heal PID hazard was hidden by the BLOCKED revert | Section 2 rule 5 and S10b item 9: when GAP-315 is reverted, the pre-existing wrong-kill hazard is logged with severity "wrong kill" and recorded in `decisions.md`. |
| 14 | MINOR | S1-6 left review files untracked | S1 adds every existing `plan-review-*.md` by name (1-3 today) plus `decisions.md` if present, and shows `git ls-files`. |
| 15 | MINOR | ESLint plugin resolution; WSL placeholder; undocumented debug env; Linux Chrome evidence | `--resolve-plugins-relative-to "$WT"`. `D` is captured and pasted literally (with an example). `SUTRADHAR_CLI_DEBUG_CLEANUP` is documented in `--help`, the README and `help-text.spec.ts` (T7). `workflow_dispatch` of `scenario-suite.yml` is an optional user item (6.4 item 5). |
| R1#7 / R2#9 | partly resolved before | Real-TEMP check vacuous | Replaced by the path-log check X1, with a negative control, plus the snapshots ("unattributed until explained"). |
| R2#14 | partly resolved before | Call-site counts | Per-step counts: S6b = 4, S6c = 2, S11 = 2. |
| (extra) | - | Found while revising | Linux scan (S6d) now reads `/proc` instead of `ps`, which also removes the busybox `-ww` limit. `cdpClose` is placed in `packages/browser` (`closeBrowserAtEndpoint`), because `@sutradhar/cli` does not depend on `puppeteer-core` directly. |

Orchestrator decisions:

| decision | resolved in |
|---|---|
| (A) | S6b, 1.9, P1-P9, L1/L8/L10, 6.2 items 2-3 |
| (B) | Preamble 5/6/8, A9, X1, S1/S11 negative controls, 0.3 snapshots |

---

## 10. Deferred to 0.7.0: close/recovery redesign (starting requirements)

**Scope.** The orchestrator's final decision removed this from 0.6.1. The redesign would make `close` and session
recovery stop *our* Chrome without ever killing an unrelated process that reused a recorded PID, and without silently
forgetting a Chrome it could not stop. The hazard it targets exists today, in master and 0.6.0: the self-heal/close
blind kill of a recorded PID (1.5), logged as an S10b gap. 0.6.1 only removes the GAP-315-specific widening (S6b
ordering).

**Design carried over from revision 4.** This is a starting point, not a verdict:
1. Graceful `Browser.close` through the session's own endpoint. It runs only when `/json/version` returns the same
   `webSocketDebuggerUrl` (per-launch GUID). Confirm the exit when the port closes and the PID is gone.
2. Fallback kill only when ownership is positively verified:
   - Windows: CIM query printing `ProcessId|CommandLine`;
   - Linux: `/proc/<pid>/cmdline`, never `ps`;
   - macOS: `ps -ww`.
3. If ownership is unverifiable: no kill, keep the PID, and report it honestly.

**Measurements already taken on the development machine** (`$SP/r4/measure.mjs`, 2026-10-04; 134 other Chrome
processes running):
- PowerShell CIM single-PID query: p50 560 ms, max 595 ms (n=10). A nonexistent PID gives exit 0, empty output, about
  540 ms.
- `connect(targetFilter: () => false)` + `close()` → PID gone: p50 1882 ms, max 1919 ms (n=5). Port closed at the same
  time.
- WSL `/proc/<pid>/cmdline` read: max 0.55 ms. An absent PID gives `ENOENT`.

**Requirements: every finding below must be resolved before the 0.7.0 design is audited.**
- **R-1 (review-4 #1, MAJOR).** Classify a dead PID as `gone` from a read-only `process.kill(pid, 0)` before any OS
  query (`EPERM` = alive). A failing query must never make a dead PID "unverified".
  - Test P10: query `undefined` + `isAlive` false → `gone`, cleared, exit 0.
  - Mutant: removing the pre-check must fail P10.
  - No hard refusal of new sessions. Either drop the oldest kept entry with a warning that names its PID, or provide a
    documented `close --forget` that prints what it forgets.
  - A live case: kill the dummy, then `close` with the query broken → exit 0.
- **R-2 (review-4 #2, MAJOR).** Specify where unverified entries live, for example a separate `unverified-chrome.json`
  that `clearState()` never touches. Define a "leftovers only" state that `readState` callers treat as no session.
  - Define the `close` order: main session, then the entries, then write the leftovers file last.
  - Test P9b: main `closed`, one entry unverifiable → exit 1, the entry kept with the same PID, and the next `nav`
    starts cleanly.
  - Mutant: "clearState wipes entries" must fail P9b.
  - Specify profile cleanup for entries that later resolve.
- **R-3 (review-4 #3, MAJOR).** Define the match rule precisely:
  - the exact `--remote-debugging-port=<port>` token, delimited by start, whitespace or a quote;
  - the parsed `--user-data-dir=` value, quotes stripped, path-normalised, case-insensitive on Windows, equal to
    `state.userDataDir`.

  Required evidence:
  - P7d, a fixture **captured from a real Chrome**: the Windows CIM line, including a TEMP path containing a space, and
    a Linux NUL-separated `/proc` sample.
  - Live L11: a real session with only the GUID in `state.wsEndpoint` rewritten → `guid-mismatch`, `verify match`, a
    kill, the PID gone, the dir removed, exit 0. Repeat it under a TEMP with a space.
  - Put L11 in the blocking set.
- **R-4 (review-4 #5).** The graceful close needs a handshake timeout. Build on `connectAtBrowserLevel(ws, timeoutMs)`
  in `dialog-cdp.ts` (an outer `Promise.race`), and race `browser.close()` against the remaining time as well.
  `Browser.close` errors are swallowed by puppeteer, so success is observable only through the exit wait.
  - Test P11: `cdpClose` never settles → the fallback runs within the phase deadline + 250 ms.
- **R-5 (review-4 #6c/#6d).** State the kill wiring explicitly so call-site counts are deterministic. Use neutral
  `mismatch` wording, because the port may be open and owned by another browser.
- **R-6 (review-4 #7).** Re-run the existing close regressions: `verify-fr2-04-dialogs.mjs`, including N11 and N11b
  with a dialog open under `--profile` with an isolated home, plus `verify-fr2-01` `teardown-close-kills-chrome`.
  Measure `Browser.close` with an open `alert()`.
- **R-7 (review-4 #8).** Exit-code and behaviour changes go under `### Changed` in the changelog, and in the CLI README
  "Exit codes" section, with the recovery path documented.
- **R-8 (review-4 #9).** The Linux close path needs real-Chrome execution before release. Use the scenario-suite
  `workflow_dispatch`, grep `close` exit codes, and make that a publish precondition.
- **R-9 (review-3 #1, review-4 #10).** The redesign gets its **own audited item with its own escalation counter**,
  separate from GAP-315. Size the caps from measurements, at least 2x the max, with the live max ≤ 50% of the cap.
- **R-10.** Remove the master hazard, then delete S10b gap 9.

---

## 11. Changes from review-4 (`plan-review-4.md`) and the orchestrator's final scope decision (revision 5)

| # | sev | finding | resolution in revision 5 |
|---|---|---|---|
| 1 | MAJOR | A dead PID becomes "unverifiable" when the query fails, so `close` exits 1 forever and sessions are refused | **Removed from 0.6.1** (scope decision). There is no ownership query, no unverified state and no exit 1. `close` keeps 0.6.0 kill semantics. Carried into section 10 as R-1. |
| 2 | MAJOR | `unverifiedChrome` wiped by `clearState`; schema unspecified | **Removed from 0.6.1.** Section 10 R-2. |
| 3 | MAJOR | The fallback `match` was never run against real Chrome; the token rule could not match | **Removed from 0.6.1.** Section 10 R-3. |
| 4 | MINOR | The spec typecheck was vacuous (TS6059 only) | Reviewer's config adopted and **re-verified during planning** (1.9): baseline 7 real errors (6 TS2322 + 1 TS6133), 0 TS6059, and a **planted error reported as TS2322**. S5 records the baseline and the negative control. Every S6 step and S11 require: equal to the baseline, 0 errors in new specs, 0 TS6059, and the planted control re-run. |
| 5 | MINOR | No handshake timeout on the graceful close | Graceful close removed from 0.6.1. Section 10 R-4. |
| 6a | MINOR | The system-binary grep matched the helper's own call form | Named helpers `powershellExe()`, `taskkillExe()`, `psBin()`. Call sites contain no quoted binary names. The grep excludes `system-binaries.ts` and expects 0 lines (S6a-4, S11-3). |
| 6b | MINOR | The S2/S3a/S3b blocks lacked variables; S3b's text was not inline | Every block starts with the literal `<HEADER>` (SP/WT/EV + `cd`) and `mkdir -p "$EV/<STEP>"`. The S3b command block is fully inlined, including the `LINT-SAME`/`INVENTORY-SAME` checks. |
| 6c | MINOR | `killChromeTree(` counts depended on unspecified wiring | Wiring stated: `kill: killChromeTree` **by reference**, called only through `deps.kill(`. Counts: S6b = 3 (definition, F8, spawn timeout); S6c and S11 = 1 (definition). The signature `killChromeTree(pid, timeoutMs = 10_000): Promise<void>` is stated in 1.5. |
| 6d | MINOR | Wrong `mismatch` wording | Removed with the redesign. Section 10 R-5. |
| 6e | MINOR | 8.3 alias not runnable on E: | **Dropped and documented.** Re-checked from PowerShell: E: gives long names only (`%~snxI` → `Internal_Projects`), and C: has them (`C:\PROGRA~1`). An isolated TEMP must live under `$SP` on E:. L1s keeps the space-path case only. A5 drops the 8.3 variant. S10b item 10. |
| 6f | MINOR | Warden PIDs missing from `our-pids.txt` | S7 adds every warden PID from `$ISO/state/warden.json`. |
| 7 | MINOR | Existing close regressions not re-run | S7 block **R**: `verify-fr2-04-dialogs.mjs` (N11/N11b and all `close` cases) and the `verify-fr2-01` teardown case, under the preamble with an isolated `USERPROFILE`/`HOME`. Precheck that `os.homedir()` resolves under ISO and that the write targets are isolated; otherwise skip with a recorded reason. |
| 8 | MINOR | Behaviour change under-documented | The changelog gains `### Changed`: the ordering change, the longer `close`, the debug switch. It states "CLI exit codes are unchanged". The README `:287` sentence stays, because it is still true. |
| 9 | MINOR | Linux close path not executed with real Chrome | The redesign is gone, so the Linux kill path is 0.6.0's. Cleanup on Linux is still exercised only through fakes and WSL. 6.4 item 5 recommends a `workflow_dispatch` scenario-suite run with specific log checks (user-owned, not a gate). S10b item 7. |
| 10 | MINOR (scope) | Defer the redesign, ship ordering only, log the hazard unconditionally | **Adopted per the orchestrator's final decision.** S6b is now ordering only (kill awaited → clear state → bounded cleanup), with the same kill function and exit codes. Tests O1-O6 and mutants M-O1..O3. Self-heal is reordered the same way. S10b item 9 logs the pre-existing wrong-kill hazard **unconditionally**. Section 10 holds the redesign. |

**Orchestrator instructions, mapped to resolutions**

| instruction | resolution |
|---|---|
| Keep 0.6.0 kill semantics and exit codes | S6b design, S6b-4 (no exit statement changes), auditor check O |
| Order: kill → clear PID/state → cleanup (15 s) | S6b steps 1-3, O1/O2, L9 |
| Same reorder for recovery | S6b self-heal wiring, C3 |
| Keep GAP-315 cleanup with fail-closed in-use detection | S6a "In-use detection fails closed", T8 + M-e, A7 |
| Keep all 4 GAP-349 paths via seams | S6c P0/P1/P2(+P2x)/F8, G1-G6 |
| Remove the redesign-only parts | Removed: `chrome-owner.ts`, CDP close, the `closeBrowserAtEndpoint` export, the WS connect timeout, P1-P9 (old), P8 unverifiable, the `SystemRoot` override (L10), ownership-match tests, L8/L8b, `closePending`/`unverifiedChrome`, the 1.9 caps (moved into section 10 as measurements) |
| Non-vacuous spec typecheck with a planted error | 1.9 and S5-5 |
| Drop the 8.3 case with a reason | 1.1, L1s, A5, S10b 10 |
| Fix the grep self-match | 6a above |


---

## 12. Changes from review-5 (`plan-review-5.md`; verdict APPROVE, 10 MINOR) — revision 6

Every fix follows the reviewer's proposal; deviations are stated in the last column.

| # | finding | resolution in revision 6 | deviation from the proposal |
|---|---|---|---|
| 1 | The trailing `clearState()` in `cmdClose` runs after the slow cleanup and can delete a session a concurrent `nav` created | S6b wiring: trailing `clearState()` **removed from the chromePid branch** and kept only in the attached-session branch. New **O7**: the cleanup stub writes a new record, and the record survives. A source guard (in `close-session.spec.ts`, reading `cli.ts`) checks that no `clearState(` follows `await stopSpawnedChrome(` in cmdClose's chromePid branch. Mutant **M-O5** re-adds it, and the guard must fail. | none |
| 2 | `deps.now()` clock unstated (`Date.now` makes the deadline unbounded) | `now: () => performance.now()` is pinned in the default and in the `cli.ts` wiring (checked by the O6 guard). **O8** uses the real clock and asserts `deadlineAt - performance.now()` ∈ (14000, 15001]. Mutant **M-O4** (`Date.now`) fails O8/O6. S6c adds a grep: no `now: Date.now` anywhere in `packages/cli/src`. | none |
| 3 | The S11 gate cannot pass on the BLOCKED/revert path | New **S11 BLOCKED variant**: `killChromeTree(` count 5, system-binary grep 1 match, `git diff origin/master -- packages/cli/src` empty, 8c reduced to a plain nav+close plus the real-TEMP snapshot, matrix equal to S1, changelog "not included". The variant used is recorded in 6.3. | none |
| 4 | Section 5 compares the kill function against master (false REOPEN) | Section 5 O now compares against **the S5 merge commit**, except `taskkillExe()`. The taskkill args and the POSIX SIGKILL fallback must equal master's. The async form, cap and `windowsHide` are explicitly not findings. | none |
| 5 | GAP-349 P2 deletes without waiting for exit; G3 is non-deterministic on Linux | `discardSpawnedProfile` passes the **PID when a kill was issued** (P2/F8), so the bounded read-only exit wait runs. A new `isAlive` seam (S6a `removeSessionTempProfile` opts, plus `SpawnDeps`) drives both the exit wait and `ownerAlive`. **G3** injects `isAlive: () => false`. New **G3b** has a dying child (`isAlive` true for 300 ms), and the dir must still be removed after `isAlive` turns false. Mutant **M-G6** (no PID passed) fails G3b. S10b item 6 notes that P2 has no live trigger. | An injected liveness seam rather than a "guaranteed-dead PID": no PID value is guaranteed dead on Linux. |
| 6 | Debug seam in pure predicates would make X1 fail spuriously | S6a states that the seam logs **only in I/O paths**, never in `isAutoTempProfileDir`/`commandLinesReference`/`decideRemoval`. New **T6b** plus mutant **M-f**. | Chose the logging-location fix over editing the branch spec line, so branch test code stays as audited. |
| 7 | Evidence-commit policy unspecified | 0.3 policy: each step's commit adds `$EV/<STEP>` by name. S4's evidence goes in the orchestrator commit. S5's evidence goes in a separate `GAP-315 merge evidence` commit right after the merge. Untracked evidence at S11-1 is a FAIL. | none |
| 8a | Matrix template vs `apps/server`/`frontend` | Both special entries written literally (`test-apps-server.log`, `test-frontend.log`). | none |
| 8b | S11 items 6-8 lacked commands | Full command blocks for 6 (audits, inventory, pack to `$SP/S11-tmp-pack`, consumer install + `npm audit --json`) and 7 (`npm pack --dry-run --json` for 0.6.1 and `sutradhar@0.6.0`, plus a file-list diff script). 8a reuses the S3a probe. 8b is the new `sdk-waitfor.mjs` harness, spec'd. 8c reuses the S7 harness with `CASES=L1 ITER=1`; the harness creates the canary. | none |
| 8c | WSL probes: static import paths differ | Every probe loads the module via `TP_MODULE` + dynamic `import()`. Example command given. | none |
| 8d | Path checker root for WSL logs | S4: run `check-cleanup-paths` with **the WSL `PROBE_ROOT`** as root. Never use the Windows ISO for WSL logs. Require `cleanup-lines > 0`. | none |
| 8e | R1 comparison run unspecified | `git worktree add "$SP/S7-tmp-s5wt" <S5 sha>`, then frozen install, forced build, run under its own ISO, `git worktree remove` (only the step-created worktree). Runs only if R1 shows a non-close failure. | none |
| 8f | Lint aborts at the first failing task | `--continue` added to every `turbo run lint` (S1, S3b). | none |
| 8g | Typecheck could replay from cache | S11-4 uses `turbo run typecheck --force --concurrency=1`. | none |
| 8h | S6a file list omitted `spawn-chrome.ts` | Added. `killChromeTree` switches to `taskkillExe()` there. | none |
| 8i | Blocking set O1-O3 vs section 5 O1-O6 | Aligned to **O1-O8** everywhere (set B, S6b, S8, section 5, 6.3). G3b added to set B. | none |
| 9a | Hard-coded versions in the changelog and S3a-4 | S3a-4 now reads "exactly one fast-uri, ≥ 3.1.8". The changelog uses placeholders filled from `moved-keys.txt` and `dist-fast-uri.txt`. **S10-5** asserts no placeholder remains. | none |
| 9b | Session-start latency undocumented | `### Changed` gains a session-start bullet (sweep ≤ about 15 s, measured `<SWEEP_P50>`). S6a adds a `phase sweep ms=` debug line to measure it. | none |
| 9c | README "Status (0.6.0)" heading | Decision: the heading becomes "Status (0.6.1)", with one sentence added and the 0.6.0 paragraph kept. S10-2's grep now includes `Status (0.6.0)`. | none |
| 9d | A new advisory at S11 had no rule | S11-6 **new-advisory rule**: stop, record, re-plan from S3a. Never ship around it. | none |
| 9e | Publish location unspecified | 6.4 item 3: publish from the S11-gated commit in this worktree, or from a merge-commit checkout after re-running S11 items 2/3/6/7. | none |
| 10 | Per-AC false-pass analysis; timeouts above 20 min | 0.3: every step's `$EV/<STEP>/README.md` carries a per-AC false-pass analysis (a step without it is not done). Waits and polls are capped at ≤ 1200 s. The 2400 s forced builds and the 1800 s R1 run are a **recorded deviation**: they are single foreground commands with a hard timeout, not polls, and they log start and end times. | Recorded deviation instead of capping builds at 1200 s, because `--concurrency=1` forced builds have exceeded 20 min before (GAP-376). |

All other content is unchanged from revision 5.

---

## 13. Changes from review-6 (`plan-review-6.md`; verdict APPROVE, 5 MINOR) — revision 7

Every finding is resolved as the reviewer proposed. All other content is unchanged from revision 6.

| # | finding | resolution in revision 7 | sections changed |
|---|---|---|---|
| A | The O7 guard contradicted the correct `cmdClose` shape. "Attached-session branch" could be read as `if (!closeBlocked)`, which drops the clear on the legacy + dialog-open path. | S6b wiring now gives the **exact target shape**: `if (chromePid) { stopSpawnedChrome } else { if (!closeBlocked) {…} await clearState(); }`. Moving the clear into `if (!closeBlocked)` is explicitly forbidden. The O7 guard is restated as two brace-matched checks: (a) no `clearState(` in the chromePid block after `stopSpawnedChrome(`; (b) exactly one `clearState(` in `cmdClose`, inside the `else` and outside `if (!closeBlocked)`. New mutant **M-O6** (S6b-2 is now 6 mutants). New live **L12** (legacy state without `chromePid` + an open `confirm()`, then `close`: exit 0 and `state.json` absent; M-O6 must fail it). An **N11b state check** is added to R1, with L12 as the authority if N11b's state dir is not observable. | S6b (wiring, O7, mutants, S6b-2), S7 (L12, R1, AC), section 5 O, 6.3 |
| B | The BLOCKED gate variant covered only S8-BLOCKED, and the S8-BLOCKED evidence was never committed | The variant now applies **whenever GAP-315 did not ship** (S4 BLOCKED or S8 BLOCKED). Gating rule 1: on S4 BLOCKED, `decisions.md` plus `$EV/S4` go in the pre-merge evidence commit. S8 revert procedure: new step 6 commits `$EV/S8`, the row changes and `decisions.md` as `GAP-315: post-merge audit BLOCKED, evidence`; step 7 runs S11 in the BLOCKED variant. | Section 2 rule 1, S8 revert procedure, S11 BLOCKED variant |
| C | S10-5 could not see the lowercase `<p50>` | The placeholder is renamed `<CLOSE_P50>`. S10-5 is now **case-insensitive** and matches **exactly the placeholder names** (`grep -niE "<(fast_uri\|qs\|hono\|hono_node\|ip_address\|close_p50\|sweep_p50\|p50)>"`), so the changelog's legitimate `<defs>`/`<ref>`/`<state>` never match. A negative control on the saved template must count 7 matches. `<SWEEP_P50>` is defined as the p50 of `phase sweep ms=` alone, with no double count. | S10 changelog template, placeholder list, S10-5 |
| D | The G-test wrapper could drop the injected `isAlive` | The wrapper is specified as forwarding `{...opts, tmpRoot, scan}` and recording the received `opts`. G3 asserts `calls[0].opts.isAlive` **is** the fake and that the fake was **called**. New mutants **M-G7** (the product omits `isAlive`) and **M-G8** (the wrapper builds fresh opts) both fail G3. S6c-2 is now 9 mutants. | S6c tests, mutants, S6c-2, 6.3 |
| E | Stale counts and cross-references | 6.3 GAP-349 line → "G1-G6 + G3b + 9 mutants". 1.1 and S1 now say "reviews 1-6 exist as of revision 7, plus any later round". S6c says **keep** the `killChromeTree` import (used by `kill: killChromeTree`). Section 5 O → "M-O1..M-O6" plus L12. | 1.1, S1, S6c, section 5, 6.3 |
