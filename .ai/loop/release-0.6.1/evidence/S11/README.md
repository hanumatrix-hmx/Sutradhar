# S11 - final release gate (NORMAL variant: GAP-315/349 + close ordering shipped; S8b ACCEPT)

Variant: **normal** (not BLOCKED). HEAD under test: the S10b commit `05a2cf1` (tree clean before the gate; evidence commits follow).
Gate fixed nothing: no product, test or doc file was changed by S11. Everything ran in Git Bash under the isolation preamble where it can
run our code (matrix ISO `$SP/S11-tmp`; the S7 harness ISO `$SP/S11`, see deviation 2); `[iso-guard]` lines are present in every test log, 0 `ISOLATION GUARD`.
Nothing was pushed, published or PR'd. Every ISO dir was deleted afterwards with the guarded form after a link scan (`iso-cleanup.txt`).

## Checklist (plan 6.3 / S11)
| # | item | result | evidence file | key output |
|---|---|---|---|---|
| 1 | location, clean tree, >= 10 GB, nothing pushed | PASS | `item1-location-clean-disk.txt` | toplevel = worktree, branch `release/0.6.1`, `df`: 49G free, `origin/release/0.6.1` absent, guard tools sha equal to S1. (The one untracked path in that listing is the evidence file the same command was creating; status was empty right after the S10b commit.) |
| 2 | `pnpm install --frozen-lockfile` | PASS | `item2-install.txt` | `Lockfile is up to date ... Already up to date`, exit 0, no tree change |
| 3a | forced build, 0 cached, new dist sha | PASS | `item3-build.txt`, `build-full.log` | `Tasks: 20 successful, 20 total`, `Cached: 0 cached, 20 total`, 09:17:01-09:17:41; dist mtimes 08:07 -> 09:17; shas below |
| 3b | dist version checks, killChromeTree, system-binary grep | PASS | `item3-dist-checks.txt` | index.js `SUTRADHAR_VERSION = "0.6.1"` x1; mcp-cli.js `MCP_SERVER_VERSION = "0.6.1"`; cli-bin.js no `0.6.[01]` (0); no `= "0.6.0"` in any bundle and 0 stray `0.6.0`; `killChromeTree(` = 1 (definition); bare system binary outside `system-binaries.ts` = 0 (positive control without the exclusion = 2); seams leak 0/0 into index.js and mcp-cli.js |
| 4a | typecheck all packages, forced | PASS | `item4-typecheck.txt`, `item4-typecheck-full.log` | `Tasks: 34 successful, 34 total`, `Cached: 0 cached, 34 total`, 0 `error TS`, exit 0 |
| 4b | spec typecheck non-vacuous | PASS | `item4-spec-typecheck.txt`, `item4-spec-tsc.txt` | exactly the 7 baseline errors (dialog-cli x2, direct-cdp-broker x1, session-flow x4), 0 TS6059, 0 errors in the 6 new/changed specs, planted control `planted.ts(1,7): error TS2322` |
| 4c | lint | PASS (1 known pre-existing failure, nothing new) | `item4-lint-summary.txt`, `item4-lint-compare.txt` | `Tasks: 31 successful, 32 total`, `Failed: @sutradhar/mcp-server#lint`: 6 x `no-explicit-any` in `session-resolution.ts` (untouched by 0.6.1), `LINT-SAME` vs S1 baseline (error/warning lines identical), 32 lint tasks = S1 |
| 5 | full test matrix (20 entries, incl. direct mcp-server and dev-runtime) | PASS | `item5-test-totals.txt`, `test-*.log` | all 20 `exit=0`, guard lines 32-52 each, 0 `ISOLATION GUARD`; totals = S1 for 19 entries; cli 243 -> **360 passed, 2 skipped** (21 files; = S8b: +117 from the GAP-315/349/close-order specs); mcp-server 156 (names `tools.spec.ts`), dev-runtime 4, sutradhar 64 (api.spec 0.6.1) |
| 5b | path-log check on the cli log + negative control | PASS | `item5-pathcheck.txt` | `cleanup-lines=395 outside-iso=0` exit 0; negative control (S1 neg log) `outside-iso=1` exit 1 |
| 6a | `audit --prod` = 0, inventory = 0 | PASS | `item6-audit.txt`, `audit-*.json`, `bundle-inventory.txt` | prod: 0 advisories (0/0/0/0/0), `totalDependencies` 160, no error; full: 6 dev-only (vitest critical, vite x3, esbuild, braces), 518 deps; `shipped advisories: 0`, mcp-cli.js inlines `fast-uri@3.1.8`; negative control (fabricated fast-uri@3.1.8 advisory) -> `shipped advisories: 1` |
| 6b | real tarball + consumer install | PASS | `item6-pack.txt`, `item6-consumer.txt`, `consumer-audit.json` | `sutradhar-0.6.1.tgz` (15 files), consumer prints `0.6.1`, `npm audit` 0 vulnerabilities (no consumer-rule exceptions), installed dist shas == local dist shas |
| 7 | `npm pack --dry-run --ignore-scripts` | PASS | `item7-dry-pack.txt`, `pack-diff.txt` | `filename: sutradhar-0.6.1.tgz`, 15 files (AGENT_SETUP, LICENSE, README, package.json, dist/{browser,errors,index,page}.d.ts(+.map), index.js, cli-bin.js, mcp-cli.js); vs published 0.6.0: `added: []`, `removed: []`, no mutant file |
| 8a | S3a MCP probe, unmodified (sha `582b9f51...`) | PASS | `item8a-mcp-probe.txt`, `mcp/` | `EXPECT_VERSION=0.6.1`: serverInfo 0.6.1, 73 tools, `hasWaitFor` PASS, launch real browser, navigate to its own server (server saw the request), `shutdown_all`, child exited code 0, no leftover Chrome; negative (`EXPECT_VERSION=0.6.0`) exit 1 (`version` FAIL); real TEMP identical |
| 8b | real headless SDK `page.waitFor` from the built bundle | PASS (harness redesigned, deviation 1) | `item8b-sdk-waitfor.txt`, `sdk-waitfor.mjs`, `sdk-waitfor.out.txt`, `v1-vacuous-*` | bundle `SUTRADHAR_VERSION` 0.6.1; `waitFor(READY-0.6.1)` took 544 ms, result `satisfiedAfterMs=543 polls=6`; `waitFor(NEVER-THERE,1000)` -> `ActionFailedError` after 1008 ms; after `close()` 0 Chrome referencing the ISO dir (positive control found 9 while open); negative control (`S11_PRE_ARM=1`) exit 1 with both >= 400 ms checks FAIL |
| 8c | S7 harness unmodified (sha `1b7091a9...`), `CASES=L1 ITER=1` | PASS | `item8c-*.txt`, `s7rerun/` | `ALL PASS`; nav exit 0 / close exit 0; dir exists after nav and is gone after close; Chrome pid gone; (ii) dirname(userDataDir) == ISO; order `phase kill` (idx 194) -> `state-cleared` (222) -> `phase cleanup` (1231); state.json absent; no new `sutradhar-cli-*` in the isolated TEMP (`before=[] after=[]`); canary swept by the first session start; phases kill 341 ms / cleanup 597 ms / scan max 578 ms (bounds 10.5 s / 15.5 s / 4 s) |
| 8c-x | path-log check on all S11 CLI logs + controls | PASS | `item8c-pathcheck.txt` | S7-rerun logs `cleanup-lines=15 outside-iso=0` exit 0; wrong-root control `outside-iso=9` exit 1; S1 neg log exit 1 |
| 8d | real TEMP `sutradhar-cli-*` before == after | PASS | `realtemp-before.txt`, `realtemp-after.txt`, `item-final-checks.txt` | 45 == 45, byte-identical name lists; the same 45 names as the S8b end snapshot; per-run before/after pairs identical (`mcp/`, `sdk-realtemp-*`, `s7rerun/`) |
| 9a | changelog placeholder check (case-insensitive) | PASS | `item-final-checks.txt` | grep prints nothing (exit 1); same pattern prints 7 on the saved template; `check-s10.mjs` all PASS |
| 9b | commit gate evidence, `check-release-ready` OK, tree clean | see `item9-check-release-ready.txt` (second evidence commit) and the final report | | |
| - | leftover processes | PASS (none) | `leftover-processes.txt`, `item-final-checks.txt` | CIM query for any command line referencing the S11 ISO roots: `hits=[]` (positive control with a dummy argv finds it first); all PIDs the S11 runs created (harness, page server, Chrome, MCP child) confirmed gone |

dist sha256 (built from this tree): `index.js` `ddaaa00191710fc772db1c93a14e469381f0a40020de930ffae198834fd8db19`, `cli-bin.js`
`9858726a291e844e1f84089b18310e90379140e2dfabf7b2fda80eb550b5c59b`, `mcp-cli.js` `55317c669c07bdb12812a787795470e6c988ae6b6f61921c4ebc968417ed8e2b`.
`cli-bin.js` is byte-identical to the bundle that S8b audited and S7/S8b ran (`9858726a...`, no version string inside), so the live-tested CLI is the shipped CLI.

## Deviations (none changes a verdict; each is explained)
1. **8b harness redesigned.** The plan's page adds the text 500 ms after load and expects `waitFor` to take >= 400 ms. Run literally
   (v1, kept as `v1-vacuous-*`), the check passed vacuously: the SDK's `goto` itself takes ~600 ms, so `waitFor` resolved in 3 ms (`satisfiedAfterMs=2`), and the
   negative control (text at once) passed too. v2 arms the page 500 ms AFTER `waitFor` is called (server-side flag polled by the page every 50 ms) and asserts the
   duration around the call, the result's own `satisfiedAfterMs`, and `t1 >= armedAt`; its negative control fails as required.
2. **8c ISO is `$SP/S11`, not `$SP/S11-tmp`.** `$SP` is 160 chars; with `S11-tmp` the 34-char CLI profile name pushes `--user-data-dir` to 206 > 200 (P5, same reason as S7's `S7`).
   The harness asserts the length (199/199). The matrix, probe and SDK run use `$SP/S11-tmp` as the plan says.
3. **`audit --prod` `totalDependencies` is 160, not ~518.** 518 is the full audit; the prod audit was 160 at S1 and S3a as well. Counts are consistent, advisories 0.
4. **Spec typecheck comparison** needed CR and path-prefix normalisation (baseline produced from the repo root); recorded with a mutant of the comparison.
5. **P7 self-match** in the first leftover query (4 `bash.exe`: my own launching shells, because the needle text was in the command). Re-run with the needle assembled from pieces: `hits=[]`, and the positive control finds a dummy and loses it after it is killed.
6. **Two evidence commits for S11** (the gate evidence, then `item9-check-release-ready.txt`): `check-release-ready` needs a clean tree, so its own output cannot be inside the commit it validates.

## False-pass analysis
| item | way it could pass while broken | what rules it out (live query, this run) |
|---|---|---|
| 1 clean tree | status read before an edit, or `git status` hiding untracked files | `git ls-files --others --exclude-standard` listed (only the evidence file being written); `check-release-ready` re-checks the tree at the end |
| 3 forced build | cached turbo replay stands in for a build | `Cached: 0 cached, 20 total` and `cache bypass, force executing` per task; dist mtimes moved 08:07 -> 09:17 and index.js / mcp-cli.js shas changed (cli-bin.js unchanged = same source, expected) |
| 3 version greps | grep of a stale dist or of the wrong string | greps read the freshly built files; `0.6.1` appears on the exact `SUTRADHAR_VERSION` / `MCP_SERVER_VERSION` lines (`grep -n` output); a consumer install of the packed tarball prints 0.6.1 and its dist shas equal the local ones |
| 3 system-binary grep = 0 | pattern matches nothing at all | the same pattern without the exclusion prints 2 (`system-binaries.ts` itself) |
| 4 typecheck | cached success | `--force`, 34 x `cache bypass, force executing`, `Cached: 0` |
| 4 spec typecheck | vacuous config (only TS6059) | 7 real semantic errors reproduced exactly, 0 TS6059, planted error reported as TS2322, comparison mutant (one baseline line dropped) detected |
| 4 lint | a new failure hidden behind the one known failure | `LINT-SAME` against the S1 log (all error/warning lines), 32 = 32 tasks, only `mcp-server` failed |
| 5 matrix | stale logs, or a vacuous run | logs regenerated 09:20-09:22 under the guard (32-52 `[iso-guard]` lines each); counts equal S1/S8b; cli log shows 395 `[cleanup]` lines, `outside-iso=0`, and the negative control exits 1 |
| 6 audits | offline/error audit looks like 0 | `error=null`, full audit still reports 6 real advisories and 518 deps, prod 160 deps; inventory negative control reports 1 for a fabricated advisory; the inventory reads the esbuild metafile (shipped graph), not the lockfile |
| 6 consumer | install from a cache, not the tarball | installed from the local `sutradhar-0.6.1.tgz`; installed dist shas equal the local dist shas; `npm ls` shows `sutradhar@0.6.1` |
| 7 pack | file list from the working tree rather than the tarball | `--dry-run` lists the packed files; the real `npm pack` earlier produced the same 15-file list and shasum `886d098b...` |
| 8a MCP probe | probe edited, or wrong server | sha `582b9f51...` equal to S3a's; the probe logs the absolute `dist/mcp-cli.js` path it spawned; `EXPECT_VERSION=0.6.0` run fails (`version: FAIL`), so the version check can fail |
| 8b SDK waitFor | `waitFor` returns at once (the v1 harness did exactly this) | v2 asserts the call duration, `satisfiedAfterMs` and `t1 >= armedAt`; the pre-armed negative control fails both; attribution query has a positive control (9 Chrome processes while open) before the final 0 |
| 8c S7 harness | edited harness or wrong CLI | sha `1b7091a9...` re-checked; `cli-bin.js` sha `9858726a...` printed before and inside the harness log; order indexes come from the raw close log, not memory |
| 8d real TEMP | another session added then removed a dir in between | name lists byte-identical at start and end (45 == 45), same 45 names as S8b's end list; every `[cleanup]` path of every log is under our own ISO (checker + wrong-root controls) |
| leftovers | CIM query vacuous | positive control with a dummy argv finds it (and not after its kill); first attempt matched our own shell (P7) and was re-run with the needle built from pieces |
| changelog placeholders | pattern can never match | prints 7 on the saved template |
| mode bits | a shell script committed as 100644 | `git ls-files -s '*.sh'` under the S8b evidence shows 100755 for all 6 scripts (set in the S8b commit); this gate adds no `.sh` file |

## Not verified / limits
- macOS and real Chrome on Linux were not run (GAP-385). CI (ubuntu, Node 20: frozen install, typecheck, build, turbo test) has not run on this branch: it must be green on the PR before publishing (plan 6.4).
- The local matrix is not `turbo run test`; mcp-server and dev-runtime have no `test` script (GAP-379), so they were run directly.
- Live Windows + Node 25 + headless Chrome only for 8b/8c; Node 18/20/22 and WSL were covered by S4/S8/S8b.
- The recommended `scenario-suite.yml` `workflow_dispatch` (6.4 item 5) is user-owned and not done.
