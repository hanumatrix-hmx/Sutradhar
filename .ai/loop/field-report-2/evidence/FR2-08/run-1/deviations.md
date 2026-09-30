# FR2-08 run-1: deviations from spec.md

The spec was written against base `6ce4e18`; the code is at `75b29c6` (+ `f995db4`, a decisions-only commit). FR2-01..07, 09, 10, 12, 16
landed in between. Every anchor below is by SYMBOL NAME and was re-read at the current base.

## A. Re-verification of the section-0 trace claims against current code

| claim | verdict at current base | evidence |
|---|---|---|
| T1 `ActionParams.settle?: boolean \| SettleSpec` | still true | `action-types.ts` (`SettleSpec`, `ActionParams.settle`) |
| T2 `DEFAULT_SETTLE_SPEC = {300,500,5000}` | true; now lives in `page-settle.ts` (moved, values unchanged) | `page-settle.ts` |
| T3 settle is generic in the engine, success path only, before `verifyAction` | true (call site now `if (params.settle && tab.page) await waitForPageSettle(...)`) | `executeActionSerialized` |
| T4 algorithm (evaluate w/ MutationObserver + `waitForNetworkIdle`) | true, byte-for-byte the same page calls | `page-settle.ts`; engine spec test "post-action settle wait" passes UNCHANGED |
| T5 no Node-side bound: settle + open dialog blocks to the 30 s auto-dismiss | **CONFIRMED live on the pre-change build 75b29c6** and fixed (D14). Before/after in `t5-before-after.md` | `live/baselines.jsonl`, `live/live-mcp.jsonl` case N18 |
| T6 settle cannot see a pending timer | CONFIRMED live (L1b: the click with `settle:true` returned before the 2 s toast) | `live/live-mcp.jsonl` L1b |
| T7 engine tests pin the settle call shape | true; **lines moved** (spec: `:1880-1970`; now the `describe('... post-action settle wait')` block near `:2456`); no assertion changed | `git diff` of the spec shows additions only |
| T8 no text/URL/JS wait on any surface | true at base | grep |
| T9 engine `'wait'` is a fixed sleep with no public tool | true | `browser-action-engine.ts` |
| T10 `runtime.audit`/`compareUrls` fixed sleeps | true: `audit` sleeps `settleMs ?? 1500`, `compareUrls` `settleMs ?? 500` (lines moved) | `runtime.ts` (out of scope, logged as a gap) |
| T11 AGENT_SETUP tool count "68", no waiting guidance | **count was 71 at base** (FR2-12 added `browser.audit`, etc.); now 72 | `AGENT_SETUP.md`, `EXPECTED_BROWSER_TOOLS.length` |
| T12 GAP-002 sleeps at `run-cli.mjs:152`, `:437` | true, same lines | `run-cli.mjs` |
| T13 `waitForFunction` default polling `'raf'` | true (puppeteer-core 25.5.0 `api/Realm.js:45`) | source |
| T14 all three pollers run in the page | true (`common/WaitTask.js:66-93`) | source |
| T15 rAF stalls in a hidden tab | CONFIRMED live again here: `rafCallsIn500ms:0`, and Puppeteer's own `waitForFunction({polling:'raf'})` in the hidden tab rejected after 10009 ms (case B-RAF) while `wait_for` succeeded (L2-*) | `live/live-summary.json` informational |
| T16 in-page interval polling is also throttled (about 1 s) | **NOT reproduced** here: `waitForFunction({polling:100})` in the same hidden tab resolved 30 ms after the event (case B-INT). Either headless Chrome does not clamp this tab's timers, or the clamp is not applied to this page. The conclusion "use Node-side polling" stands on the rAF result and on mutation polling not seeing JS state / pushState, not on interval throttling | B-INT |
| T17 a string predicate is blocked by a strict CSP | **REFUTED** live: Puppeteer's `waitForFunction('window.__flag === true', {polling:100})` RESOLVED on the `script-src 'nonce-fr208'` page (case B-CSP). Puppeteer compiles it in its own (isolated) world, which the page CSP does not govern. The spec asked for this to be "confirmed live"; it was not. The changelog therefore does NOT claim CSP as a reason; `wait_for` still works on the CSP page (L8) | B-CSP, L8 |
| T18 engine `maxRetries` defaults to 2 | true (`maxRetries` default logic near `executeActionSerialized`) | engine |
| T19 per-tab queue | true; `wait_for` bypasses it (D1) | engine |
| T20 `ActionResult.actionType` is a `string` | true, no union change needed | `types.ts` |
| T21 `getPendingDialog` optional on test tabs | true; every call is `tab.getPendingDialog?.()` | `runtime.ts` |
| T22 `tab.navigate` waits for DCL only | true | `browser-tab.ts` |
| T23 arity pins | true; **tests moved**. The pins still hold (`M7`/`M7b`/`S4`/`S5` re-assert them for every changed handler) | `tools.spec.ts`, `api.spec.ts` |

## B. Deviations from the spec (each with the reason)

1. **The visible-text semantics are FR2-07's final "rendered text" contract, not the spec's D3 "innerText".** The spec (written before FR2-07's
   root-cause redesign) says `text` = case-sensitive substring over `document.body.innerText`. FR2-07 fix-2 replaced that with a text-node walk
   (Range client rects + computed visibility + `checkVisibility()` + parent-side frame judging, whitespace-collapsed, `text-transform` applied).
   Per the FR2-08 decision "reuse `pageContainsVisibleText`, do not write a second predicate", `wait_for.text`/`textGone` call the shared
   `probeVisibleText` and therefore have FR2-07's contract and its documented limits (GAP-329 SVG never-painted containers, GAP-331 split
   inline-block / `<textarea>` text). Consequences: `opacity:0`, `aria-hidden`, off-screen and clipped text count (as in D3); text inside a 0x0
   `overflow:hidden` box counts (as in D3, case N17); matching is whitespace-collapsed and may span inline siblings of one block (D3 said `\n`).
2. **`probeVisibleText(page, text, timeoutMs)` is exported from `execution-verifier.ts` (the spec's §1.5 says the same); its page parameter is
   `VisibleTextPage {frames(), mainFrame()}` over Puppeteer `Frame`s**, not the spec's structural `ConditionFrame {isDetached, evaluate}`. The shared
   probe needs `parentFrame()`/`frameElement()` (parent-side hidden-frame judging), so a mock child frame must provide them; the unit helpers do.
3. **The probe evaluates the frames of one pass CONCURRENTLY (short-circuit on found, per-frame bound), not strictly sequentially (spec W20 /
   PROB-015).** That is FR2-07's audited design (audit-2 A2-2: one hung out-of-process frame must not mask text the main frame has); forking it would
   violate "do not write a second predicate". What stays sequential is everything wait_for owns: a pass starts only after the previous pass finished
   (asserted by W20 as "one frame never has two evaluates in flight across passes"), and keys within a pass run one after another. Every abandoned
   probe is handled (`bounded` attaches a handler), asserted by W17/P3 (no unhandled rejection).
4. **Timeout messages for an unavailable text probe carry the probe's own wording** (`only 0 of 1 frames answered (1 did not answer within
   1500ms; hung:...)`) instead of the spec's fixed `did not answer within 1500ms`; the pass-bound path still produces the fixed wording. W17 asserts
   `/did not answer within \d+ms/`.
5. **Settle tool count: 22 newly wired MCP tools, not 20.** The spec's §2.6 table lists 22 (4 navigation + 2 point + 13 engine + `upload_file_via_trigger`
   + `fill_form` + `handle_dialog`) but its prose says 20. The table was implemented; `SETTLE_TOOLS` in M6 has 25 (22 + click/type/scroll).
6. **`ERROR_HINTS`: the three `wait_for` entries are placed FIRST, not after FR2-01's entries.** A `textGone` timeout message reads `textGone "X" is
   still visible`, which contains FR2-01's `WAIT_HIDDEN_CONFIRMED_VISIBLE_FRAGMENT` (`is still visible`); placed after, it would have received the
   misleading "The element is still visible. Check the selector" hint. Unit test M5 asserts this exact collision; mutant U17 shows it is load-bearing.
7. **`wait_for` verification when `textGone` is vacuous AND another key passed:** the whole verdict is `not-run` (tier `unverifiable`), because
   D11's "vacuous => unverifiable" is applied conservatively to the wait as a whole. The other keys' checks are still listed as `pass`.
8. **`browser.wait_for` handler builds the condition with `Object.fromEntries(...filter(v !== undefined))` instead of a shared `omitUndefined`** (no such
   helper exists in `tools.ts`); behaviour identical (M3 asserts no undefined keys).
9. **CLI `waitfor` positional handling:** `waitForConditionFromArgs(p, positional)` takes the whole `cleanArgs` list (not one `timeoutArg`), so an
   UNQUOTED multi-word value (`waitfor --text Saved successfully`) is rejected with a quoting hint instead of `successfully` being read as a timeout
   error only. It is stricter, not looser, than the spec.
10. **CLI `waitfor --expect-*` is rejected** ("its conditions ARE the assertion"): not in the spec (D10 says wait_for takes no `expect`), added so an
    ignored flag cannot look like a check.
11. **CLI validates the condition BEFORE opening a session** (`normalizePageCondition` in `cmdWaitFor`). Found live (N-C5): calling
    `printErrorAndExit` from inside `withSession` crashed Node on Windows with a libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING)`), the same
    hazard FR2-04 documented for `cmdDialog`. The runtime still validates too.
12. **CLI `dialog` verb gets NO `--settle`** (spec §2.6 says "ADD if `cmdDialog` exists"). `cmdDialog` is gate-exempt and by design never attaches the
    runtime (it talks to the dialog warden / a browser-level broker), so there is no page to settle. Logged under the existing GAP-040.
13. **CLI N-C4 (dialog during `waitfor`):** the wait's OWN fatal ("wait_for blocked by an open alert dialog ...", exit 3) fired (1.3 s), not the CLI's
    pre-emption text ("a alert dialog opened while ..."). Both exit 3. A `waitfor` cannot START while a dialog is already open (FR2-04's gate exits 3
    first), so the spec's "a url-only wait continues unaffected" holds on MCP/SDK but not on the CLI; documented in the CLI README.
14. **SDK `page.waitFor({timeoutMs})` is rejected in `Page.waitFor`** with `unknown key "timeoutMs" — allowed: ..., timeout`: the runtime's normalizer
    tolerates `timeoutMs` (it is the runtime's own key), so the spec's S6 ("the runtime's unknown-key TypeError propagates") could not hold.
15. **`packages/sutradhar/AGENT_SETUP.md` is NOT committed:** it is gitignored in this repo and mirrored from the root copy by `scripts/build-bundle.mjs`
    (the spec §1 row 18 assumed a tracked mirror). The root `AGENT_SETUP.md` is the one edited.
16. **`page-settle.ts` `resolveSettleSpec` ignores explicitly-`undefined` fields of a settle object** (`{timeoutMs: undefined}` no longer wipes the
    default via spread). A strict improvement over the engine's old `{...DEFAULT, ...settle}`; P1 asserts it.
17. **`waitFor` title read is bounded** (`readTitleBounded`, 1.5 s, cached title as the fallback) rather than the spec's plain `readTitle`, so a wait that
    failed BECAUSE the page is stuck cannot hang on `page.title()`.
18. **Settle on runtime-level methods runs after FR2-07's built-in observation and before `verifyAction` (D15), including `uploadFileViaTrigger`**
    (the spec's §2.4 table says "after `fileChooser.accept`"; D15 governs).
19. **Live-harness structure:** MCP N18 measures the settle overhead against a same-call no-settle control (a click that opens a dialog takes ~3 s
    even without settle, pre-existing) instead of a flat "within 2000+500+1500 ms of sentAt"; the pre-change build is recorded by `--baseline`.
20. **The GAP-325 tolerance** (fail-closed `unavailable` naming `hung:http://localhost:...`) is inherited from FR2-07's harness with the same per-surface
    cap of 3; see `false-pass-analysis.md` for whether it fired.
21. **Hung-frame live cases (H1-H3) establish their premise first.** Two harness changes, both event-based and neither loosening a product assertion:
    (a) they wait only for the page's own marker (`window.__mx === 1`), not `readyState === 'complete'` (a hung child frame can keep the parent's load
    event from firing; one full run failed on that wait); (b) they wait until the INDEPENDENT observer confirms a frame is really hung (its evaluate does not
    answer), else the case fails as "precondition not established". (b) was found by the fresh re-run: run as the first such case in a process, H3 failed
    because the out-of-process frame had not started looping yet, so observer and product both correctly got an answer from it (`hung: 0`).
22. **Live mutants use `tsc -p <package>` rebuilds of the mutated package (not the whole turbo build).** L5's mutant made `tsc` exit 2 (an unused local) but it
    still emitted; the run still exposed the old 30 s hang, so it counts as caught. The restored source was rebuilt and a final forced full rebuild followed.
