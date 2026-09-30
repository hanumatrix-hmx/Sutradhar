# FR2-08 run-1: false-pass analysis

For every acceptance criterion: at least one way the check could pass while the behaviour is broken, and the command plus output that
rules it out. Outputs were re-read from disk / re-queried AFTER the last code change (final forced rebuild `final-build-3a/3b.log`, 0 cached;
`git status` clean for tracked files; the sources were also restored byte-identically after every mutant, sha256 in `mutation-*.json`).
Raw outputs: `fresh-queries.log`, `fresh-checks-static.log`, `live-3/live-summary.json`, `fresh-live-2/live-summary.json`.

Harness rules that apply to every live row: (1) clocks: page stamps (`Date.now()` in the fixture's recorder) and harness stamps (`Date.now()`
around each call) come from the same OS clock and are only ever compared with each other; the product's own `elapsedMs` uses a monotonic clock and is
never compared with wall stamps; (2) the ground truth is always read from the independent puppeteer-core observer (the page's own `window.__fx8`
recorder, the server's request log, `document.visibilityState`) AFTER the call, never from `success`; (3) "not yet" is proven by racing the call
against a delay that must win, not by sleeping.

## AC1: `wait_for` exists on MCP, CLI and SDK (and the npm bundle) with text / textGone / url / js / timeoutMs

| way to pass while broken | ruled out by |
|---|---|
| The unit tests pass against mocks but the built artifact has no such tool / verb (stale build, cached turbo replay of the `sutradhar` bundle, CLI dist from before the change) | `turbo run build --force` twice (final-build-3a/3b): `Cached: 0 cached, 19 total` and `0 cached, 9 total`. `find packages apps ... -newer final-build-2.log` printed only gitignored agent test artifacts (`fresh-checks-static.log`). Bundle greps `wait_for blocked by an open`: 2 in `mcp-cli.js`, 2 in `cli-bin.js`; `tools/list` of the BUNDLE reports 73 tools (72 `browser.*` + `agent.runGoal`), master 72 (`tools-list-bytes.json`, `fresh-checks-static.log`). Live surfaces spawn `packages/mcp-server/dist/cli.js`, `packages/cli/dist/cli.js`, `packages/sutradhar/dist/index.js` and `packages/sutradhar/dist/mcp-cli.js`. |
| `success:true` returned without the condition being true (a wait that returns at once) | Every wait case compares the call window with the page's own event stamps: `live-3` mcp `L1`: `sentAt <= toastShown <= recvAt`, `latencyMs 81`, observer reads `#toast` text after the call. Mutant U3/L3 (condition checked once) FAILS live L1/L1b/L1c/L11/L12; U1/L1 (unavailable counted as met) FAILS H3. |
| The timeout parameter is ignored / mapped wrongly | N1 (1500 ms) must take >= 1500 ms and <= 1500 + 1500 + slack and start with `wait_for timed out after 1500ms`; unit W15 (`timeoutMs 0` = exactly one pass); mutants U4b (deadline +1.5 s: W15 and W16c fail) and U19 (MCP handler drops `timeoutMs`: M3 fails). |
| Only the MCP surface works; CLI/SDK forward wrongly | Separate live cases per surface: CLI `C-L1..C-L4` (real child processes, exit codes, stdout), SDK `SDK-L1..SDK-N12` (`page.waitFor` resolves/rejects with `ActionFailedError`). Mutants U21 (SDK swallows a failed wait), U22/U23 (CLI parsing) fail unit tests. |
| `sessionId` optional (FR2-10) breaks for the new tool | `extra-sessionless.mjs` (`extra-sessionless.out`): with one live session `browser.wait_for` and `browser.hover settle:true` work with NO sessionId on both the server and the bundle; with two sessions the same call fails naming both ids. |

## AC2: `settle` on every state-changing tool

| way to pass while broken | ruled out by |
|---|---|
| The tool accepts `settle` in its schema but drops it before the runtime / engine (schema-only wiring) | Live sweep `S:*` (22 newly wired MCP tools + navigate/reload + go_back/go_forward + scroll + network half): each case gates on the observer reading `<tool>:2` (the fixture's 150 ms / 400 ms mutation burst) with `at <= recvAt`. Mutants: L9 (`settlePage` no-op) FAILS `S:navigate, S:click_at_point, S:handle_dialog, S:fill_form, S:go_back_forward`; L10 (`browser.hover` drops settle) FAILS `S:hover` (`mutation-live-2.log`). Unit: M6 classification guard (every registered tool is in exactly one list), M7 (each handler passes settle LAST and keeps its old arity), R1/R2/R3; mutants U13/U14/U16/U18/U20 fail. |
| The sweep cannot tell settle from no-settle (the tools are simply slow) | Controls without settle: `S-control:click_at_point` and `S-control:press_key` require `recvAt < <tool>:2.at` (returns BEFORE the burst ends): the burst ended 409 ms (click_at_point) and 401 ms (press_key) AFTER the call returned (`live-3/live-summary.json`, `observerTruth.burst2At - recvAt`). |
| Trigger never delivered (a tap that never happened would trivially "settle") | Every case also requires the page's own `<tag>-trigger` event with `at >= sentAt - 5`; `S:touch_tap` shows `triggerAt` recorded (a trusted touch WAS delivered; no `not-provable` fallback was needed). |
| CLI/SDK verbs silently ignore `--settle` / `options.settle` | CLI `C-L5:*` (11 verbs): the child's FIRST stdout byte must arrive after `<tag>:2`; SDK `SDK-L3`: goto/press/scroll resolve after `load:2` / `press_key:2` / `scroll_window:2`. |
| Missing surface silently: e.g. CLI `dialog` | Recorded as not applicable (GAP-040 note): `cmdDialog` never attaches the runtime. |

## AC3: Done-when fixture: a toast after a PURE 2 s `setTimeout` is caught by `wait_for`

| way to pass while broken | ruled out by |
|---|---|
| The page was not actually pure (a rAF / mutation / request kept `settle`-like waits alive, or the toast came from a network reply) | L1 asserts, from the observer, ZERO DOM mutations after `load` and before `toastShown`, and ZERO server requests between load and the toast (`preToastMutations: []`, `preToastRequests: []` in `live-3` `L1`); the recorder is a passive `MutationObserver` that never writes. CLI `C-L1..C-L2` repeat it with `mode=manual` (the page arms a bare `setTimeout(…, 2000)` only after the child is provably still waiting: `early: "pending"`). |
| The wait started after the toast (so it "found" existing text) | `sentBeforeToast: true` and `sentAt <= toastShown` are asserted in every windowed case. |
| A wait that merely sleeps 2+ s passes | `latencyMs` (recvAt - toast) must be <= 700 ms: 81 ms (MCP), 66 ms (bundle), 64 ms (SDK hidden tab), 31 ms after the event (CLI). |
| The claim "settle cannot see this timer" is wrong | L1b: `settle:true` on the click returned BEFORE the toast (`clickReturnedBeforeToast: true`), then `wait_for` caught it (33 ms after). L1c: `expect` on the same click is `verified:false / contradicted` (checks once), `wait_for` then succeeds. |

## AC4: `AGENT_SETUP.md` has a "wait on conditions, never sleep" section that is true

| way to pass while broken | ruled out by |
|---|---|
| The section exists in the repo copy but the shipped copy is stale | `grep -c "Waiting: wait on conditions, never sleep"`: `AGENT_SETUP.md:1`, `packages/sutradhar/AGENT_SETUP.md:1`; `diff` of the two: "mirror identical to canonical" (`fresh-checks-static.log`; the mirror is copied by `scripts/build-bundle.mjs` during the forced build). |
| The section describes behaviour the product does not have | Its claims are each backed by a live case: hidden-tab `waitForFunction` never fired (B-RAF: `rejected: Waiting failed: 10000ms exceeded`) while `wait_for` succeeded (L2-toast/js/push, `visibilityState: hidden`, `rafCallsIn500ms: 0`); vacuous `textGone` is `unverifiable` (N12, C-L4); a dialog fails within ~1.6 s (N10) with exit 3 on the CLI (N-C4); `settle` cannot see a timer (L1b); tool count 72 = `EXPECTED_BROWSER_TOOLS.length` (`grep -c "^  'browser\." tools.spec.ts` = 72). The text limits it names (GAP-329, GAP-331) are FR2-07's, asserted in the MCP description by M8. |
| Spec expectations copied into the doc although the live baselines refuted them | T16 (in-page interval throttling) and T17 (CSP blocks `waitForFunction(string)`) were both refuted (B-INT resolved 32 ms after the event; B-CSP resolved); the docs/changelog state only what was measured (GAP-333, deviations.md section A). |

## AC5: T5 fix (settle + a dialog opened by the action no longer blocks to the 30 s auto-dismiss)

| way to pass while broken | ruled out by |
|---|---|
| The "after" number is fast only because the click itself is fast / the dialog auto-dismissed early | A no-settle control click (same fixture, same call) is measured in the same run: 3065 ms; with settle 5555 ms (overhead 2490 ms = 2000 + 500 grace); the pre-change build (master 75b29c6 built from `git archive` in a temp dir) takes 30400 ms (control 3095 ms). `t5-before-after.md`, `live-baseline/baselines.jsonl`, `live-3` mcp/bundle `N18`. |
| The "before" build is not actually the old code | `grep -c waitForSettle` on the master build's engine = 2 (private method present); `browser.wait_for` absent from its tools/list (72 tools). |
| The bound only exists in a mock | Unit P3 uses never-resolving promises; live N18 uses a real `alert()` in real Chrome; mutant L5 (bound removed) FAILS N18 live (`tsc` exited 2 for that mutant but still emitted, and the run hit the old hang: caught), U11/U12 fail P3/P6/E3. |

## AC6: `text`/`textGone` REUSE FR2-07's visible-text check; "unavailable" is never met, and never "gone"

| way to pass while broken | ruled out by |
|---|---|
| A second, hand-written visibility predicate that agrees on the examples only | `grep -rn "visibleTextContainsInPage\|probeVisibleText" packages/*/src`: `visibleTextContainsInPage` appears ONLY in `execution-verifier.ts`; `condition-wait.ts` calls `probeVisibleText` (`fresh-queries.log`). FR2-07's own suites (`execution-verifier.spec.ts`, `expect-text-matrix.spec.ts`) pass unchanged against the refactor (browser vitest 929 passed). |
| Tested by hand-picked examples only (the FR2-07 failure mode) | Generated matrices: unit `frames [found/absent/throw]^k` (39 combinations) against an independent oracle written in the test; unit "shared definition" matrix (2 placements x 6 mechanisms, compared with `pageContainsVisibleText`); live matrix of 262 mechanism x placement cases on MCP (88 of them, every third, on the npm bundle) compared with the FR2-07 independent oracle, plus hung-frame cases H1-H3 on both: `live-3` 478/478, `gap325Tolerated: []`. |
| `textGone` reads "unavailable" as gone (a hung frame makes the page look empty) | H3 (text nowhere, one frame provably hung by the observer): both `text` and `textGone` must FAIL with `last: unavailable`. The fresh re-run FAILED H3 once because the hung frame had not started hanging yet (observer `hung: 0`): the harness now requires the observer to confirm a hung frame first (step 7c); H3 then passes 3 times (`live`, `live-2` pre-fix, `live-3`). Mutants U2 (unit) and L2 (live, H3) restore the defect and are caught; U1/L1 (unavailable = met) caught. |
| A tolerance quietly hides failures | The only tolerance (GAP-325, fail-closed `unavailable` naming a silent localhost frame) is capped at 3 per surface and fired 0 times in all three full runs (`gap325Tolerated: []`, and FR2-07's own `Z-gap325-budget` `tolerated: []`). |

## AC7: the negative cases really fail

Each negative (N1-N19, N-C1..N-C5, SDK-N*) asserts the failure shape (message, exit code, elapsed bound). They are not vacuous because:
mutant L4 (dialog ignored) makes N10 fail; L8 (js throw treated as transient) makes N2 fail; L6 (OR instead of AND) makes L9 fail; L7 (D16 rejection removed)
makes N-C3 fail and, because N-C3 also reads the observer, would show the click that "happened". All 10 live mutants are caught (`mutation-live*.json`),
and 24 of 24 unit mutants (`mutation-unit*.json`; U4's catch was a hang/timeout, so U4b was added: caught by W15/W16c).

## AC8: GAP-002 (the stale "no wait command" sleeps in `run-cli.mjs`)

| way to pass while broken | ruled out by |
|---|---|
| The sleep was replaced by a wait that is trivially met | UC-06 (`waitfor 15000 --text "Hello World!"`) was met after 1745 ms (`regression/run-cli-branch.json`, `waitforStdout`), i.e. it really waited; #finish holds the text in `textContent` while `display:none`, so only rendered-text semantics wait correctly. UC-01's `waitfor --js` was met after 1 ms: the three cells it reads were already filled, so the old 2500 ms sleep was unnecessary (recorded honestly, not claimed as a proof of waiting). |
| Master's suite result differs anyway | Master 75b29c6 suite: UC-04, UC-05, UC-12 fail with the same errors; branch: same three plus one UC-08 flake that passed on rerun (9.2 s). |

## AC9: no regression

| way to pass while broken | ruled out by |
|---|---|
| FR2-07 still "passes" only through the GAP-325 / H2 relaxations | `regression/fr2-07.log`: `488/488 passed`; its summary: `Z-gap325-budget` `tolerated: []` for mcp and bundle; H2 observed `verified: true, tier: verified` (the relaxed `unavailable` branch did not fire). |
| FR2-04 | `regression/fr2-04.log`: 110 passed, 1 failed, 2 skipped; the failure is `L13.headed.click-exit0` (the known GAP-316 flake): re-run in isolation 6/6 OK on master AND on this branch (`regression/l13-headed-alert-click-ab.log`). Not proven unrelated in the full run itself. |
| The CLI suite | See AC8 and GAP-338: UC-12/UC-05 were much slower on the branch in 3 of 14 UC-12 runs (0 of 13 on master) and could NOT be attributed or excluded; isolated A/B rounds are equal (12/12 plain headed clicks, 8/8 saucedemo clicks on both builds). This is the one item this run could not close. |

## AC10: "works in a background tab"

| way to pass while broken | ruled out by |
|---|---|
| The tab was not actually hidden (the case would pass in the foreground) | L2-*, SDK-L1-background: the case FAILS unless `document.visibilityState === "hidden"` is read in the fixture tab first (`visibilityState: hidden`, `rafCallsIn500ms: 0`). |
| The page's own timer throttling makes latency meaningless | Latency is measured from the page's own event stamp (when its timer actually fired), not from load: 32 ms / 64 ms. |

## Mutation-testing statement (which plausible mutants the tests catch)

Unit (24): unavailable=met (U1), textGone unavailable=gone (U2), checked once (U3), timeout ignored (U4 by hang, U4b deterministic), dialog ignored (U5),
OR not AND (U6), js throw transient (U7), presentAtStart from the last pass (U8), closed tab undetected (U9), per-frame unavailable disabled (U10),
no Node-side settle bound (U11), settle timer not cleared (U12), settle skipped for newly covered tools (U13), settlePage no-op (U14), vacuous textGone
"verified" (U15), fillForm settles per field (U16), wait_for hint no longer matches (U17), handle_dialog drops settle (U18), wait_for tool drops
timeoutMs (U19), hover drops settle (U20), SDK swallows a failed wait (U21), CLI cap raised (U22), CLI `--text-gone` value leaks (U23). All caught.
Live (10): L1 (unavailable=met), L2 (textGone unavailable=gone), L3 (once), L4 (dialog ignored), L5 (no settle bound), L6 (OR), L7 (D16 removed),
L8 (js throw transient), L9 (settlePage no-op), L10 (hover drops settle). All caught. Sources restored byte-identically (sha256) and rebuilt afterwards.

## audit-1 minors closed (follow-up, 2026-09-30)

Evidence: `../audit-1-followup/`. No product source changed except two doc strings (MCP tool description, a JSDoc).

| Item | How it could pass while broken | Ruled out by |
|---|---|---|
| F1 P7 (X6, settle `timeoutMs` ignored) | The upper bound is asserted on a fake clock only, so it could pass because the fake timers never fire the real bound; or pass because both halves are mocked | P7 also asserts `evaluate(fn,300,100)` and `waitForNetworkIdle({timeout:100})` (the mocks see the override) and that the wait is NOT done at 100+500-1 ms and IS done at +2 ms. `mutate-unit.mjs X6` -> CAUGHT, failing test is P7 (`mutation-unit-X1_X2_X5_X6.json`) |
| F1 P8 (X5, network half not awaited) | A mock where `waitForNetworkIdle` resolves at once would pass under either implementation | The mock's idle promise stays pending; the test checks `done===false` after 1000 fake ms, then true right after resolving it. X5 -> CAUGHT, failing test is P8 |
| F2 W16d (X1, js-only skips dialog gate) | The mock `evaluate` returns `true` for js, so an ungated probe would also "work" | Asserts `fatal.kind==='dialog'`, `last.js==='unavailable'` and `main.evaluate` never called (also with `timeoutMs:0`). X1 -> CAUGHT, failing test is W16d |
| F2 W16e (X2, grace never resets) | Real-clock timeline: under heavy load the windows could slide so that the second dialog is open >1 s and the correct code fails | Second dialog is open ~500 ms at most (wait ends at 1700 ms, dialog B from 1200 ms), 500 ms margin; the wait runs on the same monotonic clock. Correct code passed 5 of 5 repeated runs of the two spec files (`repeat-new-tests.log`) plus two full-suite runs; X2 -> CAUGHT, failing test is W16e |
| Mutants restored | A restore could leave a trailing edit | sha256 of `condition-wait.ts` and `page-settle.ts` before and after are identical and equal the auditor's `sha-before-mutation.txt` (`sha-before.txt`, `sha-after.txt`) |
| Docs (F3/F4/F5) reach the shipped bundle | A stale dist (turbo cache) would still contain the old text | `turbo run build --force` (19+9 tasks, 0 cached), then `grep -o` in `packages/sutradhar/dist/mcp-cli.js`: new phrases 1 each, old "within about a second" 0 (`bundle-grep.log`); M8 was run against the OLD description and FAILED (`mcp-test-fails-on-old-description.log`) |
