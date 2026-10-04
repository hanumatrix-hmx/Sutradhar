# S3c evidence - I-048 SDK `page.text()` and exports

Run 2026-10-04 on `release/0.6.2` (parent 389c747). Files: `packages/sutradhar/src/page.ts` (`Page.text`), `src/index.ts`
(re-exports `PageTextReadError`, `formatPageTextMarker`, `DEFAULT_PAGE_TEXT_MAX_CHARS`, `MAX_PAGE_TEXT_CHARS`, type `PageTextResult`),
new `tests/unit/page-text.spec.ts` (`api.spec.ts` untouched, version line still 0.6.1).

| AC | result | evidence |
|---|---|---|
| S3c-1 `page.text()` fields + paging == `page.evaluate` FULL | PASS | `live-sdk-head.stderr.log`: fields incl. `tabId == page.tabId`, `source:'dom'`, no marker in `text`; 3 distinct windows concatenate to FULL (10037) |
| S3c-2 `page.snapshot()` additive fields | PASS | `pageTextTotalChars` 10037, `pageTextTruncated` true, no `pageTextError` |
| S3c-3 `/long-emoji` surrogate safety | PASS | paging at maxChars 4000/1/1000/3999 over the 12000-char text: no window starts on a lone low or ends on a lone high surrogate, no zero-length window, each paging reproduces the text; requested offsets on each low surrogate back up to the high one; `maxChars:1` at a pair returns 2 |
| S3c-4 `{maxChars:0}` -> TypeError; NEG061 `typeof page.text` | PASS | live TypeError `maxChars must be an integer from 1 to 100000 (got 0)`; `live-sdk-neg061.stderr.log`: `typeof page.text === 'undefined'`, old snapshot has no `pageTextTotalChars`, 4000 chars |
| attribution | PASS | `browser.close()`; CIM query for Chrome with the ISO basename: none |
| vitest | PASS | sutradhar 64 -> 70 (`test-sutradhar.log`; 6 new, written first and failing: `new-tests-before-change.log`); tsc and eslint src/ clean |

Build: forced, `build-times.txt` 20:39:10-20:39:42 rc=0, 9/9 executed; only `index.js` changed (5a625405 -> 5cbe7445; cli-bin and mcp-cli unchanged); `async text(options)` present in `dist/index.js`.
The PDF case is not re-run here: `page.text()` is a one-line delegate to the S2 runtime path, whose bundled-PDF behaviour (PROB-052) was verified through the CLI in S3a (g2) and in `S3a/diag-pdf-text.txt` (the bundled `index.js` rejects with `PageTextReadError`).

## Mutants (`mutants.txt`; baseline 6 passed)
M-048n (tabId dropped), n2 (options dropped), n3 (read failure swallowed into an empty result), M-048o (`formatPageTextMarker` not re-exported), o2 (`PageTextReadError` not re-exported), o3 (`MAX_PAGE_TEXT_CHARS` not re-exported): 6/6 killed, restored sha equal.

## False-pass analysis
- S3c-1 against a stale bundle: forced build, `index.js` hash changed, the harness prints the bundle sha; NEG061 (different bundle) lacks `page.text`.
- S3c-1 paging "equal" with FULL read through the same code: FULL is `page.evaluate` (raw expression), a different path.
- S3c-3 vacuous (no pairs near window edges): fixture pairs sit at 3999/5000/7999/10001, and the four window sizes include 4000 (end on 3999 high surrogate) and 1; the unit twin (S2) kills the rule-removal mutants.
- Delegation unit tests with a stub could hide a wiring break: the live run reads a real page through the built bundle, and M-048n (tabId) is killed at unit level.
