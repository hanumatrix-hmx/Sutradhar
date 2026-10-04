# S9 - version bump 0.6.0 -> 0.6.1 (exactly 4 files)

Order per plan: `packages/sutradhar/src/index.ts` edited first; the sutradhar matrix entry FAILED on `api.spec.ts`
(`test-sutradhar-RED.log`: `expected '0.6.1' to be '0.6.0'`, `Tests 1 failed | 63 passed`, exit=1). Then api.spec.ts,
`mcp-server/src/version.ts`, `sutradhar/package.json`. Matrix entries sutradhar (3 files / 64 tests) and mcp-server
(5 files / 156 tests) then pass, exit=0, `[iso-guard]` lines 34 / 36, no `ISOLATION GUARD`
(`test-sutradhar.log`, `test-mcp-server.log`; run via `evidence/S1/matrix.sh.txt S9 sutradhar mcp-server`, ISO `$SP/S9-tmp`).

## AC
| AC | result | evidence |
|---|---|---|
| `git diff --stat` = 4 files, 4(+) 4(-) | PASS | `checks.txt` |
| scoped `git grep -nF 0.6.0` finds nothing | PASS | `checks.txt` (`grep-exit=1`) |
| api.spec.ts imports `../../src` | PASS | `checks.txt` line 15 `from '../../src/index.js'` |
| sutradhar entry RED before the api.spec edit, GREEN after | PASS | `test-sutradhar-RED.log` vs `test-sutradhar.log` |

## False-pass analysis
- Sutradhar entry "passes": it could pass because the spec imports a stale built dist instead of the source. Ruled out by
  the RED run: with only `src/index.ts` changed the same spec failed on the new value, so it reads `src` (`from '../../src/index.js'`).
- 4-file diff: could hide a CRLF-only rewrite of other files. `git diff -U0` in `checks.txt` shows exactly 4 one-line hunks.
- grep finds nothing: could be a wrong pathspec. The same grep printed 4 hits before the edit (run at the start of this step).
- Matrix GREEN: could be a stale log. The logs were regenerated (09:10:28-32) after the edits, guard lines present.
- Dist version strings are NOT checked here (dist is still 0.6.0-built); S11 item 3 checks them after a forced build.
