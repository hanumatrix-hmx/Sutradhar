# S3a evidence - I-048 CLI `text` paging flags, marker, explicit read errors (commit I-048 (2/4))

Run 2026-10-04 on `release/0.6.2` (parent e097a17). An earlier attempt STOPPED on AC S3a-7 (g) (bundled builds cannot extract PDF
text); Addendum A.1/A.2 of plan.md (orchestrator, binding) replaced (g) with (g1)/(g2) and allowed M-048h as a 2-site source mutant.
This commit also contains: the plan.md Addendum A change, the PROB-052 entry + PROB-009 amendment in `.ai/known-problems.md`, and the
runtime change that maps pdf.js's raw "DOMMatrix is not defined" to the documented message (`capability-runtime/src/runtime.ts`
`readPdfText`, so MCP/SDK surface the same `PageTextReadError`). One commit (stated choice: docs and mapping ride with S3a).

| AC | result | evidence |
|---|---|---|
| S3a-1 (a) FULL via independent eval | PASS | `live-cli-text-head.stderr.log`: L = FULL.length = 10037 |
| S3a-2 (b) text = FULL[0:4000] + marker A on stdout | PASS | exact-string compare, marker absent from stderr |
| S3a-3 (c) paging to marker B, concatenation == FULL, 3 distinct windows | PASS | same |
| S3a-4 (d) `--max-chars 100000` no marker; offset past end -> marker C, exit 0 | PASS | same |
| S3a-5 (e) `--json` | PASS | same |
| S3a-6 (f) `/short` identical to NEG061 | PASS | `shortSha256` equal in `live-cli-text-head.json` / `-neg061.json`, 300 chars |
| S3a-7 (g1) PDF windowing unit coverage with the reader stubbed | PASS | `capability-runtime/tests/unit/page-text.spec.ts` "PDF path" (source `pdf`, totals, windows, empty PDF) + new PROB-052 mapping test; capability-runtime 554 tests |
| S3a-7 (g2) live bundled `text` on /pdf | PASS | exit 1, stdout empty, `Error: text read failed: the PDF text could not be extracted: PDF text extraction is not available in this build (PROB-052): ...`, no `Fatal:`, no raw DOMMatrix error line; plain mode also exit 1; NEG061 control: one empty line, exit 0 |
| S3a-8 (h) 6 invalid-flag cases mid-session | PASS | exit 1, exact message, stdout empty, state.json sha unchanged, no new sutradhar-cli-* |
| S3a-9 (i) ids not re-stamped (on `/nodeid`; `/long` has no interactive elements) | PASS | G1 == G2 == 1791125917690, E1 == E2; control: second `snap` changes G; NEG061 `text` changes G |
| S3a-10 (j) read failure | PASS | exit 3 (dialog-blocked), never exit 0 with empty stdout; NEG061 recorded: exit 3 |
| S3a-11 (k) NEG061 4001 chars, no marker; rejects `--offset` | PASS | `live-cli-text-neg061.json` |
| S3a-12 M-048i live | PASS | sibling `cli-bin.mutant.js` (1 replacement) fails (i); deleted; real `cli-bin.js` sha unchanged |
| S3a-13 tests / typecheck / mode | PASS | cli 360 -> 395 (+35) and 2 skipped; capability-runtime 554; tsc and eslint (`src/`) 0 problems on both; spec typecheck 7 errors == baseline (`spec-tsc.txt`, run before the mapping change, test files unchanged since); `cli.ts` 100644 before and after |

Build (final): forced, `build-times.txt` rc=0, 9/9 executed; `dist-before.sha256` -> `dist-after.sha256` differ (cli-bin d403c8dd -> cc268ca9, index.js 1ba4c30f -> 5a625405, mcp-cli eb85aa99 -> c3b27a95: the runtime mapping is bundled into all three); `grep -c PROB-052 dist/cli-bin.js` = 1.
After the M-048h detour the real bundle was rebuilt (`build-final.log`) and its sha256 verified equal to the pre-mutation one; no `*.mutant.js` left in `dist`.
Isolation: guard line in every log, path-log check 0 (10 `[cleanup]` lines, none outside ISO) both runs, no PID left, ISO dirs deleted.

## Mutants
- Unit (`mutants-unit.txt`, `run-mutants.mjs`): 15 mutants (M-048g, g2, g3, j, j2, i-unit, r, r2, r3, x1-x6) all killed, restored sha equal.
- M-048i live: killed (above).
- **M-048h (A.2)**, source mutant + rebuilt bundle, two replacement sites in `packages/cli/src/cli.ts`: (1) the `if (textPagingFlagError) { printErrorAndExit(...) }` block in `main()` removed, (2) `if (textPagingFlagError) printErrorAndExit(textPagingFlagError);` inserted as the first statement of the `withSession` callback in `cmdText`. Source restored (sha equal), bundle copied to `dist/cli-bin.hmutant.js`, run by `live-h-mutant.mjs` mid-session: `m048h-mutant-result.txt` `passesCheckH:false` (four cases die with exit 3221226505 = 0xC0000409, the libuv assertion `process.exit` inside `withSession` causes; `snap --offset 5` exits 0); control on the real bundle `m048h-real-control.txt` `passesCheckH:true`. KILLED.

## False-pass analysis
- (g2) exit 1 could come from any failure: the exact PROB-052 message prefix is asserted, the raw DOMMatrix text is asserted absent from the `Error:` line, and the NEG061 control on the same PDF shows the old empty line + exit 0.
- (b)-(d) could pass against a stale bundle: `cliSha256` printed by the harness (cc268ca9) equals the freshly built file; NEG061 (different sha) shows 4001 chars and no marker.
- (h) could be vacuous without a session: runs mid-session (state.json exists, sha compared); M-048h dies on it.
- (i) vacuous attribute: values must be real numbers; the control and the NEG061/mutant runs prove the read detects a re-stamp.
- (f) both empty: length 300 > 200 and sha equality.
- (g1) stubbed reader could hide the real failure: that is exactly what (g2) covers live; the unbundled `capability-runtime/dist` run (`diag-pdf-text.txt`) shows the real PDF path returns `source:'pdf'`, 10098 chars.

## Notes for later steps (also in STATE.md)
S10b gap + S10 changelog "Known limitations" for PROB-052.
