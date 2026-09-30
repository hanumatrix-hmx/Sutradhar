# FR2-11 changelog fragment (Full action history)

Status: **VERIFY** (implemented and self-verified; not self-audited, an independent audit follows).

## Added
- `browser.get_action_history` records more, and says how much it lost:
  - **Recorded now:** `navigate`, `eval`, `go_back`, `go_forward`, `reload`, `click_at_point`, `drag_at_points`,
    `set_clipboard`, `upload_file_via_trigger`, `wait_for`, and the duplicate-guard and invalid-`timeoutMs` rejections, on top of every
    element action that was already recorded. `audit` and `compare` navigate through `runtime.navigate`, so their navigations appear too.
  - **New entry keys:** `target` (what the action was aimed at when that is not a selector: the redacted URL for `navigate`, the
    eval code preview, `(x, y) left`, the key for `press_key`, ...), `url` (the tab URL right after the action, query and fragment
    dropped) and `verification` (the same object the action's result carried: FR2-07 `{verified, confidence, reason, evidence}`,
    including FR2-08's `wait_for` / `expect` checks; absent for `eval`, which the contract excludes).
  - **`scope: "session"`** merges every tab in the order the actions were recorded (each entry has `tabId` and a per-session `seq`),
    **including tabs that have since closed** (an OAuth popup's actions no longer vanish with it). The default stays the active tab
    (`scope: "tab"`); `scope: "session"` with `tabId` is an error (a flag that would be silently ignored is rejected).
  - **`evicted` / `capacity` / `note`:** once the 200-entry cap is hit, `evicted` is the exact number of older entries dropped
    (per tab for `scope:"tab"`, per session for `scope:"session"`), `capacity` is 200, and `note` says so in words. `evicted` is
    always present (0 = nothing lost).
  - New `SutradharRuntime.getActionHistoryReport(sessionId, {scope?, tabId?})`; `getActionHistory` is unchanged.
- **CLI history file and `sutradhar history [--json]`.** Every command that runs against (or manages) the directory's session appends one
  JSON line (`v`, `type`, `ts`, `sessionId`, `cwd`, `verb`, `args`, `exitCode`, `durationMs`, `error?`, `actions[]`, `actionsEvicted`) to
  `history.jsonl` next to `state.json`. Reads (`snap`, `text`, `tabs`, `eval`, `screenshot`) and `close` are recorded; `doctor`, `profile`,
  `history` itself, `--help` and usage errors are not. The file survives `close` and self-heal. `sutradhar history` prints a human
  view (a `--- session ... (current) ---` row per session, one row per command, an indented row per action with its verification tier);
  `--json` prints the raw JSONL lines. It never starts a browser. A hung command stopped by the CLI watchdog is recorded before the
  process exits.
- **Robustness.** A line is one append, so parallel CLI processes cannot interleave bytes inside a line (verified with 8 real processes x 50
  lines and 6 x 5 lines of about 58 KiB). A torn last line (a process killed mid-write) is skipped with a `Note:` on stderr, is never
  fatal, and does not swallow the next command's line. At 5 MiB the file rotates to `history.1.jsonl` (one generation). An unwritable
  file gives one `Warning:` line; the command's output and exit code are unchanged.

## Changed (additive)
- Tab-view entries keep their original keys and values and gain `target`, `url` and `verification`; there are more of them (see above).
  A consumer that counted entries will see more.
- `runtime.waitFor`'s history entry now carries the page `url` and the result's `verification`.

## Privacy note
`history.jsonl` records commands, so it is written to be safe to keep:
- **Never stored:** URL query strings and fragments (origin and path only); typed text (`type`), `select` values, clipboard text
  (`setclipboard`, `set_clipboard`) and dialog prompt text (recorded as a length like `<8 chars>`); eval results; a typed value quoted
  in a failure message or in a failed action's verification reason (the engine's `type did not land the expected value` error quotes
  both the typed value and the field's content; both are replaced); CLI flags.
- **Stored (documented, not masked):** the first 200 characters of `eval` code, so a literal secret written in it
  (`localStorage.setItem('jwt', '...')`) is stored; `click_by_text` text and the `wait_for` condition text/`js`; page text quoted in error
  messages (capped at 300); URL *paths* (a `/reset/<token>` path is kept). Do not `eval` literal secrets if the state directory is shared.
  The file is created 0600 on POSIX and sits next to `state.json`, which already grants full control of the browser.

## Not covered (logged as gaps)
The SDK has no public history API (read `runtime.getActionHistoryReport`); MCP history is not persisted across server restarts; tab
lifecycle and state setters are not recorded; `history` has no `--last`/`--session` filter (use `| tail -n 40`); CLI flags are not
recorded; there is no opt-out; CLI tab ids are not stable across processes (every action row also carries the page URL).
