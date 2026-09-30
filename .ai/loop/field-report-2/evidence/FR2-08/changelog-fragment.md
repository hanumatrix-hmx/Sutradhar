# FR2-08: Condition waits and settle everywhere — changelog fragment

Sleeping to wait for a page is the anti-pattern this item removes. `success` of an action says the click happened;
it never said the page had finished reacting. Sutradhar now has a real "wait until X is true" primitive and `settle`
on every tool that touches the page.

**New:**
- `browser.wait_for` (MCP), `sutradhar waitfor` (CLI: `--text`, `--text-gone`, `--url`, `--js`) and `page.waitFor()`
  (SDK: `{text, textGone, url, js, timeout}`). Every given condition must hold at the same moment.
  - `text`: rendered text appears (any frame, open shadow roots, case-sensitive substring). It is the SAME check and the
    SAME code as `expect.text` (`probeVisibleText`), so "visible text" means one thing in Sutradhar and `wait_for` inherits
    `expect.text`'s documented limits: text inside never-painted SVG containers counts (GAP-329) and visible text split
    across inline-block/flex items or inside a `<textarea>` can be missed (GAP-331).
  - `textGone`: that text is absent from every frame. It succeeds at once if the text was never there
    (`output.presentAtStart:false`, verification `unverifiable`, a CLI stderr `Note:`), so a typo is surfaced, not hidden.
    A frame that cannot be inspected (hung, gone, a dialog open) is "unavailable": never "met", and never read as "gone".
  - `url`: substring of the tab URL (`pushState`/hash included). No page contact, so it is unaffected by dialogs.
  - `js`: a side-effect-free JavaScript EXPRESSION run in the main frame every ~100 ms, truthy = done, a throw fails the
    wait at once. Main frame only.
  - Polls from Node (a Node `setTimeout` between passes, fully-awaited per-frame probes, each pass bounded to 1.5 s):
    works in a background tab. It never calls `page.waitForFunction`. No hidden retries: `timeoutMs` (default 10000, max
    300000, `0` = check once) is the real total, plus at most one 1.5 s pass. It does not queue behind other actions on the
    tab. A native dialog blocking the page fails the wait within about a second, naming the dialog (CLI exit 3).
  - Result: `{success, actionType:'wait_for', output:{conditions, satisfiedAfterMs, polls, presentAtStart?, last?}}` plus
    FR2-07's `verification` (verified on success, `unverifiable` for a vacuous `textGone`, `action-failed` on failure) and a
    history entry. A timeout error lists which conditions were met and which were not.
- `settle` on every tool that interacts with or navigates the page: `navigate`, `go_back`, `go_forward`, `reload`,
  `click_at_point`, `drag_at_points`, `press_key`, `focus`, `hover`, `select_option`, `select_options`, `click_by_text`,
  `click_by_role`, `type_by_label`, `fill_form` (one settle after the last field), `upload_file`, `upload_file_via_trigger`,
  `right_click`, `drag_and_drop`, `touch_tap`, `download_file`, `handle_dialog` (they join `click`, `type`, `scroll`); the
  SDK `goto`/`press`/`scroll`/`download`/`uploadFile`; the CLI `nav`, `clicktext`, `clickrole`, `press`, `select`, `hover`,
  `upload`, `drag`, `clickpoint`, `dragpoints`, `download`. Reads, configuration setters, waits, lifecycle and tab tools are
  deliberately excluded (a unit test classifies every registered tool). `settle` is a new trailing parameter everywhere, so no
  existing call changes.
- `AGENT_SETUP.md`: "Waiting: wait on conditions, never sleep" (what to wait for with which tool, exact semantics of each
  condition, and `settle` vs `wait_for` vs `expect`). Tool count 72 (was 71).

**Changed:**
- `settle` now has a hard upper bound of `timeoutMs + 500 ms` on the Node side. It previously had none: a `click` with
  `settle:true` that opened an `alert()` blocked until the tab's 30 s auto-dismiss (measured before/after in `run-1/t5-before-after.md`).
  Settle still never fails an action.
- CLI: `--text`/`--text-gone`/`--url`/`--js` on any verb other than `waitfor` is an error (exit 1), not silently ignored.

**Why Node-side polling, honestly (baselines recorded by the live run, `run-1/live/live-summary.json`):**
- `page.waitForFunction` with its default `raf` polling in a hidden tab: timed out at 10 s where `wait_for` succeeded within 700 ms
  of the page's own event (B-RAF; the tab reported `rafCallsIn500ms: 0`). This is the reason.
- `waitForFunction({polling: 100})` in the same hidden tab resolved 30 ms after the event (B-INT): the spec's expectation that
  in-page interval polling is throttled to >= 1 s was NOT reproduced here.
- `waitForFunction(string)` on a strict `script-src` CSP page RESOLVED (B-CSP): the spec's expectation that CSP blocks it was
  REFUTED (Puppeteer compiles it in its own world). CSP is therefore not claimed as a reason; `wait_for` is verified to work
  on that page (L8).

**Known limitations:** see `docs/22-changelog.md` (`wait_for` text conditions share `expect.text`'s limits; `js` is main-frame
only; the CLI cannot start a wait while a dialog is already open; `settle` cannot see a pending timer).
