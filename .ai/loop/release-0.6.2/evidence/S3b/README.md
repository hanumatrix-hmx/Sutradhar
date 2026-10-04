# S3b evidence - I-048 MCP: `browser.snapshot` textMaxChars + marker; `browser.get_page_text`

Run 2026-10-04 on `release/0.6.2` (parent 8528700). Files: `packages/mcp-server/src/tools.ts`, `tests/unit/tools.spec.ts`
(EXPECTED_BROWSER_TOOLS 72 -> 73, the new tool added to NO_SETTLE_TOOLS reads, 11 new tests). `run-mcp.mjs` needs no edit
(`consumers.md`: it takes `Page text:` split `[0]`, the marker comes after the block).

| AC | result | evidence |
|---|---|---|
| S3b-1 tools/list = S1 + 1 incl. `browser.get_page_text` | PASS | live: 74 (S1 `tools_list` 73 + 1); probe `mcp-probe.mjs` (cmp-identical to the 0.6.1 copy) `EXPECT_TOOLS=74` exit 0, `EXPECT_TOOLS=73` exit 1 (`toolCount: FAIL`) (`mcp-probe-74.out.json`, `mcp-probe-73.out.json`); `tool-count.txt` EXPECTED_BROWSER_TOOLS = 73 (S1 72 + 1) |
| S3b-2 snapshot marker/size | PASS | `live-mcp-head.stderr.log`: Page text block == FULL[0:2000] + exact marker naming `browser.get_page_text offset=2000`; `textMaxChars:5000` -> FULL[0:5000] + marker |
| S3b-3 paging exact | PASS | `get_page_text` pages 0/4000/8000, concatenation == FULL (raw `browser.eval`), 3 distinct windows, last marker `(end)`; `maxChars:40001` and snapshot `textMaxChars:40001` -> MCP -32602 schema error; `maxChars:40000` accepted |
| S3b-4 short page identical | PASS | `s3b-4-compare.txt`: HEAD vs NEG061 `/short` snapshot block sha equal, 299 chars (> 200) |
| S3b-5 NEG061 old behaviour | PASS | `live-mcp-neg061.json`: tools/list 73 without `browser.get_page_text`; snapshot block exactly 2000 chars, no marker |
| S3b-6 vitest | PASS | mcp-server 156 -> 167 (`test-mcp-server.log`); eslint src/: same 6 pre-existing `no-explicit-any` lines as the S1 baseline (`lint-lines.txt`); tsc clean |

Build: forced, `build-times.txt` 20:35:58-20:36:29 rc=0, 9/9 executed; only `mcp-cli.js` changed (c3b27a95 -> 21fabbe9; cli-bin and index unchanged, as expected); `grep -c get_page_text dist/mcp-cli.js` = 5.
Isolation: guard line in the harness/server logs, MCP child exited (no kill needed), CIM query for Chrome with the ISO basename: none left, ISO dirs deleted with the guarded form (one `rm -rf "$SP/Sbt"` of a not-yet-existing name preceded the creation; no effect).

## Mutants (`mutants.txt`, `run-mutants.mjs`; baseline 95 passed)
M-048k (snapshot ignores textMaxChars), k2 (default not 2000), k3 (marker never rendered), k4 (pageTextError never rendered), k5 (marker even when not truncated), k6 (schema ceiling removed, 2 sites), M-048l (get_page_text ignores offset), l2 (ignores maxChars), l3 (drops marker), M-048m (tool missing from EXPECTED_BROWSER_TOOLS), M-048s (empty text instead of isError), s2 (error not matched by name): 12 mutants, 0 survivors, restored sha equal. The first run had s2 SURVIVING (tests only checked the reason text); the tests now also assert the `page text read failed:` / `get_page_text failed:` prefixes, which kills it.

## False-pass analysis
- S3b-1: a stale `mcp-cli.js` would report 73: the live count is 74 from a forced build with a changed dist hash, and the same probe with 73 fails (negative exits 1).
- S3b-2/3: the "FULL" comes from `browser.eval` (independent path); equality is exact-string, plus a NEG061 run showing the same harness sees no marker on the old build.
- S3b-4: both-empty impossible: length 299 asserted.
- The schema rejection could be an unrelated error: the message names `maxChars`/`textMaxChars` and the 40000 bound, and 40000 itself is accepted.
