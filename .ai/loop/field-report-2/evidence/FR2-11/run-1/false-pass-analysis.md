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
