# FR2-11 run-1: deviations from spec.md

The spec was written at `e638e2a`, before FR2-07 and FR2-08 landed. Everything below was re-derived against
master `fdae749`; each item says what differs and why.

## D1. Trace corrections (the code moved)
1. **The engine has four `recordAction` sites plus two early returns, not two sites.** FR2-06 added a recording
   rejection in `rejectInvalidCallerSelector`. All four sites and the duplicate-guard / invalid-`timeoutMs` early returns now
   go through the one `recordHistory` helper.
2. **`runtime.waitFor` (FR2-08) already recorded an entry** (`actionType: 'wait_for'`, `selector: describePageCondition(c)`).
   The spec never mentioned it. It is kept and now also carries `url` and the result's `verification` (the FR2-08 evidence
   check `wait_for.<cond>`), because "entries include the verification" must hold for it too. Its `selector` holds the caller's own
   wait condition (`text="..."`, `js(...)`, capped) and is URL-redacted by the sanitizer; like the eval preview it is not secret-masked.
3. **`VerificationResultDto` already has `evidence`** (FR2-07). History stores the object as the result carries it; the sanitizer
   still reads `evidence` structurally.
4. **No untruncated FR2-09 D5 helper exists.** `displayFrameUrl` truncates at 80 characters and keeps `about:` queries, so
   `redactHistoryUrl` is a separate function (the spec allowed this). It additionally drops userinfo, `javascript:`/`vbscript:`
   bodies, the query of an `about:` URL, and the query/fragment of an unparsable string.
5. **`STATE_DIR` was already exported** from `state.ts`; only `HISTORY_FILE_PATH` is new (no `STATE_DIR_PATH` alias).
6. **FR2-03's `clearStateFileIfUnchanged` is NOT on master** (`clearState` is `rm(state.json)` only). The spec's rule still holds and is
   tested: `clearState` never deletes `history.jsonl` (unit C10, live L6, mutant M10).

## D2. Found by the new negative tests (not in the spec)
7. **A typed value reached the history through two paths the spec did not foresee.** The engine's `type did not land the expected value`
   error quotes BOTH the typed value and the field's real content, and a failed action's `verification.reason` is
   `Action failed: <that error>`. The negative test E3b failed on the first implementation. `scrubActionError` / `scrubVerification`
   (called in `recordHistory`, where the params are known) now replace that text; the CLI additionally scrubs the raw secret strings
   of `type` / `select` / `setclipboard` / `dialog` from everything it stores (defense in depth). Live: `fr2-11-typefail.html`
   (a field that discards input) makes the real engine produce that error on MCP and CLI; the tool's own output contains the value
   (negative control), the history does not.
8. **`select` values are recorded as a length** in CLI args (the spec stored them). A `<select>` value is a field value; stricter
   privacy wins. The engine's `describeActionTarget('select_option')` is `undefined` as specified.

## D3. Implementation placement
9. **CLI recording lives in `main()`'s `finally` (plus the watchdog), not in a `withSession` wrapper.** Reasons: (a) the exit code is final
   only there (`finalExitCode` from a dialog pre-emption, exit codes set after `withSession` returns); (b) it also covers verbs that
   never call `withSession` (`dialog`, the browser-level `tabs` / `closetab` paths) and `close`, whose `state.json` is already gone
   (`closedSessionId` is captured first); (c) one call site. Verbs recorded are listed in `HISTORY_VERBS`.
10. **The FR2-04 watchdog is a hard `process.exit(1)`** (spec R6: "check and report"). It now records the hung command first (bounded to
    1.5 s), then exits. Live case W1 (4 s deadline via `SUTRADHAR_CLI_DEADLINE_MS`, an `eval` of a never-settling promise); mutant M20.
11. **`appendHistoryLine` opens with `a+` and prefixes a newline when the file's last byte is not `\n`** (spec: a plain `appendFile`).
    Without it a torn last line (a writer killed mid-write) would be glued onto the NEXT command's line, losing that line too.
    One extra one-byte read per append. Unit "torn last line ... not glued", live N7, mutant M11.
12. **Runtime `uploadFileViaTrigger` records the raw `triggerTarget` as `selector`** (spec: `normalizeTarget(triggerTarget)`), because
    `normalizeTarget` throws for Playwright syntax and FR2-06 pinned that error's position after `requirePage`.
13. **Durations use `performance.now()`** (monotonic) in `withHistory` and the CLI line; `timestamp`/`ts` stay wall-clock ISO strings.

## D4. Tests / harness naming
14. Runtime tests are a new file `packages/capability-runtime/tests/unit/action-history.spec.ts` (spec: append to `runtime.spec.ts`).
    MCP tests are appended to `tools.spec.ts` as specified; browser/CLI tests are new files as specified.
15. The live script is `tools/scenario-suite/verify-fr2-11-history.mjs` (task name; the spec said `...-action-history.mjs`). Counts in the CLI
    cases differ from the spec's because the extra privacy cases (L5x, N7 interleaved) add lines; the script tracks its own expectations.
16. The SDK has no history API (spec G-A). The live SDK case reads through `browser.runtime.getActionHistoryReport`, the runtime every
    SDK call goes through (a TS-private field, reachable at runtime).
17. The human `history` column widths follow the spec's example rows (duration right-aligned in 5 columns), not its prose ("6").
18. `checkInvalidTimeoutMs` results carry no `verification` (unchanged engine behaviour), so that history entry has none.

## D5. Mutation driver
19. The first full mutation run reported 4 live "NOT CAUGHT" (M03, M06, M14 did not compile; M13 was aimed at the MCP surface where the
    tab is created by `createTab`, not adopted). Those were mutant-definition bugs, not test gaps; the file is kept as
    `mutants-first-run.*`, the definitions were fixed and the full run repeated (`mutants.json`).
