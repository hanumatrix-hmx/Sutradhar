# FR2-07 run-1: False-pass analysis

For every acceptance criterion: one way the check could pass while the behaviour is broken, and the fresh
command/output that rules it out. Nothing here reuses an earlier run's output as proof: the `false-pass/`
files were produced by `false-pass-probes` (re-run at the very end against the final commit `f291ee4`), and the
live/mutation results by fresh runs after the last code change. Raw evidence paths are relative to
`.ai/loop/field-report-2/evidence/FR2-07/run-1/`.

Final state: HEAD `f291ee4` (code frozen at `f24ec4e` + the N11 script case). Live verify **96/96**
(mcp 69, cli 13, sdk 8, bundle 6). Unit: browser 644, capability-runtime 244, mcp-server 108, cli 193,
sutradhar 34, agent 56, apps/server 28, all green. tsc clean for all 7 touched/dependent packages.

## Cross-cutting ways a green result could be false

| Risk | How it could pass while broken | What rules it out (command -> output) |
|---|---|---|
| **Stale / cached build** | The live script drives `dist/`; a cached turbo build or an old dist could pass tests for code that is not in the tree. | `false-pass/fp2-build-freshness.txt`: HEAD, `git status --porcelain -- packages` = 0, every touched `dist/*.js` newer than its `src`, and the new symbols (`press_key.key-delivered`, `sutradhar-verify`, `ActionFailedError`, `lastResult`) present in the exact bundles the script spawns. `pnpm run build --force` (turbo cache **bypass**, `build-forced.log`) produced the same dist digest (`a17d4cab1638093a`) as the cached build: `dist digest AFTER forced rebuild: a17d4cab1638093a`. |
| **Mocked path** | Unit tests use doubles; the "live" script could secretly stub. | `false-pass/fp6-mock-and-containment.txt`: `vi.fn/mock occurrences in verify script: 0`; it spawns `packages/mcp-server/dist/cli.js`, `packages/cli/dist/cli.js`, `packages/sutradhar/dist/{index,mcp-cli}.js`, and an independent `puppeteer-core` observer on a real Chrome (hygiene shows the Chrome PIDs). |
| **Assertions loosened** | Making an old test weaker so new code passes. | `false-pass/fp1-no-loosening.txt`: `git diff c83c220..HEAD -- '*.spec.ts'` removed-line count **3**, each an `import` line that only gained a name (`utimesSync`, `expectFlagError`, `ActionFailedError, ExpectationFailedError...`); 1816 lines added. |
| **Tests that cannot fail (rubber stamp)** | A suite that passes for any implementation. | Two mutation layers, each restored to identical bytes and re-run green: unit `revert-confirm.json` (**12/12 mutants caught**, `restored_exact:true` with sha256 before/after) and *live* `live-mutation.json` (**4/4 caught**: break the built dist, the live case goes PASS -> FAIL -> PASS after restoring). |
| **Clock mixing** | Wall-clock deltas compared with monotonic ones, or load-sensitive thresholds. | `false-pass/fp5-clocks.txt`: the new bounded-timeout tests (V12, P11, E6, R11) use `performance.now()` with generous bounds (1400-2500 ms around a 1500 ms bound; < 5000; < 2500). The `Date.now()` lines it lists in `runtime.spec.ts` (898, 1044) are pre-existing tests, not this item's. Live overhead compares the engine's own `executionTimeMs` before vs after (same source), and navigation via `performance.now` both times; bounds 40/60 ms vs measured deltas 2/1/0/2.5 ms. |
| **Wrong auth path** | n/a: FR2-07 adds no auth. The one security-adjacent path is the download `fs.stat`, which must only ever read a path FR2-05 already contained. | `fp6...`: source order `outside the download directory` (throw) at engine line 1473 precedes `recordDownloadEvidence` at 1480, and the FR2-05 containment unit tests still pass fresh (`Tests 3 passed`). No live containment attack was written (safety-classifier rule); this ordering + the function-level tests are the evidence, recorded as unverified live in the last section. |
| **File mode** | New shell scripts committed non-executable. | No shell scripts were added (only `.mjs` run with `node`, `.html`, `.md`). |

## Per acceptance criterion

**AC1. Every MCP/CLI/SDK action result carries `verification: {verified, confidence, reason, evidence}`.**
- *False pass:* the L1 sweep only checks key presence, so a constant/hard-coded verification object would satisfy it.
- *Ruled out:* the same tool returns different tiers for different live states, re-read from the live summary
  (`fp3-negative-cases-live.txt`): `press_key` gave `verified` (K1), `contradicted` (K2/K3/K5/K7), `unverifiable` (K4),
  each next to the observer's truth. Unit mutant M12 (drop the duplicate-guard `verification`) fails E14, and the
  sweep fails when a tool omits it. CLI: `X5j` parses a `--json` document with `verification.evidence.tier` and
  no `failureScreenshot`; text mode prints `Verification:` (K1, A1, D4, S1). SDK: `lastResult.verification` (N1, S1).

**AC2. `press_key` has a real check (focused-element value / `activeElement` delta / key event on the target).**
- *False pass:* "verified" because the key changed something unrelated, or because the observer read the wrong element.
- *Ruled out:* K12: 150 random presses on `prob043-keyboard.html`, each cross-checked by a separate page-side oracle
  (`__prob043Probe` value + keydown count read after the action): `tiers {"verified":150}`, `mismatchCount 0`, so zero
  `verified` without observed effect. Negatives with the observer re-read: K2 (value `""`), K3 (`"x"`), K5 (swallowed at
  window capture, value `""`), K7 (activeElement `trap`), K4 (blurred: `unverifiable`, value `""`). Live mutant **L1**
  (verdict `fail` -> `pass` in the built dist): K2 and K3 go FAIL, then PASS after restore. Unit mutants M2, M4.
- *Also:* the 20-minute PROB-043 soak: **43503 calls, 0 mismatches** (`regression/soak-summary.json`).

**AC3. `download_file`: `fs.stat` size > 0 at the reported path.**
- *False pass:* a stale same-named file makes the stat succeed; a 0-byte file passes "exists".
- *Ruled out:* D2 (server sends `Content-Length: 0`): `contradicted "0 bytes"`, observer `fs.stat` size `0`. D1: reported bytes ==
  observer `fs.stat` == the server's independently recorded size. E10 unit: a file whose mtime is one hour old ->
  `contradicted "predates"`. D3: the second download of the same name is judged by its own mtime (`verified`, not
  "predates"). Live mutant **L3** (`size === 0` -> `=== -1`): D2 FAIL -> PASS after restore. Unit mutant M3.

**AC4. `wait_for_selector`: matched in the requested state.**
- *False pass:* reported `verified` for `hidden` when nothing ever matched (a typo'd selector).
- *Ruled out:* W2 (`hidden` on `#nope-typo-<n>`): `success:true`, `unverifiable`, reason contains `vacuously`. W1: visible toast ->
  `verified` (the pre-change build said `0.45`, `baseline.jsonl` B-W1). W3: first-match rule with a `later match` detail.

**AC5. `focus`: `activeElement === target`.**
- *False pass:* passes because `document.activeElement` (top document) happens to be the iframe/host, not the element.
- *Ruled out:* the check is `el.getRootNode().activeElement === el` in the element's own document; F4/F5/F6 (same-origin
  frame, cross-origin frame, open shadow root) are `verified` with the observer reading the frame/shadow `activeElement`;
  F2 (`<div>` without tabindex) and F3 (element blurs itself) are `contradicted` with observer `activeElement: body`.

**AC6. `navigate`/back/forward/reload: the URL or history entry changed as expected and the load committed.**
- *False pass:* a same-URL reload looks "unchanged" by URL, or `goto` not throwing is read as success.
- *Ruled out:* identity is the CDP `loaderId` + history index, not the URL: N2 (identical URL again) and N7 (reload) are
  `verified` with the observer's `performance.timeOrigin` changed; N3 hash navigation `same-document`; N6 `pushState` to the
  same URL then `go_back` `verified` via the index; N4/N5 (no history) `contradicted` with the observer's tab URLs unchanged;
  N8 (404) `contradicted "HTTP 404"` (pre-change: no verification at all, B-N8); N9/N10/N12/N13 exercise `expect`.
  Deviation, not a weakness: Puppeteer 25 *throws* at the history edge (pre-change behavior was an error, B-N4), and
  `historyStep` maps exactly that message to the same `contradicted` result (unit R6b also proves other errors still propagate).

**AC7. `set_clipboard`: read back.**
- *False pass:* reading back through the same (possibly lying) page world.
- *Ruled out:* C2 uses a page that patches `navigator.clipboard` (`?spoofClipboard=1`): observer main-world read equals the NEW text
  (the lie), the observer's own *isolated-world* read equals the OLD sentinel, and the tool says `contradicted`
  (`observerTruth {"mainWorldEqualsNew":true,"isolatedEqualsSentinel":true}`; pre-change: `{"success":true}`, B-C2).
  Live mutant **L4** (read back in the main world instead): C2 FAIL -> PASS after restore. C3 (no grant): `unverifiable`
  with a `grant_permissions` hint. C5: no clipboard text ever appears in any verification JSON (3 leak checks, all PASS).

**AC8. `click_at_point`: `elementFromPoint` identity plus event delivery.**
- *False pass:* "delivered" because *some* click happened, e.g. on a transparent decoy overlay.
- *Ruled out:* P2 names `div#decoy-overlay` (observer: covered counter 0, decoy counter 1) and `expect.text` turns it
  `contradicted`; P3 (element removes itself on mousedown) `contradicted "landed on ..., not on button#vanish"` with the
  element gone; P4/G2 off-viewport `contradicted`; P5 cross-origin frame: verdict agrees with the frame's own counter
  (`verified` <-> counter +1); P7 returns in < 3 s with `dialogPending` (GAP-019).

**AC9. `upload_via_trigger`: `input.files` read back.**
- *False pass:* verified from a stale `input.files` left by an earlier upload.
- *Ruled out:* U4 uploads the same file twice: the second is `unverifiable` ("already held a file named ... can't be told apart"), never
  `verified`; U2 (page clears the input) is verified through the change event with `#file-b.files.length === 0`;
  U3 (detached input) is `unverifiable "detached"` while the observer shows the page really did get the file.

**AC10. Anything still unverifiable says exactly why.**
- *False pass:* every reason is the same generic sentence.
- *Ruled out:* L1 sweep fails a tool whose reason is empty or contains the pre-FR2-07 generic text; the per-case reasons
  differ (K4 "no element had focus", P7 "an alert dialog opened", C3 "grant_permissions", U3 "detached", W2 "vacuously",
  S1 "a screenshot does not change the page ..."). Unit V5/V15 pin the templates.

**AC11. Public `expect: {text?, url?, urlChanged?}` on MCP and CLI actions.**
- *False pass:* text present only in a hidden element or a `<script>` matches (the old `textContent` behavior).
- *Ruled out:* X2: text only in a `display:none` element -> `contradicted` (observer: `hiddenHasIt:true`, `bodyInnerHasIt:false`,
  `bodyTextContentHasIt:true`); the pre-change engine path on the same page returned `verified:true, 0.9` (`baseline.jsonl` B-X2).
  Live mutant **L2** (`innerText` -> `textContent`): X2 FAIL -> PASS after restore. X3 documents "checked once".
  CLI X5 exit 0/4/1 and SDK X6 `ExpectationFailedError`/`ActionFailedError`; X7 schema rejection; unit R3 (TypeError before any session lookup).

**AC12. Negative tests are mandatory.** Every row of spec section 6 is implemented: live where a real page can express it
(N1-N5, N7-N10, N12-N34 via K2,K3,K4,K5,K7,K12,F2,F3,D2,E10,N4,N5,N8,N9,N10,C2,C3,C4a,P2-P5,G2,U3,U4,T2,W2,X2,X3,X4,X5,X6,X7,N10,K14) and at
unit level where it cannot be (N35 duplicate guard = E14; N37 malformed PNG = E12/P4; N16 reload-unchanged = P6/E13; N6 dialog-during-press = E6 + P7).
`false-pass/fp3-negative-cases-live.txt` lists every live NEG case with its verdict next to the observer's truth.

**AC13. Nothing regressed.**
- *False pass:* the new code passes its own tests but breaks earlier items.
- *Ruled out:* fresh runs of the older verify scripts on this build: FR2-01 mcp 28/28, cli 12/12, sdk 8/8 (its summary says `overallOk:false` only because its hygiene scan counted 24 Chrome processes = 8 each for THREE stray CLI Chrome roots whose profile dirs are `sutradhar-cli-*`: one belongs to another session on this shared machine (created 14:02, before this session), two were my own aborted CLI attempts at 16:42, which I killed by PID afterwards; none belongs to FR2-01's own run); FR2-02 `30+27+4` all passed; FR2-05 `25/25 passed`; FR2-06 `20+3` all passed;
  FR2-10 exit 0; FR2-12 `29 pass, 0 fail`; `smoke-wave12` exit 0 (`expectedElementText` in an open shadow root still verified);
  scenario suite MCP 14/14, SDK 13/14 (UC-01, same as the committed baseline); `agent` and `apps/server` vitest green.
  **Two items are not green, and both are proven pre-existing by running the identical script on the pre-change build (`c83c220`)**:
  FR2-04's `L13.headed.click-exit0` (`110 passed, 1 failed, 2 skipped` on BOTH builds; same-fixture A/B in
  `regression/l13-headed-alert-click-ab.out`) and the CLI scenario suite (`11/14`, UC-05/UC-08/UC-12, on BOTH builds). Logged as GAP-316 and GAP-321.

## Anything I could not verify (stated plainly)

- **Remote-browser downloads:** the `another host` -> `unverifiable` path is covered by unit tests (P5, E10) only; no live remote Chrome was available.
- **Download containment under attack:** not exercised live (safety-classifier rule). Only the source ordering (containment throw before
  `fs.stat`) and the FR2-05 unit tests are evidence.
- **Headed mode / non-Windows / non-Chrome:** everything ran headless Chrome on Windows 11 (headed only inside the FR2-04 script and the UC-08 A/B).
- **`press_key` in a closed shadow root or a cross-origin frame nested inside another cross-origin frame:** not exercised; a nested unreachable frame yields `unverifiable`, never `verified` (unit P3 row).
- **`--json` interplay with a dialog that opens mid-command** was not exercised beyond the existing FR2-04/FR2-12 verify scripts still passing.
- **The mutation suite is a sample (12 unit + 4 live), not proof of completeness.** Surviving-mutant classes I did not try: the CLI's
  `reportActionResult` printing order, `dialogPendingOf` key order at the MCP boundary (unit R4 covers the runtime; no live MCP case with a dialog on an *engine-routed* tool), and `capEvidence` truncation of a real over-long reason.
- **Soak raw log** (40 MB) is kept outside the repo (`E:/AI-Cache/tmp/fr207-soak-raw.jsonl`); `regression/soak-summary.json` holds its sha256 and counts.
- **Scenario-suite results** are external-site dependent; they are recorded, not gated.

---

# Fix-cycle 1 (audit-1 REOPEN): false-pass analysis

Evidence directory: `evidence/FR2-07/fix-1/`. Every command below was re-run live after the fixes, on a forced rebuild
(`build-forced.log`: 9/9 tasks, 0 cached; typecheck 34/34).

**F1 (hidden shadow host / hidden iframe).**
- *False pass:* the live negative passes because of a stale `dist` (the old code's answer) or because the fixture page has nothing
  hidden; or the unit negatives pass against a fake DOM that does not resemble Chrome.
- *Ruled out:* (1) live X8, X10, X11 (mcp and bundle) assert `contradicted` AND the observer's own reads prove the trap is real
  (`checkVisibility()===false` while `textContent` has the text; hidden iframe `getClientRects().length===0` while its
  `body.innerText` has the text). (2) Mutant: with the two `rendered(...)` gates removed (plain innerText walk) and dist rebuilt,
  the same live run FAILS X8/X10/X11 (`verified:true, "Action execution verified successfully"`) and passes X9/X12/X13
  (`live-F1-mutant-plain-innertext-mcp.jsonl`); restored source sha256 3d9e548d... equal before/after
  (`build-forced.log` is from the restored tree). (3) Positives X9, X12, X13 prove visible shadow, same-origin and cross-origin
  iframe text still count, so the fix did not just return false. (4) The auditor's own probes, unmodified, on the rebuilt worktree
  AND the sutradhar bundle: `X.shadow-in-hidden-host-NEG` and `X.hidden-iframe-NEG` now `contradicted`
  (`audit-probes-mcp.log`, `audit-probes-bundle.log`: 49 PASS, 0 FAIL each). (5) Unit: 7 verifier mutants (no body gate, no child
  gate, no frame-rect gate, no content-visibility, no shadow-host hop, no frameElement hop, display flip) each fail >=1 new test
  (`mutants.jsonl`).

**F2 (clipboard length-only mutant).**
- *False pass:* the new unit test uses strings of different length, so it would not catch a length comparison.
- *Ruled out:* the test asserts `written.length === spoof.length` before deciding; mutant `r.text.length === written.length` FAILS it
  ("expected 'pass' to be 'fail'", `mutants.jsonl` M3, sha256 3e51cb34... before == after). Live C2 now uses `AAAA-<n>` vs `BBBB-<n>`;
  the auditor's same-length live probe (`live-mutant-control.jsonl`): `clipSpoofSameLength: contradicted`.

**F3 (focus any-active-element mutant).**
- *False pass:* the fake element's root reports the wrong active element for both branches.
- *Ruled out:* three cases (self active -> pass; a different element active -> fail; null -> fail) run the REAL in-page function
  through `checkFocus`; mutant `a !== null` FAILS the "DIFFERENT element" test (M5, restored byte-identically). Live control
  `focusNoFocus: contradicted`.

**F4 (built-in not-run + trivially true expect).**
- *False pass:* the reason contains "no element had focus" only because the fixture's press failed differently.
- *Ruled out:* unit V6b failed BEFORE the change ("expected 'Action execution verified successfully…' not to match") and passes
  after; live K15 (mcp and bundle) has the observer confirm `document.activeElement` is BODY and the `press_key.*` check is
  `not-run`. Auditor probe `K.body+trivial-expect` now reads "'press_key' verified by expectation only: its built-in
  post-condition check could not run: no element had focus ...".

**F5 (wall-time bounds).**
- *False pass:* the upper bound was removed but the test now proves nothing about boundedness.
- *Ruled out:* each test still awaits a dependency that NEVER resolves (`new Promise(() => {})`); the call returning at all is the
  assertion, and a monotonic lower bound (`performance.now`) shows the bound really fired. `git grep -n "toBeLessThan" ` over the
  FR2-07 hunks shows no remaining wall-time upper bound.

**Regression false-pass.** The first live attempt after the F1 change failed X1/X2 as well ("did not answer within 1500ms") because two extra
out-of-process frames on `page.html` never answered; the fixtures were moved to their own page and the FULL live run (all cases, all
four surfaces) was repeated: 110/110 (`live-verify.log`). The one auditor probe that fails, `SDK.press-body-NEG`, fails identically in
audit-1's own log (`audit-1/sdk-probes.log`): after `page.click('#real')` the button holds focus, so `verified` is the correct answer; it is
a wrong assumption in the probe, not a regression.


---

## fix-2 (RENDERED-text contract, aggregation, harness) false-pass analysis

For each AC: one way the check could pass while the behaviour is broken, and the command/output that rules it out.

**AC: hidden text never verifies (display:none, visibility:hidden, content-visibility:hidden, [hidden], closed <details>, zero-area, hidden/ancestor-hidden frames of every kind, 10050-deep host under display:none).**
- False-pass route A: the label and the product share one wrong belief (the live matrix labels are hand-written). Ruled out: every live case compares the product with an INDEPENDENT observer (fixtures/fr2-07-oracle.mjs: ancestor walk + Range rects, own frame judgement, never calls the product function) and asserts label == observer. It caught its own defect: evidence/FR2-07/fix-2/flake-x10/live-0-oracle-defect.log (9 FAIL where the ORACLE ignored content-visibility:hidden on the iframe itself; settled by pixels in spike3-cv-iframe.log: "cv:hidden looks like display:none (BLUE only)? true").
- False-pass route B: stale ground truth. Ruled out: the observer is read before AND after the product call and the case fails if they differ (observerTruth.stable in live-N/live-summary.json).
- False-pass route C: a mutant that lets hidden text through still passes. Ruled out: mutation-unit.log (14/14 mutants caught, e.g. "M1 CAUGHT Tests 54 failed") and mutation-live.log ("M1 CAUGHT LIVE ... 64/85 passed; FAILED: mcp:M:iframe-same-origin|visibility-hidden|inner ..."). M8 (unjudgeable frame trusted) is NOT reachable live (frameElement always works in real Chrome; live "M8 NOT CAUGHT 47/47 passed") and is caught by unit tests only.
- Audit-2 probes rerun UNMODIFIED against the worktree build and the sutradhar bundle: probe-reruns/vis-matrix-mcp.log and vis-matrix-bundle.log both "SUMMARY scored 56 / 56 falseVerified [] falseNegative []"; vis-cli-sdk.log "SUMMARY 14 / 14" (audit-2 on the pre-fix build: 6 falseVerified).

**AC: rendered text verifies (no false negatives; opacity:0, aria-hidden, off-screen, clipped DO count; bare text in shadow roots counts).**
- False-pass route: an implementation that answers "not found" for everything passes all negatives. Ruled out: positive controls in every placement (matrix rows "|none|-" and the "counted" mechanisms) and mutants M4/M7/M11 fail positives: mutation-live.log M7 "11/20 passed; FAILED: mcp:M:shadow-bare-text|opacity-0|inner ...".

**AC: one silent (hung) frame must not mask text another frame has; nothing is verified or contradicted from partial information.**
- False-pass route: the hung frame in the test is not really hung, or the test passes because everything is fast. Ruled out: the hung frame is a real renderer blocked in a synchronous XHR held by the fixture server on its own site (H1-H3 in live-N/live-mcp.jsonl: H1 verified with 1 hung frame; H3 "only 8 of 9 frames answered (1 did not answer within 1500ms; ...)" unverifiable); the unit test uses a frame whose evaluate never resolves and asserts a monotonic-clock bound (< 1200 ms vs the 1500 ms per-frame bound). Mutants M5/M6/M13 caught (unit 2/4/1 failures; live M6 "2/3 passed; FAILED: mcp:H1"). SDK repro of audit A2-2: probe-reruns/multi-oopif-sdk-8.jsonl: every main-frame-text call verified (was 8 of 12 unverifiable); the single unverifiable call is text that lives ONLY in a silent cross-origin frame (fail closed, detail names the frame).

**AC: fail closed (unjudgeable / exhausted => never "visible").**
- False-pass route: guard exhaustion returns true. Ruled out: unit tests "FAIL CLOSED: ... THROWS" (checkVisibility missing, work budget) and mutants M3a/M3b caught; deep DOM 10050 under display:none is NOT verified live (matrix deep-dom|display-none|outer PASS in every run).

**AC: the harness is stable (X10/X11/X12/K11), 3 consecutive identical green runs.**
- False-pass route: green by retrying or by loosening. Ruled out: no retries. Two flake causes were fixed in the harness (the readiness wait needed an evaluate answer from a display:none out-of-process frame; K11 picked the first same-origin frame instead of one with a URL token) and one (X10, GAP-325) was root-caused to the client not attaching a cross-origin frame target (flake-x10/diag-two-clients-alt.log; diag-x10-mcp-200.log reproduces 1/200). Final: live-1/2/3 logs each "488/488 passed", per-surface case counts identical (mcp 342, cli 22, sdk 19, bundle 105); the only differing case ids are the two C5 clipboard-leak checks whose id embeds a timestamp. GAP-325 tolerances that fired: NONE in any run (Z-gap325-budget observed.tolerated is [] for mcp and bundle in runs 1-3).

**Why the GAP-325 harness tolerance is honest and not a loosened test hiding a product bug.**
1. What is tolerated is exactly one product outcome: tier 'unverifiable', expect.text 'not-run', detail naming a silent cross-origin frame (hung:http://localhost:...), success true, verified:false. verified:true is never accepted, and it does not accept a false 'contradicted' either (the tolerance replaces the verdict, it does not add one).
2. That outcome is the specified fail-closed answer when a frame cannot be inspected: the product cannot conclude "absent" or "present" about a document its client cannot reach. Requiring 'contradicted' there would demand the product claim something it cannot know.
3. The cause is outside the product: the client never attached that frame's target (frame.client is the parent's session; a raw Runtime.evaluate there answered with the MAIN frame's text, proving a raw fallback would answer for the wrong document). Evidence: flake-x10/diag-two-clients-alt.log, diag-x10-mcp-200.log (1/200), diag-x10-500.log (0/500 with an in-process client).
4. It cannot silently mask a product bug: capped at 3 per surface run (Z-gap325-budget fails otherwise), every firing is listed in live-summary.json, and it fired 0 times in the 3 final runs. Blanket-unavailable behaviour would be caught by the definitive verdicts asserted in the other 480+ cases.
5. It applies only where a cross-origin (localhost) frame is named as silent; same-origin, srcdoc and main-frame cases have no tolerance.
