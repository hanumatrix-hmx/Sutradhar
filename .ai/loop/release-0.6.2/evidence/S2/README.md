# S2 evidence - I-048 runtime `readTextWindow` (capability-runtime only)

Run 2026-10-04 on `release/0.6.2` (parent 61e2db6). Location check printed the worktree toplevel / `release/0.6.2` before writing.
Files: `packages/capability-runtime/src/{page-text.ts (new),runtime.ts,types.ts,index.ts}`,
`tests/unit/{page-text.spec.ts (new),runtime.spec.ts (spy retargeted)}`.

Test-first: `page-text-before-change.log` (new spec before any source change: fails, exit 1) vs `page-text-after-change.log` (44 passed at that point).

| AC | result | evidence |
|---|---|---|
| S2-1 live windows | PASS | `live-runtime-head.json` / `.stderr.log`: FULL (raw `runtime.eval('document.body.innerText')`) length 10037; default window 4000; `totalChars == 10037`; windows at 0/4000/8000 concatenate to FULL exactly (3 distinct windows); snapshot carries the first window + totals; `maxChars:100000` -> FULL, not truncated; offset past end -> empty/truncated; `maxChars:0` -> TypeError |
| S2-2 invalid options | PASS | `page-text.spec.ts` "readTextWindow validation never reaches the browser": 0, 100001, -1, 1.5, NaN -> TypeError, `evaluate` call count 0; live TypeError `maxChars must be an integer from 1 to 100000 (got 0)` |
| S2-3 short page identical | PASS | `s2-3-compare.txt`: HEAD and NEG061 `/short` `snapshot().pageText` sha256 equal (`0865be5f...`), length 299 (> 200); HEAD `pageTextTruncated:false`, total == length |
| S2-4 failure semantics | PASS | unit: probe-only and window-only rejecting evaluate -> `readTextWindow` rejects `PageTextReadError(dom)`; `snapshot()` returns `pageText:''`, `pageTextTotalChars:0`, `pageTextTruncated:false`, `pageTextError`; PDF parse failure and PDF fetch failure -> `PageTextReadError(source:'pdf')` with DOM window evaluate count 0; PDF parsed to empty -> `text:''`, `totalChars:0`, `source:'pdf'`, DOM evaluate count 0 |
| S2-5 NEG061 control | PASS | `live-runtime-neg061.json`: `typeof readTextWindow === 'undefined'`, `snapshot().pageTextTotalChars === undefined`, `pageText.length === 4000`; the NEG061 bundle sha (`ddaaa001...`) differs from HEAD's (`1ba4c30f...`) |
| S2-6 consumers + untouched | PASS | `consumers.txt` (107 hits), `consumers.md` (every file classified; scenario-suite / engine-comparison consumers compatible, no edit); `untouched-sources.txt`: `git diff --stat` of verifier / extract / audit / block-detector sources is empty; browser 938, mcp-server 156, sutradhar 64, cli 360 (+2 skipped) unchanged; `rg -n readPageText packages/capability-runtime/src` prints nothing (exit 1) |
| tests | PASS | `test-totals.txt`: capability-runtime 505 -> 553 (44 new at first run + 4 probe/window tests added after the mutant design), others == S1 |
| typecheck / lint | PASS | `tsc --noEmit` capability-runtime: 0 lines; `eslint src/ --ext .ts` exit 0 (`lint-capability-runtime.txt`; the first run caught an unused import, removed) |
| build | PASS | forced `turbo run build --force --concurrency=1 --filter=sutradhar...`, `build-times.txt` (20:03:49-20:04:20, rc=0, 9/9 executed, 0 cached); dist sha before/after differ (`dist-before.sha256` 9858726a/ddaaa001/55317c66 -> `dist-after.sha256` a0bed443/1ba4c30f/eb85aa99); `grep -c readTextWindow dist/index.js` = 2 |

## Mutants (`mutants.txt`, `run-mutants.mjs`; baseline 208 passed on page-text.spec + runtime.spec; each applied to a copy-restored file, sha256 before = after)
| mutant | outcome | killing test |
|---|---|---|
| M-048a window ignores offset | KILLED (8 fail) | windows concatenate / offset+maxChars / offset>=total |
| M-048b `totalChars` from the slice | KILLED (6) | default window totals, concatenation |
| M-048c validation after evaluate | KILLED (5) | "evaluate call count 0" cases |
| M-048d PDF keeps `slice(0,4000)` | KILLED (2) | "PDF ok (9000 chars)", snapshot of a PDF |
| M-048e marker when not truncated | KILLED (1) | marker `null` test |
| M-048f surrogate rules removed (4 statements) | KILLED (5) | extend / maxChars:1 / low-surrogate start |
| M-048f2 shrink instead of extend | KILLED (3) | maxChars:1 returns 2 code units |
| M-048p1 probe evaluate error swallowed | KILLED (2) | probe-only rejecting evaluate |
| M-048p2 window evaluate error swallowed (empty / total 0) | KILLED (2) | window-only rejecting evaluate |
| M-048q PDF parse failure falls back to DOM | KILLED (5) | PDF failure tests |
| M-048t `truncated` ignores offset > 0 | KILLED (2) | last-window truncated assertions |
| M-048u snapshot ignores `textMaxChars` | KILLED (2) | snapshot totals / spy args |
| M-048v snapshot drops `pageTextTotalChars` | KILLED (4) | snapshot totals |
| M-048w PDF empty text falls back to DOM | KILLED (1) | PDF empty text test |

Survivors: 0. (M-048p was one mutant in the plan; the first test design used an evaluate that threw on EVERY call, which would
have let a window-only swallow survive, so the fake got `throwOn: 'probe' | 'window'` and p became p1/p2.)

## Deviations / notes
- Plan 2.1 says `truncated = offset > 0 || offset + returnedChars < totalChars` and also "offset >= total: `truncated: true` if total > 0". For an EMPTY page with offset > 0 these differ; the more specific rule is implemented (empty page: never truncated), pinned by a unit test.
- The in-page function is exported as `pageWindowInPage` (not `readPageTextWindowInPage`): the plan's T1 check `rg readPageText packages/capability-runtime/src` must print nothing, and the longer name contains that substring.
- The last edit (removing an unused import found by eslint) happened after the forced build/live run; it has no runtime effect, and S3a force-builds again.
- Real-TEMP snapshot unchanged (`realtemp-before.txt`, `realtemp.txt` REALTEMP-SAME); no CLI ran in S2 (in-process runtime), so the path-log checker is N/A (first applicable at S3a). Guard line present in every harness/test log, 0 `ISOLATION GUARD`; no Chrome with the S2t/N2t basename remained (CIM query 0).
- `rg` is the Windows ripgrep 14.1.1 on PATH.

## False-pass analysis
- S2-1 against a stale dist: the dist sha changed after a forced, uncached build and the bundle contains `readTextWindow` (2); the harness prints the bundle sha it loaded (`1ba4c30f...`, not NEG061's). FULL comes from a raw `runtime.eval` (a different code path than `readTextWindow`); the windows must concatenate to it and be >= 3 distinct (an offset-ignoring mutant is killed by the unit twin).
- S2-2 could pass because `maxChars:0` is rejected by something downstream: evaluate call count is asserted 0, and M-048c (validation after evaluate) is killed.
- S2-3 could pass with both sides empty: length 299 > 200 asserted; the sha equality is over the full text.
- S2-4 could pass with a mock that throws for the wrong call: `throwOn` isolates the probe and the window evaluate; M-048p1/p2/q kill the swallow variants.
- S2-5 could be vacuous: `typeof readTextWindow` is genuinely undefined for a bundle whose grep count is 0 (S1), and the same harness against HEAD asserts the opposite.
- S2-6 "untouched" could be a diff of the wrong paths: `untouched-sources.txt` lists the exact paths and the full `git diff --stat` next to it; browser test count unchanged (938).
