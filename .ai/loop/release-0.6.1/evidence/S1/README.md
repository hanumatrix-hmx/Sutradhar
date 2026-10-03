# S1 evidence - baseline, isolation guard, path checker, plan commit

Run 2026-10-04 on `release/0.6.1` @ 7ff6cbd (location check printed the worktree toplevel and `release/0.6.1`; `df -h /e` 50G free).
Test matrix was driven by `$SP/matrix.sh S1` (a loop over the 20 fixed entries; each entry is exactly the plan's
per-entry command: `TEMP/TMP/TMPDIR/NODE_OPTIONS(--import assert-tmp.mjs)/SUTRADHAR_CLI_DEBUG_CLEANUP=1 timeout 900 vitest run ...`).
The one deviation from the letter of the plan: the 20 invocations were issued by that loop script in one background run
instead of 20 separate tool calls, and each log has an `exit=<code>` line appended by the script.

## AC results

| AC | result | evidence |
|---|---|---|
| S1-1 guard self-test | PASS | `guard-selftest.txt`: `neg-exit=97` (stderr line seen on the terminal: `ISOLATION GUARD: os.tmpdir()=e:/ai-cache/tmp is not under ...scratchpad; aborting pid 71152`), `pos-exit=0` with `[iso-guard] tmpdir=...scratchpad/s1-tmp`, `vitest-neg-exit=97` (cli vitest under real TEMP aborted before any test). `iso-tools.sha256`: assert-tmp.mjs `dff42280...835e6` (same hash the planning-time file had), check-cleanup-paths.mjs `bde6b533...5e`. |
| S1-2 path checker self-test | PASS | `pathcheck-selftest.txt`: `pos-exit=0`, `neg-exit=1` with `OUTSIDE-ISO e:/ai-cache/tmp/sutradhar-cli-1790000000000 ...`, `empty-exit=1`. |
| S1-3 inventory | PASS | `bundle-inventory.txt`: fast-uri@3.1.5 only on the `dist/mcp-cli.js` line; `shipped advisories: 6` (5 high + 1 moderate GHSA); no express/qs/hono/ip-address in any bundle line. `existing-dist-markers.txt` lists the same 12 `// ../../node_modules/.pnpm/...` markers for mcp-cli.js incl. `fast-uri@3.1.5` (dist mtimes 2026-10-04 00:42, before S1). |
| S1-4 test matrix | PASS | `test-totals.txt`: 20 logs, every one has `[iso-guard]` lines (32-52) and 0 `ISOLATION GUARD`; every `Tests` line non-zero and fully passed; `exit=0` for all 20; `mcp-server` log names `tools.spec.ts` (count 1). Totals: agent 56, apps-server 28, browser 938, capability-runtime 505, capability 6, cli 243, config 6, contracts 7, dev-runtime 4, events 6, frontend 29, llm 11, mcp-server 156, memory 8, observability 13, sdk 16, storage 7, sutradhar 64, utils 20, workflow 5. Pre-existing test failures: none. |
| S1-5 audit sanity | PASS | `audit-sanity.txt`: `totalDependencies=518`, `critical=1` = `vitest:critical:GHSA-5xrq-8626-4rwp`; prod audit 16 advisories, modules `fast-uri,hono,ip-address,qs`. `audit-full.json` metadata: 16 moderate, 17 high, 1 critical. |
| S1-6 clean tree after commit | see the commit step output (recorded by the builder report) | `git status --porcelain` and `git ls-files .ai/loop/release-0.6.1` are shown in the report. |

Lint baseline (`lint.log`, `lint-summary.txt`): `Tasks: 31 successful, 32 total`, 1 pre-existing failure,
`@sutradhar/mcp-server#lint` (6 x `@typescript-eslint/no-explicit-any` errors in `session-resolution.ts` lines 138/146/152/166).
This is the baseline S3b's `LINT-SAME` check compares against (31/32 tasks, same error lines).

## Mutants (`mutants.txt`)
- A: guard that does not normalise paths (`os.tmpdir()` raw, backslashes/case) with a correct isolated TEMP: exit 97, so the
  `pos-exit=0` AC fails => caught.
- B: checker that ignores quoted `path="..."` values, run on `neg.log`: exits 0 with `outside-iso=0` (real checker: 1),
  so `neg-exit=1` AC fails => caught.

## False-pass analysis
- S1-1: `neg-exit=97` could come from a guard that always fails (or from node failing to load the file). Ruled out by the
  paired positive run in the same file: `pos-exit=0` plus the printed `[iso-guard] tmpdir=...scratchpad/s1-tmp` line, with the
  same guard file/hash; and mutant A shows the pos check can fail.
- S1-2: `neg-exit=1` could be the "no lines" exit rather than the outside-path detection. Ruled out: the neg output prints
  `cleanup-lines=1 outside-iso=1` and an `OUTSIDE-ISO` line, and the `empty` case is separately exit 1 with `cleanup-lines=0`.
  Mutant B proves the check is sensitive to quote handling.
- S1-3: the inventory could pass by reading a stale metafile/dist. It builds fresh with esbuild (`write:false`) from sources
  and the dist markers are an independent second source (`existing-dist-markers.txt`, grep of the shipped file); both agree.
- S1-4: a log could contain passing numbers from a different run, or a vitest started with the real TEMP. Each log carries
  the `[iso-guard] tmpdir=...scratchpad/s1-tmp` lines (the guard runs in every worker) and `exit=0` appended by the loop script
  after that very command; logs were created by this run (timestamps 04:33-04:35, listed in `matrix-run.out`).
- S1-5: the audit JSON could be an empty/error response. Sanity: `totalDependencies=518` and the known vitest critical
  advisory is present; prod count 16 matches the plan.
- S1-6: `git status` empty could hide ignored files. The commit adds paths by name; ignored `dist/` (build products of the
  lint run) is intentionally untracked.
