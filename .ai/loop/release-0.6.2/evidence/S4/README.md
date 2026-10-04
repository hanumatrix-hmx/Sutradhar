# S4 evidence - I-047 frame-detach containment (commit `I-047: contain synchronous detached-frame throws in frame probes, snapshots and post-conditions`)

Run 2026-10-04 on `release/0.6.2` (parent 561ee09). Root cause (plan 1.3): Puppeteer's `throwIfDetached` is a plain function that throws
SYNCHRONOUSLY, so `.catch()`, a promise built outside its `try`, or `bounded(frame.evaluate(...))` never sees it. Fix = new
`packages/browser/src/actions/frame-call.ts` (`frameCall`, declared `async`; `isDetachedFrameError`) applied at every UNSAFE site.
No retry, no substitute frame, no change to frame order, the 1000 ms head start, the 150 ms probe or the retry count (`git diff` is wrap-only).

## AC table

| AC | result | evidence |
|---|---|---|
| S4-1 inventory | PASS | `inventory-run.txt`: pre-fix tree (git archive of HEAD) 207 sites / 207 rows, `check-inventory` exit 0, **11 UNSAFE**; post-fix tree 210 / 210, exit 0 with `--no-unsafe`, **0 UNSAFE** (11 rows "fixed in S4"); negative controls: removed row -> exit 1 (MISSING), extra fake row -> exit 1 (EXTRA), unclassified rows -> exit 1; documented-limitation control: `frame.evaluate.call(...)` is NOT listed by `list-sites.mjs` and IS found by the blind-spot scan (exit 1); blind-spot scan on the real post-fix tree: 0 hits (exit 0). Method list: `list-sync-methods.out`: 25.5.0 and 25.12.0 each 49 names (identical), self-check "all 27 section-1.3 names present" |
| S4-2 unit proof | PASS | `frame-detach.spec.ts` 13 tests: U-ctl (fake throws synchronously, `.catch` cannot contain it), frameCall, U1-U4 (`resolveElement`), U5 (`buildGraph`), U6a-U6f (one per other post-conditions site). Before the fix: 12 of 13 FAIL, U-ctl passes (`new-tests-before-fix.log`); after: 13/13 (`new-tests-after-fix.log`). Runtime site: `capability-runtime/tests/unit/upload-frame-detach.spec.ts` (1 test, fails under M-047g) |
| S4-3 L1 | PASS | HEAD 10/10 runs exit 1 `Click failed: No visible element found for selector: #absent`, 0 "detached Frame"; NEG061 (published 0.6.1) **10/10** runs "Click failed: Attempted to use detached Frame '<id>'" (validity met at the first churn level `k=8&ms=25`, no raise needed) |
| S4-4 L2 | PASS | HEAD 10/10 succeed, `__clicks.late === 1` every run, `t1 - t0` = 3599,3472,3630,3597,2950,3038,3108,3056,2982,2944 ms (> 1000: loop path reached). NEG061 recorded: also 10/10 succeed (3.0-3.5 s) - L2 only proves the loop path is reached; it does not discriminate (the plan lists NEG061 L2 as supporting) |
| S4-5 L3 | PASS | HEAD 30/30 complete (20 SDK `page.snapshot()` + 10 CLI `snap`, every one lists Button 1..5); NEG061 **30/30 degraded** (SDK `elementCount: 0`, CLI `Interactive elements (0):`) |
| S4-6 L4 | PASS | HEAD 5/5 `Type failed: No element found for selector: #absent-input`, 0 detached; NEG061 5/5 `Type failed: Attempted to use detached Frame '<id>'` |
| S4-7 same-build mutants | PASS | live: `cli-bin.mutant.js` (M-047a, 1 replacement) L1 **10/10 detached**; `index.mutant.js` (M-047b, 1 replacement) L3 SDK **20/20 degraded**; both files deleted, real dist sha256 unchanged (`dist-before-mutants.sha256` == `dist-after-mutants.sha256`) ; unit: `mutants-unit.txt` 13 mutants, 13 killed, 0 survivors |
| S4-8 counts/typecheck | PASS | browser 938 -> 951 (+13), capability-runtime 554 -> 555 (+1, see Deviations), mcp-server 167, sutradhar 70, cli 395 + 2 skipped (all unchanged); `tsc --noEmit` browser and capability-runtime exit 0; eslint `src/` exit 0 on both; `cli.ts` stays 100644 (not touched); no CLI spec touched so the spec typecheck baseline is unaffected |
| S4-9 Kayak | recorded, INCONCLUSIVE (supporting only) | see below |

Fixture validity (section 3 rule 4): NEG061 showed 10/10 detached failures (L1) and 30/30 degraded results (L3) at `k=8&ms=25`; every run asserts `window.__recreated > 100` (HEAD L1: 6600-30200; NEG L1: 2912-12712; L3 SDK 368+ in the mutant run).

## Inventory result (call sites found / classified / fixed)
- Method list (49): `$ $$ $$eval $eval addExposedFunctionBinding addPreloadScript addScriptTag addStyleTag asLocator boundingBox boxModel click clickablePoint content drag dragAndDrop dragEnter dragOver drop evaluate evaluateHandle focus frameElement getProperties getProperty goto hover isHidden isIntersectingViewport isVisible jsonValue locator press removeExposedFunctionBinding screenshot scrollIntoView select setContent tap title toElement touchEnd touchMove touchStart type waitForDevicePrompt waitForFunction waitForNavigation waitForSelector` (Frame/cdp Frame/ElementHandle/JSHandle decorator arrays + the Page plain delegators whose target is a decorated Frame method).
- 207 pre-fix sites in 29 files; 11 UNSAFE, all fixed: the plan's 10 (`browser-action-engine.ts` 1729/1742/1774 `.catch` chained on the call; `dom-semantic-engine.ts:392`; `post-conditions.ts` 631/647/1197/1548/1735/1743 `bounded(frame.evaluate(...))`) plus **one found by the inventory outside the plan's list**: `capability-runtime/src/runtime.ts:2141` `Promise.all([page.waitForFileChooser(), page.click(selector)])` (a sync throw escapes before `Promise.all` attaches handlers, abandoning `waitForFileChooser()`; fixed with an async IIFE, 2.2 scope "any packages/*/src file").
- Files changed (all `packages/*/src`): `browser/src/actions/frame-call.ts` (new), `browser/src/actions/browser-action-engine.ts`, `browser/src/dom/dom-semantic-engine.ts`, `browser/src/verifier/post-conditions.ts`, `capability-runtime/src/runtime.ts`.
- The plan's SAFE list was re-derived rather than trusted; additional SAFE rows the plan did not list (each with its reason in `frame-call-sites.md`): `condition-wait.ts:371`, `browser-action-engine.ts` `$$eval` x2 and `ElementHandle`/Page rows, `post-conditions.ts:237`, `runtime.ts` 1545/1615/1641.
- Independent cross-check: `independent-enumerate.mjs` (plain Node scanner over `git ls-files`, no ripgrep, no `list-sites.mjs` code) finds the same 210 keys as `sites.txt` (`independent-enumerate.txt`: only-independent 0, only-sites 0).
- Not designed here (plan 2.2): `buildGraph`'s outer catch-all that returns an empty graph (S10b).

## Kayak (supporting only, one attempt, no retries)
`kayak-supporting.json`, `logs-kayak/`: `nav https://www.kayak.com --settle` OK; `nav https://www.kayak.com/stays --settle` -> `Fatal: net::ERR_ABORTED` (a navigation abort, not a frame error), so the session stayed on the flights home page and the stays field never appeared. The scripted id heuristic then matched `[#35] "Swap origin and destination"` (click: stale-id "No visible element" message) and `[#173] a "Search for flights"` (type `Rome`: reported success). Literal criteria met (no `detached Frame` in any output, no `Interactive elements (0)` while `text` shows content; `snap` 94 and 65 elements) but the intended stays-city-field scenario was NOT reproduced, so this is recorded as **inconclusive, not as a pass**; the deterministic fixture is the evidence for I-047. No bot wall/429/CAPTCHA text was seen. Separate observation for S10b (not I-047): `nav /stays --settle` aborts.

## Mutants (all killed; `mutants-unit.txt`, `run-mutants.mjs`, live in `live-detach-mutant.err`)
| mutant | killing test(s) |
|---|---|
| M-047a loop wrapper reverted | U1, U2, U4 (+ live L1 10/10 detached) |
| M-047b buildGraph wrapper reverted | U5 (+ live L3 SDK 20/20 degraded) |
| M-047c frameCall non-async (`op(f).catch(e => { throw e })`) | frameCall test, U1-U5, U6a-U6f (12 failed) |
| M-047d single-frame path reverted | U3 |
| M-047e head start reverted | U4 |
| M-047f per-frame catch clears `allNodes` | U5 |
| M-047h/i/j/k/l/m post-conditions 631/647/1197/1548/1735/1743 reverted | U6a / U6b / U6f / U6c / U6d / U6e |
| M-047g runtime upload `page.click` back to a bare array element | `upload-frame-detach.spec.ts` (also serves as its "fails before the change" proof) |
Each mutant = copy-restore of one source file, exactly 1 replacement, restored sha256 equal (CRLF working-tree files handled).

## Deviations (all small, listed so the orchestrator can overrule)
1. `rg` is not on PATH here; used the ripgrep binary bundled with ZCode (`C:/Program Files/ZCode/resources/tools/ripgrep/rg.exe`, read-only). Flags: `-nUHb --pcre2 -o` instead of `--column`: with `-U`, rg's `--column` reports file-relative columns after an earlier match (found by the script's own self-test), so keys use the byte offset and line/col are recomputed from the file.
2. The plan's blind-spot regex has a bare top-level `\?\.\(` alternative that would match every optional call in the tree; it is scoped to optional calls OF a listed method (plus `.call/.apply/.bind`, bracket calls and destructured names).
3. The inventory is rule-generated (`classify-sites.mjs`: explicit rules for every Frame/Page-delegator receiver, UNCLASSIFIED -> exit 1) and then reviewed by hand, rather than 207 hand-typed rows. The "before the fix" inventory ran on a `git archive` copy of HEAD under `$R/S4/pre-tree` (the working tree had already been edited by then).
4. One extra UNSAFE site and one extra test file (`capability-runtime/tests/unit/upload-frame-detach.spec.ts`), so capability-runtime is 555 instead of the plan's "unchanged" 554.
5. Process slip: I ran `ls /tmp` read-only twice and created then removed one 0-byte probe file `/tmp/x` (REAL_TEMP in Git Bash) while diffing the real-TEMP listing; nothing named `sutradhar-cli-*` was touched (listing identical before/after, 4 dirs).
6. L2 uses a fresh tab per run: on BOTH 0.6.1 and HEAD a second `goto()` to the churn page after a `click` hangs for 30 s (`Navigation timeout of 30000 ms exceeded`; reproduced with the published 0.6.1 bundle). Pre-existing and unrelated to frame-detach; S10b candidate.

## False-pass analysis
- S4-1: the md could be generated from the same file it is checked against (self-consistent but wrong). Ruled out by `independent-enumerate.mjs` (210 == 210 with a different implementation and no rg), by the three negative controls (exit 1 each), and by the pre-fix run finding the plan's 10 UNSAFE sites plus the independently discovered `runtime.ts:2141`. A SAFE label could hide a missed UNSAFE: the SAFE rationales (call inside the same `try`/async scope that handles a rejection) are reasoned from source and not individually unit-tested; they are exercised live under churn by L1-L4 (HEAD 0 detached failures, 0 degraded snapshots; NEG061 fails 10/10, 30/30, 5/5), which is supporting, not exhaustive, evidence for those rows.
- S4-2: a fake that throws asynchronously would pass vacuously. U-ctl asserts the synchronous throw (`expect(() => f.waitForSelector('x')).toThrow()` and that `.catch` cannot contain it) and passes before and after; 12 of 13 fail on the pre-fix tree (`new-tests-before-fix.log`), M-047c (non-async frameCall) fails 12 of 13.
- S4-3/S4-5/S4-6: a fixture that never churns would pass anything. `window.__recreated > 100` asserted after every run, and NEG061 (a different, published build with its own Puppeteer 25.12.0) fails 10/10, 30/30, 5/5 on the same fixture, so the fixture is capable of failing; the same-build mutants (same Puppeteer as HEAD, so no version confound) fail 10/10 and 20/20.
- S4-4: success via the head start (never entering the loop) would pass; measured `t1 - t0` is 2.9-3.6 s (> 1000 ms head start) and `__clicks.late === 1` is read from the page after each click. L2 does not discriminate against NEG061 (also 10/10) - stated above, not claimed as a differentiator.
- Stale dist: forced build 9/9 executed, 0 cached (`build.log`), `cli-bin.js` cc268ca9 -> 1fb886d1, `index.js` 5cbe7445 -> e47a4f9d; the harness prints the sha256 of the files it runs and `live-detach-head.json` `cliSha256` (1fb886d1) equals the freshly re-read `sha256sum` of dist; `grep -c frameCall` = 11 in the HEAD bundle, 0 in NEG061. The bundle is not minified, so the grep is meaningful.
- Wrong binary/auth path: the CLI runs through `spawnSync(process.execPath, [cli-bin.js ...])` against a real headless Chrome with real session state in the ISO; no mocks on the live path. Isolation: `[iso-guard]` lines in every log, no `ISOLATION GUARD`, path-log check exit 0 on every CLI run (100-110 `[cleanup]` lines, 0 outside ISO), `state.userDataDir` 199 chars with dirname == ISO.
- Counts: totals re-read from the logs in `test-*.log`, not from memory.

## Notes for later steps
S10b candidates: `buildGraph` outer catch-all (plan), goto-after-click hang on the churn page (both builds), `nav kayak /stays` ERR_ABORTED. S10 changelog: I-047 also hardens `uploadFileViaTrigger` against an abandoned `waitForFileChooser()` when the main frame is detached.
`git status --porcelain` before the commit: `status-before-commit.txt`.
