# FR2-11 changelog fragment (Full action history)

Status: **VERIFY (fix-2)** (audit-1 and audit-2 REOPENed privacy; the redaction is now the character rule; not self-audited, audit-3 follows and is the last standard audit).

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
- **fix-2 (privacy):** the redaction no longer recognises URL shapes: it is the character rule below (cut at the first `?` `#` `;` and drop the rest of the text, `=` / `&` tokens replaced, userinfo stripped, a path token reduced to its last segment, encodings decoded first). Free text that merely contains those characters is redacted too (over-redaction, documented). A custom-scheme redirect, `about:blank#S`, `intranet:8080/p#S`, a URL with a space and any scheme-less URL no longer keep their tail; `cwd` is `~/dir` or `<dir>`; a navigate `target` such as `com.example.app:/cb` is stored as `<dir>`.

## Privacy note (rewritten by fix-2 after audit-2 REOPEN: fix-1 recognised URL shapes and claimed more than it did; `com.example.app:/cb#access_token=S`, `about:blank#S` and `intranet:8080/p#S` kept their fragment)
`history.jsonl` and the MCP / SDK history record commands and actions, so they are written to be safe to keep. ONE function
(`redactHistoryText`, packages/browser/src/session/action-history.ts) redacts every stored free-text string for every surface. It is the
CHARACTER RULE: it never asks what a token is (a URL, a path, a word), it looks at characters only, so scheme, host shape, case, unicode and
percent-encoding do not matter.
- **The rule.** Encoded forms of the rule's characters are decoded first (`%3F %23 %3B %3D %26 %40 %2F %5C %3A`, also double-encoded
  `%253F`, JSON unicode / hex escapes, fullwidth forms). The text is split on ANY Unicode whitespace (space, tab, newline, NBSP, zero-width,
  ideographic). In each token everything from the first `?`, `#` or `;` is replaced by `[redacted]` and the rest of the text after that cut
  is dropped (a bare `#id` token does not drop the text after it). A token that still contains `=` or `&` is replaced whole (a `&` also drops
  the rest). `userinfo@` is stripped (up to the last `@` of the authority). A token with a `/` or `\` followed by more text is reduced to its
  last segment, whatever the drive letter, UNC form or slash direction; a last segment with no `.` is a directory-like name and becomes
  `<dir>`. A `scheme://` URL keeps origin + path, `file:` becomes `file://…/<name>`, `blob:` keeps its origin, `data:` / `javascript:` bodies
  become `data:…` / `javascript:…`. Input beyond 8,000 characters is cut and the partial last token dropped.
- **Over-redaction is deliberate and bounded.** Ordinary text that contains those characters is redacted too (`Did you mean x?` is stored as
  `Did you mean x[redacted]`; a site-relative `/api/users` becomes `<dir>`; eval code `a = 1; b` becomes `a [redacted] 1[redacted]`). This only
  affects what is stored and printed by `sutradhar history`, never a live result.
- **Selectors keep their shape.** The `selector` field and the CLI selector arguments (click, hover, type, select, press, drag, upload,
  download) use the selector variant of the same function: `#id`, `button#save`, `[name=q]` stay readable; a `?`, `;` or `&`, a `#` with no
  identifier after it and a `#` after something URL-shaped are cut. A bare `#S` or `[a=S]` IS a valid selector and is stored (GAP-364).
- **Local paths and `cwd`.** The CLI stores `upload` / `screenshot` / `compare` file arguments as a basename (`<dir>` when it has no
  extension) and `download` / `audit` directory arguments as `<dir>`. `cwd` is `~` / `~/sub/dir` under the home directory, otherwise `<dir>`:
  the home directory's own name never appears in a line.
- **Lengths only:** typed text (`type`, `fill_form`, `type_by_label`), `select` values, clipboard text, dialog prompt text (`<8 chars>`).
  A typed value quoted in a failure message (and the field content quoted by "type did not land") is scrubbed.
- **Not recorded:** eval results, CLI flags (so a `--expect-text` / `--text` value is not in `args`), cookie / storage values, `handle_dialog`
  (MCP), tab lifecycle and state setters.
- **Stored (capped at 200 / 300 characters, through the rule above, not masked):** the first 200 characters of `eval` code (a literal secret
  with no rule character is stored), `click_by_text` text, `expect.text` / `wait_for` text, page text quoted in error messages, URL *paths* of
  `scheme://` URLs. Do not `eval` literal secrets if the state directory is shared. The file is created 0600 on POSIX and sits next to
  `state.json`, which already grants full control of the browser.
- Lines written by a build before fix-2 are not rewritten (`history` re-applies the rule when it prints; `history --json` is verbatim).
- Tests: seeded property tests (seed 20261001, 6,000 generated strings; CLI seed 20261012, 4,000 strings x 28 verbs x 3 positions), isolated
  per-rule cells, the auditors' attack generator (375 cells, 0 leaking), 35 mutants of the rule all caught.

## Not covered (logged as gaps)
The SDK has no public history API (read `runtime.getActionHistoryReport`); MCP history is not persisted across server restarts; tab
lifecycle and state setters are not recorded; `history` has no `--last`/`--session` filter (use `| tail -n 40`); CLI flags are not
recorded; there is no opt-out; CLI tab ids are not stable across processes (every action row also carries the page URL).
