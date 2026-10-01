# FR2-11 run-1: false-pass analysis

For every acceptance criterion: one way its check could pass while the behaviour is broken, and the command and output that rules
it out. Outputs quoted below were produced by `fresh-queries.sh` / `fresh-probe.sh` (run last, after the final code change and the final
`turbo run build --force`, 0 cached; logs `fresh-queries.log`, `fresh-probe.log`) or are named artifacts of the final live run
(`live-final/`). Nothing is reused from an earlier round.

Final state: branch `claude/fr2-11-action-history`, HEAD `ef5eda0` + the evidence commit, tracked tree clean, sources byte-identical to
what the tests ran against (mutation driver checks sha256 before/after every mutant).

## AC1. `navigate` and `eval` are recorded (MCP, CLI, SDK)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 1a | Unit tests use pageless / mock-page tabs, so a real Chrome path might not record | Live cases run against a real Chrome with an independent puppeteer-core observer: MCP `L1` (18 checks: observer reads `#count === '1'`, then `get_action_history` re-queried AFTER the actions returns `[navigate, eval, click, eval]`), CLI `L5` (7 separate processes; observer confirms `#count` and the typed field value), SDK `SDK-L1` (`page.goto`/`page.evaluate` -> 5 entries). `fresh-queries.log` §5 re-reads the CLI line file: `nav exit 0 ... actions: navigate`, `eval exit 0 ... actions: eval`, `eval exit 1 ... actions: eval(FAILED)`. |
| 1b | The tool's own report is trusted (history says navigate happened, but nothing navigated) | The observer, not the tool, is ground truth: `mcp-L1-history.json` entry 0 is `navigate` with `verification.evidence.tier: "verified"` and the observer separately confirmed the page loaded; a mutant that never records navigate (M01) FAILS live L1 with `entries are [navigate, eval, click, eval] in call order ... observed: ["eval","click","eval"]` (`mutants.json`, `mutant-live/M01`). M02 (eval not recorded) is caught by 5 unit tests. |
| 1c | The SDK case only works because it reads through a private field, an alternate path | It reads `browser.runtime.getActionHistoryReport`, the SAME runtime object every SDK call goes through; the SDK calls under test (`page.goto`, `page.evaluate`) are the public ones. There is no public SDK accessor (GAP logged). The bundle SDK (`packages/sutradhar/dist/index.js`, esbuild output) was used, not the workspace build. |
| 1d | A stale bundle / cached build replays old code | `turbo run build --force`: `Cached: 0 cached, 19 total` and `0 cached, 9 total`. `fresh-queries.log` §3: `getActionHistoryReport cli-bin=2 mcp-cli=2 index=1`, `recordCliCommand cli-bin=3`. The bundle-surface live cases (`bundle` 20 cases, 129 checks) drive `mcp-cli.js` and `cli-bin.js` directly. |

## AC2. Session-wide merged view (per-tab view kept)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 2a | Order looks right because timestamps happen to ascend; a same-millisecond tie across tabs would reorder | Order is `seq`, and unit S7 freezes the clock (`vi.useFakeTimers`) so two tabs record in the SAME millisecond: order is `[onB, onA]` with equal timestamps. Live `L2`: `seq` strictly increasing by 1 from 1, and the merged order equals the script's own call ledger (`got` vs `exp`). Mutant M18 (`seq` not increasing) fails S6/S7/S9. |
| 2b | A closed tab's entries are merely "not crashing"; they are actually gone | Live `L2` closes T2 (tab list re-read: gone) and THEN queries the session view: T2's click is still present with `tabId === T2`; `get_action_history {tabId: T2}` is still `isError`. Unit S8. |
| 2c | The default view was silently changed to the merged one (the silent-wrongness class) | `L2`: the default call returns exactly the T1 entry count from the script's own ledger, no `seq`/`tabId` keys, `tabId` at report level equals T1. Mutant M14 (MCP ignores `scope`) FAILS live `L2` (`seq` observed `[null,null,...]`). |
| 2d | Adopted-page tabs (every CLI command's tabs) are not wired into the ring, so only `createTab` tabs work | Mutant M13 removes the wiring in `adoptExistingPage`: unit S10 fails AND CLI live `L5` fails (`nav line: actions[0] is navigate ...` observed `args` only, actions empty). MCP L1/L2 alone would NOT catch it (the MCP tab is created, not adopted), which is why M13's live surface is the CLI. |

## AC3. The CLI appends every command to `history.jsonl` next to `state.json`

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 3a | The file is written to a different directory than `state.json`, or only for successful commands | `L5`: `readdir(stateDir)` contains both `history.jsonl` and `state.json`; the failing `eval` (exit 1) has its own line with `exitCode: 1` and `actions[0].success: false`. `fresh-probe.log`: `files in the state dir: history.jsonl state.json warden.json`. Mutant M12 (exit code always 0) FAILS live L5 (`failing eval: exitCode 1 ... observed exit: 0`). |
| 3b | It only works when Node exits normally; a watchdog `process.exit(1)` skips it (spec R6) | Live `W1`: `SUTRADHAR_CLI_DEADLINE_MS=4000`, `eval "new Promise(() => {})"` -> exit 1, stderr `did not finish within 4s and was stopped`, and exactly one new line whose error names the watchdog. Mutant M20 (watchdog does not record) FAILS W1 (`before: 10, after: 10`). |
| 3c | A pre-session failure appends a bogus line (or state) | `N15`: `nav ... --profile <unknown>` exits 1 (the `printErrorAndExit` path) and the dir contains neither `history.jsonl` nor `state.json`. Documented as "nothing to attribute". |
| 3d | The file is deleted when the session is closed (spec: must survive) | `L6`: after `close`, `state.json` is gone, `history.jsonl` and the directory still exist, the last line is `verb: close`. Mutant M10 (`clearState` also deletes it) FAILS unit C10 and live L6 (`the last line is the close line` observed a file with only the close line). |

## AC4. `sutradhar history [--json]` exists

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 4a | `history` starts Chrome or mutates `state.json` (it must be read-only) | `L5`: exactly one BROWSER process (no `--type=`) carries the CLI profile before and after `history`, and it is `state.chromePid`; `state.json` sha256 identical before/after. (A first version counted all Chrome processes and flaked 13 -> 12 because Chrome's helper processes come and go; recorded in `superseded-runs/`, fixed and re-run.) `N9`: on a fresh dir `history` prints `No CLI history yet ...`, exit 0, and the state dir is never created. |
| 4b | `--json` "prints JSON" but not the file's lines verbatim | `L5`: `history --json` stdout `===` the file text (CRLF-normalised, trimmed) and has 7 lines; `fresh-probe.log`: `cmp ... BYTE-IDENTICAL`. |
| 4c | The human format only works for the fixture the test was written from | Unit C8 pins the exact string for 2 sessions / failing action / 3 verification labels / a `v:2` line; live `L5` checks the header regex, exactly one `(current)` row, 7 command rows, one `FAILED` row containing `x-L5`; `fresh-probe.log` shows a real 5-command session rendered. |
| 4d | The exit code on an unreadable file is wrong | `N8` (final script): `history` over a directory named `history.jsonl` exits 1 with `Error: could not read ...`. |

## AC5. Entries include the FR2-07 verification (FR2-08 results where present)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 5a | History stores a projection (or a 5-key pre-FR2-07 shape) that merely has a `verification` key | Live `L1`: the history entry's `evidence.tier` equals the RESULT's tier, and the click's history entry carries the same `expect.text` check id the result carried (`mcp-L1-history.json`: `click.built-in`, `expect.text`, tier `verified`). `L1b`: the `wait_for` entry carries FR2-08's `wait_for.js` check. `L1d`: reload / go_back tiers equal their results' tiers; click_at_point / drag_at_points carry evidence. Unit E1/E2 assert `toEqual(result.verification)`. |
| 5b | Verification is present only for engine actions, absent for the runtime-level ones the task named (navigate, back/forward/reload, point actions) | Mutant M03b (verification dropped from runtime-level entries) FAILS live L1 (`navigate verification tier verified`); M03 (dropped from engine entries) FAILS live L1 (`click has a verification with evidence`). |
| 5c | `eval` gets a faked verification | `L1`: the successful eval entry has NO `verification` key (`Object.keys` shown in the check); unit R3. |

## AC6. Eviction count reported exactly when the cap is hit

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 6a | `evicted` is always 0 / approximate / off by one | Live `L3`: the script keeps its own ledger of every action it sent (`nT1`, `nSes`), sends 205 evals, and asserts `evicted === nT1 - 200`, first retained entry equals the `(nT1-199)`th action sent, session `evicted === nSes - 200` and first `seq === nSes - 199`, and the `note` text. Mutants: M04a (never counted) FAILS L3 (`evicted: 0, nT1: 205`), M04b (+2 per eviction) FAILS L3 (`evicted: 10 ... first: 6`). Unit S2 (201 and 450 records), S9 (205 into the ring), and the boundary test (exactly 200 records evict nothing). |
| 6b | The count is right only for the tab view | L3 asserts both scopes; unit S9 also asserts per-tab counts stay 0 when both tabs are under 200. |
| 6c | Reported in code but the MCP output hides it | Unit M2/M3 (`evicted` always present; exact `note` text, plural and singular) and live L3 reads it from the real MCP response; the final run's L3 re-read: `{"case":"L3","pass":true,"checks":7,"failed":[]}` (`fresh-queries.log` §7). |

## AC7. Privacy: no field values, typed text, clipboard text, eval source beyond the cap, URL query or fragment

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 7a | The canary search is broken and can never see a leak | Every live surface runs a PROBE SELF-TEST (`PRIV-sweep`: the search finds `SECRET`, `?n=`, `token=` in a synthetic leaking string). And NEGATIVE CONTROLS prove the leak surface exists: the CLI's own `nav` stdout DID print `SECRET-L5`; the failing `type` printed the typed value on stdout; the MCP failing-type error text contained `typefail-SECRET-L1b`. So absence in history is meaningful. |
| 7b | Only the happy path is safe: the engine's `type did not land the expected value` error quotes the typed value AND the field's content, and a failed action's verification reason repeats it | This was a REAL leak found by the negative test E3b on the first implementation (fixed: `scrubActionError`/`scrubVerification`; deviations.md D2). Live: `fr2-11-typefail.html` (a field that discards input) makes the real engine produce that error; `L1b` and CLI `L5x` assert the raw history has no canary and the entry's error is the scrubbed message. Mutant M06 (scrub disabled) FAILS live L1b (`RAW history after the failing type has no canary ... observed ["SECRET"]`). |
| 7c | The CLI stores typed text in args | Mutant M07 (`type` args recorded raw) FAILS unit C1 and live L5 (`RAW history.jsonl bytes ... observed ["hunter2"]`). `fresh-queries.log` §5: `type exit 0 ["#name","<10 chars>"]`; §5 raw byte search `SECRET=0 hunter2=0 token==0 ?n==0`. |
| 7d | Query/fragment survive somewhere else (a verification reason, an error, `url`, a target) | Mutant M05 (query kept in `redactHistoryUrl`) FAILS live L1 (`navigate target ... http://127.0.0.1:.../fr2-11-history.html?n=L1&token=SECRET-L1`), L1b and the PRIV sweep; M16 (verification reason not redacted) FAILS unit H6. Live raw sweeps: 11 raw MCP responses, `history.jsonl`, `history --json`, human output, SDK report JSON, each 0 canary matches (`fresh-queries.log` §6: `responses=11 SECRET=0 hunter2=0 token==0 ?n==0`). `fresh-probe.log` repeats it by hand with a fragment `#access_token=FRAG-SECRET-PROBE`: every count 0. |
| 7e | Clipboard text is stored | `L1b`/`L5x`: the `set_clipboard` entry is `<14 chars>`; CLI `setclipboard` line args `["<14 chars>"]`; the whole file has no `CLIP-SECRET`. Unit R9. |
| 7f | eval code is stored in full | Unit H5/N12 (10,000 chars -> 200 ending in `…`); live: the CLI line for `eval "document.title + ' https://t.test/?k=SECRET-EV'"` (`fresh-probe.log`) shows `document.title + ' https://t.test/'`. **Documented, not masked:** the first 200 chars of eval code can hold a literal secret (GAP logged; CLI README, AGENT_SETUP, changelog say so). |

## AC8. Two CLI processes appending to the same history.jsonl concurrently

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 8a | Unit test concurrency is in one process (one event loop, one handle), which proves nothing across processes | Live `L7`: 5 REAL parallel `sutradhar eval 1` processes against one session: 5 new lines, every file line individually parseable. Live `L7b`: 8 child processes x 50 lines of ~8 KiB and 6 x 5 lines of ~58 KiB written through the built `appendHistoryLine`: 400 lines, 0 unparsable, 400 unique ids (no lost entries), file ends with `\n`; 30 lines for the big-line run. |
| 8b | The stress is too gentle to interleave anything | Mutant M08 (line written in 512-byte slices, so writers can interleave) FAILS live `L7b` (`stress A ... observed` unparsable lines) and unit C9. |

## AC9. A truncated / partially written last line must not break `history`

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 9a | The reader survives, but the NEXT append is glued onto the fragment and silently lost | Live `N7` appends `{"v":1,"ty` with no newline, then runs `text` (a new line is appended) and re-reads: 8 valid lines, still exactly 1 skipped; mutant M11 (repair removed) FAILS live N7 (`8 valid lines ... observed n: 7`) and the unit test. `fresh-probe.log`: after the torn line + one more command: `valid 6 unparsable 1`. |
| 9b | The reader throws on the fragment | Mutant M09 (rethrow on a parse error) FAILS unit C7 and live N7 (`history --json still gives exactly 7 lines, exit 0` observed 1 line and `Error: could not r...`). stderr note `Note: skipped 1 unreadable line(s) in ...` in `fresh-probe.log`. |

## AC10. No regression in the neighbouring items

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| 10a | A relaxed harness tolerance hides a failure | `verify-fr2-07-verification.mjs` 488/488, `Z-gap325-budget` PASS on mcp and bundle with `"tolerated":[]` (0 tolerances fired; `regression/fr2-07/live-mcp.jsonl`), `fr2-08` `gap325Tolerated: []`; `verify-fr2-08-conditions.mjs` 478/478 (`regression/fr2-08.log`). No test was loosened, skipped or had its matcher widened (`git diff fdae749 --stat -- '*.spec.ts'` shows only appended blocks / new files; existing tests untouched). |
| 10b | A red result blamed on the environment without evidence | FR2-04 verify: 110/113, the ONE failure is `L13.headed.click-exit0` (the known GAP-316/321/338 headed-click stall). A/B against master `fdae749` built in a temp dir (`regression/ab/`): `headed-click-ab.log` `{"base":{"ok":2,"fail":10},"mine":{"ok":2,"fail":10}}`; `l13-ab.log` base and mine both `Click failed: Action click timed out after 15000ms`. CLI scenario suite: UC-05, UC-08, UC-12 fail (external-site harness mismatches); the same three fail 0/3 on master `fdae749` and on this branch (`run-cli-master.json` / `run-cli-mine.json`); SDK UC-01 fails 0/1 on both. `run-mcp` 14/14. |
| 10c | The new tests would pass on the old code (they test nothing) | The same spec files run against master `fdae749`: browser `35 failed`, capability-runtime `16 failed`, mcp-server `6 failed`, cli `1 failed + history-file.spec.ts failing to import` (`before-change/master-*.log`), and all pass on the branch (969 / 271 / 124 / 229). The 1 capability-runtime test that also passes on master is the no-record negative (N5) which asserts an ABSENCE and so passes on any non-recording build by design. |
| 10d | Recording slows every call | `overhead-bench.json` (same process, same code path, recorded vs bypassed, alternating rounds, monotonic clock): `recordingOverheadMsPerCall: 0.00199` (bound 1 ms); `recordActionAloneMeanMs: 0.00279`. Live MCP mean per eval call 0.56-0.71 ms includes stdio JSON-RPC. |

## Not verified / limits (recorded, not hidden)
- Headed mode, non-Windows, non-Chrome browsers: not run. POSIX file mode 0600 is untested (Windows).
- `upload_file_via_trigger` and `go_forward` have unit coverage only (a wiring test where each body fails: recorded under its own actionType, the error propagates unchanged); live covers reload, go_back, click_at_point, drag_at_points and set_clipboard (a real write whose read-back is `unverifiable`: the clipboard-read permission is not granted).
- The rotation race between two processes rotating in the same instant (spec R5) is accepted and logged, not tested.
- A `taskkill /F` of a CLI mid-write to produce a REAL torn line was not attempted (torn lines are injected by appending a fragment; the appender writes each line with one `write`).
- Live attack harnesses against download/lock containment were not written (safety-classifier rule).
- The 20-minute PROB-043 soak was not run (the spec allows the 5-minute smoke): `regression/prob043.log` `passed calls=10866 mismatches=0`.

---

# fix-1 (audit-1 REOPEN): false-pass analysis

Scope: findings F1-F6 of `audit-1/verdict.md` plus the brief's test, mutation and verification requirements. Every "ruled out by" cell quotes a command and output that
was produced AFTER the last source change (HEAD `e7749cc` for the tracked sources; no tracked source changed after `8f39703`) by re-querying live state: `final/fresh-queries.sh`
(log `final/fresh-queries.log`, and `final/fresh-queries-before-rebuild.log` for the one section that flagged something), `final/fresh-probe.mjs` (`fresh-probe-{head,bundle}.log`),
`final/fresh-bookkeeping.log`, the three live runs `final/live-3x/run-{1,2,3}.log`, and the auditor's own probes re-run from byte-identical copies (`audit-probes-rerun-fix-1/`).
Nothing is reused from an earlier round. Two things this section found about itself are in the tables (marked **found**).

## F1. A query with `(` `[` `{` or `'` leaks its tail (MCP, bundle, CLI, SDK)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| F1-a | The canaries are hand-picked again (the run-1 false pass: only `?n=..&token=SECRET` was tried) | Generated matrix: 61 URL-shaped + 19 path-shaped secret positions x 20 surrounds = 1,600 cells, each with its own canary. `fresh-queries.log` §4: `matrix cells 1600 rotating 80 selfTest problems []`. The audit's four shapes are cells `query-paren`, `query-bracket`, `query-brace`, `query-apostrophe` (plus `query-dquote`, `query-angle`, `query-pct-brackets`, `query-space`, ...). |
| F1-b | The check reads a stale or pre-action snapshot | `fresh-probe.mjs` navigates, THEN calls `browser.get_action_history` (session and tab scope) and reads `history.jsonl` from disk after the last command. `fresh-probe-head.log`: `PASS MCP session view: no canary at all (queries with ( [ { ', userinfo, ;param, fragment, eval error with URL + Windows + POSIX paths, upload, download)`, `PASS MCP default tab view: no canary at all`, `PASS SDK report (session + tab): no canary; targets are origin + path`. Re-run after the final forced rebuild: `[fresh-probe head] 16/16 checks passed`, `[fresh-probe bundle] 16/16 checks passed`. |
| F1-c | The probe cannot actually see this bug (vacuous canary search) | Negative control inside the probe: `PASS negative control: the OLD regex leaves a canary in all 4 audit shapes (so this probe can see the bug)`; unit self-test: identity redactor fails every cell, an eraser fails every `keep`. Mutant MF1 (the old character-class regex restored): unit `Tests  19 failed \| 18 passed (37)`, live MCP `PM` FAILS (its batch accounting and canary checks) (`mutants-final/...json`, MF1 `unit=true live=true`). |
| F1-d | Only mocks / pageless tabs exercised | Real Chrome, real navigations: `fresh-probe-head.json` navigation targets: `http://127.0.0.1:<port>/p` x5 and `.../f` for `?q=(a)`, `?ids[]=1`, `?q={x}`, `?q=it's`, and `user:CNRY@host/p;jsessionid=..#frag`; the tool RESULT of the eval did contain the canary (`PASS MCP: the tool RESULTS did contain the secrets`), so the redaction, not an absent secret, is what the history shows. |
| F1-e | A cached or stale build | `turbo run build --force`: `Cached:    0 cached, 19 total` and `0 cached, 9 total` (twice: `final/build-1..4-*.log`). `final/dist-hash.txt`: dist tree hash before and after a second forced rebuild identical (`b4d70950...bf9f`, "the dist the live runs used equals a fresh forced build of HEAD"), and unchanged after the MF25 mutant run and its rebuild-after-restore. **Found:** `fresh-queries-before-rebuild.log` §2 said `POSSIBLY-STALE` (src mtimes newer than dist) because the auditor's mutation driver had rewritten, then byte-restored, source files after the build; §1 of the same log shows every touched file `IDENTICAL` to its HEAD blob, and the rebuild + hash equality above settles it (`fresh-queries.log` §2 now `DIST-NEWER` for all 5). Bundle: §3 `old=0 ENCODED_SCHEME=2 FORM_PAIRS=2 redactHistoryText=9` for `cli-bin`, `=4` for `index` / `mcp-cli`. |
| F1-f | Only the builder's own script passes | The auditor's unmodified probes against the rebuilt worktree and bundle: `paren.log`: `"mcpLeaks": []`, `"cliFileLeaks": []`, reason `'navigate' verified: a new document committed at http://127.0.0.1:55309/p[redacted]`; `privacy-sdk.json` `"leaks": []` (before: `CNRYsdkbracket`); probes `sha256sum -c` OK for all 7 files (`fresh-queries.log` §7). |

## F2. A CLI URL argument without a scheme is stored raw

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| F2-a | Only the `nav` verb is handled (verb-specific fix) while every other verb's args still leak | The shared rule runs on EVERY arg: unit `redactCliArgs` x 22 verbs x 3 positions x 1,600 cells; live: the CLI `PM` case sends the 80 rotating cells as `focustab <text>` (a verb that stores nothing but its args): `[cli] PASS PM (12 checks)` incl. `a plain positional arg (focustab <text>) of every cell is stored redacted and still shows its origin / path / basename`. Mutants MF5 (CLI own naive redactor) and MF24 (generic rule bypassed) are caught unit AND live (this coverage gap was real: MF5 survived live until the `focustab` pass was added, `superseded-runs/mutants-live-first`). |
| F2-b | The stored arg was checked from the command's own output, not from disk | `fresh-probe`: history.jsonl read from disk after all 9 commands; `PASS CLI scheme-less nav arg is stored as host:port/path (display part kept)` (`lines[0].args[0] === "127.0.0.1:<port>/p"`), `PASS CLI history.jsonl raw bytes: no canary`, `PASS CLI \`sutradhar history\` human output: no canary`, `PASS CLI \`sutradhar history --json\` is byte-identical to the file and has no canary`. Auditor's `privacy-cli.mjs` rerun: `unexpectedLeaks []` (before: `CNRYcliupdir, CNRYclidldir, CNRYnoscheme`). |
| F2-c | `history` hides a leak that is still on disk | The raw bytes are read from `history.jsonl` itself, not from `history` output; and the human output re-applies the rule only as defense (mutant MF16 removes it: caught by the "older leaky line" test). |

## F3. Full local paths reach history

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| F3-a | The path tools never ran (an upload that failed before recording, a download that never happened) so nothing could leak | Live checks that they really ran: MCP `PM`: `upload: a real upload worked, the missing-file upload failed, the download worked`; `fresh-probe`: `PASS MCP: upload ok, missing upload failed, download ok` and `PASS the CLI path verbs really ran (upload 0, missing upload non-zero, env-rooted download 0)`. The missing-path upload uses a DIFFERENT selector string than the first upload (the duplicate guard masked it in the first draft of my own check: **found**, `deviations.md` 10). |
| F3-b | The canary was in the basename, which is stored by design, so "no leak" proves nothing, or the opposite, a by-design basename is mistaken for a leak | Canaries are in DIRECTORY components (`CNRYfpUpDir with space`, `CNRYfpDlRoot`, `CNRYfpMissing`) and each cell's `keep` demands the basename survives (`file.txt`, `dl.txt`). The auditor's rerun leaves exactly its own DOCUMENTED list: MCP `found = CNRYlsthrown, CNRYevalcode, CNRYexptext, CNRYwaittext, CNRYupname, CNRYdlname` (`unexpectedLeaks []`; before `CNRYupmissdir, CNRYdldir`); CLI `CNRYcliupname, CNRYdlname, CNRYcliwait, CNRYcliexp`. **Found:** the auditor's own `clidldir` (the `download` DIRECTORY argument) was NOT in its documented list, and a directory's basename is a canary position, so the CLI now stores `<dir>` for download / audit directory arguments (`fresh-probe`: `PASS CLI upload arg = basename, download dir arg = <dir>`). |
| F3-c | Only Windows path shapes were tried | Matrix: Windows backslash, forward slash, spaces, lowercase drive, deep dirs with spaces, UNC, UNC with spaces, POSIX, POSIX with spaces, `/tmp`, `~/`, `file://` (Windows, POSIX, spaces, encoded spaces, query), path + query, path + fragment. **Not verified:** a real tool call on a POSIX host (POSIX shapes are exercised as strings and as injected error text on this Windows machine, including the `/home/CNRYfpE3/a b/file.txt` quoted in a live eval error). |
| F3-d | One full path is still stored | Yes, by decision: `cwd` of every CLI line (GAP-359). Stated in the docs ("the one full local path in a line") and not hidden. |
| F3-e | Mutants of the path rule are not noticed | MF4 (paths kept), MF4b (file URL path kept), MF14 (CLI file-arg basename removed), MF14b (`<dir>` removed), MF18 (path across spaces cut short), MF17 (JSON-escaped `\\` taken for a UNC root), MF23 (query kept on a path): all caught unit; MF4 / MF14 / MF14b / MF23 also live (`fresh-queries.log` §6: `mutants 27 caught 27 unit-caught 27 live-caught 17 of 17 with a live surface`). |

## F4. Docs, CLI help, READMEs and changelog overclaim

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| F4-a | The docs were edited but the BUILT help / tool description still say the old thing | `final/fresh-bookkeeping.log`: `node packages/cli/dist/cli.js --help` contains `is replaced by [redacted] (query/fragment, userinfo, scheme-less hosts included) and local file paths are stored as a basename`; the bundle's `cli-bin.js --help` has 1 `[redacted]` line; `grep -rn "Query strings and fragments are never stored\|URLs drop their query/fragment\|(query/fragment dropped)"` over AGENT_SETUP.md, docs, the READMEs and `packages/*/src` returns nothing; the rule sentence is present in AGENT_SETUP.md, the CLI README, the MCP README, the changelog, `cli.ts` and `tools.ts` (1 each). The MCP description and the help are pinned by unit tests (`tools.spec.ts` M5 asserts `origin + path only`, `[redacted]`, `basename`; `help-text.spec.ts`). |
| F4-b | The docs state a rule the code does not implement, or list a stored class that is actually dropped | Each documented class was probed: STORED (`eval` code literal, `expect.text`, `wait_for` text, basenames, a page value quoted in an eval error) all appear in the auditor's rerun `found` lists; NOT in `args` (CLI flags: `--text CNRYcliwait` is absent from `args` but reaches `actions[]` through the evidence, so `CNRYcliwait` IS in the file, exactly as the README says); typed / select / clipboard text: unit + the matrix's `type` / `select` / `setclipboard` / `dialog` cases (`redactCliArgs` keeps `['#pw','<7 chars>']` ...). **Not re-probed live this cycle:** `handle_dialog` is not recorded (code unchanged since audit-1's completeness probe, which listed it). The brief's wording on `expect.text` / `waitfor` text is ambiguous; I documented them as STORED (AC5) and said so (`deviations.md` 3). |

## F5. Mutant A5 survives (no test for the type_by_label did-not-land scrub)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| F5-a | The new test passes because the typed-value scrub alone removes the secret, so the did-not-land branch is never needed | The fixture's field content is the typed value REVERSED (`TERCES-2retnuh`), which does not contain the typed value, so it is removed only by the did-not-land branch. **Found:** my first draft put that content into an `observed` field and failed on the UNMUTATED code (a test bug, caught by running it unmutated first). Fresh: `final/` `auditor-mutants-all.log`: `A5 KILLED Tests 1 ... restored=true` (before: `SURVIVED 969 passed`); `A5-kill.txt`: unmutated `Tests 18 passed`, mutated `1 failed \| 17 passed`, sha256 before = after. |
| F5-b | The mutation driver's "killed" is a compile error | The driver reports `Tests 1 failed` (tests ran) and the failing test name; A1-A14 all restored (`restored=true` x13). A4 is `NOT APPLIED` (its target line no longer exists); its intent (fragment kept) is MF6 + MF15. |

## F6. Pre-dispatch selector rejection is not recorded

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| F6-a | "Consistent" only because BOTH paths now skip recording | Not the case and not claimed: engine-level rejections (invalid CSS) are still recorded (existing `browser-action-engine.spec.ts` tests, 989 pass); the pre-dispatch one is deliberately unrecorded and PINNED (`F6 / N17` test: 4 methods throw `InvalidSelectorError`, history `[]`). I implemented recording, FR2-06 R2 failed (`resolveTab` called 14 times), I reverted that file from `HEAD` and kept the contract (`deviations.md` 1, GAP-356). The owner can reverse it; nothing else depends on it. |
| F6-b | The test passes because the tab is missing / the session unknown | The test adopts a mock page on a real `BrowserSession`; `capability-runtime` 272 passed, including FR2-06 R2 unchanged. |

## The generated matrix, the canary search and over-redaction

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| T-a | The matrix is vacuous (texts contain no canary, or `keep` is empty) | `selfTest`: every generated text contains its canaries; identity redactor fails all 1,600 cells; an eraser fails every `keep`; `fresh-queries.log` §4 `selfTest problems []`; the live PM cases run the same self-test first (`matrix self-test` check). |
| T-b | Over-redaction would pass (everything deleted) | `keep` checks: origin + path or basename per cell, unit AND live. MF25 (a cut URL loses its path) is caught: unit `5 failed \| 32 passed`, live MCP `PM`: `no over-redaction` check FAILS with `error: "http://127.0.0.1:65026[redacted]"` for `query-plain` (`mutants-final/mutants-MF25.json`). |
| T-c | Only one surface is covered | Every history output on every surface: MCP session + default tab view + bundle (1,600 injected cells + 35 real navigations incl. 9 refused ports + upload / download), SDK report (1,600 cells + 26 real `page.goto`), `history.jsonl`, `sutradhar history`, `history --json`, CLI / bundle (80 rotating cells x 2 verbs + 26 navigations + scheme-less + paths). `fresh-queries.log` §5: `PM cases mcp:PM:PASS:10 cli:PM:PASS:12 sdk:SDK-PM:PASS:6 bundle:PM:PASS:10 bundle:PM:PASS:12` in all three runs. The CLI live cases are a rotating SUBSET (GAP-361); the full cross product for the CLI is unit-level. |
| T-d | New shapes were added after the fact and only look covered | The step-6 shapes (bare `?token=`, `/p?token=`, `intranet/app?t=`, form bodies, encoded URLs, query on a path) were added to the matrix FIRST and failed 14 tests before the code (`before-change/browser-matrix-newshapes-before.json`: `failed 14 passed 4`). |

## Mutation (at least 8 new mutants of the new redaction)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| M-a | A mutant is "caught" because the mutated file does not compile | The driver records the failing tests and the `Tests N failed \| M passed` line (tests ran); the live run builds the mutated package first and reports `buildFailed`. **Found:** the first live run reported MF4 and MF14 as NOT caught because they did not compile (TS narrowing, an unused import); the definitions were fixed and re-run (`superseded-runs/mutants-live-first` vs `mutants-final`). |
| M-b | A source is left mutated or a dist stays stale after a mutant | `fresh-queries.log` §1: `tracked changes under packages/ and tools/ vs HEAD: []` and four sources `IDENTICAL` to HEAD blobs; `mutants ... all restored identical true` (sha256 before / after every mutant) and `rebuiltAfterRestore` for every live mutant; dist hash unchanged after the last mutant (`final/dist-hash.txt`). |
| M-c | A surface-specific mutant is only checked where it cannot fail | Each mutant is paired with the surface it can affect (CLI-only mutants live on the CLI case, browser-package mutants on MCP or CLI): `live-caught 17 of 17 with a live surface`; the 10 unit-only mutants (MF4b, MF9, MF10, MF13, MF15, MF16, MF17, MF18, MF19, MF22) have no live counterpart by construction (pure string rules or CLI output formatting) and are caught by the matrix unit specs. **Found:** MF23 was NOT caught live on the first pass (its cell had no canary in the query); the cell was strengthened and MF23 re-run and caught (`mutants-MF23.json`). |

## Final verification (build, tsc, vitest, live x3) and regression

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| V-a | Unit tests ran against a stale `dist` (the CLI specs import `@sutradhar/browser` through the root vitest alias to `src`, but live runs use `dist`) | Both are checked: unit = `vitest run` on the 7 packages after the last source commit (`final/vitest-*.log`: browser 989, capability-runtime 272, mcp-server 124, cli 259, sutradhar 43, agent 56, server 28, all `exit 0`); live = the forced build (F1-e) and the dist hash equality. `typecheck.log`: `Tasks:    34 successful, 34 total`, `Cached:    0 cached`; lint clean on browser / capability-runtime / cli. |
| V-b | One lucky live run | Three full runs, each `47/47 cases, 321/321 checks` (mcp 9/72, cli 14/82, sdk 2/16, bundle 22/151), `hygiene.lingeringChromeKilledByPid []` (`fresh-queries.log` §5). The earlier mid-cycle run that had failures is kept: `superseded-runs/live-1` had 5 failing cases (two harness mistakes of mine: a canary placed in the BASENAME of the download directory, and the failing eval's message read from the line's `error` instead of the recorded action's; plus one `bundle L5` flake where click / type exited 1 with no captured stderr, which passed in the next run and in the three final runs). |
| R-a | Regression suites pass only because a tolerance absorbs a failure | FR2-07 488/488 with the GAP-325 tolerance: `Z-gap325-budget ... observed: {tolerated: []}` (fired 0 times on the mcp and bundle surfaces that carry the budget case, `regression/fr2-07/live-summary.json`). FR2-08 478/478 (`mcp 327, cli 23, sdk 10, bundle 118`). FR2-04 `ALL PASS (111 passed, 0 failed, 2 skipped, 113 total)`. |
| R-b | The CLI scenario suite difference is hand-waved | Mine 11/14 (UC-05, UC-08, UC-12 fail) vs master `fdae749` 12/14 (UC-05, UC-12) in full runs. UC-08 is the intermittent headed-download hang (95 s, empty stdout): isolated runs interleaved, mine pass / pass / FAIL, master pass / pass / FAIL (`regression/ab/uc08-*.log`), so the same 1-in-3 on both. UC-05 and UC-12 are the known pre-existing failures (external site). The suite rewrote `results/uc06-modal-after-clicktext.png`; restored from the HEAD blob (`3dc5f41b`), `git status` shows no tracked change. |
| R-c | The "master" I compared against is not master | `regression/master-tree-verify.json`: of the 5,098 files of the `fdae749` tree, 274 byte-identical and 4,820 identical after CRLF to LF normalisation; 4 differ: three test specs overlaid earlier (audit F9) and one png rewritten by a scenario run. Sources and scenario scripts match. |

## Bookkeeping

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| B-a | Ledger / gaps / decisions say done but are not | `final/fresh-bookkeeping.log`: highest gap `GAP-362`, 10 new rows GAP-353..362 (the previous maximum was GAP-352, new numbers start at max + 1); the ledger row reads `**VERIFY (fix-1)**`; the decisions entry `2026-10-01 -- FR2-11 fix-1 ...` exists. Status is VERIFY, not DONE: a re-audit follows. |

---

# FR2-11 fix-2: False-pass analysis (cycle 2, the character rule)

Fresh queries after the last source commit are in `fix-2/final/fresh-queries.log` (re-run at the end, nothing reused). Evidence index: `fix-2/README.md`.
A cell is "ruled out" only by a command that re-reads LIVE state (the built `dist`, the real history file, a real tool call) after the action.

## P1. One function, the character rule, on every surface

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P1-a | The unit tests exercise `redactHistoryText` while another surface keeps its own redactor (the CLI args, the CLI error, `actions[]`, the human output, the structured `url` / `target`) | Mutants that split ONE surface off: MX10 (CLI `fin` replaced by a naive redactor), MX18 (human output stops re-applying the rule), MX19 (structured URL skips the rule), MX20 (`entry.error` unredacted), MX33 (`buildHistoryLine` stores raw actions): every one is CAUGHT in `fix-2/mutants-unit-final/console.log`, and MX10 / MX20 / MX9 also FAIL the live script (`fix-2/mutants-live-before-step6/`). |
| P1-b | The property check is vacuous (the secret is not in the text, or the check cannot see a leak) | `char-rule.spec.ts`: "every secret is present in its own text" (6,000 distinct), "the property check catches an identity redactor on every case" (6,000 of 6,000); live: the check `PROBE: the live tool result of every failing eval DID show its shape` (23 of 23 on MCP, bundle MCP, CLI, bundle CLI); `audit-reruns-fix-2/attack-gen-negative-control.log`: attack-gen against an identity shim reports `cells=375 leaking=375`. |
| P1-c | Unit tests run against `src` (vitest aliases the workspace to source) while the shipped `dist` / bundle is stale | The live passes run the built `dist` and the bundle after `turbo run build --force`; `fresh-queries.log` section 4 shows the dist tree hash taken right after the build equals the hash now; section 5 greps the three bundle files for the new code (`decodeDelimiters`, `BARE_ID`) and for ZERO of the old (`findUrlMarker`, `SCHEMELESS_HOST`, `QUERY_LIKE`, `URL-looking token`). |
| P1-d | The rule passes because it erases everything | `keep` checks: the matrix keeps `scheme://` origin + path and file names (`privacy-matrix.spec.ts`, eraser self-test fails every `keep`), the live checks `navigations: about:blank and the http shapes still show their target`; mutant MX17 (OVER-redaction: a URL reduced to its last segment) is CAUGHT, unit and live. |
| P1-e | Real input has rule characters in engine-generated strings, which the synthetic tests do not contain | FOUND by the regression run, not by my tests: FR2-08 L12 pins the wait_for selector `text="Saved successfully"` and failed 476/478 under the rule (`superseded/regression-before-step9/fr2-08.log`). Fixed (`conditionSelector`: the engine's key syntax is exempt, its payload is not) and pinned by `char-rule.spec.ts` "wait_for selector" + mutants MX34 / MX35; FR2-08 is 478/478 again (`final-chain/regression/fr2-08.log`). `upload_file_via_trigger`'s basename had the same gap (MX36). |

## P2. Paths and `cwd`

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P2-a | The canary sits in the file name (stored by design) so "no leak" proves nothing | Canaries are in DIRECTORY segments (`C:\Users\<canary>\docs\f.txt`, UNC, forward slashes, another drive, POSIX) and in the LAST segment of an extension-less path (`C:\Users\<canary>` -> `<dir>`); the file name `f.txt` is a `keep`. Live: MCP / CLI / SDK / bundle `FIX2` (7 path shapes, uploads of missing paths really failed and their live error carried the path: `the missing-path uploads really failed and their live error carried the path`). |
| P2-b | `cwd` passes because the OS temp dir is not under the home directory | The live CLI `FIX2` makes a directory UNDER the real home (`~/fr2-11-cwd-inside-...`) and one outside it, and checks `cwd === "~/<name>"` / `"<dir>"`, with the expectation computed by `path.relative(os.homedir(), ...)` independently of the code; it also searches the raw bytes for the home path (three spellings) and for the home directory's own NAME. Mutant MX9 (cwd stored raw) FAILS that live check. |
| P2-c | The home directory name is absent only because the home is short / generic | The check searches `path.basename(os.homedir())` only when it is at least 4 characters (here `Varad M`, 7), and says so in the check text when it is not searched. |

## P3. Eval preview (decision D-fix2-3)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P3-a | The pinned expectation was computed with the function under test | The expectations are hand-written literals: `2+0 /*t1*/` -> `2+0 <dir>`, `const x = 1; fetch("https://t.test/?k=S")` -> `const x [redacted] 1[redacted]`, `1+1`, `document.title` unchanged, 200-character cap with an ellipsis (`char-rule.spec.ts`, `action-history.spec.ts` H5 / H6, `capability-runtime` eval test). |
| P3-b | The preview still leaks through another field (the eval `error`, the frame selector) | The property test stores the SAME text in `target` (eval), `error`, `selector`, `url`, verification reason and evidence, and in `evalCodePreview(fetch(JSON.stringify(text)))`. |

## P4. Structured `target` (FR2-09 D5) is consistent with the rule

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P4-a | D5 and the rule disagree and each test only exercises one | `char-rule.spec.ts` "the rule and D5 agree": for every generated case `redactHistoryUrl` AND `redactHistoryText` drop the secret; `%3F` in a path (D5 keeps pathnames) is cut because the rule runs on the D5 result (mutant MX19). |

## P5. Docs, `--help`, tool descriptions

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P5-a | The source text was edited but the BUILT help / description / bundle still carry the old claim | `fresh-queries.log` section 6: the BUILT `node packages/cli/dist/cli.js --help` contains the new sentence once; the BUILT `packages/mcp-server/dist/tools.js` contains it; section 5: the bundles contain it and contain `URL-looking token` zero times. Tests pin both texts (`help-text.spec.ts`, `tools.spec.ts` M5) including a negative assertion on the old wording. |
| P5-b | The documented rule is not what the code does | The rule sentence in the CLI README, AGENT_SETUP, the changelog, `--help` and the tool description was written from the code header; every clause has an isolated cell or a property (decode, whitespace, cut, `=` / `&`, userinfo, last segment, `<dir>`, `scheme://`, selector variant, cwd, input cap). The old claims audit-2 disproved ("fragments are cut", "any URL-looking token", "host[:port]/", "a URL typed with literal spaces cannot leak its tail", "UNC -> basename") are gone: `git grep -n "URL-looking token\|host\[:port\]" -- . ':!.ai' ':!packages/*/tests'` returns only the negative assertion in `help-text.spec.ts` that the old wording is gone. |

## P6. Property tests

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P6-a | The generator is written around the redactor and cannot reach what it misses | The generator (`tools/scenario-suite/lib/fr2-11-property.mjs`) never calls the redactor; seeds: browser 20261001 (6,000), CLI 20261012 (4,000 x 28 verbs x 3 positions), live 20261003 / 20261004 / 20261005. A SECOND, independent check: `fix-2/final/fuzz2.mjs`, an ORACLE fuzz over a hostile alphabet that does not use the generator's forms: 400,000 strings, 0 violations (`final/fuzz-oracle-final.txt`), and `fuzz.mjs` over 120 seeds x 6,000 = 720,000 generator strings, 0 leaks (`final/fuzz-generator-final.txt`). The fuzz is not decoration: it FOUND two real bugs after my cells were green (selector `host#` + space + secret; a `#a;b` token that did not drop what follows), fixed and pinned (MX31, MX32). |
| P6-b | A fixed seed hides a leak that other seeds expose | 120 + 10 other seeds above; the unit seed is recorded and deterministic (`generate(seed)` equality test), so a failing string is reproducible by id. |

## P7. Isolated cells (one rule each)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P7-a | A cell is also protected by a second rule, so deleting its own rule does not fail it (the audit-2 B2 / B3 / B4 problem) | Each rule has a mutant and the failing test names are in `fix-2/mutants-unit-final/mutants-fix2.json`: MX1 (`#`), MX2 (`?`), MX3 (`;`), MX4 (`=` / `&`), MX5 (userinfo), MX6 / MX6b (decoding / double-decoding), MX7 (whitespace; failing test: only the whitespace cell), MX8 (path rule), MX9 (cwd; failing tests: only the cwd cells), MX13 (input cap; only the cap cell), MX14 / MX36 (upload targets), MX16 (`<dir>`). |
| P7-b | A mutant is "caught" but only by an unrelated test, or is an equivalent mutant | Found and fixed: the auditor's B1 (userinfo FIRST `@`) SURVIVED my first cells because the strip runs twice; a THREE-`@` cell now kills it (MX5b). MX29 and MX30 survived once (a path before `scheme://`; the bare-`#id` over-redaction bound) and got cells. |

## P8. The auditors' probes and attack generator, unmodified

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P8-a | The rerun used a modified copy | `audit-reruns-fix-2/sha-originals.txt` was produced from `audit-2/` and `sha256sum -c` prints no mismatch (`fresh-queries.log` section 7: 0); the audit-1 files (`lib`, `privacy-*`, `typebylabel`) are byte-equal to `audit-1/` (checked by hand: SAME x6). |
| P8-b | attack-gen ran against a stale or different build | It prints the root it loaded; head: the worktree `packages/*/dist` after the force build; bundle: `mkshim-bundle-attack-gen.cjs` cuts the BUNDLED `action-history` and `history-file` sections out of `packages/sutradhar/dist/cli-bin.js` and `mcp-cli.js` into a shim root, so the unmodified generator loads the shipped code: `cells=375 leaking=0` on all three (`attack-head.log`, `attack-bundle-cli-bin.log`, `attack-bundle-mcp-cli.log`; fix-1 had 104 leaking cells, audit-2). |
| P8-c | The live probes pass because the page values they look for are also stored by design | The probes' own DOCUMENTED residual list (eval code literal, `expect.text`, `wait_for` text, file basenames, a page value quoted in an eval error: `CNRYlsthrown, CNRYevalcode, CNRYexptext, CNRYwaittext, CNRYupname, CNRYdlname`) is the second element of the same output line and is unchanged from audit-2; `unexpectedLeaks` is `[]` on head and bundle for MCP, CLI, SDK, paren and type_by_label. |
| P8-d | Verification deep-equality passes because both sides are the same object | `live-attack-*.json` `verif`: `deepEqualSanitized` is true for 9 of 10 and false only for the typed-value scrub (the documented exception, as in audit-2); `deepEqualRaw` is now false in 4 more places because the rule redacts the stored text (an `about:blank#S` fragment in a reason, a `text="..."` in a wait_for reason, an expected-URL query, the selector `#missing` quoted in an error), besides the typed-value scrub: the expected consequence of the rule, stated here; AC5 as the orchestrator defined it (history == the SANITIZED result) holds 9 of 10 with the one documented exception. |

## P9. Live script

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P9-a | The new cases did not run, or ran against the wrong surface | `final-live-{2,3,4}/<part>/live-summary.json` per surface: mcp 11 cases / 80 checks, cli 16 / 93, sdk 3 / 21, bundle 26 / 170 (56 / 364 per pass); the `FIX2` and `PROP` cases appear in each surface's jsonl; the bundle surface runs `packages/sutradhar/dist/mcp-cli.js`, `cli-bin.js` and `index.js`. |
| P9-b | A one-process timeout hid a failure | The first exploratory pass timed out in the CLI privacy part (exit 124, kept under `superseded/`); the driver now splits each pass into 11 processes, each reports its own exit and its `cli-dirs-new.txt`; every final part exited 0. |
| P9-c | One lucky pass, or a failure explained away | Passes 2, 3 and 4 on the final build: each 11 / 11 parts, 56 / 56 cases, 364 / 364 checks (`final-live-{2,3,4}/totals.json`). Pass 1 was 55 / 56 (`final-live-1-cli-pm-download-hang/`): the CLI privacy part failed 2 of 12 checks because the `download` command hung (exit null after 90 s) while I was running a UC-04 A/B on the same machine; it is kept, not deleted, and pass 4 replaced it. The hang is the known intermittent headed download (UC-08 on master); UC-08 isolated: 3 / 3 on this branch and 3 / 3 on master (`final-chain/ab/`). |
| P9-d | Exactly-once, verification equality, eviction and concurrency are no longer exercised | They are cases of the same script (L1-L8, W1, N-series) and passed in every pass; the audit-1 / audit-2 probes for completeness, eviction and concurrency were also rerun (`rerun-completeness.log`: 39 OK + `seq contiguous true`; `rerun-eviction.log` 11 PASS and 2 FAIL lines that are audit-1's exact-target check of the over-redacted eval preview `2+0 <dir>`, as in audit-2 A2-F4; `rerun-concurrency.log`: 0 skipped, 40 of 40 kills clean). |

## P10. Mutation

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P10-a | A mutant is "caught" because it does not compile | The first live run of MX4 / MX5 / MX8 / MX14 was a `buildFailed` (TS6133 under noUnusedLocals) and was reported NOT CAUGHT, not hidden; the mutants were rewritten to compile and re-run (`mutants-live2-before-step6`: 4 of 4 caught live). All 13 live-capable mutants were caught live before step 6, and the MCP / CLI subset was run live AGAIN on the final build (`final-chain/mutants-live-final/`, result below). The unit driver runs vitest, not tsc, so every unit "caught" lists failing tests (`mutants-fix2.json`). |
| P10-b | A source is left mutated or the dist is stale after a mutant | The driver compares sha256 before / after each mutant (`restored=true`, 38 of 38 in the final unit run), `fresh-queries.log` section 3 compares the four sources to their HEAD blobs, section 4 compares the dist hash to the one taken after the final build. |

## P11. Final verification and regression

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| P11-a | A tolerance absorbs a regression | FR2-07 488 / 488 and the GAP-325 tolerance fired 0 times (`tolerated: []` in `live-mcp.jsonl` and `live-bundle.jsonl` of `final-chain/regression/fr2-07/`). FR2-08: see P1-e (the regression was REAL, was fixed, and is 478 / 478 on the final build: `final-chain/regression/fr2-08.log`). FR2-04: 110 passed / 1 failed / 2 skipped, the failure is `L13.headed.click-exit0`; on master the same suite gives 110 / 1 / 2 with `L13.headed.snap-exit3` (`final-chain/ab/fr2-04-master.log`, `fr2-04-head.log`): the headed L13 case is unstable on both. CLI scenario suite: UC-04, UC-05, UC-08, UC-12 failed in the full run (10 / 14; fix-1 11 / 14; master 12 / 14 at fix-1 time). UC-04 is Google Maps (external): 9 / 9 fail here and 8 / 9 fail on master today (`final-chain/regression/ab-uc04/`); UC-05 / UC-12 fail on master too (fix-1 A/B); UC-08 is the intermittent download hang (isolated 3 / 3 pass on both). None touches history. |
| P11-b | The master I compare against is not master | `E:\AI-Cache\tmp\fr211-master` was verified byte-equal (CRLF-normalised) to commit `fdae749` for 5,094 of 5,098 files in fix-1 (the 4 differences are three test specs and a png); unchanged. |

## Bookkeeping

Highest gap before this cycle GAP-362 -> new rows GAP-363..GAP-371 (max + 1, computed by the script `append-gaps.cjs` that refuses to run unless the maximum is 362); the ledger row reads `**VERIFY (fix-2)**`; changelog-fragment and `docs/22-changelog.md` carry the rule; `decisions.md` has the entry "FR2-11 fix cycle 2 (Executor)". Not self-declared done: audit-3 follows.


---

# FIX-3 (extra, user-authorised cycle after audit-3 BLOCKED): False-pass analysis

Scope: A3-F1 (glued tokens) plus the minors A3-F2 / A3-F3 / A3-F4. Every row names one way the check could pass while the behaviour is broken and the command whose FRESH output rules it out. Evidence root: `.ai/loop/field-report-2/evidence/FR2-11/fix-3/` (`F3` below). The re-queries are in `F3/final/fresh-queries.sh` / `fresh-queries.log` (run after the last source commit `b216146`; sources equal their HEAD blobs, dist hash unchanged).

## Q1. A3-F1 on every surface (MCP, SDK, `history.jsonl`, `history`, `history --json`, dist and bundle)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| Q1-a | The unit property test is vacuous: its generator never produces a glued token, or the secret is not in the text | `glue-rule.spec.ts` asserts every generated case has its secret in its own text; the grid has 4,606 strings (every delimiter x every URL slot x URL / path neighbour x both orders, every path form), the random part 6,000 (seed 20261101); **negative control** `F3/final/fresh-queries.log` section 7: the same independent fuzz against the fix-2 source (`549a099`) reports `"leaks": 6547` of 20,000, so the oracle does see a leak. Before-change run of the spec on the fix-2 code: 37 failed / 7 passed (`F3/before-change/`). |
| Q1-b | The generator and the rule share a blind spot (the audit-1/2/3 failure mode) | A SECOND, independently written fuzz (`tools/scenario-suite/fuzz-fr2-11-fix3.mjs`: different PRNG, a grammar of atoms joined by hostile glue, JSON / array / error wrapping, passwords that hold delimiters): 1,000,000 strings, 0 leaks, 0 idempotency failures on dist (seeds 101-105, 424242), on the MCP bundle code (201, 202) and on the CLI bundle code (301, 302) (`F3/final/fuzz-independent.txt`, the last run in `fresh-queries.log`). It found four real classes the hand-written cells had not (GAP-378) BEFORE the audit. |
| Q1-c | The fix is only in the browser package, the CLI keeps its own copy | The CLI cases call the same function: `packages/cli/tests/unit/glue-rule.spec.ts` (seed 20261103, 1,500 strings x 28 verbs x 3 positions, error, `actionsUnavailable`, serialized line, human output) passes; live: `live-pass-2/cli-glue` and `bundle-cli-glue` read the raw `history.jsonl` bytes, `history` and `history --json` after real CLI processes: 6 / 6 checks each. |
| Q1-d | A mocked or hand-built entry hides a real recording path | The live GLUE case runs real tools: a failing `eval` (the text is a real error message) and the same text as a literal inside the eval code, on MCP (tab and session view), the SDK (`page.evaluate`, `getActionHistoryReport`), CLI processes and the bundle; a PROBE check requires the LIVE result to still show the canary (the redaction is on the stored form, and the search can see a leak). The audit-3 repro scripts `glue-live.mjs` / `glue-sdk.mjs` / `glue-unit.mjs`, byte-identical (sha256 in `audit-reruns-fix-3/sha-check.txt`), now report empty leak lists (`audit-reruns-fix-3/a3-glue-live-head.log`, `-bundle.log`: tab / session / file / human / json all `[]`; audit-3's own run stored 4 canaries). |
| Q1-e | The built dist / bundle is stale and the test ran the old code | `turbo run build --force --concurrency=1` 20 / 20 after the last source commit; bundle markers `SUB_DELIM` / `IPV6_HOST` present and fix-1 `QUERY_LIKE` absent in all three bundles; dist hash `65fa714e...` identical after the build, after tsc and in `fresh-queries.log` section 3; the built CLI `--help` and the built `tools.js` carry the new wording (section 5); the built function on the audit-3 shapes is clean (section 6). |
| Q1-f | Over-redaction: an eraser passes every "no secret" test | The cells also assert the readable part (`https://h.test/a`, `doc.txt`, `db:5432/app`, `http://[::1]:5000/p`); `privacy-matrix.spec.ts` (browser and CLI) and `char-rule.spec.ts` (their `keep` checks fail on an over-redaction) pass in full on the final code: `F3/final/vitest-matrix-charrule-glue.txt` (131 browser tests, 47 CLI tests, 0 failed); the live GLUE case has a `keep` check per shape. |

## Q2. The refinements the orchestrator approved (IPv6 group, `<dir>`, userinfo through delimiters)

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| Q2-a | The IPv6 exemption is too wide (a bracket group that can carry a credential or a path) | Cells (b1)-(b5): `https://[xyz]/home/N/doc.txt` (non-hex), `https://h.test/a[::1]/home/N/doc.txt` (hex but not after `//` or `@`), `https://[::1/home/N/doc.txt` (not closed), `x//[not hex!]/...`, `https://h.test/a[/home/N/f.txt]` all still split and redact; mutants MG14 (group rule dropped), MG15 (charset widened) and MG16 (position requirement dropped) are each caught by exactly these cells. Cell (a): `http://[::1]:5000/p?token=S` -> `http://[::1]:5000/p[redacted]`, also inside ( ) [ ] { } ' " wrappers and with userinfo. |
| Q2-b | `<dir>` idempotency passes only because the second pass happens not to re-split | The cell compares `redact(redact(x))` to `redact(x)` for `file://...<dir>`, `<dir>`, `a <dir> b`; the fix-2 idempotency property test (6,000 strings) and the privacy-matrix idempotency test both pass; mutant MG17 (protection removed) is caught by them. A second, independent idempotency check runs in the fuzz (0 failures in 1,000,000). |
| Q2-c | A password with delimiters leaks only when the delimiter is one the cell did not try | Cells for `( )`, `,`, `'`, `\|`, `"`, `[ ]`, `{ }`, `< >`, backtick, `^`, `p(a)ss`, a JSON-escaped quote (`JSON.stringify` output), U+00AD, U+200B; the generator's `userinfo-weird` slots draw the in-password character from a list of 22 (random scheme, host and path); every `Cf` character of Unicode (the engine's own table, 170 characters) is tried inside a password and between a URL and a path (`EVERY Unicode format character` test). MG12 (strip bounded at the sub-token start, the literal design) and MG13 (backslash stops the strip) are caught by the unit cells AND live (MG12 caught on the CLI surface after the driver was corrected, see Q5-c). |

## Q3. Minors A3-F2, A3-F3, A3-F4

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| Q3-a | A3-F2: the docs were edited but the BUILT help text and tool description still state the rules unconditionally | `help-text.spec.ts` and `tools.spec.ts` assert the new wording (bare `#id` exception, `EVERY @`, the `scheme://` exception, IPv6 host); `fresh-queries.log` section 5 greps the BUILT `packages/cli/dist/cli.js --help` output and the BUILT `packages/mcp-server/dist/tools.js` (not the source). README, AGENT_SETUP, `docs/22-changelog.md` and the changelog fragment carry the same rule and the "Known limits" paragraph. |
| Q3-b | A3-F3: "documented" but the behaviour differs from what is written | The README states `open 'E:/x/Acme Secret Project/s.png'` -> `open '<dir> Secret s.png'`; a unit cell pins that exact string, and section 6 of `fresh-queries.log` prints it from the built dist. It is a documented limit (the rule splits on whitespace first), not fixed: GAP-372/373 and `deviations.md` D8. |
| Q3-c | A3-F4: the new test does not kill audit-3's N13 mutant | N13 ALONE is an EQUIVALENT mutant under the new rule (MG9: the Cf class splits U+202A..U+202E and `\s` still covers U+2028, U+2029, U+202F), reported NOT CAUGHT and explained, not hidden (GAP-377). The compound mutant N13 + Cf-class-removed (MG9b) and the Cf class alone (MG8) ARE caught, by the cells for each of U+202A..U+202E between a URL and a path (both orders) and for the soft hyphen, U+061C, U+2066, a tag character, U+200B and U+FEFF; MG8 is also caught live (soft-hyphen shape). |

## Q4. The auditors' probes, unmodified

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| Q4-a | A probe was edited or the copy differs | `audit-reruns-fix-3/sha-check.txt`: 35 of 35 copies sha256-identical to the originals in `audit-1/`, `audit-2/`, `audit-3/` (the run stops on a mismatch); copies live in sibling folders `audit-reruns-fix-3-a{1,2,3}/` because the probes locate the repo from their own folder. Mutation, kill and overhead scripts were not re-run (they edit sources or kill processes). |
| Q4-b | `attack-gen.mjs` passes because it is blind | 375 cells, 0 leaking on dist, on the code cut out of `cli-bin.js` and of `mcp-cli.js` (shim roots); the IDENTITY negative control reports 375 / 375 leaking (`a2-attack-gen-negative-control.log`). |
| Q4-c | A probe exit 0 hides a leak | The privacy probes print their own verdict: audit-1 / audit-2 MCP, CLI, SDK, paren, type_by_label and live-attack (dist and bundle): `unexpected: []`, `mcpUnexpected: []`, `cliUnexpected: []`, `leaksValue / leaksFieldContent: false`; audit-3 `attack3.mjs` (720 cells): 7 CLAIM leaks, exactly the documented residuals audit-3 itself ruled acceptable (1 bare `#q <secret>`, 6 selector `[k=S]` = GAP-364), 0 new; audit-3 `glue-unit.mjs`: 9 of 9 clean; `a3-live3-head.log` is IDENTICAL to audit-3's own HEAD run of the same script (`diff` empty after dropping ports and timestamps): its only canaries are the documented literal eval CODE `'A3Cres' + 'ult1'` and the LIMIT list, none new; `a3-cli3` / `a3-sdk3` / `a3-func3` ran clean. `a2-completeness.log` ends with the same MCP timeout (39 OK, 4 isError rows) as audit-3 saw on master and HEAD (GAP-369); `a2-concurrency` 300 appends, 0 skipped, 40 of 40 kills clean, 0 torn lines. |

## Q5. Live script, mutation, regression

| # | How it could pass while broken | Ruled out by |
|---|---|---|
| Q5-a | The new live case did not run on a surface | `live-pass-2/*/live-summary.json` (`totals.json`): 61 / 61 cases, 393 / 393 checks (mcp 12 / 86, sdk 4 / 26, cli 17 / 99, bundle 28 / 182); the fix-2 totals were 56 cases / 364 checks, the difference is exactly the five GLUE cases and their 29 checks; the exactly-once, verification-equality, eviction and concurrency cases are the same ones and pass. |
| Q5-b | One lucky pass | Pass 1: 60 / 61 cases, 392 / 393 checks: the CLI `GLUE` part failed 1 check, a BUG IN MY OWN NEW CHECK (it read only the line's `error`, a thrown eval keeps its text in `actions[]`); the 5 privacy checks passed. Kept (`live-pass-1/cli-glue/console.log`), fixed in commit `7398741`, part re-run alone (`live-pass-1b-cli-glue`, 6 / 6), then pass 2 ran the whole script (61 / 61). A third live set on the FINAL build (`final-glue-live`, after the last rebuild) ran the GLUE case on all five surfaces: 2/2, 4/4, 1/1, 2/2, 1/1 cases, 0 failed checks. |
| Q5-c | A mutant is "caught" for the wrong reason, or "not caught" because the live run used a stale build | The first live run of MG1 / MG8 / MG10 / MG12 was NOT CAUGHT, reported as such: MG1 and MG8 needed live shapes only the quote class / the Cf class protects, MG10 needed four `@` (the strip runs three times over a token, so first-@-only is an equivalent mutant up to three), and MG12 on the CLI surface rebuilt `packages/cli` while the mutated source is in `packages/browser`: a driver bug, so the CLI process ran the unmutated dist. All three were fixed (shapes, cell, table) and re-run: MG1, MG8, MG10, MG11, MG12 caught live (`mutants-live2`, `mutants-live3`); a baseline GLUE run before each batch passed (`mutants-live/baseline*`), so a failure is the mutant's. |
| Q5-d | A source is left mutated | The driver compares sha256 before / after each mutant (`restored=true` for 26 / 26 in the unit run and for every live run); `mutants-live*/sha-src-{before,after}.txt` are equal; `fresh-queries.log` section 2 compares the sources to their HEAD blobs; the dist was rebuilt after the live mutants and its hash equals the one verified in the live passes. |
| Q5-e | A tolerance absorbs a regression | FR2-08 478 / 478, FR2-07 488 / 488 (no tolerance in this runner), FR2-04 110 / 1 / 2 with `L13.headed.click-exit0` failing and master giving the identical 110 / 1 / 2 with the same case (`regression/master-fr2-04.log`), CLI suite 11 / 14: UC-05 and UC-12 fail on master too (`regression/master-cli-suite.log`), UC-08 (the headed download hang) failed 3 / 3 on HEAD and 3 / 3 on master in isolation (`regression/uc08-*.json`: 95-96 s each) although it passed once on master in the full run: a flake, no difference between the trees. FR2-08 overlapped for about seven minutes with the last two parts of live pass 2 (my chain's wait cap expired); it passed in full, so no flake needed an A/B. |
| Q5-f | The master I compare against is not master | Unchanged: `E:\AI-Cache\tmp\fr211-master` is the verified `fdae749` tree of the earlier cycles (5,094 of 5,098 files byte-equal, the 4 differences are 3 specs and a png); the CLI scenario suite rewrites `tools/scenario-suite/results/uc06-modal-after-clicktext.png` on every run, I restored it (commit `cdca9c2`). |

## Bookkeeping

Highest gap before this cycle GAP-371 -> new rows GAP-372..GAP-378 (max + 1, computed); the ledger row reads `**VERIFY (fix-3, extra authorised cycle)**`; `decisions.md` has the entries "fix-3: executor stopped on a design conflict" and "FR2-11 fix-3 (Executor)". Not self-declared done: audit-4 follows and is final.
