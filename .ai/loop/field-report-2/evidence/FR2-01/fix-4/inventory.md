# FR2-01 fix-4 inventory — every per-frame/per-probe outcome site in the wait_for_selector path

Read in full before this inventory: `browser-action-engine.ts` (2275 lines), audit-4's gap
descriptions (GAP-081..088), and decisions.md's audit-3/audit-4 entries. Table below lists every
function in the `wait_for_selector` call graph that (a) makes a per-frame/per-probe call able to
time out, throw, or return empty/null, (b) what it currently does with each outcome, and (c)
whether that's safe (distinguishes "confirmed negative" from "couldn't determine").

| Function | Lines (pre-fix) | Outcome handling today | Safe? | Change needed |
|---|---|---|---|---|
| `raceFrameProbe` | 1447-1478 | Already tri-state (`match`/`no-match`/`unknown`) via `FRAME_PROBE_TIMED_OUT` sentinel; disposes late-resolving handle. | Safe | none |
| `pierceFirstMatch` | 1421-1434 | Rethrows selector-syntax and fatal (session/target closed) errors; context-destroyed (in-page nav) -> `no-match`; **any other unrecognized error -> `no-match`** (GAP-081 part 2). | **Unsafe** | Unrecognized error must default to `'unknown'`, not `'no-match'`. Only the two positively-classified cases (syntax error -> rethrow, fatal -> rethrow, context-destroyed -> no-match) get a definite answer. |
| `isHandleVisible` | 1504-1512 | `.catch(() => false)` catches literally everything (including tab-closed/session-closed/target-closed) and reports "not visible". No time bound at all on the `.evaluate()` call. | **Unsafe** (GAP-081, GAP-086) | Convert to tri-state (`visible`/`not-visible`/`unknown`). Bound the evaluate call with `FRAME_PROBE_TIMEOUT_MS` via a new `raceBounded` helper (timeout -> `unknown`). Classify caught errors: fatal (session/target/connection closed) -> `unknown`; context-destroyed (element's frame navigated away) -> `not-visible` (the node is genuinely gone, consistent with `pierceFirstMatch`'s own per-frame-hiccup precedent); anything else unrecognized -> `unknown` (audit-4's explicit default). |
| `liveFramesOf` | 1530-1537 | Already throws on a genuinely closed tab (`page.isClosed()`), which is correctly treated as fatal by all callers. | Safe | none |
| `firstVisibleHandleAnyFrame` | 1543-1557 | Probes frames **sequentially** (`for` loop) via `pierceFirstMatch`, calls old boolean `isHandleVisible`. | **Unsafe** (GAP-084 — still sequential, the GAP-059 fix was never applied here) | Parallelize the per-frame probe via `Promise.all` (same pattern `isHiddenInEveryFrame` already uses), keep first-frame-in-order-wins semantics, dispose every non-winning matched handle (previously not needed since the loop never fetched later frames after an early return). |
| `firstAnyHandleAnyFrame` | 1563-1572 | Same sequential probing as above. | **Unsafe** (GAP-084) | Same parallelization + first-match-wins + dispose-the-rest treatment. |
| `isHiddenInEveryFrame` | 1578-1609 | Already parallel (fix-3/GAP-059) and already tri-state (`hidden`/`visible`/`unknown`) at the frame-probe level, **but** calls the old boolean `isHandleVisible` to decide whether a `match` verdict is actually visible — a `false` there (which, pre-fix, conflated "confirmed not visible" with "errored/unknown") silently became part of a `hidden` verdict. | **Unsafe** (feeds GAP-081 upstream) | Consume `isHandleVisible`'s new tri-state result: `'visible'` -> return `'visible'` immediately; `'unknown'` -> `sawUnknown = true`, continue; `'not-visible'` -> continue (same as `no-match`). |
| `waitForHiddenInAllFrames` | 1377-1395 | Returns a plain `boolean` — `isHiddenInEveryFrame`'s `'unknown'` verdict falls through to "keep polling" every pass (correct so far), but once the deadline is reached the function returns `false` regardless of whether the LAST pass's verdict was `'visible'` (confirmed) or `'unknown'` (never confirmed either way). The caller (`dispatchAction`'s `state==='hidden'` branch) then always reports the plain "is still visible" message. | **Unsafe** (GAP-082) | Return `FrameSetHiddenVerdict` (`'hidden' | 'visible' | 'unknown'`) instead of `boolean`, tracking the last pass's verdict. Caller must render a distinct, honest message for `'unknown'` ("could not verify: one or more frames were unresponsive") vs `'visible'` ("still visible"). |
| `dispatchAction`'s `state==='hidden'` branch | 823-851 | Treats `waitForHiddenInAllFrames`'s `false` as one undifferentiated "still visible" failure. | **Unsafe** (GAP-082, consumer side) | Switch on the 3-way verdict from the fixed `waitForHiddenInAllFrames`. |
| `checkWaitForSelectorOnce`'s hidden branch | 1679-1701 (pre-fix) | Same collapse, one level down: `hiddenNow = (await this.isHiddenInEveryFrame(...)) === 'hidden'`, boolean, single message. | **Unsafe** (GAP-082, sibling site audit-4 did not explicitly name but the inventory step found) | Same 3-way switch as the `dispatchAction` site — this is exactly the "9th site neither fix-3 nor audit-4 caught" the escalation brief asked this inventory to find. **New finding, not pre-listed in GAP-081..088.** |
| `countOtherVisibleMatches` | 1711-1733 | Wraps the WHOLE per-frame loop in one `Promise.race` against a flat 500ms timer; on timeout, silently resolves `0` — indistinguishable from "confirmed zero other visible matches". Per-frame errors are swallowed too (`catch { }` -> skip). | **Unsafe** (GAP-085) | Bound each frame's `$$eval` individually via the same `raceBounded`/`FRAME_PROBE_TIMEOUT_MS` primitive, run frames in parallel, and return `{count, unconfirmed}` instead of a bare `number` — `unconfirmed:true` when any frame timed out, so the caller can surface that the advisory count is incomplete rather than silently reporting 0. |
| `diagnoseSelectorVisibility` | 1781-1805 | Sequential per-frame `$$eval` with **no per-frame time limit** — only the *caller* (`describeWaitForSelectorTimeout`) wraps the whole thing in a single 1000ms race. On that outer race's timeout, the function returns `null`, and its caller falls straight through to the "No element found for selector" message — a confirmed-negative claim this diagnosis never actually established. | **Unsafe** (GAP-083) | Bound each frame's `$$eval` individually (reuse `raceBounded`/`FRAME_PROBE_TIMEOUT_MS`, run in parallel). Track `unconfirmedFrames` and `framesProbed` alongside `total`/`visibleFlags`. Return `null` only when there is truly nothing to report (zero flags AND zero unconfirmed frames). |
| `describeWaitForSelectorTimeout` | 1813-1867 | Only ever branches on `diagnosis && diagnosis.total > 0`; any other outcome (including a real "some frames never answered, none confirmed absent") falls to the generic "No element found" message. | **Unsafe** (GAP-083, consumer side) | Add a branch for `diagnosis.total === 0 && diagnosis.unconfirmedFrames > 0`: report "visibility could not be determined for N of M frame(s)" instead of asserting a confirmed absence. |
| `probeSelectorMatchExists` | 1753-1770 | Already tri-state (`true`/`false`/`undefined`) via its own `raceFrameProbe` calls with a defensive `.catch(() => ({kind:'unknown'}))`. | Safe | none |

## Cross-check against GAP-081..088

- GAP-081 (isHandleVisible + pierceFirstMatch catch-alls) -> found, both halves (rows 2 and 3).
- GAP-082 (waitForHiddenInAllFrames flattening to boolean) -> found (rows 8 and 9), **plus the
  sibling site in `checkWaitForSelectorOnce` that neither fix-3 nor audit-4 named** (row 10 — the
  "9th site" this inventory step was designed to catch).
- GAP-083 (diagnoseSelectorVisibility no per-frame bound, false "No element found") -> found
  (rows 11 and 12).
- GAP-084 (firstVisibleHandleAnyFrame/firstAnyHandleAnyFrame still sequential) -> found (rows 5
  and 6).
- GAP-085 (countOtherVisibleMatches silent 0 on timeout) -> found (row 10... row labelled
  `countOtherVisibleMatches`).
- GAP-086 (isHandleVisible has no time bound) -> found (row 2, same fix as GAP-081).
- GAP-087 (E5 doesn't test what it claims) -> test-file finding, not a `browser-action-engine.ts`
  site; addressed in the test file directly (see final report).
- GAP-088 (report-hygiene issues from fix-3) -> not a code site; addressed by writing this
  report honestly (full overallOk, no cherry-picking, fresh ci-gate run — see final report).

## 9th site found

`checkWaitForSelectorOnce`'s `state === 'hidden'` branch (pre-fix lines 1679-1701) has the exact
same boolean-collapse bug as `waitForHiddenInAllFrames`/`dispatchAction`'s hidden branch, one
level down, for the `timeoutMs <= 0` ("check once") path specifically. Neither fix-3 nor audit-4's
8 named gaps mention this site by name, even though audit-4's own report says "and the check-once
path" in GAP-082's description in passing — this inventory step traced that reference to its
actual code location and confirms it is a real, distinct, unfixed site, not covered by the
`dispatchAction` fix alone (a caller using `timeoutMs<=0` never reaches `waitForHiddenInAllFrames`
at all).
