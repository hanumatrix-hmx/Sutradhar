# FR2-11 AUDIT-1 verdict: REOPEN

Branch claude/fr2-11-action-history at 3fc218e, scope fdae749..HEAD. Independent auditor; no source edited, nothing committed.
Machine-readable: audit-findings.json. Probes, logs and raw outputs: this directory (regress/ holds the A/B suite runs).

## Why REOPEN
All six functional Done-when items pass with fresh live evidence. Privacy, the spec's top risk (R1), fails:
- F1 (major): URL-in-text redaction stops at ( ) [ ] { } and the apostrophe. A real, successful navigation to
  /p?q=(a)&token=X or /p?ids[]=1&token=X stores the token in verification.reason / evidence (MCP, SDK) and in
  history.jsonl on disk (CLI args and actions).
- F2 (major): CLI URL args without a scheme (nav 127.0.0.1:P/p?token=X) are stored raw.
- F3 (major under the audit brief; the spec is silent): full local paths are stored (download reason/detail,
  upload error, CLI upload/download args), and no doc lists this.
- F4 (minor): the docs and CLI help state that query strings and fragments are never stored.
The builder AC7 check was a false pass: its canaries only used ?n=..&token=SECRET.

## Privacy canary matrix (HEAD; bundle identical)
| canary | MCP tab | MCP session | CLI file | CLI history / --json | SDK |
|---|---|---|---|---|---|
| typed text (type, fill_form, type_by_label, tab2 type) | clean | clean | clean | clean | clean |
| type-did-not-land value + field content (type, type_by_label) | clean | clean | clean | clean | clean |
| select value / option label / missing value | clean | clean | clean (length) | clean | n/a |
| clipboard text | clean | clean | clean (length) | clean | n/a |
| dialog prompt text | not recorded | not recorded | clean (length) | clean | n/a |
| cookie, localStorage, sessionStorage values (setters + eval result) | clean | clean | clean | clean | n/a |
| eval result | clean | clean | clean | clean | clean |
| URL userinfo (user:pass@) | clean | clean | clean | clean | clean |
| URL query / fragment, plain shape | clean | clean | clean | clean | clean |
| URL query containing ( or [ | LEAK | LEAK | LEAK | LEAK | LEAK |
| scheme-less URL arg with query | n/a | n/a | LEAK (args) | LEAK | n/a |
| route pattern / mock body | clean | clean | n/a | n/a | n/a |
| upload dir (success) | clean (basename target) | clean | LEAK (args) | LEAK | n/a |
| upload path in error | LEAK | LEAK | n/a | n/a | n/a |
| download dir / file path | LEAK (reason/detail) | LEAK | LEAK (args + reason) | LEAK | n/a |
| eval code literal, expect.text, wait_for text, eval error quoting page data | stored (documented, except expect.text) | same | same | same | same |
History file: next to state.json; default dir ~/.sutradhar-cli/hash inherits a user-only ACL; POSIX mode 600 (WSL);
shared by every session and named profile in that directory (sessionId separates lines).

## Concurrency and kills
- Cross-process appenders through the real appendHistoryLine: 12 x 10 lines of 200 B / 5 KB / 40 KB / 63 KB / 70 KB (guard-truncated): 120/120, 0 skipped, max line 62,775 B.
- 10 x 30 lines across the 5 MiB rotation: 52 + 248 = 300, lost 0.
- Real taskkill /F /PID of 40 looping appenders: 0 torn lines, file always ends with a newline, and the next appends are not glued.
- Real taskkill /F of 42 CLI eval processes swept across their completion window: 0 unparseable lines. A kill before the append leaves no line (by design).
- Chrome killed mid-command: the line has exitCode 1 and actionsUnavailable.
- Self-heal: the line carries the new sessionId, marked (current).
- Unwritable file: one Warning, and the command is unaffected.
- A 60 MB file reads in 0.65 s.

## Completeness (MCP, one entry per action unless noted; verification deep-equal to the result)
Recorded once: navigate (+settle), eval, eval throw, click (+settle), click failure after retries, engine-rejected invalid CSS,
duplicate-guard rejection, NaN timeoutMs (SDK runtime), type, press_key, focus, scroll, hover, select_option, select_options,
wait_for_selector, wait_for met/timeout, click_by_text, click_by_role, type_by_label, fill_form (2 fields = 2 type entries),
upload_file, upload_file_via_trigger, right_click (as click), drag_and_drop, touch_tap, click_at_point, drag_at_points,
set_clipboard, download_file, go_back, go_forward, reload, audit (1 navigate), navigate to a refused port (FAIL).
Not recorded: handle_dialog, new_tab, close_tab, set_cookie, screenshot, snapshot (by spec / GAP-341), and the
runtime-level Playwright-syntax rejection (F6). seq contiguous; no double recording seen (CLI press = focus + press_key by design).

## Mutants (new; each restored, sha256 verified; forced rebuild afterwards)
A1 tab cap off-by-one KILLED; A2 seq from 0 KILLED; A3 session eviction uncounted KILLED; A4 fragment kept KILLED;
A5 type_by_label scrub removed SURVIVED; A6 value scrub only for >= 12 chars KILLED; A7 evidence observed not redacted KILLED;
A8 runtime success:false recorded as success KILLED; A9 session report returns live ring KILLED; A10 note plural inverted KILLED;
A12 select value raw in CLI args KILLED; A13 blank lines counted as unreadable KILLED; A14 CLI secret scrub disabled KILLED;
A15 history --json re-serialises (live) KILLED. A11 (torn-line repair removed) KILLED but duplicates builder M11.

## Master comparison (concurrent A/B, same load)
FR2-08 478/478 vs 478/478; FR2-07 488/488 vs 488/488 (GAP-325 tolerated none); FR2-04 111 pass + 2 skip on both;
CLI scenario suite 12/14 vs 11/14 (UC-05, UC-12 fail on both; master UC-03 Chrome-start timeout came from the shared global profile
under concurrent runs). The headed-click stall did not reproduce on either side in this run. Overhead: MCP eval +0.04 ms mean,
click -0.09 ms, get_action_history +0.8 ms; CLI +14 ms median per command. Unit: browser 969, runtime 271, mcp 124, cli 229,
sutradhar 43, agent 56, server 28, all pass; typecheck 34/34; pre-existing spec files only appended to.
tools/list: 115,870 -> 116,847 bytes (+977, all in get_action_history).

## Under-reported by run-1
AC7 row 7d false pass (F1, F2); paths (F3) absent from docs and gaps; A5 test gap; F6 not logged; the master scratch tree
(E:/AI-Cache/tmp/fr211-master) still holds the HEAD versions of 3 test specs from the before-change run.

## Not verified
Headed mode, non-Chrome; simultaneous rotation race; a kill inside the write syscall; POSIX 600 outside WSL /tmp.
Build note: the first turbo stage of pnpm build replays its cache, but build-bundle recompiled all 14 packages under test from clean.

## Side effects of this audit, all undone
The CLI scenario suite rewrote tools/scenario-suite/results/uc06-modal-after-clicktext.png; it was restored from the HEAD blob
(hash 3dc5f41b). A leaked suite Chrome (PID 42364) was killed by PID. All PIDs I started are in pids.log.
