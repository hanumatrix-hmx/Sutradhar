# FR2-11 changelog fragment (Full action history)

Status: **VERIFY (fix-1)** (audit-1 REOPENed privacy, findings F1-F6 fixed and self-verified; not self-audited, an independent re-audit follows).

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

- **fix-1 (privacy):** in free text a cut URL now ends in `[redacted]` (was: silently shortened); the stored page URL (`url`, a navigate `target`)
  is still origin + path with nothing appended. A `file:` URL is stored as `file://…/<basename>` (FR2-09 D5 shows the full local path in frame
  labels; history deliberately does not). CLI `upload` / `download` / `screenshot` / `audit` / `compare` path arguments are a basename or `<dir>`.

## Privacy note (rewritten by fix-1 after audit-1 REOPEN: the first version claimed "query strings and fragments are never stored", which was false for `?q=(a)&token=X`, scheme-less CLI URLs and local paths)
`history.jsonl` and the MCP / SDK history record commands and actions, so they are written to be safe to keep. ONE function
(`redactHistoryText`, packages/browser/src/session/action-history.ts) redacts every stored string for every surface; it is fail-closed
and token-based (it does not try to recognise URL grammar):
- **URL markers.** The text is split on whitespace. A token that carries a marker (`scheme://`, a leading `//`, `host[:port]/` or `host?x`
  with or without a scheme, IPv4, IPv6 `[::1]:P`, `localhost`, `user:pass@`, `data:`, a `?key=` query with no URL around it, a
  percent-encoded `http%3A%2F%2F`) is cut from its FIRST `?`, `#` or `;` to the end of the token and replaced by `[redacted]`, so
  `?q=(a)&token=X`, `?ids[]=1&t=X`, `?q={x}`, `?q=it's`, `#frag`, `;jsessionid=X` all go; userinfo (`user:pass@`) is removed; `data:` bodies
  become `data:…`; `blob:` keeps its origin. After a cut the following tokens are dropped up to the next URL or path (a URL typed with
  literal spaces cannot leak its tail). A form-encoded body (`a=1&token=X`) is replaced whole. The display origin and path stay visible.
- **Local paths.** An absolute Windows (`C:\...`, `C:/...`), UNC, POSIX or `~/` path and a `file://` URL are reduced to their **basename**,
  also when the path contains spaces (`file://…/file.txt` for a file URL; a query on a path is cut). In the CLI, `upload` / `screenshot` /
  `compare` file arguments are stored as a basename even when relative and `download` / `audit` directory arguments as `<dir>`.
- **Lengths only:** typed text (`type`, `fill_form`, `type_by_label`), `select` values, clipboard text, dialog prompt text (`<8 chars>`).
  A typed value quoted in a failure message (and the field content quoted by "type did not land") is scrubbed.
- **Not recorded:** eval results, CLI flags (so a `--expect-text` / `--text` value is not in `args`), cookie / storage values, `handle_dialog`
  (MCP), tab lifecycle and state setters.
- **Stored as written (capped at 200 / 300 characters, redacted by the rule above, not masked):** the first 200 characters of `eval` code
  (a literal secret in it is stored), `click_by_text` text, selectors, `expect.text` / `wait_for` text as they appear in the action
  `selector` and in `verification.evidence`, page text quoted in error messages, URL *paths* of full URLs (a `/reset/<token>` path is kept)
  and the CLI line's `cwd`. Do not `eval` literal secrets if the state directory is shared. The file is created 0600 on POSIX and sits next
  to `state.json`, which already grants full control of the browser.
- Lines written by a build before fix-1 are not rewritten (`history` re-applies the rule when it prints; `history --json` is verbatim).

## Not covered (logged as gaps)
The SDK has no public history API (read `runtime.getActionHistoryReport`); MCP history is not persisted across server restarts; tab
lifecycle and state setters are not recorded; `history` has no `--last`/`--session` filter (use `| tail -n 40`); CLI flags are not
recorded; there is no opt-out; CLI tab ids are not stable across processes (every action row also carries the page URL).
