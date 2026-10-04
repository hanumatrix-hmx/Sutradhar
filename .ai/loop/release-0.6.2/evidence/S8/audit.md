# S8 independent audit - release 0.6.2 (I-048, I-047, I-049, I-051, I-NAV)

Auditor: fresh, read-only for source (built none of S2-S7). Date 2026-10-04. Worktree `$WT`, branch `release/0.6.2`, HEAD
`9edd93b`. Location check printed `$WT` / `release/0.6.2`. No tracked file modified, nothing committed; `git status --porcelain`
at the end = `?? .ai/loop/release-0.6.2/evidence/S8/` only. All scratch under `$R/S8` (+ ISO `$R/S8-tmp`, live ISOs `A8t`/`N8t`).

## 1. Verdict: **ACCEPT** (all five items)

| item | verdict | escalation count | blocking findings |
|---|---|---|---|
| I-048 page text (S2, S3a, S3b, S3c) | ACCEPT | 0 | none (A-1 MINOR test gap, A-6/A-7 INFO) |
| I-047 frame detach (S4) | ACCEPT | 0 | none (A-2, A-3, A-4 INFO) |
| I-049 `#N` ids (S5) | ACCEPT | 0 | none |
| I-051 no-session reads (S6) | ACCEPT | 0 | none |
| I-NAV back/forward/reload (S7) | ACCEPT | 0 | none (A-5 INFO) |

No FAIL on X, T1-T10, F1-F4, N1-N4, S1-S5, H0-H4. No security finding. Findings in section 4; none blocking.

## 2. Commits vs plan steps (one logical step = one commit)

`git log --oneline 3f0ba55..HEAD`: `61e2db6` S1, `e097a17` S2, `8528700` S3a (+Addendum A, PROB-052 mapping, as recorded in
its message), `389c747` S3b, `561ee09` S3c, `4d94646` S4, `ca794a9` S5, `945d209` S6, `6c952b8` fixture change (its own
commit with a reason, as plan 4.S1 step 7 requires), `9edd93b` S7. Source files per commit (`git show --stat`, evidence
excluded) match each step's "Files" list; S4 additionally touches `capability-runtime/src/runtime.ts` (an UNSAFE site found by
the inventory, allowed by 2.2 "any packages/*/src file"). Mode: `git ls-files -s packages/cli/src/cli.ts` = 100644; new
`.sh` evidence scripts 100755.

## 3. Build, matrix, isolation

- Build (plan S8 allows a fresh forced build): `df -h /e` 46G free; `timeout 2400 node_modules/.bin/turbo run build --force
  --concurrency=1 --filter=sutradhar...` 22:15:01-22:15:31 rc=0, `Tasks: 9 successful, 9 total / Cached: 0 cached`
  (`build.log`). dist sha256 before = after = S7 `dist-after.sha256` (`cli-bin f221f536`, `index 7c528f4c`, `mcp-cli
  4184a9a4`), mtimes moved 22:15:31 (`dist-*-mtimes.txt`): an uncached rebuild of HEAD source reproduces the builder's dist
  byte-for-byte, so every builder live run was on HEAD-equivalent bundles. No `*.mutant.js` in dist before or after
  (`ls packages/sutradhar/dist | grep -c mutant` = 0); real dist hashes unchanged after all auditor runs.
- Dist content greps (all three bundles): `readPageText` 0/0/0; `readTextWindow` 3/3/3; `get_page_text` mcp-cli 5;
  `no active browser session` cli-bin 2; `history-edge` 2/1/1; `frameCall` 11/11/11; `mutant|vitest|__test|forTesting` 0.
  Only test seam reachable in dist: `pollTries`/`pollMs` options of `runHistoryCommand` (defaults used by cli.ts; harmless).
- Full matrix (`bash $R/S1/matrix.sh S8`, ISO `$R/S8-tmp` created fail-closed): 20/20 entries exit 0, every log has
  `[iso-guard]` lines (32-54), 0 `ISOLATION GUARD`. Totals S1 -> S8: browser 938->960 (+13 S4, +9 S7), capability-runtime
  505->557 (+48 S2, +1 S3a, +1 S4, +2 S5), cli 360->436 +2 skipped (+35 S3a, +1 S5, +10 S6, +30 S7), mcp-server 156->167
  (+11 S3b), sutradhar 64->70 (+6 S3c); the other 15 packages identical to S1. Every increase attributed; 0 regressions.
- Live runs: every builder harness re-run **unmodified** (sha256 in `harness.sha256`, equal to the files committed by each
  step and to S4/S5/S6/S7 `harness.sha256`), each with its own fail-closed ISO (`scripts/live.sh`: `[ ! -e ]` then `mkdir` +
  `.r062`; guarded delete after; deliberate delete-then-recreate per run, stated here). LOGDIR/OUT redirected to
  `S8/live/` so no builder evidence was overwritten. HEAD = real dist; NEG061 = `$SP/v061/.../dist` (sha256 `9858726a`,
  `ddaaa001`, `55317c66`, unchanged); same-build mutants run from a **copy** of the dist under `$R/S8/dc/dist` (identical
  sha256, `puppeteer-core` 25.5.0 junction), never written into the real dist.

| run | result | run | result |
|---|---|---|---|
| s2-head / s2-neg | 12 PASS / 5 PASS | s3a-head (NO_MUTANTS=1) / s3a-neg | 21 / 11 PASS |
| s3a on dist copy (embeds M-048i) | 23 PASS (M-048i FAILS (i): G1 1791132646134 -> G2 1791132646844) | s3b-head / s3b-neg | 14 / 8 PASS |
| s3c-head / s3c-neg | 8 / 4 PASS | probe74 / probe73 | exit 0 / exit 1 (`toolCount: FAIL`) |
| s4-head RUNS=10 | 12 PASS | s4-mutant (M-047a L1, M-047b L3) | 10/10 detached, 20/20 degraded |
| s4-neg | FATAL at L2 (A-3) | s4-neg LEVELS=L1,L3,L4 | L1 10/10 detached, L3 20/20+10/10 degraded, L4 5/5 |
| s5-head / s5-neg | 30 / 18 PASS | s6-head / s6-neg | 34 / 7 PASS |
| s7-head | 46 PASS | own-probes-head / -neg | 28 PASS / 4 FAIL (validity) |

- Isolation per run (`live/*.meta`): `[iso-guard]` present, 0 `ISOLATION GUARD`, harness path-log checks exit 0 (e.g.
  `cleanup-lines=110 outside-iso=0`), `state.userDataDir` 199 chars with dirname == ISO, leftover query for
  `scratchpad/<ISO>` chrome/node after every run (see A-8 for the one exception). Real TEMP `sutradhar-cli-*`: 5 before, 5
  after, identical names (`realtemp-before.txt`, `realtemp-after.txt`); none vanished.
- Final process query (`scripts/leftover.sh`): positive control (a node process with `positive-control/scratchpad/A8t/final`
  in its command line) found PID 15496; then A8t `[]`, N8t `[]`, chrome/node with `r062/S8` in the command line: 0.
- X item `find "$SP/v061" "$SP/S1" "$SP/S2" "$SP/S4" "$SP/S6" "$SP/S8" "$SP/r5" -newer <stamp 2026-10-04 19:00>`: empty.

## 4. Findings

| id | severity | blocking | item | finding / evidence | required fix |
|---|---|---|---|---|---|
| A-1 | MINOR | no | I-048 T4 | The CLI continue hint for a window at offset > 0 is pinned by no test. Auditor mutant A-048a (`textContinueHint(r.offset + r.returnedChars)` -> `textContinueHint(r.returnedChars)`) **survives** the unit suites (`mutants-own.txt`) and the unmodified S3a live harness (`live/mut-own-048hint-s3a`: 21 PASS, rc 0), because S3a(b) checks only offset 0 and S3a(c) only the final marker B. It is killed by the auditor's live probe P3 (`live/mut-own-048hint`: `"offset":8000,"end":12000,"hint":4000`). HEAD behaviour is correct (P3 on HEAD: every marker A at offsets 0/8000/16000 names `--offset <end>`). | Add one `text-output.spec.ts` row: `textOutput({offset:4000, returnedChars:4000, totalChars:10037, truncated:true}, false)` names `--offset 8000` (S10b or a one-line follow-up; not needed for this verdict). |
| A-2 | INFO | no | I-047 F1 | The committed inventory is keyed at the S4 commit. S7 added 9 lines to `post-conditions.ts` and 22 to `cli.ts`, so `check-inventory` on HEAD reports 16 MISSING/16 EXTRA; all 16 pair up as pure line shifts (same file, same column, constant delta 9/22; `scripts/head-drift.txt`); HEAD site count 210 = S4 count, no new site. | If S11 re-runs the inventory, re-key `sites.txt`/md on the final tree first. |
| A-3 | INFO | no | I-047 harness | `live-detach.mjs` L2 can abort FATAL on the pre-existing goto-after-click 30 s hang (builder note S4 Deviation 6): happened on NEG061 in this audit (`live/s4-neg.stderr.log`, `TimeoutError: Navigation timeout of 30000 ms exceeded` in `runLevels:112`). HEAD L2 was 10/10. S11 8c could flake the same way. | S11: on such a FATAL, re-run with `LEVELS=L1,L3,L4` (as done here) and record it; not a 0.6.2 regression. |
| A-4 | INFO | no | I-047 F5 | Clicking an element inside a child frame that is navigating cross-origin surfaces raw Puppeteer texts (`Execution context was destroyed`, `Argument should belong to the same JavaScript world as target object`) on HEAD **and** NEG061 (pre-existing; never "detached Frame"). | S10b candidate (child-frame navigated-away diagnosis). |
| A-5 | INFO | no | I-NAV H1-SPA | Fixture commit `6c952b8` replaced the load-time `location.hash = 'x'` with `pushState`, so the builder's H1-SPA covers pushState entries only. The changelog's "(pushState, #hash)" claim is covered by auditor probe P4 (post-load `location.hash` entries): back -> `#a`, back -> no hash, forward -> `#a`, all exit 0 with `eval` read-backs; NEG061 has no verbs (validity). | none |
| A-6 | INFO | no | I-048 T10 | Registry/tests/probe agree: tools/list 74 (`probe74` exit 0, `probe73` exit 1), `EXPECTED_BROWSER_TOOLS` 73 + `agent.runGoal`. Docs still say 72 (`README.md:42`, `AGENT_SETUP.md:60` = `packages/sutradhar/AGENT_SETUP.md:60` (`cmp` 0), `packages/mcp-server/README.md:19`) and no doc mentions `get_page_text` - expected, docs are S10. | S10-3 must update all of them (it is already an S10 AC). |
| A-7 | INFO | no | I-048 T7 | Live S3a(j) (alert open, then `text`) exits 3 (dialog guard) on HEAD **and** NEG061, so it does not discriminate; the DOM read-failure path is unit-only (M-048p1/p2/r/s killed). The PDF read failure (A.1) is the live discriminating proof: HEAD exit 1 + PROB-052 line, NEG061 one empty line exit 0. MCP get_page_text while an alert is open returned a real window (P7, 2 ms; no hang, never empty success). | none |
| A-8 | process | no | auditor | (1) The first auditor mutant batch reported a STOP (ISO not deletable: a Windows BITS temp file `chrome_chrome_BITS_*` held briefly inside A8t) as "killed"; caught, the batch was rewritten to require harness rc 1 **and** >= 1 FAIL line, and re-run. (2) `taskkill //PID` under `MSYS_NO_PATHCONV=1` did not kill: the 154 Chrome processes launched by mutant M-051a (expected: that mutant launches browsers) stayed alive ~10 min, then were killed by PID after the ownership query (command line contains `scratchpad/A8t`); final query 0. No foreign process was touched. | none (recorded honestly) |
| A-9 | INFO | no | I-048 2.1 | DOM path makes two in-page evaluates (the pre-existing `contentType` PDF probe, then the window), not "ONE"; only the window crosses CDP, as intended. | none |
| A-10 | INFO | no | I-049 | S5 README attributes the M-049a kill also to `selector-args.spec.ts`; the CLI suite resolves `@sutradhar/capability-runtime` through its built dist, so a source mutant of `types.ts` never reaches it (`6 passed (6)` under every M-049 mutant). The kills are real, by `runtime.spec.ts` alone. | none |

## 5. Checklist (plan section 5), re-derived

**X Isolation - PASS.** Commands and excerpts in section 3 (fail-closed ISO creation in `scripts/live.sh`; guard lines;
path-log checks exit 0 in every CLI harness; real TEMP 5 = 5 same names; final leftover query 0 with positive control; 0.6.1
dirs untouched). Builder steps: S2-S7 READMEs record the same items; spot-checked `S4/live-detach-head.json` (path check
`cleanup-lines=110 outside-iso=0`) and `S6` (fresh `st<k>` dirs asserted absent - re-observed in `live/s6-head`).

**I-048**
| item | verdict | command | excerpt |
|---|---|---|---|
| T1 | PASS | `rg -n "slice\(0, ?(4000\|2000)\)" packages/*/src apps/*/src`; `rg -n readPageText packages/capability-runtime/src` | only `agent-loop.ts:705 raw.slice(0, 2000)` (separate agent.runGoal cap, S10b item 2); readPageText: no hits (rc 1) |
| T2 | PASS | `live.sh A8t s2-head/s3a-head/s3b-head/s3c-head` | runtime: `windows concatenate to FULL exactly {"windows":3,"accLen":10037}`; CLI: same + `last marker is B ... 8000-10037 of 10037 (end)`; MCP: `concatenation == FULL, windows differ {"windows":3,"acc":10037}`; SDK: `paging concatenation == page.evaluate FULL` |
| T3 | PASS | s2/s3a/s3b head vs neg JSON | runtime short sha `0865be5f...` = NEG061, 299 chars; CLI `c5ca6a0c...` = NEG061, 300 chars; MCP `0865be5f...` = NEG061 (SDK uses the same `index.js` runtime as s2) |
| T4 | PASS | s3a-head (b)(c)(d), own P3, WSL logic check | `[page text truncated: showing characters 0-4000 of 10037. Continue with: sutradhar text --offset 4000]` on stdout, `b marker is on stdout, not stderr`; shapes B/C exact; P3 hint == end at offsets 0/8000/16000 (see A-1 for the test gap) |
| T5 | PASS | s3a-head (h); unit M-048c | 6 invalid-flag cases mid-session: exit 1, message, `stateUnchanged:true`, `noNewCliDir:true`; M-048c killed (5 failed) |
| T6 | PASS (A.1 form) | s3a-head/neg (g2) | HEAD `Error: text read failed: the PDF text could not be extracted: PDF text extraction is not available in this build (PROB-052)...`, exit 1, empty stdout; NEG061 `"stdout":"\n"`, exit 0. Unit PDF windowing (g1) M-048d/q/w killed |
| T7 | PASS | unit S2/S3a/S3b/S3c mutant runs | M-048p1/p2/q (S2), r/r2/r3 (S3a), s/s2 (S3b), n3 (S3c) all KILLED; snapshot `pageTextError` covered (M-048v); live see A-7 |
| T8 | PASS | s3a-head (i) + copy run | `G1 == G2 == 1791132644281`, control snap `G3 1791132645654`; M-048i: `G1 1791132646134 -> G2 1791132646844` (fails (i)); NEG061 re-stamps (`G1 ...660861 -> G2 ...661476`) |
| T9 | PASS | `git diff --stat 3f0ba55 HEAD -- execution-verifier.ts extract audit agent/src condition-wait.ts apps` | empty; their packages' test counts unchanged in the matrix (agent 56, apps-server 28) |
| T10 | PASS (docs = S10, A-6) | probe74/probe73; `count-expected-tools.mjs` | `toolCount: 74` PASS / 73 FAIL; EXPECTED_BROWSER_TOOLS 73; schema rejects 40001 (`-32602 ... less than or equal`), 40000 accepted; FR2-10: P7 `sessionId omitted: used "sess_..."` on `get_page_text` |
| T11 | PASS | own P3 (`/grow`, page text grows every 30 ms while paging) | 28 windows, 28 distinct totals; every window `selfConsistent`, `textIsSnapshotWindow`, total on a line boundary; concatenation 38999 == FINAL 38999 |

**I-047**
| item | verdict | command | excerpt |
|---|---|---|---|
| F1 | PASS | own `own-enumerate.mjs` (no ripgrep, own 49-name list from `api/Frame.js:215-234`, `cdp/Frame.js:326`, `ElementHandle.js:228-259`, `JSHandle.js:208`, Page plain delegators `Page.js:1150-1447`) on `git archive 4d94646`; `check-inventory.mjs` + own negative controls | file:line sets equal to `S4/sites.txt` except 7 `frontend/*.tsx` DOM rows the builder scanned additionally; post-fix `CHECK-INVENTORY OK unsafe=0`; own controls: 2 rows removed -> `missing=2 ... FAILED exit=1`; fake row -> `EXTRA ... exit=1`; one row flipped UNSAFE + `--no-unsafe` -> exit 1; blind-spot scan HEAD `hits: 0`; `post-conditions.ts:1197` (S4 key 1205) fixed row present; method list 25.5.0 = 25.12.0 (49) |
| F2 | PASS | `unit-mutants.sh` (S4 runner, WT = scratch tree) | `BASELINE browser 13 passed; runtime 1 passed; SUMMARY mutants=13 killed=13 survivors=0` incl. M-047c; own A-047a (frameCall swallows -> null) KILLED (4 failed) |
| F3 | PASS | s4-head, s4-mutant, s4-neg-L134 | HEAD L1 `detachedRuns=0/10 cleanRuns=10/10`, L2 `success=10/10 ms=2633..3932` (> 1000), L3 `degraded sdk=0/20 cli=0/10`, L4 0/5; NEG061 L1 10/10, L3 20/20 + 10/10, L4 5/5; mutants M-047a 10/10, M-047b 20/20; `__recreated` > 100 every run |
| F4 | PASS | `git diff 3f0ba55 HEAD -- browser-action-engine.ts` | only `x.waitForSelector(...)` -> `frameCall(x, (f) => f.waitForSelector(...))`; timeouts `timeoutMs`/`mainFrameTimeoutMs`/`probeTimeoutMs`, frame order, retry count untouched |
| F5 | PASS | own P1 (4 iframes navigated every 40 ms between `127.0.0.1:B`, `localhost:B`, `127.0.0.1:A`; `__navs` 20236), own P2 (main frame `location.replace` every 250 ms, 3 child iframes) | P1 HEAD 8/8 `No visible element found for selector: #absent`, 0 raw detached (NEG061 also clean: non-discriminating); P2 HEAD 0/10 raw detached, 0 bare context errors; **NEG061 P2: `Click failed: Attempted to use detached Frame 'B3461F8D...'`** (discriminating) |

**I-049**
| item | verdict | command | excerpt |
|---|---|---|---|
| N1 | PASS | WSL/Win logic check `normalizeTarget table`; `git show ca794a9 -- types.ts` | `#5`,`[#5]`,` #5 `,`5` -> `[data-sd-node-id="5"]`; `#05` -> `"05"`; `#a5`,`div#x`,`#5 > span` unchanged; `#5]`,`[#5` -> InvalidSelectorError; regexes `^#(\d+)$` / `^\[#(\d+)\]$` on the trimmed target |
| N2 | PASS | `git diff --stat 3f0ba55 HEAD -- packages/browser/src/actions/selector-dialect.ts` | empty |
| N3 | PASS | s5-head / s5-neg; own P5 | HEAD 30 PASS (CLI/MCP/SDK/`--frame`, counters read by separate `eval`); NEG061 `Error: Invalid selector "#1" — this looks like a snapshot node id`, bare-number control works; P5 `hover "#1"` -> `__hover` 1, `select "[#2]" b` -> value `b`, `type " #3 " zz` -> value `zz` |
| N4 | PASS | S5 mut-spec via `mutrun.mjs` on scratch tree; own A-049a | M-049a/b/b2/c/d KILLED (`1 failed | 161 passed` each, by `runtime.spec.ts`); A-049a (`bracketed[0]`) KILLED. See A-10 for an attribution note |

**I-051**
| item | verdict | command | excerpt |
|---|---|---|---|
| S1 | PASS | logic check `isLaunchCapable table` | true only for `nav http://x`, `newtab u`, `audit u`, `compare a b`; false for `nav`, `newtab`, `newtab ""`, `audit`, `compare a`, `text u`, `back`, `grant o p`, `tabs`, no verb |
| S2 | PASS | s6-head; own P6 | 16 verbs, own fresh state dir each: exit 1, exact line (em dash), no `Fatal:`, stdout empty, no state.json/warden.json, no `sutradhar-cli-*` under ISO, CIM 0; P6 adds `tabs --json`, `back --json`, `reload`, `forward --expect-url-changed`, `eval 1 --json`, `newtab ""`, `audit ""`, `download #x`, `text --offset 10`: all exact line, exit 1, stdout empty |
| S3 | PASS | `git diff 3f0ba55 HEAD -- packages/cli/src/session-flow.ts` (no removed line); S6 mut-spec | additive only; the guard is the first statement inside `if (!state) {`; M-051i (guard with state present) KILLED; s6-head `nav` then `text` exit 0; 0.6.1 W1-W5 tests pass (matrix cli 436) |
| S4 | PASS | plan S6 docs grep (35 lines = builder `dep-grep-docs.txt`); `rg cli-bin .claude/skills` | `.claude/skills`: 0 verb hits; every runnable doc block starts with `nav`; `run-cli.mjs` flows start `closeSession(); nav`; WebBench driver frozen (recorded) |
| S5 | PASS | S6 mut-spec (14) + live | M-051a-unit/b/c/d..d6/f/g/h/i/j KILLED; live M-051a 21 FAIL (browsers launched), M-051e 17 FAIL (`Fatal: no active browser session ...`), own o051 (line on stdout) 17 FAIL; own unit A-051a KILLED |

**I-NAV**
| item | verdict | command | excerpt |
|---|---|---|---|
| H0 | PASS | logic check `probe checks`; S7 mut-spec | back edge `[go_back.document, go_back.history-index, go_back.history-edge]`; forward edge likewise; forward not-moved and moved: no edge check; M-NAVg/g2/g3 KILLED, own A-NAVb (edge check `outcome:'pass'`) KILLED; `capEvidence` row E-tests in the browser suite (960 pass); classifier reads only the check (M-NAVf reason-text, M-NAVf2 `expected === -1` KILLED) |
| H1 | PASS | s7-head; own P4 | `Navigated back to .../hist/a` + `eval location.href` == a; forward -> b; reload hit counter 1 -> 2; H1-SPA back `#2`, back no hash, forward `#2` (`historyLength 7`); P4 post-load `#hash` entries pass |
| H2 | PASS | s7-head | `forward` at newest: exit 1 `Forward: no forward history entry (still on ...)`; `forward --expect-url-changed` exit 1 (not 4); `back` edge exit 1; `back --expect-url-changed` exit 1; `back --json` at edge: JSON with `go_back.history-edge` on stdout, edge line on stderr, exit 1 |
| H3 | PASS | s7-head | validity `reload --dialog accept` handled a beforeunload; `reload --dialog dismiss` exit 1, cancel message, hit counter unchanged (30286 ms); `back --dialog dismiss` exit 1, URL unchanged (30256 ms) |
| H4 | PASS | s7-head | no-session back/forward/reload: exit 1, exact S6 line |
| mutants | PASS | live batch `scripts/live-mutants2.out` | M-NAVa 10 FAIL, M-NAVb 10, M-NAVc 2 (`Fatal: net::ERR_ABORTED`), M-NAVd 3 (H1-SPA `Back: no history entry` on a same-document move), M-NAVe 3 (exit 4), M-NAVf 3 (exit 4), own onav 1 (`hasDoc:false`); unit M-NAV* 16/16 KILLED, own A-NAVa KILLED |

**D Docs/evidence integrity**
| item | verdict | evidence |
|---|---|---|
| D1 | PASS | totals re-derived from `test-*.log` (section 3) |
| D2 | PASS | `harness.sha256` here = each step's committed harness (S4/S5/S6/S7 `harness.sha256` agree; S2/S3a/S3b/S3c unchanged since their commits per `git log`). S11 must reuse these hashes |
| D3 | N/A at S8 | changelog is S10; behaviour it must state is verified here (incl. A-5 for `#hash` and the PROB-052 exit 1) |
| D4 | PASS | S2, S3a, S3b, S3c, S4, S5, S6, S7 READMEs each have a "False-pass analysis" section |
| D5 | PASS | `cmp AGENT_SETUP.md packages/sutradhar/AGENT_SETUP.md` exit 0 (both still 72: A-6) |

**Other checks requested by the brief**
- Page-text consumers: `rg pageText|readTextWindow|get_page_text packages/*/src apps/*/src`: only MCP snapshot/get_page_text,
  SDK `page.text`, CLI `text-output.ts`, runtime. `expect.text`/`wait_for` (`probeVisibleText`), `extract_data`, `audit`,
  block detector, agent loop (`extractVisibleText`, own 2000 cap) and `apps/server` (own 1500 cap) are independent and
  untouched (T9). MCP renders old mocks without the new fields (tools.spec, 167 pass).
- Exit codes vs 0.6.1 (all intended and in the plan): `text` failed read 0 -> 1 (2.1); `text` on a PDF in the bundled
  build 0 (empty line) -> 1 with the PROB-052 message (Addendum A.1); any non-launch verb with no session 0 (blank browser)
  -> 1 (2.4, incl. `grant`, `tabs`, `getclipboard`, `newtab`/`audit` without url); new `back`/`forward` edge -> 1 even with
  `--expect-*` (2.5, documented exception to README :131); `click "#5"`/`"[#5]"` 1 -> 0 (2.3); `--offset`/`--max-chars`
  misuse stays exit 1 (message changes from "Unrecognized flag"). No other exit code moved (matrix unchanged elsewhere).
- Linux determinism: the new pure logic (page-text windowing twins exhaustive over 63 x 12 (offset, maxChars) on a
  surrogate-rich text, marker shapes, validation, CLI text output, parse-args table, isLaunchCapable/withSessionFlow,
  NoSessionError text, decideNavigationVerdict edge, classifier/exit/--json, frameCall, normalizeTarget) bundled from HEAD
  sources with esbuild (`wsl-logic-bundle.sha256` `65b01a35...`) and run on Windows Node v25.0.0 under the guard and on WSL
  Ubuntu Node v20.20.2 in a `mktemp -d` dir: both `checks=39 fails=0 sha256=bee7f26a...` (identical result line).
  Negative control: the same bundle with `end += 1` -> `end -= 1` gives `fails=2`. Vitest itself was not run under WSL:
  the Windows `node_modules` carry only win32 esbuild/rollup binaries (same caveat the 0.6.1 auditors handled the same way).

## 6. Mutants

- Builder unit mutants, re-run unchanged with `WT` pointing at a scratch copy of HEAD (`$R/S8/tree`, `git archive` + exact
  source copies, node_modules junctions since removed): S2 14/14, S3a 15/15, S3b 12/12, S3c 6/6, S4 13/13, S5 5/5, S6 14/14,
  S7 16/16 KILLED, every restore sha256 equal (`mutants-S*.txt`). First S2 pass stopped `BAD-APPLY` on M-048c because
  `git archive` wrote CRLF; after copying the worktree's LF sources it ran clean (recorded, not a product issue).
- Builder live mutants re-run on the dist copy: M-048i, M-047a, M-047b, M-051a, M-051e, M-NAVa/b/c/d/e/f all KILLED.
  M-048h (Addendum A.2: source edit + rebuild) was **not** re-run (would need a full rebuild from mutated source);
  its target behaviour (validation before `withSession`) was re-observed live (s3a (h): state.json sha unchanged, no new
  profile dir) and read in `cli.ts` `main()` (`if (textPagingFlagError) printErrorAndExit(...)` before dispatch).
- Auditor's own (>= 1 per item): unit A-048b, A-047a, A-049a, A-051a, A-NAVa, A-NAVb KILLED; **A-048a SURVIVED** (A-1);
  live o048 (marker B -> A at the end) KILLED by S3a(c), o051 KILLED by S6, onav KILLED by S7 H2, o048hint KILLED by own P3
  and NOT killed by S3a (A-1).
- Plausible mutant the suites catch (global rule): moving `if (!deps.mayLaunch) throw` after `spawnFresh` (M-051b) - KILLED
  by N1 call counts.

## 7. False-pass analysis of the auditor's own checks

| check | how it could pass while broken | what rules it out |
|---|---|---|
| live harness re-runs | stale or foreign bundle | forced uncached build (0 cached) reproduced dist sha256; each harness prints the sha256 it loaded (`f221f536`/`7c528f4c`/`4184a9a4`), NEG061 prints `9858726a`/`ddaaa001`, and the same harnesses FAIL or report the old behaviour on NEG061 |
| harness unmodified | edited harness | `harness.sha256` equals the committed files and the S4-S7 records; my runner only sets env (`LOGDIR`, `OUT`, `CLI`, `MODE`, `LEVELS`) that each harness declares |
| mutant batch | a run that never happened counted as "killed" | happened once (A-8); the verdict now needs harness rc 1 AND >= 1 `FAIL` line AND a `rc=` line in the run's meta; every kill above was re-read for the expected failure text (section 5) |
| same-build mutants | mutant never applied / applied twice | `mkmut.mjs` asserts exactly 1 replacement on the copy; the copy's `cli-bin.js` sha256 still `f221f536...` at the end; the harness logs the mutant sha (`c626601c...` for M-NAVd) |
| unit mutants on a scratch tree | tests resolving the worktree source instead of the mutated copy (mutants would survive) or vice versa | baselines pass on the tree; 95/95 builder mutants and 6/7 own mutants are killed there, i.e. the mutated tree file is what the tests load; A-048a's survival is reproduced live (S3a harness 21 PASS) so it is not a tree artifact |
| I-047 F5 probes | churn not happening; probe blind to raw text | `__navs` 20236 (P1); P2 is discriminating: NEG061 shows `Attempted to use detached Frame` on the same probe, HEAD 0/10 |
| T11 | text never actually changed, or windows checked against themselves | 28 distinct totals; windows compared with an independent raw `eval document.body.innerText` taken after growth stopped (prefix-growing page, so every snapshot is a prefix of FINAL) |
| I-051 probes | Chrome started elsewhere / a stale state dir | each sub-case uses a new state dir asserted absent; ISO `sutradhar-cli-*` count 0; leftover query by ISO path, with a positive control |
| leftover-process query | query that can never match | positive control process found (PID 15496) by the same script, then 0 for A8t/N8t |
| WSL determinism | the check cannot fail, or WSL ran a different file | negative-control bundle gives `fails=2`; bundle sha256 printed inside WSL (`65b01a35...`) equals the Windows file |
| inventory equality | my enumerator shares the builder's blind spots | different implementation (char scan over `git ls-files`, no ripgrep) and an independently derived method list; the `.call/.apply/.bind` blind spot is covered by the builder's separate scan (0 hits on HEAD) |
| real-TEMP | a vanished foreign dir missed | sorted name lists before/after compared with `comm` (5 = 5, same names) |

## 8. Reproduction

Scripts: `scripts/live.sh` (ISO create/run/leftover/guarded delete), `scripts/leftover.sh`, `scripts/live-mutants.sh`,
`scripts/unit-mutants.sh`, `mkmut.mjs`, `own-probes.mjs` + `probe-server.mjs`, `own-enumerate.mjs`, `wsl-logic-check.mjs`,
`own-mut-spec.json`. Outputs: `live/*.{meta,stderr.log,json}`, `mutants-*.txt`, `inventory-audit.txt`, `test-*.log`,
`wsl-logic-*.out`. Background processes started by the auditor: none still running (final query 0).
