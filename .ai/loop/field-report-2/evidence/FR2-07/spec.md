# FR2-07: A single verification contract, implementation spec

**Item:** FR2-07 (Phase 2, agent ergonomics). It replaces today's patchwork, where some results carry a real check, some carry a generic 0.45 "unverified", and some carry nothing, with one contract that every action result follows.

**Base:** HEAD `767ed73` on `claude/field-report-2-loop`. At this commit only FR2-01's code has landed (at AUDIT(2)). FR2-02 through FR2-06 exist only as specs. Line numbers below were read at `767ed73`. FR2-01 (still possible in a fix cycle), FR2-02, FR2-03, FR2-04, FR2-05 and FR2-06 all merge first, and together they touch every file this item touches. The Executor therefore anchors **by symbol name, not by line number**.

**Decisions in force:**
- §4.8: a check that can't really be verified returns `verified:false` with a concrete reason. Confidence is never raised without a real post-condition check.
- §4.9: prefer additive, the smallest diff, and consistency with the surrounding code.
- FR2-04 D-1: nothing page-observable that disguises a page primitive. This item adds no overrides of page APIs. It uses only listeners and expandos, the same precedent as `verifiedClickOnHandle`'s `__ptClicked`.

**Hard preconditions:** FR2-05 and FR2-06 must be DONE. FR2-05's `download_file` rewrite (the `filePath` from CDP plus guid filtering) is the path this item's `fs.stat` check reads. FR2-06's reordered `uploadFileViaTrigger` is the shape §2.9 builds on.
- If `grep -n "evt.filePath" packages/browser/src/actions/browser-action-engine.ts` finds nothing, the Executor stops and reports.
- If `grep -n "InvalidSelectorError" packages/capability-runtime/src/runtime.ts` finds nothing, the Executor stops and reports.

FR2-04's `getPendingDialogDetail` and `getPendingDialogs` are used **when present**, with a fallback (§2.11). So FR2-04 is a soft dependency.

**Sequencing:** DEVELOP runs after FR2-06, with no parallel Executor (see the §1 overlap table).

**Versioning:** no version bump. The item writes `evidence/FR2-07/changelog-fragment.md` (§7.2).

---

## 0. Trace results (grounded at `767ed73`)

### 0.1 What the verifier does today

| # | Finding | Evidence |
|---|---|---|
| T1 | `verifyAction(tab, previousUrl, actionResult, spec = {})` defaults `candidateConfidence` to 0.9. The branches, in order: (1) the action failed → `confidence 0`, reason `Action failed: …`; (2) `shouldUrlChange && !urlChanged` → ×0.5; (3) `expectedUrlSubstring` not in the URL → ×0.4; (4) `expectedElementText` not found → ×0.5; (5) `candidateConfidence < 0.5` → `verified:false, confidence = candidate`; (6) no spec and not in `SELF_VERIFYING_ACTION_TYPES` → `verified:false`, ×0.5 (**0.45**), with a generic "no built-in post-condition check" reason; (7) otherwise `verified:true, confidence = candidate`. | `execution-verifier.ts:12-126` |
| T2 | **Today's `SELF_VERIFYING_ACTION_TYPES` has exactly 10 entries**: click, click_by_role, click_by_text, type, type_by_label, hover, select_option, upload_file, scroll, drag_and_drop. **`wait_for_selector` is NOT in it.** FR2-01 gave it a real in-dispatch check (it throws unless the requested state was observed, `browser-action-engine.ts:681-754`), but it never added it to the set. A **successful** wait therefore still reports `verified:false, 0.45` over MCP today. | `execution-verifier.ts:162-173` |
| T3 | Each of the 10 self-verifying types verifies **inside `dispatchAction` by throwing**. A failed post-condition becomes `success:false` and goes through the retry loop. The verifier never sees a "contradicted" state for them. | engine `:494-967` |
| T4 | `pageContainsText` uses `textContent` over the body plus open shadow roots. **That counts `display:none` text and `<script>` source**, so `expectedElementText` can pass on text that isn't visible. It calls `page.evaluate` with **no timeout**, so a pending dialog blocks it until the 30 s auto-dismiss. A throw is reported as "not found". It doesn't look inside iframes. | `execution-verifier.ts:133-151` |
| T5 | `VerificationResultDto` is `{verified, urlChanged, elementFound, confidence, reason}`. **There is no `evidence` field.** `VerificationSpec` is `{expectedUrlSubstring?, expectedElementText?, shouldUrlChange?, candidateConfidence?}`. `shouldUrlChange:false` is **ignored** (only `true` is checked). | `action-types.ts:30-44`, verifier `:33` |
| T6 | The engine calls the verifier from exactly 2 places: success (`:290-296`, after settle) and final failure (`:387-392`). **`checkDuplicateAction`'s rejection result has no `verification` at all** (`:437-446`). | engine |

### 0.2 What each affected action returns today

| Action | Path | `verification` today | What really happens |
|---|---|---|---|
| `press_key` | engine `:585-590` → `page.keyboard.press` | `false`, 0.45, generic | Nothing is observed. PROB-043 (`known-problems.md:461-468`) documents a real historical case where `press_key('A')` reported success while nothing landed. |
| `focus` | engine `:794-804` → `handle.focus()` | `false`, 0.45 | Nothing is observed. A non-focusable `<div>` "succeeds". |
| `touch_tap` | engine `:857-868` → `handle.tap()` | `false`, 0.45 | Nothing is observed. |
| `download_file` | engine `:870-938`, resolves on the CDP `completed` event | `false`, 0.45 | There's no filesystem check. A 0-byte file, or a file under a different name, still "succeeds". |
| `wait_for_selector` | engine `:681-754` | `false`, 0.45 (T2) | **The check is real**, but it isn't reported. |
| `take_screenshot` (engine; only `browser-skills-library.ts:104` uses it) | `:806-810` | `false`, 0.45 | — |
| `browser.screenshot` / `runtime.screenshot` | `runtime.ts:832-841` **skips the engine** | **none**. MCP returns only an image (`tools.ts:908-926`) | — |
| `navigate` | `runtime.ts:377-387` → `tab.navigate` → `page.goto` (`browser-tab.ts:234-254`) | **none** (`NavigateResult {tabId,url,title}`) | A goto that doesn't throw is taken as success. The HTTP status is discarded. |
| `go_back` / `go_forward` | `runtime.ts:389-401` | **none** | **`page.goBack()` resolves `null` when there's no history entry, and that is silently reported as success.** |
| `reload` | `runtime.ts:403-408` | **none** | — |
| `click_at_point` | `runtime.ts:514-542` → `page.mouse.click` | **none**. MCP's description (`tools.ts:478`) says it "bypasses element resolution and verification entirely" | There's no dialog race (GAP-019). An off-viewport point "succeeds". |
| `drag_at_points` | `runtime.ts:552-584` | **none** | — |
| `set_clipboard` | `runtime.ts:1316-1336`, returns `void`; MCP gives `{success:true}` (`tools.ts:1415-1429`) | **none** | The write runs in the page's main world, so a page that monkey-patches `writeText` turns it into a silent no-op. |
| `get_clipboard` | `runtime.ts:1288-1312`, returns `string` | **none** | **When both read paths are blocked, it returns `''` silently**, which is indistinguishable from an empty clipboard. |
| `upload_file_via_trigger` | `runtime.ts:1344-1363`, returns `void`; MCP gives `{success:true, filePath}` | **none** | There's no read-back. Puppeteer's `FileChooser` has no public element accessor (`puppeteer-core@25.5.0 lib/types.d.ts:3024-3046`). |
| `fill_form` failure entries | `runtime.ts:618-626` | **none** on the catch path | — |

### 0.3 Surface exposure

| # | Finding | Evidence |
|---|---|---|
| T7 | **`verificationSpec` isn't reachable from any public surface.** Grep across `packages`, `apps` and `tools` finds it only in `action-types.ts`, the engine, the verifier, `browser-action-engine.spec.ts` and `capability-runtime/scripts/smoke-wave12.mjs:119`, which calls the engine directly. It isn't in the runtime's method signatures, `tools.ts`, `cli.ts` or `page.ts`. | grep |
| T8 | `runtime.runAction` (`:1642-1662`) copies `result.verification` through. MCP `jsonResult` (`tools.ts:82-94`) serialises the whole object. So adding fields to `VerificationResultDto` flows to MCP JSON automatically for the 19 engine-routed tools. | |
| T9 | **CLI:** no verb prints anything from `verification` (`cli.ts:309-686`); only `success` and `error` are printed. `--json` exists only for `snap` (`parse-args.ts:92`, `cli.ts:266`). `cmdPress` runs `runtime.focus(...).catch(() => {})` and presses anyway (`:356`, GAP-025). There are no `back`/`forward`/`reload` verbs. | |
| T10 | **SDK:** `Page.click`/`type`/`press`/`scroll` return `void` and discard `success:false` (`page.ts:105-146`, GAP-024). `goto` returns `Page`. `screenshot` returns `string`. Only `waitForSelector` throws (FR2-01 D3). There are no `goBack`/`goForward`/`reload` methods. | |

### 0.4 Backward-compatibility scan (question 5)

Grep over `packages`, `apps`, `tools` and `scripts` for `verification`, `.verified` and `confidence` finds **no consumer that branches on the absence of `verification`** for any of the affected action types.

| Consumer | Reads | Affected? |
|---|---|---|
| `tools/reliability/prob043-mcp-soak.mjs:185,203` | `action.verification?.verified` and `(action.verification && !action.verification.verified)` | Only for `browser.type`, which already had verification and stays self-verifying. `checkedPress` (`:227-238`) reads only `success`. **Unaffected.** |
| `tools/scenario-suite/run-{mcp,cli,sdk}.mjs` | UC-12 re-reads the DOM independently. It never reads `verification`. CLI checks use `startsWith`/`includes` on stdout (`run-cli.mjs:72,135,…`). | An extra trailing stdout line is safe. |
| `packages/agent` (`agent-loop.ts:388-398`, `recovery-engine.ts`) | `result.success`, `error`, `currentUrl`, `outputData` | Unaffected. |
| `packages/agent/tests/unit/confidence-execution.spec.ts:134-147` | `verifyAction(tab, url, {success:true, actionType:'click'}, {candidateConfidence:0.85})` → `verified:true, 0.85` | Must stay green (§4.0). |
| `apps/server/tests/integration/iba-acceptance.spec.ts:77-84` | `verifyAction(tab, 'about:blank', {success:true, actionType:'navigate'}, {shouldUrlChange:true})` → `verified:true, urlChanged:true` | Must stay green (§4.0). |
| `capability-runtime/scripts/smoke-wave12.mjs:110-122` | `expectedElementText` for text inside an open shadow root → `verified:true` | The text is visible (`<p>` in an open shadow root), so it stays green under the new visible-text semantics. It's a regression gate (§5.9). |

### 0.5 Existing tests that constrain the design (they must pass byte-unchanged)

| Test | What it pins | How the design satisfies it |
|---|---|---|
| `browser-action-engine.spec.ts:464-486` | `press_key` with a mock page (`frames:[]`, `keyboard.press` only, **no `mainFrame`, no `evaluate`**) gives `verified:false` and a reason containing `'no built-in'` | The press observation needs `page.mainFrame()`. Without it, the built-in check becomes `not-run`. The unverifiable reason template is ``'${type}' completed, but no built-in post-condition check could run: ${why}.`` (§2.2). That is honest wording and contains `no built-in`. |
| `:488-506` | `shouldUrlChange` unmet → reason contains `'Expected URL change'` | The spec-failure reason strings are kept **verbatim**. |
| `:508-526` | candidate 0.2 → `confidence 0.2`, reason contains `'below the verification threshold'` | The low-confidence branch still precedes the unverifiable branch. |
| `:528-551` | candidate 0.75, no spec, press_key → `confidence 0.375`, reason contains `'no built-in'` | The unverifiable tier stays at candidate × 0.5 (§2.3). |
| `:553-589` | click and click_by_text self-verifying → `verified:true`, `0.75` | The self-verifying path is unchanged. |
| `:1011-1073` | modifier `order` equals exactly `['down:Control','down:Shift','press:a','up:Shift','up:Control']`; no `down`/`up` without modifiers | The observation never touches `page.keyboard`. |
| `:666-682`, `:1140-1186`, `:1188-1211` | PROB-037 repeats; per-tab serialisation, with 10 ms ticks | With no `mainFrame`, the observation returns synchronously. **No timer is created before the press.** |
| `:1880-1927` | `press_key` settle tests: the page-level `evaluate` spy is **not called** without settle, and called **exactly once** with settle | **No observation may use `page.evaluate`.** Every in-page call goes through `page.mainFrame()` / `frame.evaluate` / `handle.evaluate` / CDP (the same rule as FR2-06's T11). |
| `:1555-1571` | `touch_tap`: `handle.evaluate` always resolves `false`, and `success:true` with `tap` called once | The touch check is an observation and **never throws**. A `false` read gives `contradicted`, and `success` stays `true`. |
| `:1680-1825` | the four `download_file` tests. The files don't exist on disk. They assert `success`, `outputData`, `error` and `detach` | The fs check is an observation. A missing file gives `contradicted`, `success` stays `true`, and there's no extra wait (the `.crdownload` grace applies only when a partial file exists). |
| `:1828-1855` | every action with no page gives `success:false` | Dispatch throws before any observation runs. |
| `mockTab` (`:21-39`) | **has no `getPendingDialog`** | Every dialog check uses optional-call `tab.getPendingDialog?.()`, the same as FR2-06. |
| `mcp-server/tests/unit/tools.spec.ts:183-193` | `browser.screenshot` `content[0]` is the image | The verification goes into `content[1]`. |
| `tools.spec.ts:332-347` | `waitForSelector` spy `toHaveBeenCalledWith('s1','#t',500,undefined,'attached')`. Vitest compares argument arrays **by length** | **Arity rule (§2.6):** a trailing `expect` argument is passed only when it's defined. |
| `sutradhar/tests/unit/api.spec.ts:81-105` | `stub.click` `toHaveBeenCalledWith('sess-1','7','tab-1',undefined,undefined,undefined)` (6 args); the stub resolves `{success:true}` | The same arity rule applies. `success:true` means the new throw doesn't fire. |
| `capability-runtime/tests/unit/runtime.spec.ts:344-358` | unknown session → `BrowserNotAvailableError` for get/set clipboard and uploadFileViaTrigger | `resolveTab` stays the first statement. |

### 0.6 Decisions (the Orchestrator records these in `decisions.md`)

**D1. Evidence has one common shape, not a union per action type.** `evidence = {tier, checks[]}`, where each check is `{check, outcome, expected?, observed?, detail?}` and `expected`/`observed` are scalars only.
- Why not a discriminated union: each action type would get its own JSON schema that ripples into MCP output, the CLI `--json` output, SDK types and FR2-11's history. Consumers would need 15 branches.
- The common shape stays useful for debugging because each `check` id is stable and namespaced (`press_key.key-delivered`, `expect.text`). Its `expected`/`observed` pair says exactly what was compared.
- It can't turn into a dumping ground: values are scalar, strings are capped at 200 characters, and there are at most 8 checks.

**D2. `tier` is explicit.** It is one of `verified | contradicted | unverifiable | low-confidence | action-failed`. Callers never have to decode a confidence number to tell "we checked and it's wrong" apart from "we couldn't check".

**D3. Confidence tiers** (question 4):
- `verified` = candidate (0.9 by default).
- `unverifiable` = candidate × 0.5 (**0.45**, unchanged, and pinned by test `:528-551`).
- `contradicted` = candidate × 0.1 (**0.09**). This is new, and spec failures move here too, from ×0.5/×0.4. No test asserts those numbers (grep).
- `low-confidence` = candidate (unchanged).
- `action-failed` = 0 (unchanged).
- After FR2-07, 0.45 applies only when no real check could run. That covers `screenshot`/`take_screenshot`, `wait`, a `press_key` with no focused target, blocked clipboard reads, remote-browser downloads, dialog-blocked observations and similar cases. It **never** applies to a check that ran and failed.

**D4. New checks observe; they never throw.** A new post-condition that fails leaves `success:true` and sets `verified:false, tier:'contradicted'`.
- Why not throw, like the 10 existing checks: a throw goes through the retry loop. The retry would re-press a key (typing it twice), re-click a download link (duplicate files, GAP-020), re-navigate, or re-write the clipboard. So `success` means "the primitive was dispatched", and `verification` means "its effect was observed".
- The 10 existing throwing checks are **not changed**. Their audited behavior stays.

**D5. `expect` never changes `success`.** A failed `expect` means `success:true`, `verified:false`, `tier:'contradicted'` and a failing `expect.*` check. An action failure means `success:false`, `tier:'action-failed'`, and the `expect.*` checks marked `not-run`. The CLI uses exit 1 for an action failure and **exit 4** for an expectation failure. The SDK throws `ActionFailedError` for an action failure and `ExpectationFailedError` for an expectation failure.

**D6. The `expect` schema is `{text?, url?, urlChanged?}` and maps 1:1 onto `VerificationSpec`.** Two semantic fixes come with it:
- `urlChanged:false` now asserts the URL is **unchanged**. `shouldUrlChange:false` was silently ignored before; grep finds no caller passing `false`.
- `text` now means **visible** text in every live frame and open shadow root, checked with a 1500 ms bound. That fixes T4's false positive, where hidden-template text passed.

`candidateConfidence` stays internal (it isn't in `expect`).

**D7. Unverifiable reasons are specific and follow one template:** ``'<type>' completed, but no built-in post-condition check could run: <specific why>.`` When no `expect` was given, the reason adds ` Pass expect:{text|url|urlChanged} to assert the effect you intended.` The `<why>` texts are enumerated in §2.2 and §2.8.

**D8. `press_key` (with PROB-043 in mind):**
- The check observes the *deep* focused element (through same-origin and cross-origin frames via `frame.frameElement()` identity, and through open shadow roots) and installs a trusted `keydown` listener in that element's own window.
- A key-specific effect rule applies only where the effect is deterministic: printable characters and Backspace/Delete in text-entry controls, and Tab.
- If `activeElement` is `<body>`, the result is **unverifiable**, never verified.
- The listener is read over `Runtime.evaluate`, which is a different CDP path from `Input.dispatchKeyEvent`. That makes it an independent oracle for PROB-043's "keyboard bound to a stale session" theory: in that failure mode no keydown would be observed, so the result would be `contradicted`.

**D9. Navigation identity uses CDP, not page state.**
- `Page.getFrameTree().frameTree.frame.loaderId` changes on every cross-document commit, including a same-URL reload and a bfcache restore. It doesn't change on a same-document navigation.
- `Page.getNavigationHistory()` gives `{currentIndex, entries[].id}`.
- Nothing is written into the page. HTTP status comes from `performance.getEntriesByType('navigation')[0].responseStatus`. A status ≥ 400 counts as `contradicted`.

**D10. The clipboard read-back runs in a CDP isolated world** (`Page.createIsolatedWorld` + `Runtime.evaluate {contextId}`). A page that monkey-patches `navigator.clipboard` in its main world can't spoof it. `getClipboard` uses the same isolated read. When that read is unavailable, it falls back to today's main-world read, and its verification is then `unverifiable` ("read in the page's main world").

**D11. Evidence never contains page field values or clipboard contents.** It records only lengths, a changed/unchanged flag and element descriptors, because passwords and the user's real clipboard (in headed mode) must not leak into logs or history.

**D12. `dialogPending` goes on every MCP and SDK action result once** (closes GAP-018). The shape `{type, message, defaultValue, url}` is exactly FR2-04's `formatDialogPending` JSON (FR2-04 §2.8.5), with the same key order, so there's one contract across all three surfaces. Every renderer-touching observation first checks `tab.getPendingDialog?.()`. If a dialog is pending, the check is `not-run` with the reason `a <type> dialog is open (see dialogPending)`.

**D13. Closed here because they're adjacent and small:**
- **GAP-018:** `dialogPending` on MCP and SDK results.
- **GAP-019:** `clickAtPoint` races `mouse.click` against 1500 ms, like `verifiedClickOnHandle`, so the observation can't hang for 30 s.
- **GAP-024:** the SDK throws `ActionFailedError` on `success:false`.
- **GAP-025:** `cmdPress` aborts if focus fails or is contradicted. Otherwise the press verification would certify a key sent to the wrong element.

**D13a. Logged as new gaps, deliberately out of scope:**
- State setters (`set_cookie`, `set_local_storage_item`, `grant_permissions`, `set_viewport`, …) and read tools (`eval`, `extract_data`, `snapshot`, `get_*`, except `get_clipboard`) don't get the contract.
- There are no CLI `back`/`forward`/`reload` verbs and no SDK `goBack`/`goForward`/`reload`.
- GAP-026 (the trigger click can't reach shadow DOM or iframes) stays open.

**D14. `wait_for_selector`:** FR2-01's code is not modified. Evidence is derived from its output keys (`state`, `matchedAtStart`, `otherVisibleMatches`) after dispatch.
- `hidden` with `matchedAtStart:false` → **unverifiable**, because it's vacuous: a typo'd selector can't be told apart from an element that disappeared. This is FR2-01 spec §7.2 item 4's typo trap.
- `hidden` with `otherVisibleMatches > 0` → verified, following FR2-01's documented first-match rule, with an advisory detail.

**D15. `touch_tap` has a live decision gate** (§5.7). If real Chrome delivers no trusted touch, pointer or click event to a correctly tapped, unoccluded element without touch emulation, the Executor must not ship a check that always fails. `touch_tap` then stays unverifiable, with the reason "touch delivery can't be observed without touch emulation", and the decision is recorded.

---

## 1. Files to touch

| # | File | Change | Prior items that also touch it |
|---|---|---|---|
| 1 | `packages/browser/src/actions/action-types.ts` | Evidence types, `VerificationResultDto.evidence`, `VerificationSpec` doc (`shouldUrlChange:false`), `VerifiableActionType`, `BuiltInVerdict` | FR2-01 (`WaitForSelectorState`, `state`) |
| 2 | `packages/browser/src/verifier/execution-verifier.ts` | Compose tiers, the unverifiable-reason map, `SELF_VERIFYING` += `wait_for_selector`, `pageContainsVisibleText`, `failedVerification`, evidence capping | none (FR2-01 and FR2-04 explicitly didn't; FR2-06 only *calls* `verifyAction` with 4 args, which stays compatible) |
| 3 | `packages/browser/src/verifier/post-conditions.ts` (**new**) | `PostConditionRecorder`, the pure verdict deciders, the self-contained in-page functions, `NavigationProbe`, `statDownloadedFile`, `evaluateInIsolatedWorld`, `readClipboardIsolated`, `inspectPng`, timeouts | — |
| 4 | `packages/browser/src/verifier/index.ts` | `export * from './post-conditions.js'` | — |
| 5 | `packages/browser/src/actions/browser-action-engine.ts` | A recorder per attempt, passed into `dispatchAction`. Checks in the `press_key`, `focus`, `touch_tap`, `download_file` (after FR2-05's containment assertion), `navigate` and `take_screenshot` cases. `wait_for_selector` evidence derived **outside** FR2-01's case. The verifier is called with the built-in verdict. The duplicate-guard result gets `verification`. | FR2-01, FR2-05 (download case), FR2-06 (probe, `toPuppeteerQuery` at the focus/touch_tap sites, the D8 no-retry rule) |
| 6 | `packages/capability-runtime/src/types.ts` | `ActionExpectation`, `toVerificationSpec`, `failedExpectations`, `DialogPendingInfo`, `ClipboardReadResult`; adds `ActionResult.dialogPending`, `NavigateResult.verification`/`dialogPending`, `ScreenshotResult.verification`, `DownloadResult.verification?` | FR2-02, FR2-04, FR2-06 |
| 7 | `packages/capability-runtime/src/runtime.ts` | A trailing `expect?` on every action method; checks at the runtime level (navigation ×4, clickAtPoint, dragAtPoints, set/get/readClipboard, uploadFileViaTrigger, screenshot); `runAction` adds `dialogPending`; the `fillForm` catch path gets a verification; a private `verifier` | FR2-01, 02, 04, 05, 06 |
| 8 | `packages/capability-runtime/src/index.ts` | Re-export the evidence types from `@sutradhar/browser` | FR2-01, FR2-05 |
| 9 | `packages/mcp-server/src/tools.ts` | `expectSchema` and `expectDesc`, added to 24 tools with the arity rule. Result shapes for set_clipboard, get_clipboard, upload_file_via_trigger and screenshot. Fix the `click_at_point` description. | FR2-01, 02, 05, 06 |
| 10 | `packages/cli/src/parse-args.ts` | `--expect-text <t>`, `--expect-url <s>`, `--expect-url-changed`, `--expect-url-unchanged`; `expectFlagError` | FR2-01, 03, 04 |
| 11 | `packages/cli/src/verification-output.ts` (**new**, pure) | `formatVerificationLine`, `exitCodeForResult`, `toCliJson`, `EXIT_EXPECTATION_FAILED = 4` | — |
| 12 | `packages/cli/src/cli.ts` | A verification line and `--json` on action verbs; exit 4; `cmdPress` focus gate (GAP-025); `getclipboard` verification on stderr; help text; flag validation in `main()` | FR2-01, 03, 04, 05, 06 |
| 13 | `packages/sutradhar/src/page.ts` | Results returned; the two error classes; `expect` options; `lastResult` | FR2-01, FR2-05 |
| 14 | `packages/sutradhar/src/errors.ts` (**new**) and `src/index.ts` | `ActionFailedError`, `ExpectationFailedError`; exports | FR2-01, FR2-05 (index) |
| 15 | `AGENT_SETUP.md` + `packages/sutradhar/AGENT_SETUP.md` (identical), `packages/mcp-server/README.md`, `packages/cli/README.md`, `packages/sutradhar/README.md` | A "Reading results: success vs verification" section; the `expect` option; the CLI flags and exit 4 | FR2-01, 02, 04, 05, 06 |
| 16 | Tests (new): `browser/tests/unit/execution-verifier.spec.ts`, `browser/tests/unit/post-conditions.spec.ts`, `cli/tests/unit/verification-output.spec.ts` | §4 | — |
| 17 | Tests (append only): `browser-action-engine.spec.ts`, `capability-runtime/tests/unit/runtime.spec.ts`, `mcp-server/tests/unit/tools.spec.ts`, `cli/tests/unit/parse-args.spec.ts`, `sutradhar/tests/unit/api.spec.ts` | §4 | all prior items |
| 18 | `tools/scenario-suite/fixtures/fr2-07-verification.html`, `fr2-07-frame.html`, `fr2-07-server.mjs` (new) | §3 | — |
| 19 | `tools/scenario-suite/fixtures/fr2-05-download-server.mjs` | **Additive:** an `empty=1` query option on `/file` (Content-Length 0) | FR2-05 |
| 20 | `tools/scenario-suite/verify-fr2-07-verification.mjs` (new) | §5 | — |
| 21 | `.ai/loop/field-report-2/evidence/FR2-07/changelog-fragment.md` (new) | §7.2 | — |

**Not touched:**
- `browser-tab.ts`. FR2-04 owns it. This item only *reads* `getPendingDialog`/`getPendingDialogDetail`.
- `packages/agent`, `apps/server` (they only receive the richer DTO), `session-manager.ts`.
- The 10 existing throwing checks, including `verifiedClickOnHandle`, `clearAndType`, and the `upload_file`/`select_option` read-backs.
- FR2-01's `wait_for_selector` case body and its helpers.
- FR2-06's `selector-dialect.ts`.
- `tools/reliability/prob043-mcp-soak.mjs`, which is run as a gate, not modified.

**How the diff stays additive on shared files:**
- The engine gets one new parameter on `dispatchAction`. The case bodies only gain lines *after* the existing primitive call. The success block gains a recorder and the 5th verifier argument.
- `runtime.ts` methods gain a trailing optional parameter, and return types widen: `void` → `ActionResult`, and `NavigateResult` gains an optional field.
- `tools.ts` gains a schema key on each tool. Only the 4 handlers whose result shape changes are edited.
- `cli.ts` changes only the result-printing lines of the action verbs, plus `cmdPress` and the help text.
- `page.ts` changes the method bodies and return types.

---

## 2. API diff

### 2.1 Types (`action-types.ts`)

```ts
/** How a verification was concluded. Callers branch on this, not on the confidence number. */
export type VerificationTier =
  | 'verified'        // at least one real post-condition check passed and none failed
  | 'contradicted'    // a check ran and found the effect did NOT happen (built-in or expect.*)
  | 'unverifiable'    // no real check could run (the reason says exactly why)
  | 'low-confidence'  // the caller's candidateConfidence is below 0.5 (pre-existing gate)
  | 'action-failed';  // success:false: nothing to verify; expect.* checks are 'not-run'

export type EvidenceOutcome = 'pass' | 'fail' | 'not-run';
export type EvidenceScalar = string | number | boolean | null;

export interface EvidenceCheck {
  /** Stable id: `<actionType>.<name>` for built-in checks, `expect.text|expect.url|expect.urlChanged`
   *  for caller expectations. Catalog in §2.8; ids are part of the public contract. */
  readonly check: string;
  readonly outcome: EvidenceOutcome;
  readonly expected?: EvidenceScalar;   // strings capped at 200 chars ('…' suffix)
  readonly observed?: EvidenceScalar;   // NEVER a field value or clipboard content (D11)
  readonly detail?: string;             // one sentence, ≤ 300 chars
}

export interface VerificationEvidence {
  readonly tier: VerificationTier;
  readonly checks: readonly EvidenceCheck[];   // ≤ 8, built-in first (record order), then expect.* (text, url, urlChanged)
}

/** Result of an {@link ExecutionVerifier} check, attached to {@link ActionResultDto.verification}. */
export interface VerificationResultDto {
  readonly verified: boolean;
  readonly urlChanged: boolean;
  readonly elementFound: boolean;
  readonly confidence: number;
  readonly reason: string;
  /** NEW (FR2-07). What was actually checked and what was observed. */
  readonly evidence: VerificationEvidence;
}

export interface VerificationSpec {
  readonly expectedUrlSubstring?: string;
  /** Must appear in the page's VISIBLE text (any live frame, open shadow roots). FR2-07: was textContent. */
  readonly expectedElementText?: string;
  /** true: URL must differ from the pre-action URL. false (FR2-07): URL must be identical. undefined: not checked. */
  readonly shouldUrlChange?: boolean;
  readonly candidateConfidence?: number;
}

/** The engine's ActionType plus the runtime-level actions that bypass the engine. */
export type VerifiableActionType =
  | ActionType | 'go_back' | 'go_forward' | 'reload' | 'click_at_point' | 'drag_at_points'
  | 'set_clipboard' | 'get_clipboard' | 'upload_file_via_trigger' | 'screenshot';

/** A built-in post-condition's conclusion, produced by the dispatch path, consumed by the verifier. */
export interface BuiltInVerdict {
  readonly outcome: EvidenceOutcome;   // pass | fail | not-run
  readonly reason: string;             // the <why>/<what> sentence, no type prefix
  readonly checks: readonly EvidenceCheck[];
}
```

`ActionType` itself is **unchanged**, so the engine's `default:` case and the FR2-06 tests aren't affected.

### 2.2 Verifier (`execution-verifier.ts`)

**Signature** (widened, backward compatible):
```ts
export interface VerifiableActionResult {
  readonly success: boolean; readonly actionType: string; readonly error?: string;
  readonly outputData?: Record<string, unknown>;
}
public async verifyAction(
  tab: IBrowserTab, previousUrl: string, actionResult: VerifiableActionResult,
  spec: VerificationSpec = {}, builtIn?: BuiltInVerdict,
): Promise<VerificationResultDto>;
```
`ActionResultDto` is assignable, and so are the two 4-argument callers in the tests and FR2-06's call.

**Algorithm** (the first matching rule sets `tier` and `reason`; `checks` always contains every check that was produced):

1. `c = spec.candidateConfidence ?? 0.9`. `urlChanged = tab.url !== previousUrl`.
2. **Action failed:**
   - `tier:'action-failed'`, `verified:false`, `elementFound:false`, `confidence:0`, reason `Action failed: ${error ?? 'Unknown error'}` (**unchanged text**).
   - `checks` holds one `{check:'expect.<k>', outcome:'not-run', detail:'the action failed; expectations were not evaluated'}` for each spec key given. Nothing else.
3. **Built-in:** `bi = builtIn ?? (SELF_VERIFYING.has(type) ? selfVerifyingPass(type) : unverifiableDefault(type))`:
   - `selfVerifyingPass(type)` gives `{outcome:'pass', reason:SELF_VERIFYING_DETAIL[type], checks:[{check:\`${type}.built-in\`, outcome:'pass', detail:SELF_VERIFYING_DETAIL[type]}]}`.
   - `unverifiableDefault(type)` gives `{outcome:'not-run', reason: UNVERIFIABLE_WHY[type] ?? 'this action type has no built-in post-condition check', checks:[]}`.
4. **Expect checks**, run in this order and only when the key is present:
   - `shouldUrlChange === true`: `urlChanged` → pass; otherwise fail with reason `Expected URL change from ${previousUrl}, but URL remained ${currentUrl}` (**verbatim**).
   - `shouldUrlChange === false`: `!urlChanged` → pass; otherwise fail with reason `Expected the URL to stay ${previousUrl}, but it changed to ${currentUrl}`.
   - `expectedUrlSubstring`: pass or fail with reason `Current URL ${currentUrl} does not contain expected substring ${s}` (**verbatim**).
   - `expectedElementText`: `pageContainsVisibleText` gives `'found'` → pass, `'not-found'` → fail with reason `Expected text "${t}" was not found in the page's visible text after the action` (it keeps the existing `Expected text "X" was not found` prefix), or `'unavailable'` → not-run with the detail from the helper.
   - Checks record `expected` (the substring or the text, capped) and `observed` (the current URL, or `'found'`/`'not-found'`; the page text itself is never recorded).
5. Any expect `fail` → `tier:'contradicted'`, `confidence: c*0.1`, reason = the first failing expect reason.
6. `bi.outcome === 'fail'` → `tier:'contradicted'`, `c*0.1`, reason ``'${type}' completed, but its post-condition check failed: ${bi.reason}.``
7. `c < 0.5` → `tier:'low-confidence'`, `elementFound:true`, `confidence:c`, with the **existing reason text verbatim**.
8. `anyPass = bi.outcome==='pass' || some expect pass`; `anyNotRun = bi.outcome==='not-run' && !someExpectPass || some expect not-run`. When `!anyPass || someExpectNotRun`:
   - `tier:'unverifiable'`, `c*0.5`.
   - Reason: when some expect is `not-run`, it's `Expectation could not be evaluated: ${detail}`. Otherwise it's ``'${type}' completed, but no built-in post-condition check could run: ${bi.reason}.`` with, when no spec keys were given, ` Pass expect:{text|url|urlChanged} to assert the effect you intended.` appended.
9. Otherwise `tier:'verified'`, `verified:true`, `elementFound:true`, `confidence:c`. The reason is:
   - for a self-verifying type with no builtIn given, the **existing string** (`'${type}' has a built-in post-condition check (verified inside the action itself before it could report success) — confidence …`);
   - when only a spec was checked, the existing `Action execution verified successfully with confidence …`;
   - otherwise ``'${type}' verified: ${bi.reason}`` plus, if any expect passed, ` Expectations met: text, url.` (listing them).
10. `evidence = capEvidence({tier, checks: [...bi.checks, ...expectChecks]})`. This truncates strings (200) and detail (300), and keeps the first 8 checks. When it drops any, it appends ` (+N more checks omitted)` to the 8th check's detail.

**`UNVERIFIABLE_WHY`** (exact texts; used only when no builtIn verdict was supplied):
- `wait`: `a fixed-duration sleep has no post-condition`
- `take_screenshot` / `screenshot`: `a screenshot does not change the page, so there is no effect to verify`
- `press_key`, `focus`, `touch_tap`, `download_file`, `navigate`, `go_back`, `go_forward`, `reload`, `click_at_point`, `drag_at_points`, `set_clipboard`, `get_clipboard`, `upload_file_via_trigger`: `no observation was supplied to the verifier for this action (it was verified outside the engine path that records one)`. This is reached only by direct verifier callers such as `iba-acceptance`, never by the product paths.

**`SELF_VERIFYING_ACTION_TYPES`** = the existing 10 plus `'wait_for_selector'`. The comment is updated: the engine *records* the verdict for `wait_for_selector`, and the set entry covers direct verifier callers.

**`SELF_VERIFYING_DETAIL`**:
- click / click_by_role / click_by_text: `occlusion and click-delivery were checked inside the action before it reported success`
- type / type_by_label: `the typed value was read back from the element inside the action`
- hover: `occlusion at the hover point was checked inside the action`
- select_option: `the selected value(s) were read back inside the action`
- upload_file: `the input's files list was read back inside the action`
- scroll: `scroll position movement was read back inside the action`
- drag_and_drop: `a 'drop' event on the target was observed inside the action`
- wait_for_selector: `the element was observed in the requested state inside the action`

**`pageContainsVisibleText(tab, text): Promise<'found'|'not-found'|'unavailable'>`:**
- If `tab.getPendingDialog?.()` is pending → `'unavailable'` with detail `a <type> dialog is open (see dialogPending); the page can't be inspected until it's handled`.
- No page → `'unavailable'`.
- Otherwise, for each live frame (`page.frames().filter(f => !f.isDetached())`, main frame first) run `frame.evaluate(visibleTextContainsInPage, text)`.
  - The in-page function (self-contained) returns true if `document.body.innerText` contains `text`, or if for any element with an open `shadowRoot` (recursively) any child `Element` of that root has `innerText` containing it.
  - `innerText` excludes `display:none` and `<script>`/`<style>`.
- The whole loop races `EXPECT_TEXT_TIMEOUT_MS = 1500`. On timeout → `'unavailable'` with detail `the page did not answer the text check within 1500ms`.
- If any frame says true → `'found'`. If every frame answered false → `'not-found'`. If some frames threw and none were true → `'unavailable'` with detail `N of M frames could not be inspected`.
- **It never uses `page.evaluate`.**

**`failedVerification(error: string, expectKeys: string[] = []): VerificationResultDto`** is exported. It produces rule 2's output without a tab, and is used by the duplicate guard, `fillForm`'s catch path and `clickAtPoint`/`dragAtPoints` failures.

### 2.3 Confidence table (the whole contract)

| tier | verified | confidence (c = candidate, default 0.9) | elementFound |
|---|---|---|---|
| verified | true | c (0.90) | true |
| low-confidence | false | c | true |
| unverifiable | false | c × 0.5 (0.45) | false |
| contradicted | false | c × 0.1 (0.09) | false |
| action-failed | false | 0 | false |

### 2.4 `post-conditions.ts` (new, `@sutradhar/browser`)

```ts
export const OBSERVE_BEFORE_TIMEOUT_MS = 1000;
export const OBSERVE_AFTER_TIMEOUT_MS = 1500;
export const EXPECT_TEXT_TIMEOUT_MS = 1500;
export const NAV_PROBE_TIMEOUT_MS = 1000;
export const CLIPBOARD_READBACK_TIMEOUT_MS = 1500;
export const DOWNLOAD_PARTIAL_GRACE_MS = 2000;
export const DOWNLOAD_MTIME_TOLERANCE_MS = 2000;
export const EVIDENCE_STRING_MAX = 200, EVIDENCE_DETAIL_MAX = 300, EVIDENCE_MAX_CHECKS = 8;

export class PostConditionRecorder {
  constructor(actionType: string);
  check(c: EvidenceCheck): void;                         // appended in order
  verdict(outcome: EvidenceOutcome, reason: string): void; // last call wins
  toBuiltIn(): BuiltInVerdict | undefined;               // undefined iff nothing recorded AND no verdict set
}

/** Races `p` against `ms`; resolves {ok:true,value} | {ok:false, timedOut:boolean, error?:string}. Never rejects;
 *  attaches a no-op catch to `p` (PROB-015 rule: an abandoned promise must never go unhandled). */
export function bounded<T>(p: Promise<T>, ms: number): Promise<BoundedResult<T>>;

/** Pure: `tag#id.cls1.cls2` (≤ 80 chars) + ` [#N]` when data-sd-node-id is present; 'body'; 'null'. */
export function describeElementInPage(el: Element | null): string;   // self-contained (serialised into pages)
```

**Pure deciders** (each unit-tested, §4.2). They take plain observation objects and return a `BuiltInVerdict`:
- `decideKeyVerdict(obs: KeyObservation)`
- `keyEffectRule(key, modifiers, target: TargetInfo): 'value-changed' | 'focus-moved' | 'none'`
- `keyMatches(requested, {key, code}): boolean`
- `decideFocusVerdict`, `decideNavigationVerdict`, `decidePointVerdict`, `decideDragVerdict`, `decideUploadVerdict`, `decideClipboardVerdict`, `decideDownloadVerdict`
- `inspectPng(buf: Buffer): {ok: true; width; height} | {ok: false; why}`. It checks the signature `89 50 4E 47 0D 0A 1A 0A`, then that the IHDR chunk type is at bytes 12..15, then that width and height (big-endian at 16..23) are both > 0.

**Observers** (I/O, each wrapped by `bounded`, never throwing):
- `observeFocusForKey(page)` / `finishKeyObservation(page, handle, params)` (§2.8.1)
- `NavigationProbe.begin(page)` / `probe.finish(kind, requestedUrl?)` (§2.8.4)
- `observePoint(page, x, y, deliveryEvent)` / `finishPointObservation` (§2.8.6)
- `observeUploadTargets(page)` / `finishUploadObservation(page, fileName, fileSize)` (§2.8.7)
- `statDownloadedFile(filePath, startedAtMs, {browserWsEndpoint, fs?})` (§2.8.3)
- `evaluateInIsolatedWorld<T>(page, expression, timeoutMs)`: `page.createCDPSession()`, then `Page.getFrameTree`, then `Page.createIsolatedWorld({frameId: mainFrameId, worldName: 'sutradhar-verify', grantUniveralAccess: false})`, then `Runtime.evaluate({expression, contextId, awaitPromise:true, returnByValue:true})`, and `session.detach()` in `finally`. The same session is used for create and evaluate.
- `readClipboardIsolated(page)` gives `{path:'clipboard-api'|'execCommand-paste'|'blocked'|'unavailable', text?: string, error?: string}` (§2.8.5).

Every in-page function is **fully self-contained** (Puppeteer serialises it with `toString()`): no imports, no references to anything outside it. The isolated-world expressions are string literals.

### 2.5 Engine (`browser-action-engine.ts`)

**The success path in `executeActionSerialized`** (inside the `while` loop):
```ts
const recorder = new PostConditionRecorder(params.actionType);          // fresh per attempt
const dispatchPromise = this.dispatchAction(tab, params, recorder);
... (race, settle unchanged)
if (params.actionType === 'wait_for_selector') recordWaitForSelectorEvidence(recorder, resultData); // D14
const verification = await this.verifier.verifyAction(tab, previousUrl, result, params.verificationSpec, recorder.toBuiltIn());
```
A timed-out attempt's orphaned dispatch can write only into its own, discarded recorder.

The failure path (`:387-392`) is unchanged: 4 arguments, so it's `action-failed`.

`checkDuplicateAction`'s returned object gains `verification: failedVerification(error, specKeys(params.verificationSpec))`.

**`recordWaitForSelectorEvidence(rec, out)`** (in `post-conditions.ts`):
- `state = out.state`.
- `state === 'hidden' && out.matchedAtStart === false` → `check({check:'wait_for_selector.state-matched', outcome:'not-run', expected:'hidden', observed:'no-match-at-start', detail:'nothing matched the selector when the wait started, so "hidden" was satisfied vacuously'})`, and verdict `not-run` with `nothing matched "<sel>" at any point, so state "hidden" was satisfied vacuously — a wrong selector and an element that already disappeared look the same`.
- Otherwise the check is `pass` with `expected:state, observed:state`, verdict `pass` with `the element was observed in state "<state>"`. If `out.otherVisibleMatches > 0`, add the detail `N later match(es) of the selector are still visible (visibility is judged on the first match)`.

**`dispatchAction(tab, params, rec: PostConditionRecorder)`.** Only the cases below change, and only by *appending* after the existing primitive call. Every appended block is inside `try { … } catch (e) { rec.verdict('not-run', \`the post-condition check itself failed: ${msg}\`) }`, so a check can never fail the action.

| Case | Appended (details in §2.8) |
|---|---|
| `press_key` | `const pre = await observeFocusForKey(page)` **before** `withModifiers(...)`, then after it `await finishKeyObservation(page, pre, params, rec)` |
| `focus` | after `runHandleOp('focus', …)`: `await checkFocus(handle, rec)` |
| `touch_tap` | before `runHandleOp('touch_tap', …)`: `const mark = await armTouchObservation(handle)`; after it: `await finishTouchObservation(handle, mark, rec)` |
| `download_file` | `const startedAt = Date.now()` at case entry; after FR2-05's containment assertion, before `return`: `await recordDownloadEvidence(downloaded.path, startedAt, page, rec)` |
| `navigate` | `const probe = await NavigationProbe.begin(page)` before `tab.navigate`; after it: `await probe.finish('navigate', params.url, rec)` (when there's no page, the probe is a no-op, so the result is `not-run`) |
| `take_screenshot` | after capture: `rec.check(pngCheck(Buffer.from(buf,'base64')))`, then `rec.verdict('not-run' or 'fail', …)` (§2.8.9) |

**`page.evaluate` is never used for any of these** (§0.5).

### 2.6 Runtime (`runtime.ts`) and types (`types.ts`)

**Types (`types.ts`):**
```ts
/** Public, caller-facing post-action assertion (MCP `expect`, CLI --expect-*, SDK options.expect). */
export interface ActionExpectation {
  /** Visible text that must appear somewhere on the page after the action (any frame, open shadow roots;
   *  case-sensitive substring; display:none / script text does not count). Checked once, right after the action. */
  text?: string;
  /** Substring the tab's final URL must contain. */
  url?: string;
  /** true: the URL must differ from the pre-action URL; false: it must be identical (string compare, fragment included). */
  urlChanged?: boolean;
}
/** Throws TypeError on: non-object; unknown key; text/url not a non-empty string; urlChanged not boolean. Returns undefined for undefined. */
export function toVerificationSpec(e: ActionExpectation | undefined): VerificationSpec | undefined;
//   → { expectedElementText: e.text, expectedUrlSubstring: e.url, shouldUrlChange: e.urlChanged } (undefined keys omitted)
/** The expect.* keys whose check outcome is not 'pass' ('text' | 'url' | 'urlChanged'); [] when none given. */
export function failedExpectations(v: VerificationResultDto | undefined): string[];
export interface DialogPendingInfo { type: string; message: string; defaultValue: string | null; url: string } // = FR2-04 line JSON
export interface ClipboardReadResult { text: string; verification: VerificationResultDto; dialogPending?: DialogPendingInfo }

// ActionResult     += dialogPending?: DialogPendingInfo;   (verification stays optional in the TYPE; runtime always sets it)
// NavigateResult   += verification?: VerificationResultDto; dialogPending?: DialogPendingInfo;
// ScreenshotResult += verification?: VerificationResultDto;
// DownloadResult   += verification?: VerificationResultDto;   (FR2-05's SDK page.download fills it)
```
Re-export `VerificationResultDto`, `VerificationEvidence`, `EvidenceCheck`, `VerificationTier` and `EvidenceOutcome` from `index.ts`.

**Method signatures:** the new parameter is always **last**, which keeps every existing positional call valid.

- **Engine-routed methods** (each forwards `verificationSpec: toVerificationSpec(expect)` in `ActionParams`, and only when `expect` is defined): `click(…, settle?, expect?)`, `focus(sid, target, tabId?, expect?)`, `type(…, settle?, expect?)`, `pressKey(sid, key, tabId?, modifiers?, expect?)`, `scroll(…, settle?, expect?)`, `hover(sid, target, tabId?, offset?, expect?)`, `selectOption(…, tabId?, expect?)`, `selectOptions(…, tabId?, expect?)`, `waitForSelector(sid, target, timeoutMs?, tabId?, state?, expect?)`, `clickByText(sid, text, tabId?, expect?)`, `clickByRole(sid, role, name?, tabId?, expect?)`, `typeByLabel(…, tabId?, expect?)`, `uploadFile(…, tabId?, expect?)`, `clickWithButton(…, tabId?, expect?)`, `dragAndDrop(…, tabId?, expect?)`, `touchTap(sid, target, tabId?, expect?)`, `downloadFile(sid, target, downloadDir?, tabId?, expect?)`.
- **Runtime-level methods:**
  - `navigate(sid, url, tabId?, expect?)`, `goBack(sid, tabId?, expect?)`, `goForward(sid, tabId?, expect?)`, `reload(sid, tabId?, expect?)` → `NavigateResult` (with verification)
  - `clickAtPoint(sid, x, y, tabId?, button = 'left', expect?)`, `dragAtPoints(sid, fx, fy, tx, ty, tabId?, expect?)` → `ActionResult`
  - `setClipboard(sid, text, tabId?)`: **`Promise<void>` → `Promise<ActionResult>`**
  - `getClipboard(sid, tabId?)`: **unchanged**, `Promise<string>`. It now delegates to `readClipboard` and returns `.text`.
  - `readClipboard(sid, tabId?)`: **new**, → `ClipboardReadResult`
  - `uploadFileViaTrigger(sid, trigger, filePath, tabId?, expect?)`: **`Promise<void>` → `Promise<ActionResult>`**
  - `screenshot(sid, tabId?, fullPage = true)` → `ScreenshotResult` with `verification`

`toVerificationSpec` runs **first** in each method, before `resolveTab`. An invalid `expect` is a synchronous `TypeError`, with no browser contact. That's the same class as FR2-06's `InvalidSelectorError`.

**Runtime-level template** (navigation shown; the others follow the same pattern):
```ts
public async goBack(sessionId: string, tabId?: string, expect?: ActionExpectation): Promise<NavigateResult> {
  const spec = toVerificationSpec(expect);
  const { tab } = this.resolveTab(sessionId, tabId);                // unchanged order
  const page = this.requirePage(tab);
  const previousUrl = tab.url;
  const rec = new PostConditionRecorder('go_back');
  const probe = await NavigationProbe.begin(page);                  // bounded; never throws
  await page.goBack();                                              // unchanged primitive; a throw propagates as today
  await probe.finish('go_back', undefined, rec);
  const verification = await this.verifier.verifyAction(tab, previousUrl, { success: true, actionType: 'go_back' }, spec, rec.toBuiltIn());
  return { tabId: tab.id, url: page.url(), title: await this.readTitle(tab), verification, ...this.dialogPendingOf(tab) };
}
```

- `runAction` adds `...this.dialogPendingOf(tab)` to its return.
- `dialogPendingOf(tab)` returns `{dialogPending}` only when a dialog is pending (§2.11). Otherwise it returns `{}`, and the key is **absent**.
- `fillForm`'s catch literal gains `verification: failedVerification(msg)`.
- `clickAtPoint`/`dragAtPoints`'s `success:false` paths gain `verification: failedVerification(msg, specKeys)`.
- `private readonly verifier = new ExecutionVerifier()`.

### 2.7 MCP (`tools.ts`)

```ts
const expectDesc =
  'Optional assertion checked once, right after the action (after settle, if requested). text: visible text ' +
  'that must appear on the page (any frame, open shadow roots; case-sensitive substring; hidden/display:none ' +
  'text does not count). url: substring the final URL must contain. urlChanged: true = URL must differ from ' +
  'before, false = must be identical. A failed expectation does NOT fail the action: success stays true and ' +
  'verification.verified is false with evidence.tier "contradicted" and a failing expect.* check. Every result ' +
  'carries verification {verified, confidence, reason, evidence:{tier, checks}} — tier "unverifiable" means ' +
  'nothing could be checked (the reason says why), not that the action failed.';
const expectSchema = z.object({
  text: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  urlChanged: z.boolean().optional(),
}).strict().optional().describe(expectDesc);
```

- **`expect: expectSchema` is added to these 24 tools:** navigate, go_back, go_forward, reload, click, click_at_point, drag_at_points, type, press_key, focus, scroll, hover, select_option, select_options, wait_for_selector, click_by_text, click_by_role, type_by_label, upload_file, right_click, drag_and_drop, touch_tap, download_file, upload_file_via_trigger.
- **Not added to:** set_clipboard, get_clipboard, screenshot and fill_form. The first three have no page effect to assert. fill_form has per-field results. This is documented in the changelog.
- **Arity rule, in every handler:**
  ```ts
  return jsonResult(await runtime.waitForSelector(sessionId, target, timeoutMs, tabId, state, ...(expect ? [expect] : [])));
  ```
  This keeps `tools.spec.ts:346` byte-unchanged and passing.
- **Result shapes:**
  - set_clipboard: `jsonResult(await runtime.setClipboard(...))`. It still has `success:true`, and is now a superset of `{success:true}`.
  - get_clipboard: `jsonResult(await runtime.readClipboard(...))` gives `{text, verification, dialogPending?}`, a superset of `{text}`.
  - upload_file_via_trigger: `jsonResult({ ...(await runtime.uploadFileViaTrigger(...)), filePath })`, which keeps the top-level `filePath`.
  - screenshot: `content: [{type:'image', data, mimeType}, {type:'text', text: JSON.stringify({ actionType:'screenshot', verification, ...(dialogPending ? {dialogPending} : {}) }, null, 2)}]`.
- The `click_at_point` description drops "bypasses element resolution and verification entirely". The new text: `… Prefer browser.click when there's a real element to target. The result's verification names the element that was actually at the point and whether a trusted click reached it; it can't know which element you intended, so pair it with expect.`
- **No `ERROR_HINTS` change. No tool-count change.**

### 2.8 The real checks, one per action type (exact logic)

A `TargetInfo` is `{kind:'element'|'body'|'none'|'frame-unreachable', desc, textEntry:boolean, readOnly:boolean, selStart:number|null, selEnd:number|null, valueLen:number}`. The in-page functions return one; they **never return the value itself**.

#### 2.8.1 `press_key` (`press_key.focused-target`, `press_key.key-delivered`, `press_key.effect`)

**Before** (`observeFocusForKey`, bounded by `OBSERVE_BEFORE_TIMEOUT_MS`):
1. If `tab.getPendingDialog?.()` is pending → `pre = {skipped:'dialog'}`. If `typeof page.mainFrame !== 'function'` → `pre = {skipped:'no-frame-api'}`. In either case nothing else runs, and **no timer is created**.
2. `frame = page.mainFrame()`, then loop up to depth 4:
   - `info = await frame.evaluate(activeInfoInPage)`. It walks `document.activeElement` through open `shadowRoot.activeElement` levels, and returns `{isFrameElement: el is IFRAME/FRAME, ...TargetInfo}` for the deep element.
   - If `isFrameElement`: `child = first of frame.childFrames() whose (await c.frameElement())?.evaluate(el => el === el.ownerDocument.activeElement)` is true, then `frame = child` and continue. If nothing matches → `kind:'frame-unreachable'`.
3. In the final frame, run `frame.evaluate(armKeyListenerInPage, key, token)`:
   - It stores `window[token] = { el: deepActive, before: <value or textContent>, events: [] }`.
   - It adds a capture listener on `window` for `keydown` that pushes `{key, code, trusted: e.isTrusted, onTarget: e.composedPath().includes(state.el)}` (modifier-only keydowns are ignored unless `key` is a modifier).
   - It sets the expando `state.el.__sdKeyMark = token`.
   - `token` is `'__sdKey_' + random`.

**After** (`finishKeyObservation`, `OBSERVE_AFTER_TIMEOUT_MS`): if `pre.skipped` is set, there's no evaluation. Otherwise, in the same frame, `frame.evaluate(readKeyObservationInPage, token)` returns:
- `{delivered: events.some(trusted && keyMatches), onTarget, valueChanged: currentValue !== before, afterValueLen, focusMoved: deepActive?.__sdKeyMark !== token, afterDesc}`;
- then it removes the listener, `delete window[token]` and `delete el.__sdKeyMark`.

An evaluate error that matches `isContextDestroyedError`, or a `page.url()` different from before, gives `navigated:true`. A timeout gives `timedOut:true`.

**`keyEffectRule(key, modifiers, target)`:**

| target | key | modifiers | rule |
|---|---|---|---|
| `textEntry` (`input` of type text/search/email/url/tel/password/number, or no type; `textarea`; `isContentEditable`), readonly or not | a single character (`[...key].length === 1`) | none, or `['Shift']` | `value-changed` |
| `textEntry` input/textarea with a non-null selection | `Backspace` | none | `value-changed` iff `selStart > 0 \|\| selStart !== selEnd`, else `none` |
| same | `Delete` | none | `value-changed` iff `selEnd < valueLen \|\| selStart !== selEnd`, else `none` |
| any `element` | `Tab` | none, or `['Shift']` | `focus-moved` |
| anything else (Enter, Escape, arrows, F-keys, Control/Meta/Alt combos, contenteditable Backspace/Delete) | | | `none` (delivery only) |

**`keyMatches(requested, {key, code})`** is `key === requested || code === requested || (requested.length === 1 && key.toLowerCase() === requested.toLowerCase())`.

**`decideKeyVerdict`**, in first-match order (checks are always recorded: the focused target, delivery as pass/fail/not-run, and the effect as pass/fail/not-run with `expected: rule, observed: 'length 3→4' | 'moved to input#b' | 'unchanged'`):

| Condition | outcome | reason |
|---|---|---|
| `pre.skipped === 'dialog'` | not-run | `a dialog was already open before the press (see dialogPending); the page couldn't be observed` |
| `pre.skipped === 'no-frame-api'` or pre errored/timed out | not-run | `could not observe the page's focused element before the press (<err>)` |
| `kind === 'frame-unreachable'` | not-run | `focus is inside an <iframe> whose frame couldn't be matched, so its document couldn't be observed` |
| `navigated` | pass | `the page navigated right after the key press, which is treated as delivered (the same rule as click); the key's effect on the old page can't be read` |
| after timed out and a dialog is now pending | not-run | `a <type> dialog opened after the press (see dialogPending); the page can't be inspected until it's handled` |
| after timed out, no dialog | not-run | `the page did not answer the post-press observation within 1500ms` |
| `kind === 'body' \|\| 'none'` | not-run (delivery is still recorded) | `no element had focus (document.activeElement was <body>), so the key went to the page with no target whose effect could be checked` |
| rule `value-changed` and `valueChanged` | pass | `keydown '<k>' reached the focused <desc> and its value changed (length a→b)` |
| rule `value-changed` and not changed | **fail** | `keydown '<k>' <reached/did not reach> the focused <desc>, but its value did not change (length a→a)<; the field is readonly>` |
| rule `focus-moved` and `focusMoved` | pass | `Tab moved focus from <desc> to <afterDesc>` |
| rule `focus-moved` and not moved | **fail** | `Tab did not move focus away from <desc>` |
| rule `none` and `delivered && onTarget` | pass | `keydown '<k>' was delivered to the focused <desc>; no deterministic effect is defined for this key, so only delivery was verified` |
| rule `none` and `delivered && !onTarget` | **fail** | `keydown '<k>' was dispatched while <desc> had focus, but it reached a different element` |
| rule `none` and not delivered | **fail** | `no trusted keydown '<k>' reached the page while <desc> had focus (the key may not have been delivered; a page listener that stops propagation at window capture can also hide it)` |

#### 2.8.2 `focus` (`focus.active-element`)

`checkFocus(handle, rec)` runs `bounded(handle.evaluate(el => { const r = el.getRootNode(); const a = r.activeElement ?? null; return { ok: a === el, observed: <describe a, or 'body'> }; }), 1000)`. `getRootNode()` makes the check local to the element's own document or shadow root, and it runs in the element's own frame (OOPIF included), because the handle lives there.
- pass: `document.activeElement in the element's own document is <desc>`
- fail: `after .focus(), the active element in the element's own document is <observed>, not <desc> (the element may not be focusable, or the page moved focus away)`
- A timeout or dialog gives not-run.
- Detail: when the element is inside a frame, `checked in the element's own frame document`.

#### 2.8.3 `download_file` (`download_file.file-on-disk`)

`statDownloadedFile(p, startedAt, {browserWsEndpoint})`:
1. If `new URL(browserWsEndpoint).hostname` isn't one of `127.0.0.1`/`localhost`/`[::1]`/`::1` → not-run: `the browser runs on another host (<host>), so its download directory isn't on this machine's filesystem`. The endpoint comes from `page.browser().wsEndpoint?.()`. If that's unavailable, the local check is assumed.
2. `fs.stat(p)`. On ENOENT, if `p + '.crdownload'` exists, poll every 100 ms for up to `DOWNLOAD_PARTIAL_GRACE_MS`. If it's still missing → fail `Chrome reported the download complete, but no file exists at <p>` (or `…; only a partial .crdownload file exists`).
3. `!isFile()` → fail `<p> is not a regular file`.
4. `size === 0` → fail `the downloaded file is 0 bytes`.
5. `mtimeMs < startedAt - DOWNLOAD_MTIME_TOLERANCE_MS` → fail `the file at <p> predates this download (modified <iso>), so it isn't this download's output`.
6. Otherwise pass `<size> bytes written to <p> during this action`.

The check records `expected:'>0 bytes, written during this action'` and `observed:'<size> bytes'|'missing'|'0 bytes'|'stale'`.

`outputData` gains `downloadedSizeBytes` when stat succeeded. This is additive: FR2-05's keys are unchanged.

#### 2.8.4 `navigate` / `go_back` / `go_forward` / `reload` (`<type>.document`, `<type>.history-index`, `<type>.http-status`)

**`NavigationProbe.begin(page)`** is bounded by `NAV_PROBE_TIMEOUT_MS` per call:
- `s = await page.createCDPSession()`.
- `hist = await s.send('Page.getNavigationHistory')` gives `{currentIndex, entries}`. `tree = await s.send('Page.getFrameTree')` gives `loaderId`.
- It stores `{url: page.url(), loaderId, index, entryId, entryUrls}`.
- On any failure it stores `{unavailable: reason}`, and `finish` then records not-run: `the navigation baseline couldn't be captured (<reason>)`.

**`finish(kind, requestedUrl, rec)`:**
- It reads history and the frame tree again (the same session, then `detach` in `finally`).
- `newDoc = after.loaderId !== before.loaderId`. `sameDoc = !newDoc && after.url !== before.url`.
- When `newDoc`, it reads the status with `page.mainFrame().evaluate(() => performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0)`, bounded. Status 0 or unavailable → no status check is recorded.

| kind | pass when | fail reasons |
|---|---|---|
| navigate | `newDoc` → `a new document committed at <after.url>` (plus ` (redirected from <requested>)` when it differs). `sameDoc` → `a same-document navigation moved the tab to <after.url>`. `after.url === requestedUrl && !newDoc && !sameDoc` → pass `the tab was already at <url>; Chrome treats this as a same-document fragment navigation with no load` | otherwise: `no new document committed and the URL did not change (<before.url>); the navigation may have been cancelled, e.g. by a beforeunload dialog (see dialogPending)` |
| reload | `newDoc` → `a new document committed (loader changed)` | `reload did not commit a new document` |
| go_back | `before.index === 0` → **fail** `there was no history entry to go back to (index 0 of N)`. Otherwise pass iff `after.index === before.index - 1` → `history moved from entry <i> to <i-1> (<after.url>)` plus ` (same-document)` or ` (new document)` | `the history index did not move (still <i>)` |
| go_forward | `before.index === entries.length - 1` → **fail** `there was no forward history entry`. Otherwise pass iff `after.index === before.index + 1` | `the history index did not move (still <i>)` |
| all, when `newDoc` and status ≥ 400 | — | overrides to **fail**: `the navigation committed, but the server answered HTTP <status>` |

Checks recorded:
- `<type>.document`: `observed:'new-document'|'same-document'|'none'`
- `<type>.history-index`: `expected: i±1, observed: j` (back/forward only)
- `<type>.http-status`: `observed: status`

A dialog pending after `finish` → the status read and frame tree are skipped, and it's not-run: `a <type> dialog is open (see dialogPending)`. `Page.getNavigationHistory` is answered by the browser process, so history is still recorded.

**The engine `navigate` case (agent path) uses the same probe.**

#### 2.8.5 `set_clipboard` (`set_clipboard.read-back`) and `get_clipboard` (`get_clipboard.read`)

- `setClipboard`'s write is **unchanged** (main world, with the existing fallback).
- Then `r = await readClipboardIsolated(page)`, bounded by `CLIPBOARD_READBACK_TIMEOUT_MS`.
- The expression tries `navigator.clipboard.readText()`. On a throw it uses a scratch textarea with `document.execCommand('paste')`, whose **boolean return** decides between `'execCommand-paste'` and `'blocked'`.

| r | outcome | reason |
|---|---|---|
| `text === written` | pass | `the clipboard was read back from an isolated world and matches (length N)` |
| a `text` that differs | **fail** | `the clipboard was read back from an isolated world and does not match what was written (read length M, wrote N); the write may have been intercepted by the page` |
| `'blocked'` | not-run | `the clipboard couldn't be read back (the clipboard-read permission isn't granted for this origin; grant it with browser.grant_permissions to get a verified result). The write itself may have succeeded` |
| `'unavailable'` (CDP error or timeout) | not-run | `the isolated-world read-back couldn't run (<err>)` |

Evidence records `expected: N` (the length) and `observed: M | 'blocked'`. **It never records either text.**

`readClipboard(sid, tabId?)`:
- `bringToFront`, then `readClipboardIsolated`.
- `'clipboard-api'`/`'execCommand-paste'` → `{text, verification: verified}` with reason `read via <path> in an isolated world`.
- `'blocked'` → `{text: ''}` with **unverifiable** and reason `the clipboard could not be read (permission not granted); the returned empty text is NOT the clipboard's content`.
- `'unavailable'` → it falls back to today's main-world code, returning `text`, **unverifiable**, with reason `read in the page's main world because the isolated read couldn't run; page scripts could alter this value`.

`getClipboard` keeps its `Promise<string>` contract. It returns `readClipboard(...).text`, so its behavior is unchanged except that the read moves to the isolated world.

#### 2.8.6 `click_at_point` / `drag_at_points` (`click_at_point.hit-element`, `click_at_point.click-delivered`; `drag_at_points.down-delivered`, `drag_at_points.up-delivered`)

**`observePoint(page, x, y, eventName)`:**
- It skips on a pending dialog or a missing `mainFrame`.
- In the main frame it runs `pointInfoInPage(x, y)`: `el = document.elementFromPoint(x,y)`, then it descends open shadow roots with `root.elementFromPoint`.
  - If `el` is null → `{hit:null}`.
  - If `el` is an IFRAME/FRAME → `{frame:true, innerX: x - r.left - el.clientLeft, innerY: y - r.top - el.clientTop}`. The child `Frame` is matched through `frameElement()` identity (as in §2.8.1) and the step repeats there, up to depth 3. If nothing matches → `frame-unreachable`.
- In the final frame, `armPointListenerInPage(eventName, token, innerX, innerY)` stores `window[token] = {hit, desc, events: []}` and a capture `window` listener for `eventName` (and for drags, `mousedown` and `mouseup`) that pushes `{trusted, onHit: e.composedPath().includes(hit), dx: |e.clientX - innerX|, dy: |e.clientY - innerY|, targetDesc: describe(e.composedPath()[0])}`.
- `eventName` is `click` for the left button, `contextmenu` for the right and `auxclick` for the middle, matching `verifiedClickOnHandle`'s rule.

**The primitive** (GAP-019 closed):
```ts
await Promise.race([page.mouse.click(x, y, { button }).catch(() => {}), sleep(1500)])
```
The drag keeps its sequence, and each step gets the same race.

**`decidePointVerdict`:**

| obs | outcome | reason |
|---|---|---|
| a dialog is pending after | not-run | `a <type> dialog opened (see dialogPending); delivery couldn't be read` |
| `hit === null` | **fail** | `no element is at (x, y); the point is outside the viewport or the document` |
| `frame-unreachable` | not-run | `the point is inside an <iframe> whose frame couldn't be matched` |
| navigated (context destroyed or URL changed) | pass | `the page navigated right after the click, which is treated as delivered` |
| a trusted event with `onHit && dx≤1 && dy≤1` | pass | `a trusted <event> landed on <desc>, the element at (x, y)` |
| a trusted event, `!onHit` | **fail** | `the click at (x, y) landed on <targetDesc>, not on <desc>, which was at that point when it was dispatched` |
| no trusted event | **fail** | `no trusted <event> reached the page at (x, y)` |

The drag is pass iff `mousedown` was trusted with `onHit` at the from-point **and** a trusted `mouseup` was within 1 px of the to-point. A from-hit that is null or unreachable → fail/not-run as for the click. **Drags are main frame plus shadow only.** A from-point on an iframe → not-run: `drag delivery inside frames isn't observed`.

The drag's reason on pass: `mousedown reached <desc> at (fx, fy) and mouseup was delivered at (tx, ty); the drag's app-level effect was not checked — use expect`.

#### 2.8.7 `upload_file_via_trigger` (`upload_file_via_trigger.files-read-back`)

This sits on top of FR2-06's shape:
1. `normalizeTarget` → `assertUploadPathAllowed`.
2. **New:** `const size = (await stat(filePath)).size; const obs = await observeUploadTargets(page)`. In the main frame, `armUploadListenerInPage(token)`:
   - collects every `input[type=file]` in the document and in open shadow roots (recursively), with `before = [names]` per input (index order);
   - adds a capture listener on `document` for `change` that records `{trusted, names:[...files].map(f=>f.name), sizes}` when the target is an `input[type=file]`.
3. FR2-06's `try { Promise.all([waitForFileChooser(), page.click(selector)]) } catch …`. On a throw, clean up best-effort (`removeUploadListenerInPage`) and re-throw, as today.
4. `await fileChooser.accept([filePath])`.
5. `finishUploadObservation`, bounded to 1000 ms, polls every 100 ms for up to 500 ms for a trusted change event, then scans again.

`decideUploadVerdict(name = basename(filePath), size)`:

| obs | outcome | reason |
|---|---|---|
| a trusted change event whose names include `name` with a matching size | pass | `a trusted change event delivered "<name>" (<size> B) to <inputDesc>` |
| no event, but a scanned input whose names changed from `before` and now include `name` with a matching size | pass | `<inputDesc>'s files now hold "<name>" (<size> B)` |
| a trusted change event whose names **exclude** `name` | **fail** | `the file input received [<names>], not "<name>"` |
| an input held exactly `[name]` before and after, with no event | not-run | `<inputDesc> already held a file named "<name>" before this upload and no change event fired, so the new upload can't be told apart` |
| nothing found and no event | not-run | `the file was handed to the page's file chooser, but no connected <input type=file> in the main document holds it and no change event reached the document; the receiving input may be detached, in a closed shadow root, or in an iframe` |

`outputData` is `{filePath, fileName, fileSizeBytes}`. The result's `actionType` is `upload_file_via_trigger`.

#### 2.8.8 `touch_tap` (`touch_tap.hit-element`, `touch_tap.touch-delivered`)

- **`armTouchObservation(handle)`:** `handle.evaluate` computes the element's center, the hit status via `getRootNode().elementFromPoint` (like `verifiedClickOnHandle`'s `isHit`), and the describe string. It installs capture listeners on the **element** for `touchend`, `pointerup` (with `pointerType === 'touch'`) and `click`, which set `el.__sdTapMark = {trusted, type}`.
- **`finishTouchObservation`:** bounded `handle.evaluate` reads the mark and removes it.
- **Verdict:**
  - delivered and trusted → pass `a trusted <type> reached <desc>`
  - not delivered and `!isHit` → **fail** `the tap point is occluded by <topDesc>; no touch event reached <desc>`
  - not delivered → **fail** `no trusted touch/pointer/click event reached <desc>`
  - a timeout or dialog → not-run
- **D15 applies.**

#### 2.8.9 `screenshot` / `take_screenshot` (`screenshot.png-well-formed`)

- `inspectPng(buf)` ok → check pass `observed:'<w>x<h>'`, verdict **not-run**: `a screenshot does not change the page, so there is no post-condition to verify; the capture was checked to be a well-formed <w>x<h> PNG, but its content was not inspected`.
- Not ok → check fail with verdict **fail**: `the capture is not a valid PNG (<why>)`.

So screenshot is **unverifiable by design** unless its output is actually broken.

#### 2.8.10 `wait_for_selector`

This is D14 / §2.5. `SELF_VERIFYING` gains the entry, and the recorder derives the evidence. FR2-01's logic isn't touched.

### 2.9 Where `expect` flows (question 3)

`MCP expect {text,url,urlChanged}` → zod `.strict()` → handler, which passes it only if defined (arity rule) → `runtime.<method>(…, expect)` → `toVerificationSpec(expect)`, which throws `TypeError` for anything invalid before `resolveTab` → `ActionParams.verificationSpec` (engine-routed) → `executeActionSerialized`, after settle → `verifier.verifyAction(…, spec, builtIn)`. For runtime-level methods, the verifier is called directly after the primitive.

Precedence of what a caller sees:

| Situation | `success` | `error` | `verification.tier` | `expect.*` checks | MCP | CLI exit | SDK |
|---|---|---|---|---|---|---|---|
| The action failed | false | the message (+ hint) | action-failed | not-run | JSON `success:false` (a thrown runtime error is `isError`, as today) | 1 | throws `ActionFailedError` |
| The action succeeded and an expectation failed | true | — | contradicted | ≥1 fail | JSON | **4** | throws `ExpectationFailedError` |
| The action succeeded and an expectation couldn't be evaluated | true | — | unverifiable | ≥1 not-run | JSON | **4** | throws `ExpectationFailedError` |
| The action succeeded, no expect, built-in contradicted | true | — | contradicted | — | JSON | 0 (the line says NOT verified) | returns the result (no throw) |
| The action succeeded, no expect, nothing checkable | true | — | unverifiable | — | JSON | 0 | returns the result |

### 2.10 CLI

**`parse-args.ts`:** `--expect-text <t>` and `--expect-url <s>` are valued (they join `isConsumedValue`). `--expect-url-changed` and `--expect-url-unchanged` are booleans. All four go into `KNOWN_FLAGS`.
```ts
expectFlag: ActionExpectation | undefined;                     // undefined when none given
export function expectFlagError(p: ParsedArgs): string | undefined;
//  both --expect-url-changed and --expect-url-unchanged → '--expect-url-changed and --expect-url-unchanged are mutually exclusive'
//  --expect-text/--expect-url given without a value     → '--expect-text needs a value (e.g. --expect-text "Saved")'
```

**`verification-output.ts` (new, pure):**
```ts
export const EXIT_EXPECTATION_FAILED = 4;
export function formatVerificationLine(v: VerificationResultDto | undefined): string;
//  verified      → `Verification: verified (confidence 0.90) — <reason>`
//  other tiers   → `Verification: NOT verified — <tier> (confidence 0.45) — <reason>`
//  undefined     → `Verification: none reported`
//  reason: newlines → spaces, capped at 400 chars
export function exitCodeForResult(r: { success: boolean; verification?: VerificationResultDto }, expectGiven: boolean): 0 | 1 | 4;
//  !success → 1; expectGiven && failedExpectations(v).length > 0 → 4; else 0
export function toCliJson(r: object): object;   // drops failureScreenshot, adds failureScreenshotOmitted:true when present
```

**`cli.ts`:**
- Verbs: click, clicktext, clickrole, type, press, select, wait, hover, scroll, upload, drag, clickpoint, dragpoints, download, nav, setclipboard, screenshot.
  - They pass `expectFlag` (where the runtime method accepts it; setclipboard and screenshot don't).
  - In text mode they print the existing status line, then `formatVerificationLine(result.verification)` on **stdout**, and only when `success`.
  - With `--json` they print `JSON.stringify(toCliJson({...result, ...dialogKeys}), null, 2)` **instead of** the status line. Here `dialogKeys` are the keys FR2-04 uses for `snap --json` (`dialogPending`, `dialogsHandled`). FR2-04's `reportDialogs` must not print its `dialogPending:` lines in `--json` mode. If FR2-04 didn't already build that switch for `snap --json`, add `{json: boolean}` to `reportDialogs`.
  - Then `process.exitCode = exitCodeForResult(result, !!expectFlag)`.
  - When the code is 4, stderr gets `Error: expectation failed: <failed keys> — <verification.reason>`.
- `getclipboard`: stdout is **unchanged** (only the text). `formatVerificationLine` goes to **stderr**.
- **`cmdPress` (GAP-025):**
  - `const f = await runtime.focus(sid, ref)`.
  - If `!f.success` → print `Press aborted: could not focus <ref>: <error>`, exit 1, **no key pressed**.
  - If `f.verification?.evidence.tier === 'contradicted'` → `Press aborted: focus did not land on <ref>: <reason>`, exit 1.
  - `unverifiable` proceeds.
- `main()` validates `expectFlagError` after FR2-04's `dialogFlagError`.
- **Help text additions:**
  ```
    --expect-text <t>       After the action, require this visible text on the page (exit 4 if absent)
    --expect-url <s>        After the action, require the URL to contain <s> (exit 4 if not)
    --expect-url-changed / --expect-url-unchanged
                            Require the URL to have changed / stayed the same (exit 4 otherwise)
    --json                  "snap": structured element data; action verbs: print the full result JSON
                            (including verification) instead of the status line
  Every action prints a "Verification:" line. "NOT verified — unverifiable" means nothing could be
  checked (the reason says why), not that the action failed. Exit codes: 0 ok, 1 action failed,
  3 blocked by a dialog, 4 an --expect-* check failed or couldn't be evaluated.
  ```

### 2.11 `dialogPending`

`dialogPendingOf(tab)`:
- `d = tab.getPendingDialogDetail?.()` (FR2-04) → `{type: d.dialogType, message: d.message, defaultValue: d.defaultValue ?? null, url: d.url}`.
- Otherwise `p = tab.getPendingDialog?.()` → the same shape, with `url: tab.url`.
- Returned as `{dialogPending}` or `{}`.

Key order is `type, message, defaultValue, url`, which is FR2-04 D-3 / §2.8.5's order. The CLI keeps FR2-04's lines; MCP and SDK get the key.

### 2.12 SDK (`page.ts`, `errors.ts`)

```ts
export class ActionFailedError extends Error { name = 'ActionFailedError'; constructor(public readonly result: ActionResult) }   // message = result.error
export class ExpectationFailedError extends Error { name = 'ExpectationFailedError';
  constructor(public readonly result: ActionResult | NavigateResult, public readonly failed: string[]) }                      // message = `Expectation failed (${failed}): ${reason}`
export interface ElementOptions { delay?: number; settle?: boolean | SettleSpec; expect?: ActionExpectation }  // + expect
export interface GotoOptions { expect?: ActionExpectation }
export interface WaitForSelectorOptions { state?; timeout?; expect?: ActionExpectation }
```

| Method | Before | After |
|---|---|---|
| `click(sel, opts?)` | `Promise<void>`, swallows | `Promise<ActionResult>`. Throws `ActionFailedError` on `!success` (GAP-024) and `ExpectationFailedError` when `opts.expect` is given and `failedExpectations` is non-empty. The runtime call follows the arity rule: `runtime.click(sid, sel, tab, undefined, undefined, opts?.settle, ...(opts?.expect ? [opts.expect] : []))`. |
| `type` / `press(key, opts?)` / `scroll(dir, amt, opts?)` | void | the same pattern |
| `waitForSelector` | void, throws | `Promise<ActionResult>`, still throws (FR2-01 D3), plus the expect throw |
| `download` / `uploadFile` (FR2-05) | `DownloadResult` / void | `DownloadResult & {verification}` / `ActionResult`, with FR2-05's throws kept |
| `goto(url, opts?)` | `Page` | still returns `Page` (chaining compat). Throws `ExpectationFailedError` on an expect failure. |
| `screenshot()` | string | unchanged |
| **`lastResult`** (new getter) | — | the full result (`ActionResult \| NavigateResult \| ScreenshotResult`) of this page's most recent action call. It's the uniform way to read `goto`/`screenshot` verification. |

Exports from `index.ts`: `ActionFailedError`, `ExpectationFailedError`, `type ActionExpectation`, `type ActionResult`, `type VerificationResultDto`, `type VerificationEvidence`, `type GotoOptions`.

---

## 3. Fixture design

**Reused fixtures** (only gaps get new content):

| Case family | Reuse |
|---|---|
| PROB-043-grade key oracle | `fixtures/prob043-keyboard.html` (192 inputs, `__prob043Probe.events`/`applicationValues`) |
| wait states | FR2-01's `fr2-01-wait-states.html` (toast, `#banner, #stays`) |
| download | FR2-05's `fr2-05-download-server.mjs` (`/page`, `/file` with a random 64 KB body and `served[]` ground truth), plus the **additive `empty=1`** option (`Content-Length: 0`) |
| upload trigger (FR2-06 compat) | FR2-06's `fr2-06-selectors.html` `#browse-btn` / `#hidden-file` |
| beforeunload | FR2-04's `fr2-04-dialogs.html` (only if `runtime.setDialogPolicy` exists) |

**New: `tools/scenario-suite/fixtures/fr2-07-server.mjs`** exports `startFr207Server(): Promise<{port, origin, crossOrigin, url(path, nonce), close()}>`.
- It listens on **both** `127.0.0.1:P` and `[::1]:P`, so `http://localhost:P` works whichever address `localhost` resolves to. It never uses `0.0.0.0`.
- `origin = http://127.0.0.1:P` and `crossOrigin = http://localhost:P`. These are different sites, so the cross-origin frame is an out-of-process iframe under Chrome's default site isolation.
- Routes:
  - `/page.html?n=<nonce>[&spoofClipboard=1]` serves `fr2-07-verification.html`.
  - `/frame.html` serves `fr2-07-frame.html`.
  - `/nav/a`, `/nav/b` and `/nav/login` are small HTML pages with an `<h1>`.
  - `/nav/redirect` is a 302 to `/nav/login`.
  - `/nav/missing` is a 404 with an HTML body.
  - `/nav/form` has a `<form action="/nav/b"><input id="q"></form>`.
- All responses are `Cache-Control: no-store`. **Per-case uniqueness goes only in the query string** (the FR2-01 gotcha).

**New: `fixtures/fr2-07-verification.html`**, served over HTTP. It ends with `window.__fx7.ready = true`. `window.__fx7 = {clicks:{}, events:[], ready}`.

| Element | Markup / behavior | Proves |
|---|---|---|
| `#txt` | `<input>` | press positive (K1) |
| `#blocked` | input; `keydown` → `preventDefault()` | press contradicted (K2) |
| `#ro` | `<input readonly value="x">` | press contradicted, readonly (K3) |
| `#swallow` | input; a **window capture** keydown listener registered in `<head>` calls `stopImmediatePropagation(); preventDefault()` when `e.target.id==='swallow'` | no delivery observed and no effect (K5) |
| `#tab-a`, `#tab-b` | two inputs | Tab moves focus (K6) |
| `#trap` | input; `keydown` Tab → `preventDefault()` | Tab contradicted (K7) |
| `#ta`, `#ce` | textarea, `contenteditable` div | press in textarea and contenteditable |
| `#nofocus` | `<div>` with no tabindex | focus contradicted (F2) |
| `#blur-on-focus` | input; `onfocus = () => this.blur()` | focus contradicted (F3) |
| `#host` | open shadow root with `<input id="shadow-in">` | shadow focus and press |
| `iframe#same` | `srcdoc` with `<input id='in-frame'>` (closed with a plain `</script>`, the FR2-01 lesson) | same-origin frame focus and press |
| `iframe#xo` | `src = crossOrigin + '/frame.html'` (contains `<input id="xo-in">` and `<button id="xo-btn">` with a click counter posted to the parent via `postMessage`) | out-of-process iframe focus, press, click_at_point |
| `#real-btn` | `position:absolute; left:40px; top:300px; width:120px; height:40px`; the click increments `__fx7.clicks.real` | click_at_point positive (P1) |
| `#covered-btn` + `#decoy-overlay` | overlay `position:absolute`, same box, `z-index:10`, transparent, its own click counter; the covered button's click sets `#result` text `COVERED CLICKED` | the decoy case (P2) |
| `#vanish` | button; `mousedown` → `this.remove()` | click lands elsewhere, contradicted (P3) |
| `#ctx-target` | `contextmenu` increments a counter | right button (P6) |
| `#alert-btn` | `onclick = () => alert('fr2-07')` | dialog path (P7) |
| `#drag-pad` | 300×150 div; records trusted mousedown/mouseup `clientX/Y` into `__fx7.events` | drag (G1) |
| `#tap-target`, `#tap-covered` + `#tap-overlay` | touch listeners record into `__fx7.events` | touch (T1/T2) |
| `#browse` + `#file-a` | the button's click runs `fileA.click()`; `#file-a` is hidden; its `change` writes `name:size` into `#upload-out` | upload positive (U1) |
| `#browse-reset` + `#file-b` | the `change` handler records into `#upload-out-b`, **then** `this.value = ''` | a page that clears its input: passes via the event (U2) |
| `#browse-detached` | the click creates `const i = document.createElement('input'); i.type='file'; i.onchange = () => window.__detachedGot = i.files[0]?.name; i.click()` and **never attaches it** | unverifiable (U3) |
| `#hidden-template` | `<template>`-like `<div style="display:none">FR2-07 SAVED</div>` | expect.text visible-only (X2) |
| `#show-saved` | the click appends a visible `<div id="toast">FR2-07 SAVED</div>` synchronously | expect.text positive (X1) |
| `#show-late` | the click adds the same toast after `setTimeout(800)` | the "checked once" timing (X3) |
| `#noop` | a button whose click does nothing | expect negative (X2) |
| `#push-same` | the click runs `history.pushState({}, '', location.href)` | go_back to the identical URL (N6) |
| `#hash-link` | `<a href="#section">` | hash-only navigation |
| `?spoofClipboard=1` | an inline head script: `let last=''; navigator.clipboard.writeText = async t => { last = t; }; navigator.clipboard.readText = async () => last;` (**the liar**) | clipboard contradicted, and proof that the isolated world is needed (C2) |

**Gotchas:**
- The script source must not contain the literal `FR2-07 SAVED`, because `expect.text`'s old `textContent` semantics would match `<script>` text. The script builds it as `'FR2-07 ' + 'SAVED'`. The literal appears **only** in `#hidden-template`, which makes baseline B-X2 a real false positive in the pre-change build.
- Wait for `ready` through the observer before each case.

---

## 4. Unit tests

### 4.0 The no-loosening rule

**No existing assertion may be changed, removed, skipped or loosened.** Every test named in §0.4 and §0.5 must pass byte-unchanged, and so must all FR2-01 through FR2-06 tests, `tools.spec.ts`'s exact tool list and count, and `parse-args.spec.ts`/`state.spec.ts`. If one fails, the implementation is wrong, not the test.

### 4.1 `browser/tests/unit/execution-verifier.spec.ts` (new)

A `tab` stub is `{url, page?, getPendingDialog?}`.

- **V1.** `success:false`, spec `{expectedElementText:'x'}`:
  - `tier 'action-failed'`, `confidence 0`, `reason === 'Action failed: boom'`;
  - `checks` equals `[{check:'expect.text', outcome:'not-run', detail:'the action failed; expectations were not evaluated'}]`.
- **V2.** `click`, no builtIn, no spec: `verified`, `0.9`, the reason contains `has a built-in post-condition check`, and `checks[0]` is `{check:'click.built-in', outcome:'pass'}`.
- **V3.** builtIn pass: `tier 'verified'` and reason starts ``'press_key' verified: ``.
- **V4.** builtIn fail: `tier 'contradicted'`, `verified false`, `confidence ≈ 0.09` (`toBeCloseTo(0.09, 5)`), reason contains `its post-condition check failed:`.
- **V5.** builtIn not-run, no spec:
  - `tier 'unverifiable'`, `confidence 0.45`;
  - reason contains `no built-in post-condition check could run:` **and** the builtIn reason **and** `Pass expect:{text|url|urlChanged}`.
- **V6.** builtIn not-run plus `shouldUrlChange:true`, with the URL changed: `verified`, `0.9`, and the reason doesn't contain `Pass expect`.
- **V7.** builtIn pass plus text `'x'`, where every frame's evaluate returns false: `contradicted`, and the reason contains `Expected text "x" was not found`.
- **V8.** `shouldUrlChange:false` with the URL changed: `contradicted`, reason contains `Expected the URL to stay`. With it unchanged → the check passes.
- **V9.** `expectedUrlSubstring` mismatch: the reason contains `does not contain expected substring` (the existing text).
- **V10.** candidate 0.2 plus builtIn pass: `tier 'low-confidence'`, `confidence 0.2`, reason contains `below the verification threshold`.
- **V11.** `getPendingDialog` returns `{dialogType:'alert', …}` with text `'x'`:
  - `expect.text` is `not-run` with detail containing `dialog is open`;
  - `tier 'unverifiable'`;
  - no frame `evaluate` is called.
- **V12.** A frame `evaluate` that never resolves, with text `'x'`: resolves within 1400-2500 ms (real timers); `expect.text` is not-run; there's no unhandled rejection.
- **V13.** The in-page `visibleTextContainsInPage`, run with `vi.stubGlobal('document', …)`:
  - `body.innerText` containing `t` → true;
  - only a shadow child's `innerText` containing it → true;
  - neither → false;
  - self-containment: `new Function('return (' + fn.toString() + ')')()` gives the same results.
- **V14.** Capping:
  - a 1000-character `observed` is ≤ 200 characters and ends with `…`;
  - 10 checks → 8 kept, and the 8th's detail ends with `(+2 more checks omitted)`.
- **V15.** `wait` with no builtIn: `unverifiable`, reason contains `a fixed-duration sleep has no post-condition`.
- **V16.** For every tier, `JSON.parse(JSON.stringify(v))` deep-equals `v`.
- **V17.** `failedVerification('boom', ['text'])` equals V1's result without a tab.
- **V18.** A spec failure uses the contradicted confidence: `shouldUrlChange:true` unmet → `confidence ≈ 0.09` (the new value, which no existing test asserts).

### 4.2 `browser/tests/unit/post-conditions.spec.ts` (new): the pure deciders

- **P1.** `keyEffectRule`:
  - `('a',[],textEntry)` → `value-changed`; `('A',['Shift'])` → `value-changed`; `('a',['Control'])` → `none`;
  - `('Backspace',[],{selStart:0,selEnd:0})` → `none`; `({selStart:2,selEnd:2})` → `value-changed`;
  - `('Delete',[],{selEnd:len})` → `none`;
  - `('Tab',[],element)` → `focus-moved`; `('Tab',['Shift'])` → `focus-moved`;
  - `('Enter',[],textEntry)` → `none`;
  - `('a',[],{textEntry:false, kind:'element'})` → `none`;
  - `('é',[],textEntry)` → `value-changed` (single code point).
- **P2.** `keyMatches`: `('a',{key:'A'})` true; `('Numpad0',{key:'0',code:'Numpad0'})` true; `('Enter',{key:'Enter'})` true; `('Enter',{key:'a'})` false.
- **P3.** `decideKeyVerdict`, one assertion per row of the §2.8.1 table: 13 cases, each asserting `outcome` and a reason substring. It also asserts no check's `observed`/`expected`/`detail` contains a sentinel field value passed in the observation (D11).
- **P4.** `inspectPng`:
  - a real 1×1 PNG (a base64 constant) → `{ok, width:1, height:1}`;
  - an empty buffer → `ok:false`; a JPEG header → `ok:false`;
  - a PNG signature with width 0 → `ok:false`.
- **P5.** `statDownloadedFile` with an injected `fs` and fake timers:
  - missing → fail `no file exists`;
  - 0 bytes → fail `0 bytes`;
  - `mtimeMs = start - 3600_000` → fail `predates this download`;
  - OK → pass `observed '10 bytes'`;
  - `.crdownload` present, and the final file appearing at +500 ms → pass;
  - `.crdownload` present for more than 2 s → fail `partial`;
  - `browserWsEndpoint 'ws://10.0.0.5:9222/devtools/browser/x'` → not-run `another host`;
  - `ws://127.0.0.1:…` → a local check.
- **P6.** `decideNavigationVerdict`, one case per row of the §2.8.4 table:
  - navigate new-doc, redirect note, same-doc, identical-fragment no-op, no-commit fail;
  - reload pass/fail;
  - back at index 0 fail, back moved pass, back unmoved fail;
  - forward at the end fail;
  - status 404 with newDoc fail;
  - status 0 → no status check;
  - baseline unavailable → not-run.
- **P7.** `decidePointVerdict`: null hit fail, onHit pass, other-target fail, no-event fail, frame-unreachable not-run, navigated pass, dialog not-run. `decideDragVerdict`: both pass, missing mouseup fail, from-point in an iframe not-run.
- **P8.** `decideUploadVerdict`: all 5 rows of §2.8.7, plus a size mismatch in a change event → fail.
- **P9.** `decideClipboardVerdict`: all 4 rows. For each, `JSON.stringify(checks)` contains neither the written nor the read text (D11).
- **P10.** `PostConditionRecorder`:
  - order is preserved; the last `verdict` wins;
  - `toBuiltIn()` is `undefined` when empty;
  - with no verdict set: any fail → fail, all pass → pass, otherwise not-run.
- **P11.** `bounded`: a resolving promise → ok; a hanging one → timedOut at about `ms`; a rejecting one → `{ok:false, error}`; no unhandled rejection in any case.
- **P12.** `recordWaitForSelectorEvidence`:
  - `{state:'visible'}` → pass;
  - `{state:'hidden', matchedAtStart:false}` → not-run, reason contains `vacuously`;
  - `{state:'hidden', matchedAtStart:true, otherVisibleMatches:2}` → pass, detail contains `2 later match`.

### 4.3 `browser-action-engine.spec.ts`: append `describe('FR2-07 built-in post-conditions')`

- **E1.** `press_key` on a page with no `mainFrame`:
  - `success:true`, `evidence.tier 'unverifiable'`;
  - reason contains `no built-in` and `could not observe the page's focused element`;
  - `keyboard.press` called once; elapsed < 50 ms.
- **E2.** `press_key` with a scripted `mainFrame.evaluate`:
  - calls: (1) `activeInfo` → `{kind:'element', desc:'input#q', textEntry:true, isFrameElement:false, …}`; (2) arm → `undefined`; (3) read → `{delivered:true, onTarget:true, valueChanged:true, afterValueLen:1, focusMoved:false}`;
  - result: `verified`, and `checks` includes `press_key.key-delivered` pass and `press_key.effect` pass.
- **E3.** The same as E2 with `valueChanged:false`: `contradicted`, `confidence ≈ 0.09`, reason contains `value did not change`, `success:true`, `retriesUsed 0`, `keyboard.press` called **once** (D4, no retry).
- **E4.** `activeInfo` → `{kind:'body'}`: `unverifiable`, reason contains `no element had focus`.
- **E5.** The read rejects `Execution context was destroyed`: `verified`, reason contains `navigated`.
- **E6.** The read never resolves: the action returns in < 2500 ms with `not-run` and `the page did not answer`.
- **E7.** `press_key` on a page with a `page.evaluate` spy plus a scripted `mainFrame`: the spy is **never** called.
- **E8.** `focus`:
  - `handle.evaluate` sequence `[false (not stale), {ok:true, observed:'input#a'}]` → `verified`;
  - `[false, {ok:false, observed:'body'}]` → `contradicted`, reason contains `not input`/`body`, `success:true`, `handle.focus` called once.
- **E9.** `touch_tap`: arm → `{isHit:true, desc:'button#t'}`; read → `{trusted:true, type:'touchend'}` → `verified`. With read → `null` and `isHit:false, topDesc:'div#o'` → `contradicted`, reason contains `occluded by div#o`, `tap` called once. The existing `:1555-1571` test passes unchanged.
- **E10.** `download_file` with a real `mkdtemp` directory and a mocked CDP client (the existing helpers):
  - write `report.pdf` (10 bytes) before emitting `completed` with `filePath` → `verified`, `outputData.downloadedSizeBytes === 10`;
  - a 0-byte file → `contradicted`;
  - no file → `contradicted`;
  - `utimes` set to one hour ago → `contradicted` `predates`;
  - `page.browser().wsEndpoint()` returning `'ws://10.1.2.3:9222/x'` → `unverifiable` `another host`.
- **E11.** `wait_for_selector`:
  - visible success (the existing FR2-01 mocks) → `verified`, with `wait_for_selector.state-matched` `expected:'visible'`;
  - hidden with `matchedAtStart:false` → `unverifiable`;
  - hidden with `otherVisibleMatches:2` → `verified` with the detail.
- **E12.** `take_screenshot` with `page.screenshot` resolving a valid 1×1 PNG base64: `unverifiable`, check `screenshot.png-well-formed` pass `'1x1'`. A garbage string → `contradicted`.
- **E13.** The `navigate` case, with `page.createCDPSession` resolving a mock whose `send` scripts history and `loaderId`:
  - `loaderId` changes → `verified`; unchanged with an unchanged URL → `contradicted`;
  - no `createCDPSession` → `unverifiable` `baseline couldn't be captured`.
- **E14.** Duplicate guard: the second duplicate click result has `verification.evidence.tier === 'action-failed'`, reason `Action failed: Duplicate …`.
- **E15.** `verificationSpec` flows through on the success path: a click with a self-verifying mock plus `{shouldUrlChange:false}` where the URL is unchanged → `verified` with `expect.urlChanged` pass.
- **E16.** Every result in E1-E15 survives `JSON.parse(JSON.stringify(result))` unchanged.

### 4.4 `capability-runtime/tests/unit/runtime.spec.ts` (append)

- **R1.** `toVerificationSpec`:
  - `{text:'a', url:'b', urlChanged:false}` → `{expectedElementText:'a', expectedUrlSubstring:'b', shouldUrlChange:false}`; `{}` → `{}`; `undefined` → `undefined`;
  - `{text:''}`, `{url:5}`, `{urlChanged:'yes'}` and `{bogus:1}` each throw `TypeError`.
- **R2.** With `runAction` spied, `click(…, {text:'x'})` passes `params.verificationSpec` equal to `{expectedElementText:'x'}`. `click('s1','#a')` passes params **without** a `verificationSpec` key.
- **R3.** An invalid `expect` on an unknown session → `TypeError`, **not** `BrowserNotAvailableError`, and `resolveTab` isn't called.
- **R4.** When `tab.getPendingDialog` returns `{dialogType:'confirm', message:'m'}`, the `runAction` result has `dialogPending` deep-equal to `{type:'confirm', message:'m', defaultValue:null, url:<tab.url>}` with key order `['type','message','defaultValue','url']`. With no dialog, `'dialogPending' in result === false`.
- **R5.** `fillForm` where `type` throws: the entry has `verification.evidence.tier 'action-failed'`.
- **R6.** `goBack` on a stubbed page, with `createCDPSession` scripted to index 0 → 0 and `goBack` resolving `null`: the result's `verification.evidence.tier === 'contradicted'` and the reason contains `no history entry`. The existing unknown-session behavior is unchanged.
- **R7.** `setClipboard` with `createCDPSession` scripted so the isolated read returns `{path:'blocked'}`: returns `ActionResult` with `success:true` and `unverifiable`. The existing R-tests at `:344-358` are unchanged.
- **R8.** `readClipboard` blocked → `text === ''`, `unverifiable`, reason contains `NOT the clipboard's content`. `getClipboard` still resolves a `string`.
- **R9.** `uploadFileViaTrigger` with stubs returns an `ActionResult` whose `actionType` is `'upload_file_via_trigger'`. FR2-06's R5 and R6 are unchanged.
- **R10.** `screenshot` resolves `{base64, verification}` with `tier 'unverifiable'`.
- **R11.** `clickAtPoint` where `mouse.click` hangs forever: resolves in < 2500 ms (GAP-019).

### 4.5 `mcp-server/tests/unit/tools.spec.ts` (append)

- **M1.** Each of the 24 tools has `inputSchema.expect`:
  - `safeParse(undefined)`, `({})`, `({text:'x'})` and `({urlChanged:false})` all pass;
  - `({text:''})`, `({bogus:1})` and `({urlChanged:'yes'})` all fail;
  - none of set_clipboard, get_clipboard, screenshot and fill_form has `expect`.
- **M2.** Arity:
  - the click handler without `expect` → the spy's `mock.calls[0].length === 6`;
  - with `expect:{text:'x'}` → 7 args, and the 7th deep-equals `{text:'x'}`;
  - the same for `wait_for_selector` (5 and 6 args), `navigate` (3 and 4), `click_at_point` (5 and 6).
  - FR2-01's M2 (`:332-347`) passes unchanged.
- **M3.**
  - set_clipboard → the parsed JSON has `success === true` and a `verification` object;
  - upload_file_via_trigger → `success`, `filePath` and `verification`;
  - get_clipboard → `text` and `verification`.
- **M4.** screenshot: `content[0].type === 'image'` (the existing test is also still green); `content[1].type === 'text'`; `JSON.parse(content[1].text).verification.evidence.tier === 'unverifiable'`.
- **M5.** The `click_at_point` description doesn't contain `verification entirely`, and contains `expect`.
- **M6.** A `navigate` JSON result has `verification`.
- **M7.** The `expectDesc` text contains `does NOT fail the action` and `unverifiable`.
- **M8.** The tool count is unchanged (the existing assertion, not re-asserted).

### 4.6 CLI

**`parse-args.spec.ts` (append):**
- **C1.** `--expect-text "Saved"` → `expectFlag {text:'Saved'}`, and `"Saved"` isn't in `cleanArgs`. `--expect-url /b` works the same way.
- **C2.** `--expect-url-changed` → `{urlChanged:true}`; `--expect-url-unchanged` → `false`; both together → `expectFlagError` returns the exclusivity text.
- **C3.** `--expect-text` as the last argument → error text; no flag → `expectFlag === undefined`; unrecognised-flag detection is unchanged.

**`verification-output.spec.ts` (new):**
- **O1.** `formatVerificationLine` exact strings for the verified, contradicted and unverifiable tiers and for `undefined`; newlines are collapsed; the cap is 400.
- **O2.** `exitCodeForResult`:
  - `{success:false}` → 1 (with expect too);
  - success plus expect failing → 4;
  - success plus expect not-run → 4;
  - success plus expect passing → 0;
  - success plus built-in contradicted with no expect → 0.
- **O3.** `toCliJson` drops `failureScreenshot` and sets `failureScreenshotOmitted:true`, and leaves other keys untouched.

### 4.7 `sutradhar/tests/unit/api.spec.ts` (append)

- **S1.** With the stub `click` → `{success:true, verification:{…verified}}`, `await page.click('7')` returns that object, and the stub is called with exactly 6 args. The existing `:81-105` tests are unchanged.
- **S2.** Stub → `{success:false, error:'nope'}`: `page.click('7')` rejects `ActionFailedError` with `.result.error === 'nope'`, `.name === 'ActionFailedError'`.
- **S3.** Stub → success with `verification.evidence.checks [{check:'expect.text', outcome:'fail'}]`: `page.click('7', {expect:{text:'x'}})` rejects `ExpectationFailedError` with `.failed` deep-equal to `['text']` and `.result.success === true`. The stub is called with 7 args.
- **S4.** A built-in contradicted with no `expect` → resolves (no throw).
- **S5.** `goto` with `expect` failing → rejects `ExpectationFailedError`. Without `expect` it resolves to the `Page`. `page.lastResult` equals the navigate result.
- **S6.** `press('Enter')` and `scroll()` follow S1/S2's pattern with their own arities.
- **S7.** FR2-01's `waitForSelector` throw-on-failure tests are unchanged, and a success now returns the result.

---

## 5. Live-verify script: `tools/scenario-suite/verify-fr2-07-verification.mjs`

**Prerequisites:** `pnpm build`. Copy these helpers verbatim from `verify-fr2-01-wait-states.mjs` (no refactor; that's GAP-005): `freshUrl`, `record`, `writeJsonl`, `resolveChromeExecutablePath`, `rmWithRetry`, `makeMcpClient`, `textOf`, `jsonOf`, and the CLI and observer helpers.

**Outputs** go to `.ai/loop/field-report-2/evidence/FR2-07/`:
- `live-{mcp,cli,sdk,bundle}.jsonl` and `baseline.jsonl`;
- `live-summary.json`, with per case: `surface, case, expected, observed, observerTruth, verification, pass`;
- `live-verify.log`.

The script exits 1 on any failure.

**Surfaces:**
- **Observer:** `puppeteer-core` launched from a `mkdtemp` profile, used as the independent truth. MCP (`packages/mcp-server/dist/cli.js`, stdio) and the SDK attach to it through `browser.attach`.
- **CLI:** `packages/cli/dist/cli.js` with its own session. The observer connects through the `state.json` `wsEndpoint`.
- **SDK:** `packages/sutradhar/dist`.
- **Bundle:** `packages/sutradhar/dist/mcp-cli.js`.
- **Servers:** `startFr207Server()` and FR2-05's `startDownloadServer()`.

A case marked **NEG** is an action that superficially "succeeds" while the effect doesn't happen. It must show `success:true && verification.verified === false`, with the **observer confirming the effect really didn't happen**.

### 5.0 Baseline (pre-change build; `--baseline`)

The Executor writes the script first, builds the pre-change tree (FR2-01 through FR2-06 merged, no FR2-07 code), and runs `--baseline`. That mode runs the cases below, records the full JSON result into `baseline.jsonl`, and asserts nothing.

| B | Case | Expected pre-change observation |
|---|---|---|
| B-K2 | press `a` into `#blocked` | `success:true`, `verified:false 0.45` generic (no evidence) |
| B-F2 | focus `#nofocus` | `0.45` generic |
| B-D2 | download `empty=1` | `0.45`, no fs check |
| B-N4 | go_back at index 0 | `{tabId,url,title}` only: **no verification, silent success** |
| B-N8 | navigate `/nav/missing` | no verification |
| B-C2 | set_clipboard on the spoof page | `{success:true}` |
| B-P3/P4 | click_at_point `#vanish` / (5000,5000) | `success:true`, no verification |
| B-U3 | upload_file_via_trigger `#browse-detached` | `{success:true, filePath}` |
| B-W1 | wait_for_selector visible success | `verified:false 0.45` (T2) |
| B-X2 | the engine path with `verificationSpec {expectedElementText:'FR2-07 SAVED'}` on `#noop` (through a runtime script, since there's no public `expect` yet) | **`verified:true`: a real false positive**, because `textContent` includes `#hidden-template` |

### 5.1 press_key (MCP; † also CLI `press`; ‡ also SDK `press`)

- **K1 †‡.** Focus `#txt`, press `a` → `verified`. `press_key.effect` pass. The observer reads `#txt.value === 'a'`.
- **K2 NEG.** Focus `#blocked`, press `a` → `contradicted`, reason contains `value did not change`. The observer reads `''`.
- **K3 NEG.** `#ro` → `contradicted`, detail `readonly`. The observer reads `'x'`.
- **K4 NEG.** The observer runs `document.activeElement.blur()`, then press `a` → `unverifiable`, reason contains `no element had focus`.
- **K5 NEG.** `#swallow` → `contradicted`, reason contains `no trusted keydown`. The observer confirms the value is unchanged.
- **K6.** `#tab-a`, press `Tab` → `verified` `moved focus`. The observer sees `activeElement.id === 'tab-b'`.
- **K7 NEG.** `#trap`, press `Tab` → `contradicted` `did not move focus`.
- **K8.** On `/nav/form` focus `#q`, type `x`, press `Enter` → `verified`, reason contains `navigated`. The observer sees the URL is `/nav/b?…`.
- **K9, K10, K11.** Shadow `#shadow-in`, same-origin frame `#in-frame`, cross-origin `#xo-in`: each press `b` → `verified`. The observer reads the value through a shadow root, `contentDocument` and the out-of-process frame's `Frame` respectively.
- **K12 (the PROB-043 false-positive oracle).** 150 iterations on `prob043-keyboard.html`:
  - Each iteration picks a random `press-N` field, gives it a base value with `type`, focuses it, then presses a random key from `['a','Z','5','Backspace','Delete','ArrowLeft','Enter']`.
  - The observer reads the value and `events.keydown`.
  - Assert: **zero** iterations with `verified:true && !(valueChanged || keydownCountIncreased)`; zero `contradicted` where the observer saw the value change; and `unverifiable` only for ArrowLeft/Enter/Delete-at-end, where the rule is `none` but delivery was observed. Those count as verified-delivery, not unverifiable. Record the count per tier.
- **K13.** Press `Enter` in `#txt` inside a form whose submit handler (`preventDefault`) runs `#show-saved`'s logic, with `expect:{text:'FR2-07 SAVED'}` → `verified`. The same with `expect:{text:'NOT THERE'}` → `contradicted` with `expect.text` fail and `success:true`.

### 5.2 focus

- **F1 †.** `#txt` → `verified`. The observer sees `activeElement.id === 'txt'`.
- **F2 NEG.** `#nofocus` → `success:true`, `contradicted`, observed `body`.
- **F3 NEG.** `#blur-on-focus` → `contradicted`.
- **F4.** `#in-frame` → `verified`. Separately, the observer checks the top document's `activeElement` is `iframe#same` (recorded, not asserted).
- **F5.** `#xo-in` → `verified`. The observer reads `activeElement` in the out-of-process frame.
- **F6.** `#shadow-in` → `verified`.

### 5.3 download (FR2-05 server)

- **D1 †‡.** `#dl` → `verified`, and `observed` bytes equal the observer's `fs.stat` size, which equals `served[last].size`.
- **D2 NEG.** `empty=1` → `success:true`, `contradicted` `0 bytes`. The observer's `fs.stat` size is 0.
- **D3.** The same filename twice → both `verified`. The paths differ (FR2-05 uniquifies), and neither is flagged `predates`.
- **D4 †.** CLI `download <ref> ./out` → a `Verification: verified` line and exit 0. `download … --expect-url /never` → exit 4 and the file still exists.

### 5.4 navigation (MCP; † CLI `nav`; ‡ SDK `goto`)

- **N1 †‡.** navigate `/nav/a?n=…` → `verified` `new document`. The observer sees `performance.timeOrigin` changed.
- **N2.** Navigate to the identical URL again → `verified` (a new loader). The observer sees `timeOrigin` changed.
- **N3.** Navigate `…#s1` → `verified` `same-document`. Navigate to the same `#s1` URL again → `verified` with a reason containing `already at`.
- **N4 NEG.** `new_tab` then `go_back` → `success:true`, `contradicted` `no history entry`. The observer sees the URL unchanged.
- **N5 NEG.** `go_forward` at the end → `contradicted`.
- **N6.** Click `#push-same`, then `go_back` → `verified`, and the URL is identical before and after. `history-index` observed `i-1`.
- **N7.** reload → `verified` (a new document). The observer sees `timeOrigin` changed.
- **N8 NEG.** navigate `/nav/missing` → `success:true`, `contradicted` `HTTP 404`.
- **N9.** navigate `/nav/redirect` with `expect:{url:'/nav/login'}` → `verified`. With `expect:{url:'/nav/b'}` → `contradicted` with `expect.url` fail.
- **N10.** Clicking `#hash-link` with `expect:{urlChanged:false}` → `contradicted`. Clicking `#noop` with `expect:{urlChanged:true}` → `contradicted`. Clicking `#noop` with `expect:{urlChanged:false}` → `verified`.
- **N11 (only if FR2-04's `setDialogPolicy` exists).** On `fr2-04-dialogs.html` with a beforeunload armed and the policy `dismiss`, navigate → an `isError` or `success:false` result, **never** `verified:true`. Record it.
- **N12 †.** `nav <redirect> --expect-url /nav/login` → exit 0. `--expect-url /nav/b` → exit 4, and stdout contains both `Navigated to` and `NOT verified — contradicted`.
- **N13 ‡.** `page.goto(redirect, {expect:{url:'/nav/b'}})` rejects `ExpectationFailedError` with `.result.url` ending `/nav/login`.

### 5.5 clipboard

- **C1.** Grant `clipboard-read`/`clipboard-write` for the origin, then set_clipboard `fr2-07-A-<n>` → `verified`. The observer's own `readText` (with the grant) equals the value.
- **C2 NEG.**
  - On the normal page, set_clipboard `SENTINEL-<n>` → `verified`.
  - Navigate to `?spoofClipboard=1` and set_clipboard `NEW-<n>` → `success:true`, `contradicted`.
  - The observer's **main-world** `navigator.clipboard.readText()` on the spoof page returns `NEW-<n>` (the lie). Its isolated read (through the observer's own `createIsolatedWorld`) returns `SENTINEL-<n>`.
  - This proves the main-world read-back would have been a false positive.
- **C3 NEG.** A fresh MCP session with no grant, set_clipboard → `unverifiable`, reason contains `grant_permissions`.
- **C4.** get_clipboard with no grant → `text:''`, `unverifiable`, `NOT the clipboard's content`. With the grant → `verified`, and `text` equals the observer's value.
- **C5.** For every C-case, `JSON.stringify(verification)` contains neither `SENTINEL-` nor `NEW-` nor `fr2-07-A-` (D11).

### 5.6 click_at_point / drag_at_points

- **P1 †.** The observer computes `#real-btn`'s center, then `click_at_point` → `verified`, hit `button#real-btn`. The observer sees `clicks.real` go up by 1.
- **P2.** The `#covered-btn` center → `verified:true`, and the reason names `div#decoy-overlay` (the documented decoy semantics). The observer sees the covered counter unchanged. The same with `expect:{text:'COVERED CLICKED'}` → `contradicted`: **`expect` catches the decoy.**
- **P3 NEG.** `#vanish` center → `success:true`, `contradicted`, reason contains `landed on` and `not on button#vanish`.
- **P4 NEG.** (5000, 5000) → `contradicted` `no element is at`.
- **P5.** The `#xo-btn` center (inside the cross-origin frame) → `verified` **only if** the observer confirms the frame's counter went up by 1 through `postMessage`. Otherwise the result must be `unverifiable`. **Assert `verified:true ⇒ counter+1`.**
- **P6.** Right button on `#ctx-target` → `verified` with `contextmenu`, and the observer's counter goes up by 1.
- **P7.** The `#alert-btn` center → returns in < 3000 ms (GAP-019), `dialogPending.type === 'alert'`, `unverifiable` containing `dialog`. Then `handle_dialog accept`.
- **G1 †.** A drag inside `#drag-pad` → `verified`. The observer's `__fx7.events` has a trusted down and up within 1 px.
- **G2 NEG.** A drag from (5000, 5000) → `contradicted`.

### 5.7 touch_tap (the D15 gate)

- **T1.** `#tap-target` → expected `verified`, with an observer-confirmed trusted event in `__fx7.events`.
  - **If T1 is not verified:** the Executor checks whether *any* trusted event reached the element, using the observer's own listener.
  - If none did, apply D15 (revert to unverifiable with the documented reason), record the decision, and rerun. **Never loosen T2.**
- **T2 NEG.** `#tap-covered` (under `#tap-overlay`) → `contradicted` `occluded`. The observer sees no event on `#tap-covered`.

### 5.8 upload_file_via_trigger (a temporary file of known size)

- **U1.** `#browse` → `verified`. The observer sees `#upload-out === '<name>:<size>'`.
- **U2.** `#browse-reset` → `verified` through the change event. The observer sees `#file-b.files.length === 0` and `#upload-out-b` holding the name.
- **U3 NEG.** `#browse-detached` → `success:true`, `unverifiable`, reason contains `detached`. The observer sees `window.__detachedGot === <name>`. That is truth that the page got it, which the verifier honestly couldn't prove.
- **U4.** Upload the same file into `#browse` again → the tier is recorded (expected `unverifiable` if Chrome fires no change event, otherwise `verified`). It is **never `contradicted`**.
- **U5.** FR2-06 compat: `pierce/#browse-btn` on `fr2-06-selectors.html` → `verified`.

### 5.9 wait_for_selector, screenshot, expect semantics, the contract sweep

- **W1.** FR2-01 toast visible → `verified` (the B-W1 baseline was 0.45).
- **W2 NEG.** `hidden` with `#nope-typo-<n>` → `success:true`, `unverifiable` `vacuously`.
- **W3.** `#banner, #stays` hidden → `verified`, detail contains `later match`.
- **S1.** MCP screenshot: `content[1]` JSON is `unverifiable` with `png-well-formed` observed `WxH`, and it matches the observer's `window.innerWidth × document.documentElement.scrollHeight` (full page). SDK `page.screenshot()` then `page.lastResult.verification.evidence.tier === 'unverifiable'`. CLI `screenshot` prints the line.
- **X1 †‡.** Click `#show-saved` with `expect:{text:'FR2-07 SAVED'}` → `verified`.
- **X2 NEG.** Click `#noop` with `expect:{text:'FR2-07 SAVED'}` → `contradicted`. The observer confirms the text exists only in the hidden element. **B-X2 recorded `verified:true` for the same case: this proves the false positive is fixed.**
- **X3.** Click `#show-late` with `expect:{text:'FR2-07 SAVED'}` → `contradicted`, and the observer sees the toast about 800 ms later. This documents that expect is checked once.
- **X4.** Click `#does-not-exist` with `expect:{text:'x'}` → `success:false`, `tier 'action-failed'`, `expect.text` not-run, and the MCP result is not `isError`.
- **X5 †.** CLI: `click "#show-saved" --expect-text "FR2-07 SAVED"` → exit 0. `click "#noop" --expect-text "NOPE"` → exit 4 plus the stderr `expectation failed`. `click "#missing" --expect-text x` → exit 1.
- **X6 ‡.** SDK: `page.click('#noop', {expect:{text:'NOPE'}})` rejects `ExpectationFailedError`. `page.click('#missing')` rejects `ActionFailedError` (GAP-024).
- **X7 (MCP bad arguments).** `expect:{text:''}` and `expect:{bogus:1}` are rejected by schema validation. With the runtime called directly, `expect:{urlChanged:'yes'}` → `TypeError` and no browser contact (the observer's page is untouched).
- **L1 (contract sweep).** Every one of the 24 `expect` tools plus set_clipboard, get_clipboard and screenshot is called once on the fixture. Each result has `verification` with exactly the keys `verified, urlChanged, elementFound, confidence, reason, evidence`; `evidence.tier` is one of the 5 values; each `evidence.checks` entry has `check` and `outcome`; and every `reason` is non-empty. A `reason` that contains the pre-FR2-07 generic text `nothing about its actual effect on the page was verified` fails the case.

### 5.10 Overhead, bundle, regression gates, teardown

- **Overhead:** 20× press_key on `#txt`, 20× focus, 10× navigate, 10× click_at_point. Record the median `executionTimeMs` against `baseline.jsonl`, and assert a delta ≤ 40 ms (press/focus/click_at_point) and ≤ 60 ms (navigate).
- **Bundle smoke** (`mcp-cli.js`): K1, N4, C2 and P3. This proves esbuild keeps the in-page functions and the isolated-world expression intact.
- **Regression gates** the Executor also runs:
  - `tools/scenario-suite/ci-gate.mjs` (3 surfaces);
  - `verify-fr2-01…06` scripts;
  - `node packages/capability-runtime/scripts/smoke-wave12.mjs`;
  - a **20-minute `prob043-mcp-soak.mjs`** with zero mismatches;
  - `packages/agent` and `apps/server` vitest (the ExecutionVerifier consumers).
- **Teardown:** MCP `browser.shutdown` plus `stdin.end()`; CLI `close`; SDK `browser.close()`; `observer.close()`; both servers closed; `rmWithRetry` of the profiles, temporary upload files and download dirs. `live-summary.json` records 0 Chrome processes with a scratch profile on their command line and 0 new `sutradhar-cli-*` dirs.

---

## 6. Negative cases (the core of this item)

Each case is "the action superficially succeeds, but the effect doesn't happen, or can't be proven". Every row needs the observer's confirmation.

| # | Action | Setup | Must report | Where |
|---|---|---|---|---|
| N1 | press_key | printable key into an input whose keydown calls `preventDefault` | `success:true`, contradicted `value did not change` | K2, E3 |
| N2 | press_key | printable key into a readonly input | contradicted (detail `readonly`) | K3 |
| N3 | press_key | no focused element (body) | unverifiable `no element had focus` | K4, E4 |
| N4 | press_key | a page swallows the keydown at window capture | contradicted `no trusted keydown` | K5 |
| N5 | press_key | Tab while a focus trap cancels it | contradicted `did not move focus` | K7 |
| N6 | press_key | dialog opened by the key | unverifiable (dialog), `dialogPending` set | E6 variant, live P7 analogue |
| N7 | press_key | 150-iteration oracle | zero `verified:true` without an observed effect or delivery | K12 |
| N8 | focus | non-focusable `<div>` | contradicted, observed `body` | F2, E8 |
| N9 | focus | element blurs itself on focus | contradicted | F3 |
| N10 | download_file | a server sends 0 bytes | contradicted `0 bytes` | D2, E10 |
| N11 | download_file | a stale same-name file (mtime in the past) | contradicted `predates` | E10, P5 |
| N12 | download_file | a remote browser endpoint | unverifiable `another host` (never a false fail or pass) | E10 |
| N13 | go_back / go_forward | no history in that direction (Puppeteer resolves `null`) | contradicted `no history entry` | N4, N5, R6 |
| N14 | navigate | an HTTP 404 page | contradicted `HTTP 404` | N8 |
| N15 | navigate | a redirect elsewhere, with `expect.url` | contradicted (expect.url fail), `success:true` | N9, N12, N13 |
| N16 | reload | loader unchanged (mock) | contradicted | P6, E13 |
| N17 | set_clipboard | the page's `writeText` is a no-op **and** its `readText` lies | contradicted: the isolated read sees the old content | C2 |
| N18 | set_clipboard | no read permission | unverifiable, with a grant hint | C3 |
| N19 | get_clipboard | blocked read returns `''` | unverifiable `NOT the clipboard's content` | C4, R8 |
| N20 | click_at_point | the element removes itself on mousedown | contradicted `landed on …, not on button#vanish` | P3 |
| N21 | click_at_point | an off-viewport point (`mouse.click` doesn't throw) | contradicted `no element is at` | P4 |
| N22 | click_at_point | a decoy overlay | `verified:true` **naming the decoy**, and `expect.text` makes it contradicted (the documented boundary) | P2 |
| N23 | click_at_point | a point in a cross-origin frame | verified only if the observer confirms, otherwise unverifiable | P5 |
| N24 | drag_at_points | from an off-viewport point | contradicted | G2 |
| N25 | upload_file_via_trigger | a detached input | unverifiable `detached` (while the observer shows the page did get the file, so the verifier makes no claim either way) | U3 |
| N26 | upload_file_via_trigger | the same file re-selected, no change event | unverifiable, never contradicted | U4, P8 |
| N27 | touch_tap | the target is under an overlay | contradicted `occluded` | T2, E9 |
| N28 | wait_for_selector | `hidden` with a typo'd selector | unverifiable `vacuously` | W2, E11 |
| N29 | expect.text | the text exists only in a `display:none` element | contradicted (the pre-change build said verified:true, B-X2) | X2 |
| N30 | expect.text | the text appears 800 ms after the action | contradicted (checked once; documented) | X3 |
| N31 | expect (any) | the action itself failed | `action-failed`, expect not-run; CLI exit 1, not 4; SDK `ActionFailedError` | X4, X5, X6 |
| N32 | expect | invalid shape (`''`, unknown key, non-boolean) | a zod rejection (MCP) / `TypeError` before any browser contact (runtime) | X7, R3 |
| N33 | expect.urlChanged:false | the action changed the URL | contradicted `Expected the URL to stay` | N10, V8 |
| N34 | CLI press | focus fails or is contradicted | `Press aborted`, exit 1, **no key sent** (the observer's value is unchanged) | add to §5.1 as K14 † |
| N35 | duplicate guard | a double click inside 1 s | result has `verification.tier 'action-failed'` | E14 |
| N36 | observation vs. dialog | any renderer-touching check while a dialog is open | not-run with `dialog`, never a hang past about 1.5 s | V11, E6, P7 |
| N37 | screenshot | a malformed capture | contradicted `not a valid PNG` (unit only; no live repro possible) | E12 |

---

## 7. Risks

### 7.1 False-confidence risks (the hard rule)

1. **Delivery counted as verification (press_key rule `none`, click_at_point, drag, touch).**
   - `verified:true` for `Enter` means "a trusted keydown reached the focused target", not "the form was submitted". That's the same bar the existing click check sets.
   - Mitigation: every such reason says `only delivery was verified` or `the drag's app-level effect was not checked — use expect`, and `expectDesc` tells agents to assert effects with `expect`. The K12 oracle checks the no-false-pass property over 150 real presses.
2. **Main-world observers can be influenced by the page.**
   - Listeners and expandos live where page scripts can see them. A hostile page can't forge `isTrusted`, but it can call `stopImmediatePropagation` at window capture before ours runs. That produces a false *negative*, never a false positive, and the reason text says so.
   - It could also set `input.files` through `DataTransfer` to fake the scan fallback in §2.8.7. That's adversarial-only, needs the exact name and size, and only applies when no trusted change event was seen. It's documented.
   - The clipboard, where spoofing is realistic, reads in an isolated world (D10, proven by C2).
3. **`expect.text` substring semantics.**
   - `"Saved"` also matches `"Unsaved changes"`. It's documented as a case-sensitive substring, and agents should pass specific text.
   - Visible-text semantics (N29) removes the hidden and script false positives.
   - Remaining gap: text that is `opacity:0` or off-screen counts as visible for `innerText`. That's consistent with FR2-01's visibility rule, and documented.
4. **`hidden` wait with `matchedAtStart` unknown.** `probeSelectorMatchExists` resolves `false` on its 500 ms timeout, which makes a slow page look vacuous. That direction is conservative: it gives unverifiable, never a false pass.
5. **Download staleness tolerance.** A file modified within 2 s *before* the action counts as fresh. That's negligible, and FR2-05's `filePath` removes the name ambiguity. A 0-byte file that was genuinely intended (an empty CSV) reports `contradicted`, a false negative that the reason explains.
6. **The loader-id signal.** It's browser-side CDP. Risk: a `Page.getFrameTree` blocked by a dialog gives not-run, not pass. A client-side redirect after commit shows as `newDoc` for the final document. Fine.
7. **A 4xx/5xx page counted as contradicted.** Sites that return 200 for error pages get `verified`: the navigation happened, and content is `expect.text`'s job. That's documented.
8. **Page tampering with `performance.getEntriesByType`.** It could only mask a 4xx (a false pass on status alone). The loader/history evidence still stands. Documented as adversarial-only.
9. **Existing self-verifying checks keep their exact behavior.** This item doesn't strengthen them. PROB-043's open question about stale-handle read-back in `clearAndType` stays open. FR2-07 adds an independent keydown oracle for `press_key` only.

### 7.2 Other risks and behavior changes (the changelog fragment)

1. MCP JSON gains `verification.evidence` on all action tools. It also gains `verification` (+ `dialogPending`) on the navigation tools, set_clipboard, get_clipboard (`{text, verification}`) and upload_file_via_trigger, plus a second `content[]` item on screenshot. All of this is additive.
2. **Confidence for failed spec checks drops** from 0.45/0.36 to **0.09** (the contradicted tier).
3. **`expectedElementText` / `expect.text` now use visible text across all frames**, bounded to 1.5 s. Before it was `textContent`, main frame only, unbounded.
4. **`shouldUrlChange:false` now asserts an unchanged URL.** Before it was ignored.
5. **SDK:** `click`/`type`/`press`/`scroll` now **throw `ActionFailedError`** on `success:false` (GAP-024; breaking, for 0.5.0) and return the result instead of `void`. `ExpectationFailedError` is new, and so is `page.lastResult`.
6. **CLI:** action verbs print one extra `Verification:` line. `--json` on action verbs is new. Exit code **4** is new. `press` aborts on a failed focus (GAP-025).
7. `runtime.setClipboard` and `uploadFileViaTrigger` return `ActionResult` instead of `void`. `getClipboard` reads through an isolated world.
8. `clickAtPoint` no longer blocks for 30 s on a dialog (GAP-019).
9. **Latency:** about 2-4 extra CDP round trips per press/focus/tap/point action, and 4 per navigation. Measured in §5.10, and bounded by the timeouts in §2.4.
10. **Merge risk:** FR2-04's `reportDialogs` JSON-mode switch (§2.10) and FR2-06's `uploadFileViaTrigger` shape. The Executor re-anchors by symbol and re-runs the FR2-04 and FR2-06 verify scripts.
11. **Hand-offs:**
    - FR2-08's settle-everywhere must keep "expect is checked after settle".
    - FR2-11 stores `verification` (it's JSON-safe; V16/E16).
    - FR2-12's `browser.audit` is a report, not an action, and the cross-cutting Auditor should confirm it's documented as outside the contract.
    - FR2-13 maps its scenario `expect` onto `ActionExpectation` and uses `failedExpectations`.
    - FR2-15's `expect(...)` row points here.
12. **New gaps to log (minor):**
    - state-setter and read tools are outside the contract (D13a);
    - there are no CLI `back`/`forward`/`reload` verbs and no SDK equivalents;
    - drag delivery inside frames isn't observed;
    - GAP-026 is still open.
    - **Closed by this item:** GAP-018, GAP-019, GAP-024 and GAP-025.

---

## 8. Rollback

`git revert <FR2-07 commit>` restores every §1 file. There's no persisted state, no on-disk format change, no new process and no tool-count change.
- **Order:** revert FR2-07 before any later item that consumes `evidence`, `ActionExpectation` or `failedExpectations` (FR2-11, FR2-13). Otherwise those items fail to compile, which is loud, not silent.
- **Partial rollback is safe** along two seams:
  - (a) Keep the types, the verifier composition and `expect` (§2.1-2.3, §2.6, §2.7, §2.9), and revert individual observers. Each case's appended block is independent, and a missing recorder verdict falls back to `unverifiable` with a specific reason. That's today's honesty level, not a false pass.
  - (b) Revert the CLI/SDK surface changes (§2.10, §2.12) while keeping MCP.
- **Afterwards:** add a `decisions.md` entry; set the ledger status to `TODO`/`BLOCKED`; move GAP-018/019/024/025 back to TODO; drop `changelog-fragment.md`; revert the additive `empty=1` in `fr2-05-download-server.mjs` only if nothing else uses it.

---

### Critical Files for Implementation
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\verifier\execution-verifier.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\actions\action-types.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\browser\src\actions\browser-action-engine.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\capability-runtime\src\runtime.ts`
- `E:\HMX_Projects\Internal_Projects\PinchTab\.claude\worktrees\project-understanding-696041\packages\mcp-server\src\tools.ts`