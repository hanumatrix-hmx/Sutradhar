# S1 evidence - baseline, fixtures, spikes, plan commit (release 0.6.2)

Run 2026-10-04 on `release/0.6.2` @ 3f0ba55 by the builder (Claude Sonnet 5.5). Location check printed the worktree toplevel
and `release/0.6.2`; `git status --porcelain` printed exactly `?? .ai/loop/release-0.6.2/`; `df -h /e` 49G free.

| AC | result | evidence |
|---|---|---|
| S1-1 location + only expected untracked dir | PASS | step-1 output above (toplevel, branch, HEAD 3f0ba55, `?? .ai/loop/release-0.6.2/`) |
| S1-2 self-tests | PASS | `guard-selftest.txt` neg-exit=97 / pos-exit=0 (+ `[iso-guard] tmpdir=...scratchpad/r062/s1-tmp`) / vitest-neg-exit=97; `pathcheck-selftest.txt` pos 0, neg 1 with `OUTSIDE-ISO`, empty 1; `iso-tools-hash-check.txt` HASH-EQUAL vs 0.6.1 `iso-tools.sha256` |
| S1-3 NEG061 pin | PASS | `neg061.sha256` (cli-bin 9858726a..., index ddaaa001..., mcp-cli 55317c66..., version 0.6.1); `neg061-absent-names.txt`: all 5 names 0, `async readPageText(tab)` in index.js = 1 |
| S1-4 ISO names free; spectsc | PASS | `iso-names-free.txt` 18/18 free; `spectsc.sha256` |
| S1-5 matrix | PASS | `test-totals.txt`: 20 logs, each with `[iso-guard]` lines (32-52), 0 `ISOLATION GUARD`, exit=0; totals equal to plan 1.1 (agent 56, apps-server 28, browser 938, capability 6, capability-runtime 505, cli 360+2 skipped, config 6, contracts 7, dev-runtime 4, events 6, frontend 29, llm 11, mcp-server 156, memory 8, observability 13, sdk 16, storage 7, sutradhar 64, utils 20, workflow 5). `matrix-run.out`: 19:44:36 - 19:46:15 |
| S1-6 spec typecheck + lint | PASS | `spec-tsc-baseline.txt`: 7 `error TS`, 0 TS6059; `spec-tsc-planted.txt`: planted TS2322 (`planted.ts(1,7)`); `lint-summary.txt`: `Tasks: 31 successful, 32 total`, 1 failure `@sutradhar/mcp-server#lint` (6 pre-existing no-explicit-any, same as 0.6.1 baseline) |
| S1-7 fixture self-test | PASS | `fixtures-selftest.txt`: SELFTEST OK (21 checks incl. a 404 negative control); `fixtures.sha256` |
| S1-8 spikes | PASS | `spikes.md`: SP-1 selects the **dialog-history** branch (reload/goBack under dismiss reject `Navigation timeout of 30000 ms exceeded` after ~30 s, a dismissed beforeunload is in the dialog history; accept-policy validity run resolves with an accepted dialog); SP-2: headless PDF loads (`application/pdf`), no fallback needed |
| 8b tool-count baseline | PASS | `tool-count.txt`: `tools_list=73 expected_browser_tools=72` (the two differ by 1 today: tools/list has one non-`browser.*` entry); probe `mcp-probe-head.out.json`, exit 0, all 10 checks PASS with EXPECT_VERSION=0.6.1 EXPECT_TOOLS=73 |
| S1-9 clean tree after commit | see builder report (`git status --short`) | |

## Mutants (`mutants.txt`)
- Guard without path normalisation (0.6.1 `assert-nonorm.mjs`) under a correct isolated TEMP: exit 97, so the `pos-exit=0` AC fails: caught.
- Checker that ignores quoted `path="..."` (0.6.1 `check-nonquoted.mjs`) on `neg.log`: exit 0 `outside-iso=0` (real checker 1): `neg-exit=1` AC fails: caught.

## Deviations / notes
- `tsconfig.neg.json` (copied unchanged, as the plan requires) extends and includes files under `$SP/r5/` (its `planted.ts`), so the
  planted-control run reads `$SP/r5` (read-only) in addition to the `$R/spectsc` copy. No write to r5.
- The matrix was driven by `$R/S1/matrix.sh` in one foreground call (as in 0.6.1), not 20 tool calls.
- `fixtures/selftest.mjs` ends with `process.exitCode` rather than `process.exit()` (the latter tripped a libuv assertion on Windows after closing sockets).
- Real-TEMP snapshot (`realtemp-before.txt` 5 dirs, `realtemp-after.txt` 4 dirs): `sutradhar-cli-1791123566240-fRTLjR` disappeared
  between the snapshots. Not attributable to this step: S1 ran no CLI (only in-process runtime + the MCP probe, whose stderr shows
  `[iso-guard] tmpdir=...scratchpad/s2t`), the dir was created ~47 s before the spike by another session's CLI and is a normal
  CLI-lifecycle cleanup. Recorded as external. The path-log checker is N/A for S1 (0 `[cleanup]` lines because no CLI ran; checker
  exits 1 on an empty log by design) - first applicable at S3a.
- 0.6.1 dists equal HEAD dists (hashes identical to NEG061), so the spikes' "HEAD build" is the unchanged tree; no forced build in S1.

## False-pass analysis
- S1-2 `neg-exit=97` could come from a guard that always aborts: paired `pos-exit=0` with a printed `[iso-guard]` line under the same file + mutant A.
- S1-3 absent names could be a grep of the wrong dir: the same files contain `async readPageText(tab)` (count 1) and the sha256 values match the pinned published hashes.
- S1-5 numbers could come from a stale/other run: every log has `[iso-guard] ... r062/s1-tmp` lines and `exit=0` appended by the loop after that command; times 19:44-19:46 in `matrix-run.out`.
- S1-6 baseline 7 could include a wrong tsconfig: planted control produces the extra TS2322 from `planted.ts`, so the config really typechecks sources.
- S1-7 selftest could pass vacuously: 404 control + content checks (line count, surrogate indices) - first run caught a real assertion bug (41 vs 42 per line) and was fixed.
- S1-8 SP-1 "dismiss" could be an unarmed page: the `accept` run on the same fixture shows an accepted dialog, and the armed state is read back (`function`).
- 8b probe could pass against a stale mcp-cli: hashes equal the pinned 0.6.1 build, and `serverInfo.version`/`toolCount` checks are asserted by the probe itself.
