# S2 consumers of page text (classification against plan section 1.2)

Source: `consumers.txt` (rg with the plan's pattern, plus `--glob '!**/results/**'`: the scenario-suite `results/` JSON
dumps are generated output, not consumers). 107 hits in 28 files; classified by file.

| file(s) | what it does | class |
|---|---|---|
| `capability-runtime/src/runtime.ts`, `types.ts`, `page-text.ts` | the implementation (this step) | changed here |
| `capability-runtime/tests/unit/page-text.spec.ts` (new), `runtime.spec.ts:1520` | tests; the spy is retargeted from `readPageText` to `pageTextWindow` and a new test fails if `snapshot()` does not call it | updated here |
| `cli/src/cli.ts:841` `console.log(snap.pageText)` (the `text` verb) | prints the window | **S3a** switches it to `readTextWindow` (marker, flags, errors) |
| `mcp-server/src/tools.ts:524` `snap.pageText.slice(0, 2000)` | MCP snapshot block | **S3b** (`textMaxChars`, marker, `pageTextError`) |
| `mcp-server/tests/unit/tools.spec.ts:640,665,686` | mocks with `pageText: ''` and no new fields | **S3b** renderer must tolerate absent fields; mocks left as is (they prove it) |
| `sutradhar/src/page.ts:251` (`page.snapshot()`) | returns the runtime `SnapshotResult` as is | additive fields flow through; `page.text()` added in **S3c** |
| `tools/scenario-suite/run-cli.mjs` (`text` x10: lines 157, 223, 229, 312, 376, 386, 445, 559, 588, 704) | `stdout.includes(...)`, regexes (`Item total:`, `HeadlessChrome/`), `trim() === 'New Window' \|\| includes(...)` | **compatible**: the marker is an extra final stdout line only when truncated, no check is an exact equality that the extra line would break; no edit |
| `tools/scenario-suite/run-mcp.mjs:353` splits on `Page text:` and takes `[0]` | reads only the part before the block | **compatible** (marker is after the block) |
| `tools/scenario-suite/run-sdk.mjs:536-546` `snap.pageText.includes(phrase)` | substring check on the window | **compatible** (text unchanged on success) |
| `tools/engine-comparison/measure-snapshot-cost.mjs:39-40` | `pageText.length`, `JSON.stringify(snap)` size | **compatible**; `fullSnapshotChars` grows by ~70 characters (three additive fields), noted, no edit |
| `apps/server/src/routes/browser-routes.ts:282-311` | own `innerText.slice(0, 1500)` for the server snapshot endpoint | **not a consumer** (separate cap, S10b gap) |
| `agent/src/core/agent-loop.ts:260` (`extractVisibleText`) | agent.runGoal's own excerpt (2000) | **not a consumer** (separate cap, S10b gap) |
| `frontend/src/runtime/api/client.ts:81` `pageText: string` | type of the apps/server HTTP response | not a consumer of `SnapshotResult` |
| `browser/src/actions/browser-action-engine.ts:842`, `browser-action-engine.spec.ts:306` | comments mentioning snapshot's pageText | no behaviour |
| remaining hits (`--no-text`, `--expect-text`, `waitfor --text`, `'text'` failed-expectation keys, selector-dialect `quoted-text`, extract-data/`wait_for.text` expectations) | regex matched the word `text`; unrelated to page text | not consumers |

Not consumers by design (independent text): `wait_for` text/textGone and `expect.text` (`probeVisibleText`),
`extract_data`, `audit`, the block detector.

`rg -n "readPageText" packages/capability-runtime/src` prints nothing (the in-page function is `pageWindowInPage`).
