# T5: settle has no Node-side bound (a dialog opened by a settle action blocks to the 30 s auto-dismiss)

The defect (spec section 0, T5): every bound in the old `waitForSettle` was an in-page timer or a Puppeteer timeout that only starts
once `page.evaluate` is running. While a native dialog is open the page's main thread is frozen and `page.evaluate` does not run until
the dialog closes. So `click` with `settle:true` on a button that calls `alert()` blocked until the tab's 30 s auto-dismiss.

Fix (D14): `waitForPageSettle` (new `packages/browser/src/actions/page-settle.ts`, extracted from the engine byte-for-byte) races the whole
wait against a Node timer of `spec.timeoutMs + 500 ms`, cleared on normal completion. Settle still never fails an action.

## Live proof (same fixture, same harness case N18, real Chrome, MCP over stdio, observer-attached browser)

Fixture: `tools/scenario-suite/fixtures/fr2-08-conditions.html?case=settle`, `#s-alert` calls `alert('settle')`. The call is
`browser.click {target:'#s-alert', settle:{timeoutMs:2000}}`. Each run first clicks the same button on a fresh load WITHOUT settle
(the control), because the click itself takes ~3 s when it opens a dialog (pre-existing; GAP-335).

| build | control click, no settle | click with settle `{timeoutMs:2000}` | settle overhead | what it means |
|---|---|---|---|---|
| BEFORE: master `75b29c6` built in a temp dir (`git archive` + `pnpm install --offline` + `pnpm run build`; the main checkout was never touched) | 3095 ms | **30400 ms** | ~27.3 s | blocked until the 30 s dialog auto-dismiss |
| AFTER: this branch, forced full rebuild (`turbo run build --force`, 0 cached), MCP server | 3037 ms | **5573 ms** | 2536 ms (= 2000 + ~500 grace + ~36) | bounded by `timeoutMs + 500` |
| AFTER: same, through the npm bundle `packages/sutradhar/dist/mcp-cli.js` | 3063 ms | **5566 ms** | 2503 ms | same |

Sources: `live-baseline/baselines.jsonl` (BEFORE, produced by `verify-fr2-08-conditions.mjs --baseline` with `FR208_BASELINE_ROOT`
pointing at the master build; log `baseline-pre-change.log`), `live/live-summary.json` cases `mcp:N18` and `bundle:N18` (AFTER).

Gate for the AFTER case: `settleOverhead <= 2000 + 500 + 1500 ms` and the call must return below 15 s. Both hold in every run
(see `live/` and `live-2/`). Revert-and-confirm: mutant L5 (the Node-side bound removed again, `mutation-live.log`) fails N18 live, and
mutants U11/U12 fail the unit tests P3/P6/E3.
