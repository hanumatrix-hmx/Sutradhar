# FR2-07 run-1: deviations from spec.md

The spec was written against base `767ed73`; this run is based on master `c83c220` (FR2-01..06, 09, 10, 12, 16
landed). Everything was anchored by symbol name and each section-0 claim was re-checked against the current
code. Where the code or the platform differs, the spec's intent was followed and the difference is recorded
here. Nothing below weakens an acceptance criterion; each item says what was done instead and why.

## Preconditions (checked, not deviations)
- `evt.filePath` exists in `browser-action-engine.ts` (`onProgress`): FR2-05 precondition satisfied.
- `InvalidSelectorError` exists in `capability-runtime/src/runtime.ts` (via `types.ts`): FR2-06 precondition satisfied.
- `getPendingDialogDetail` (FR2-04) exists on `IBrowserTab`; `dialogPendingOf` uses it when present and falls
  back to `getPendingDialog`.

## Where the current code / platform contradicted the spec

1. **`page.goBack()` at the history edge throws in Puppeteer 25, it does not resolve `null`.** Spec section 0.2
   ("resolves `null` ... silently reported as success") and baseline row B-N4 ("silent success") describe older
   Puppeteer. The pre-change build (run via `--baseline`, `baseline.jsonl` row B-N4) returned an *error*
   (`go_back failed: History entry to navigate to not found.`), not a silent success. To still deliver the
   contract (a result with `verification`, tier `contradicted`, "no history entry to go back to"), the runtime's
   `historyStep` swallows exactly that one Puppeteer message and lets the CDP navigation probe judge the
   unmoved history index. Any other error still propagates. Unit test R6b covers both branches.
2. **SDK `waitForSelector` still resolves `undefined`.** Spec 2.12/S7 says it returns the `ActionResult`, but the
   existing FR2-01 test `S4: resolves to undefined on success` pins the old return value and the spec's own rule
   (4.0) forbids changing an existing assertion. The verification is reachable via `page.lastResult` (which the
   spec also adds). It still throws its plain FR2-01 `Error` (not `ActionFailedError`) on failure for the same
   reason (the message is that method's documented contract).
3. **FR2-06's `E6` test pins that `press_key` never touches `mainFrame().evaluate` on a partial mock.** The
   spec's own E1 only covered a page with no `mainFrame`. Observers therefore require a *real* frame
   (`hasFrameApi`: `evaluate` and `childFrames` both functions); a partial double is `not-run` synchronously with
   no renderer call. Real Puppeteer frames always satisfy it.
4. **Observer signatures.** `observeFocusForKey(tab)` / `observePoint(tab, ...)` / `observeUploadTargets(tab)`
   take the tab (not the page) because the dialog check needs `tab.getPendingDialog`. `NavigationProbe.begin` /
   `finish` each open and detach their own CDP session instead of sharing one (no leak if `finish` is never
   reached).
5. **A cross-frame identity expando is not usable for points.** The spec's point observer marks the `<iframe>`
   element and matches `frameElement()` by that mark. Puppeteer's `frameElement()` handle lives in its utility
   (isolated) world, where a main-world expando is invisible, so the first live P5 run was `unverifiable`
   ("frame could not be matched"). Frames are now matched by bounding box (also removes the page-observable
   mark). Key/focus frame descent uses `getRootNode().activeElement === el`, which needs no expando.
6. **Reason wording.** Added the article ("an alert dialog", "a confirm dialog"). For a printable key whose
   value did not change *and* no trusted keydown was seen at all, the reason says "no trusted keydown ... reached
   the page" (the spec's K5 expects that phrase, but its table only produced it for rule `none`). For
   `click_at_point`, `mousedown`/`mouseup` are armed as well as the click event: when an element removes itself on
   mousedown Chrome drops the click entirely, and the mouseup shows where the press ended, which is what produces
   the spec's expected "landed on ..., not on button#vanish" reason.
7. **"Pass expect:{...}" coaching sentence** is not appended for `wait`, `screenshot`, `take_screenshot`,
   `set_clipboard`, `get_clipboard` (none accepts an `expect` on any surface, so the hint would point at
   something the caller cannot do). Spec V5 only exercises `press_key`.
8. **`click_at_point` no longer blocks on `page.title()` behind a dialog.** Racing `mouse.click` (GAP-019) was not
   enough live: `readTitle` is a main-thread evaluate and re-created the 30 s hang one call later (first P7 run:
   30011 ms). With a dialog pending the cached `tab.title` is used.
9. **MCP screenshot** adds the verification text block only when the runtime result carries one; the existing
   test T11 (mock returning `{base64}`) pins the note at `content[1]`. The real runtime always supplies it.
10. **CLI `--json`.** The spec's `dialogKeys` merge is unnecessary here: FR2-04/GAP-261 already routes
    `dialogPending:`/`dialogHandled:` lines to stderr in `--json` mode, and the result JSON carries
    `dialogPending` from the runtime, so `reportDialogs` was not changed. A value-less `--expect-text --json` is
    detected as "missing value" because `--json` is one of the CLI's own flags.

## Live-script differences from spec section 5
- **K8** asserts `verified` and the observer's URL only; whether the reason says "navigated" or "delivered"
  depends on whether the page commits before the read (timing), so it is recorded, not asserted.
- **D3**: both downloads are `verified` and neither is flagged "predates"; the *paths were identical*, i.e. this
  Chrome overwrote the first file instead of uniquifying it (the spec assumed FR2-05 uniquifies). Logged as a gap,
  outside FR2-07.
- **P5** asserts the verdict *agrees with the observer's counter* (verified => +1, contradicted => unchanged,
  unverifiable => no claim). Live, a click into a just-attached out-of-process frame was sometimes not delivered
  at all (counter unchanged, 1 of 3 runs) and the tool correctly said `contradicted`; the spec's "verified only
  if +1, else unverifiable" would have failed a correct verdict.
- **S1** compares the reported `WxH` with the returned PNG's own IHDR (parsed in the script), because the
  observer's `innerWidth x scrollHeight` (800x600) differs from the attached session's emulated viewport
  (1100x900): the observer reads a different viewport than the one screenshotted.
- **CLI cases run with async spawn** (not `spawnSync`): the fixture HTTP servers live in the script's own process,
  and a blocked event loop starved Chrome's requests (first CLI run: `nav` timed out at 30 s).
- **Baseline** was produced from `git archive c83c220` extracted outside the repo (`E:/AI-Cache/tmp/fr207-base`,
  `pnpm install --offline`, `pnpm run build`); no git worktree was created. B-X2 (a real false positive: hidden
  text made `verified:true`) and the 0.45 generic verdicts are in `baseline.jsonl`.
- **T1 (touch_tap, decision gate D15)**: real Chrome delivered trusted `touchend`/`pointerup`/`click` events to a
  tapped, unoccluded element without touch emulation (T1 `verified`, observer confirmed). D15's fallback
  ("stay unverifiable") was therefore not needed and was not applied.

## Process notes (not spec deviations)
- **Regression gates** were run from this worktree with each script's evidence directory redirected into `regression/`
  (the scenario drivers via `SCENARIO_OUTPUT_PATH`; `ci-gate.mjs` reads a fixed directory, so it was run as a temporary
  copy with `RESULTS_DIR` pointed at `regression/scenario`, then deleted). `verify-fr2-10` has no evidence-dir variable and
  rewrote its own committed evidence; those 4 tracked files were restored with `git restore -- <dir>`.
- **Attribution runs on the pre-change build** (`git archive c83c220` extracted to `E:/AI-Cache/tmp/fr207-base`, built offline):
  `verify-fr2-04` (`base-fr2-04.log`: same single L13.headed failure), `run-cli.mjs` (`base-scenario/`: same 11/14), UC-08 alone,
  and a same-fixture headed alert-click A/B (`l13-headed-alert-click-ab.*`).
- **The 40 MB soak log** is not committed (`regression/soak-summary.json` has its sha256 and per-kind counts).
- **Live mutation** (`live-mutation.json`) edits the *built dist* the live script drives, then restores the identical bytes
  (sha256 recorded); unit mutation (`revert-confirm.json`) edits `src` the same way.
- **One CLI-session Chrome per run is left behind as a `sutradhar-cli-*` profile directory** (GAP-315, FR2-03 territory); the
  script reports it in `live-summary.json` `hygiene.newSutradharCliTempDirs` and I removed it by hand each time.
