# FR2-07: A single verification contract — changelog fragment

Every action result now follows one contract: `success` says whether the primitive ran, `verification`
says whether its effect was observed. This replaces the old patchwork (some results carried a real
check, some a generic 0.45 "unverified", some nothing).

**New:**
- `verification.evidence: {tier, checks[]}` on every action result. `tier` is one of `verified`,
  `contradicted`, `unverifiable`, `low-confidence`, `action-failed`; callers branch on it, never on the
  confidence number. Confidence is fixed per tier: verified = 0.90, unverifiable = 0.45, contradicted =
  0.09, action-failed = 0. Each check has a stable id (`press_key.effect`, `download_file.file-on-disk`,
  `navigate.document`, `expect.text`, ...) and scalar `expected`/`observed` values. Evidence never contains
  a field value or clipboard content.
- A public `expect: {text?, url?, urlChanged?}` option on 24 MCP tools, `--expect-text`, `--expect-url`,
  `--expect-url-changed` / `--expect-url-unchanged` on the CLI action verbs, and `options.expect` in the
  SDK. A failed expectation never fails the action: `success` stays true, `verified` is false, `tier` is
  `contradicted`. CLI exit code **4** and SDK `ExpectationFailedError` report it.
- Real post-condition checks for the actions that had none: `press_key` (trusted keydown observed on the deep
  focused element, through shadow roots and same/cross-origin frames, plus a value/focus effect where it is
  deterministic), `focus` (`activeElement` identity in the element's own document), `touch_tap` (a trusted
  touch/pointer/click reached the element), `download_file` (`fs.stat` of the reported path: exists, > 0
  bytes, written during this call), `navigate`/`go_back`/`go_forward`/`reload` (CDP loader id + history index
  + HTTP status), `click_at_point`/`drag_at_points` (which element was actually at the point and whether a
  trusted event reached it), `set_clipboard` (read back from a CDP isolated world, so a page that patches
  `navigator.clipboard` cannot spoof it), `upload_file_via_trigger` (change event / file list read back), and
  `wait_for_selector` (its existing in-dispatch check is now reported instead of showing 0.45).
- `verification` on results that had none: `navigate`, `go_back`, `go_forward`, `reload`, `set_clipboard`,
  `get_clipboard`, `upload_file_via_trigger`, `click_at_point`, `drag_at_points`, `fill_form` failure entries,
  the duplicate-action rejection, and (as a JSON text block after the image) `screenshot`.
- `dialogPending: {type, message, defaultValue, url}` on every MCP/SDK action result while a native dialog is
  open (closes GAP-018), the same shape as the CLI's `dialogPending:` line.
- SDK: `page.lastResult`, `ActionFailedError`, `ExpectationFailedError`, `GotoOptions`, `ActionOptions`.
- `runtime.readClipboard()` (`{text, verification}`); `getClipboard()` still returns a string.
- CLI `--json` on action verbs prints the full result JSON (failure screenshot omitted).

**Changed (behavior):**
- Confidence for a failed check drops from 0.45/0.36 to **0.09** (the `contradicted` tier). Confidence is
  0.45 only where no real check could run, and its `reason` now names exactly why.
- `expect.text` / `expectedElementText` now means **rendered** text across all live frames and open shadow roots,
  bounded to 1.5 s per frame. Precisely: the text node is laid out (non-empty client rects), its computed
  `visibility` is `visible`, it is not under `display:none` / `content-visibility:hidden` / a closed `<details>`, and
  every enclosing `<iframe>` is itself rendered and `visibility:visible` (judged from the parent side, so it also
  holds for cross-origin frames). `opacity:0`, `aria-hidden`, off-screen and clipped text still COUNT (rendered, not
  "perceivable"); text in a closed shadow root is unreachable. Anything that cannot be judged (frame element
  unreachable, page too large for the work budget) is `unavailable`, never "visible". It used to be `textContent`
  (main frame only, unbounded), which counted `display:none` and `<script>` text: a real false positive.
- `shouldUrlChange:false` now asserts the URL is unchanged. It used to be silently ignored.
- SDK `click`/`type`/`press`/`scroll` now **throw `ActionFailedError`** on `success:false` (closes GAP-024;
  breaking, part of 0.5.0) and return the result instead of `void`. `waitForSelector` still resolves
  `undefined` and throws its plain FR2-01 error; read its verification from `page.lastResult`. `goto` still
  returns the `Page`.
- CLI: every action verb prints one extra `Verification:` line; exit code 4 is new; `press` aborts when focus
  fails or lands elsewhere instead of pressing into whatever holds focus (closes GAP-025).
- `runtime.setClipboard` and `uploadFileViaTrigger` return `ActionResult` instead of `void`.
- `clickAtPoint` / `dragAtPoints` no longer block for 30 s when the click opens a native dialog (closes
  GAP-019); the result names the dialog.
- `go_back` / `go_forward` with no history entry: Puppeteer 25 throws "History entry to navigate to not
  found."; the runtime now turns that into a normal result whose verification is `contradicted` ("no history
  entry to go back to") instead of an opaque error.
- `browser.click_at_point`'s description no longer claims verification is bypassed.

**Not covered (by design, logged as gaps):** state setters (`set_cookie`, `grant_permissions`, `set_viewport`,
...) and read tools (`eval`, `extract_data`, `snapshot`, ...) are outside the contract; `set_clipboard`,
`get_clipboard`, `screenshot` and `fill_form` take no `expect`; there are still no CLI `back`/`forward`/`reload`
verbs or SDK `goBack`/`goForward`/`reload`; `drag_and_drop`/`drag_at_points` delivery is not observed inside
frames.

**Cost:** about 2-4 extra CDP round trips per press/focus/tap/point action and 4 per navigation, each bounded by
a 1-1.5 s timeout (measured in `run-1/live-summary.json`).

**`tools/list` size:** the payload grows from 64,950 to 87,093 bytes (+34%) because the `expect` description is repeated on 24 tools. The tool count is unchanged (72) and the tool names are identical.

- (fix-2) `expect.text` aggregation: a frame that never answers no longer makes the whole page unverifiable. `found` returns as soon as
  any frame confirms; each frame has its own 1.5 s bound; "not found" needs every frame to have answered, otherwise the result is
  `unverifiable` with `only N of M frames answered (K did not answer within 1500ms; hung:<frame url>)`.
- (fix-2) Text inside a `visibility:hidden` iframe (or one under a hidden ancestor), including cross-origin frames, no longer verifies;
  bare text nodes in open shadow roots now count; text under a 10000+ level deep hidden tree no longer counts as visible.
- (fix-2) `tools/list`: the `expect` description is longer (precise contract); the tools array is 91,165 bytes (was 65,088 before FR2-07).
