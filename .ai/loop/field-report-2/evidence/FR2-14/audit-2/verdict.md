# FR2-14 AUDIT-2 verdict (after fix-1): REOPEN (minor-only)

Auditor: independent. Worktree `project-understanding-696041`, branch `claude/fr2-14-project-config`, HEAD `6acaff0`
(checked with `git rev-parse --show-toplevel` / `git branch --show-current` / `git rev-parse HEAD`). Product code was edited
only by my mutants, each restored byte-identically (`mutant-files-sha-after-check.txt`: 8/8 OK). After the mutants all dist
was deleted and rebuilt with force (`build-2-final.log`: 19 + 9 tasks, 0 cached). Nothing committed or pushed. All probes are
in `probes/`, all outputs in this directory. I formed every verdict below before reading `fix-1/` and the fix-1 section of
`run-1/false-pass-analysis.md`.

## Why REOPEN

The major finding is fixed. F1, the conditional refusal, holds against everything I threw at it, on every surface:
- 290/290 function-level attack cells;
- live CLI, package and bundle;
- live MCP, package and bundle;
- live SDK;
- 12/12 F1-conditional mutants caught by at least one layer.

A refused discovered root is never used, merged or used as a fallback. Precedence regenerated with my own seeded oracle passes: 338/338 at function level, and 96/96 x 2 CLI builds live. No regressions against master.

The item still fails audit because two audit-1 fixes are incomplete, and the docs now make exact claims that are false:
- **N1:** the F4 echo cap is bypassed by `~user` entries. They are uncapped and multi-line.
- **N2:** the F3 home boundary is bypassed by a link above home that points into home.

The fix-1 unit suites also miss two F1 attack shapes (N3), and GAP-350 misdescribes MCP behaviour (N4). All four are minor and small to fix. This is the second failed audit, so CLAUDE.md escalation applies to the builder (see "Root cause" below).

## Findings

| # | Severity | One-line repro | Required fix |
|---|---|---|---|
| N1 | minor (F4 false-pass) | `{"downloadDir":"~evil<LF>Note: using nothing. All good.<LF>SECRET=hunter2"}` -> the error prints 3 raw lines. `"~"+20 KB` -> 20,335-char message. Same for `allowedDownloadRoots[i]` and `allowedUploadRoots[i]` (`f4-tilde-multiline.txt`, `fixes-fn.json` F4_*TildeUser). The docs say every echo is single-line and capped at 64. | `clip()` the entry in the `toAbs` catch of project-config.ts (it forwards resolveConfigPath's raw `"<entry>": ~user is not supported`). Add unit cases. |
| N2 | minor (F3 incomplete) | `HOME=<S>/top/home`, `<S>/top/.sutradhar.json`, cwd `<S>/top/jn` (junction OR dir symlink -> `home/p`) -> the file ABOVE home is loaded. Live: `sutradhar doctor` prints `Config: <S>/top/.sutradhar.json`, `allowedDomains=config` (`f3-reverse.txt`). | When the canonical cwd is inside home, walk the canonical path (or stop when the literal walk leaves home). Add a unit test. Or narrow the spec D3/doc claim. |
| N3 | minor (test gap on the F1 surface) | Mutant B1 (a blank or `;;` env counts as set, and the FILE roots are used) and B10 (an upload-roots env var skips the download refusal) pass all 848 unit tests. Only my probe and the live rows catch them. | Add refused-file x {`""`, `"   "`, `";;"`, upload-env-only} cells to override-matrix.spec.ts. |
| N4 | minor (docs; behaviour is pre-existing) | MCP `browser.launch {viewport:{width:1e9,height:1e9}}` -> isError "Chrome may not be installed/found", and 8 chrome.exe are held until `shutdown_all`. Identical on master (`ab-mcp-launch-viewport-arg.txt`). GAP-350 claims the call argument is treated as an absent layer. | Correct GAP-350, or bound the zod schema 1..10000000. |
| N5 | info | `--viewport 10000000x10000000` (the advertised maximum) -> exit 1 "No browser session", and Chrome dies. No leak. | Optional: document it as a protocol limit. |
| N6 | info, pre-existing | `createSutradharServer({allowedDomains: ''/false/0})` is unrestricted and ignores env and the file. Identical on master (`ab-odd-options.txt`). | Optional. |
| N7 | info, pre-existing | The docs say doctor/close/profile/dialog "never load the file". doctor loads it and prints it. It is only never blocked by it. | Wording. |
| N8 | info | A refused discovered root that is overridden by env is silent: the MCP banner only says "config: loaded". | Optional warning. |
| N9 | info, environment | verify-fr2-04 gives 97/4/2 on HEAD and on master, with the same 4 cases. The builder had 111/0/2 earlier. | None for FR2-14. |

## F1 attack surface (`probes/f1-attack.mjs` + live harnesses)

Six hostile discovered shapes: `../outside`, a second out-of-tree root, `.git/hooks`, a mixed file, `C:/Windows/Temp`, and a junction out. For each shape:

- **Env set but unusable.** All refused, with the refusal or a parse error, on both CLI and MCP compositions: `""`, `"   "`, `";;"`, `" ; ; "`, `0`, `false`, `[]`, `null`, relative, `~nobody`.
- **Env usable.** The value is used exactly, and the file roots are never added: a nonexistent absolute path, the parent of the hostile root, an absolute dir.
- **Option.** `[]`, `null`, `undefined`, `[null]` and a string are refused. `[abs]` wins, also over env.
- **Higher layer sets only uploads.** An env or option that sets only upload roots -> refused.
- **Mixed file.** Env downloads plus the file's uploads -> downloads are exactly env, uploads are the file's.
- **CLI `download <ref> <dir>`.**
  - With `<dir>` = the hostile dir, or any dir: roots = default + `<dir>`, never the file root.
  - Without `<dir>` -> refused.
  - Other verbs in the same session are still refused.
- **Explicit load** (`SUTRADHAR_CONFIG`, SDK `configFile`): no refusal. It is used when alone, env still beats it, and it is not announced.

Results:

| Run | Result |
|---|---|
| Function level | 290/290 (re-run on the final build: 290/290) |
| Live CLI | 14/14 package, 14/14 bundle, 14/14 final build |
| Live MCP | 7/7 x 2 (fatal before Chrome, 0 chrome.exe; env and explicit downloads sha-verified) |
| Live SDK | 6/6 |

Hostile spellings with no higher layer: I re-ran audit-1's loader probes. The adapter changes ONE line: the loaded config goes through `resolveFsRoots`. Over 170 cases there are 3 verdict changes, all intended: vpHuge (F8), the F3 junction case, and a UNC path-normalisation-only difference. All 67 DL/ADR spellings behave identically (50 refused, 17 accepted inside the tree or explicit). `GIT~1` on C: is refused.

## Precedence matrix (`probes/prec-gen.mjs`, seed 0x5eed2a14)

**Function level: 338/338.** The kinds at each layer are:

| Layer | Kinds |
|---|---|
| CLI flag (via the real parseArgs) | value, `0xH`, max+1 (both are errors) |
| CLI env | value, `""`, blank, `"0"` |
| CLI state | value, malformed, null |
| MCP option | value, null, undefined, `[]`, 0 |
| MCP env | value, `""`, blank, `"0"` |
| File | value, idle 0 |

The run also covers:
- the MCP viewport via the registered `browser.launch` handler;
- file `null`/`""`/`0`/`false`/`[]`/`{}` for all 7 keys -> every one is a load error, except `idleTimeoutMs: 0`. So `allowedDomains: null` in the file fails closed, never "unset -> unrestricted".

**Live, observed through:** Host log, innerWidth beacon, `prompt()` beacon, file plus sha256 of the served bytes, change beacon, stderr Note, and chrome.exe by PID.

| Surface | Result |
|---|---|
| CLI | 96/96 package + 96/96 bundle (16 subsets x 6) |
| MCP | 27/28 per build. The miss is `[config].idle` under a 4-way parallel load. The isolated re-test passed 4/4: reaped at ~30 s with the reaper's own log line, and env `0` was not reaped in 90 s (`live-mcp-idle-isolated.jsonl`). |
| SDK | config, option+config, all-null+config, opt-in-off: 4/4 |

Harness corrections were each re-run before counting:
1. A stdout slice cut `--help`.
2. MCP idle 3000 ms reaped my own session (attempt 1).
3. Long TEMP paths pushed Chrome past MAX_PATH. It fell back to the mock browser (attempts 1 and 2). Fixed with short TEMP names.

## Rulings on F3 to F9

- **F3: FAIL (N2).** The fixed cases pass: a junction or symlink in home pointing out, home via a link, a case variant, a trailing separator. The reverse direction still escapes.
- **F4: FALSE-PASS (N1).** Every other echo site is capped and single-line.
- **F5: PASS.** A swapped root still passes the runtime re-check (`fixes-fn.json` F5), and SECURITY.md now says exactly that.
- **F6: PASS.** Live exit 1 before any request. `--help`, README, docs and changelog all say it.
- **F7: PASS for the home boundary.** B14 is caught; B13 is equivalent on win32 (`b13-equivalence.txt`). Superseded by the new gap N3.
- **F8: PASS.**
  - File and flag bounds are enforced before Chrome on CLI and MCP.
  - The kill path is proven with `probes/kill-path.mjs` (`kill-path.json`). Bounds widened with the kill kept -> exit 1, 0 Chrome. Kill removed -> 10 leaked (the positive control works). Master leaks (`ab-f8-master-leak.txt`).
  - GAP-350: silently ignoring an SDK option or MCP `defaultViewport` is acceptable (no leak, falls to the next layer). Its claim about the MCP call argument is wrong (N4).
- **F9: PASS.** The SDK `console.warn` appears only for a discovered accept; it is absent for an option and for an explicit file. The single-label suffix rule in the docs matches `runtime.ts`.

## Mutants (`probes/mutants-a2.mjs`, `probes/mutants-def.mjs`)

For each mutant the runner:
1. replaces the text exactly once (EOL-aware);
2. runs forced builds of the package and the bundle;
3. runs vitest for cr, cli, mcp and sdk;
4. runs f1-attack;
5. runs the live CLI F1 part, or the SDK mini check;
6. restores the file (sha256) and rebuilds.

| id | mutant | unit | probe / live | caught |
|---|---|---|---|---|
| B1 | blank or `;;` env counts as set, FILE roots used | **all pass** | f1 54; live 3 | yes, not by unit (N3) |
| B2 | env roots merged with refused file roots | cr 11, cli 8, mcp 8 | f1 51; live 0 | yes |
| B3 | option present but `[]`/null skips the refusal | cr 5, mcp 4, sdk 4 | f1 18 | yes |
| B4 | MCP only: refusal not passed | mcp 4 | f1 66 | yes |
| B5 | SDK only: refusal not passed | sdk 5 | live SDK 1 | yes |
| B6 | `download <dir>` not a higher layer (resolver) | cli 4 | f1 18; live 1 | yes |
| B7 | `<dir>` clears the refusal but keeps the file roots | cli 4 | f1 18 | yes |
| B8 | `fsRootsConfigLayer` drops the refusal | cr 6, cli 4, mcp 4, sdk 5 | f1 115; live 7 | yes |
| B9 | explicit file also refused (over-refusal) | cr 2 | live 1 | yes |
| B10 | upload env skips the download refusal | **all pass** | f1 13; live 1 | yes, not by unit (N3) |
| B11 | cli.ts does not pass `<dir>` to the resolver | all pass (expected) | live 1 | yes |
| B12 | blank env becomes default roots | cr 1 | f1 36; live 2 | yes |
| B13 | exact-string home equality | all pass | - | equivalent on win32, not counted |
| B14 | inHome from the canonical cwd only (pre-F3) | cr 1 | - | yes |
| B15 | widen the `--viewport` bound only | cli 1 | - | ineffective harness mutant, replaced by kill-path.mjs |

F1-conditional mutants: 12/12 caught. The unit suites alone miss B1, B10, and B11 (expected for B11).

## Master comparison (fdae749 tree at E:\AI-Cache\tmp\fr211-master)

I checked the tree: 555 tracked ts/mjs/json files identical after CR normalisation, 3 test files differ.

| Suite | HEAD | Master | Attribution |
|---|---|---|---|
| verify-fr2-08 | 478/478 | - | no regression |
| verify-fr2-07 | 488/488 | - | no regression |
| verify-fr2-04 | 97 pass / 4 fail / 2 skip | identical 4 failures | environment (N9) |
| run-cli | UC-05/06/08/12 fail | UC-05/06/08/09/12 fail | external sites |

`baseline-cli.json` sha is unchanged.

Overhead per command (cold child, `performance.now`, n=15), median:

| Case | ms |
|---|---|
| No file | 2.8 to 5.2 |
| File without download keys | 4.8 |
| File with download roots | 58 |
| Refused file | 60 |

These match audit-1 (the cost is fsutil spawns).

## Root cause (second failed audit, for the builder)

Each fix was verified against cases written together with it, not against the whole input space:
- every echo site, not just the listed ones;
- both directions of the link/home relation;
- every "set but unusable" higher-layer shape.

The spec is right. The implementation residuals are small (N1, N2). The tests need the missing shapes (N3).

## Not verified

- POSIX owner/mode and symlink semantics (Windows host).
- Attack-style live downloads into hostile roots (safety rule). The only out-of-tree downloads were the documented explicit-load escape hatch, into my own scratch.
- Windows ACLs (GAP-077).

## Process

- PIDs I killed, all trees whose command line held my scratch path `fr214a2` (`pids-killed.txt`): 2 harness node processes, 2 orphaned CLI Chromes, 1 master A/B leak, 1 live session left by B15, and 10 kill-path control PIDs.
- Nothing was killed by image name.
- `E:\AI-Cache\tmp\sutradhar-cli-*` was unchanged (only `sutradhar-cli-1790798002107`, never touched).
