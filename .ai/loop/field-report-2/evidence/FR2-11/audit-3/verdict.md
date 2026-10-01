# FR2-11 AUDIT-3 verdict: BLOCKED (third failed audit; the LAST standard-cycle audit)

Branch claude/fr2-11-action-history at 78087d7 (fix-2 = 719b4fe..78087d7). Independent auditor. No source edited
(16 mutants applied and restored byte-identically, sha256 checked, dist rebuilt), nothing committed. Machine-readable:
`audit-findings.json`. Probes, logs and outputs are in this directory.

## Why BLOCKED
All six functional Done-when items pass again with fresh live evidence, and the character rule cut rules (a) and (b)
(`? # ;` and `= &`, encoded forms included) held against every shape I generated. But two of the rule claims are still
decided by recognising a URL shape, and both fail open:

- **A3-F1 (major, privacy, undocumented).** A whitespace-free token that contains a `scheme://` URL with no path separator
  before it is exempt from the path rule AS A WHOLE (`reducePathToken` returns the token unchanged when `schemeEnd(t) >= 0`),
  and `stripUserinfo` only strips the authority of the FIRST URL in the token. Anything glued after the first URL (JSON,
  fetch arguments, a comma-separated list, `JSON.stringify` output in an error) keeps a second URL `user:password@` and
  full local paths. Live on every surface (MCP tab + session, SDK, CLI `history.jsonl`, `history`, `history --json`,
  dist and bundle; `glue-live-head.json`, `glue-live-bundle.json`, `glue-sdk.json`):
  - `eval ['https://h.test/a','https://u:PASS@h2.test/p'].length` -> the preview is stored with `u:PASS@`;
  - `eval throw new Error(JSON.stringify({api:'https://h.test/x',db:'postgres://admin:PASS@db:5432/app'}))` -> the
    `error` field stores the database password (SDK, `glue-sdk.json`);
  - `['https://h.test/a','C:/Users/NAME/doc.txt']` (and a `/home/NAME/` path) -> the full local path is stored.
  The tool description and `--help` state "userinfo@ is stripped" and that a token with a slash or backslash followed by more
  text is reduced to its last segment, without condition; spec 0.7 / R1 requires FR2-09 D5 on EVERY URL-bearing string.
  Not covered by GAP-363..371.
- **A3-F2 (minor, docs).** `--help` and the `get_action_history` description state the userinfo and path rules without the
  `scheme://` exception and omit the bare-`#id` exception (the CLI README has both); A3-F1 contradicts them.
- **A3-F3 (minor, privacy, rule-consistent).** A local path with spaces keeps the words between the spaces:
  `open 'E:/x/Acme Secret Project/s.png'` -> `open <dir> Secret s.png'`. The stated rule (split first) predicts it,
  but no document says so.
- **A3-F4 (minor, tests).** My mutant N13 (U+2028..U+202F removed from the split set) survives all unit suites and every
  generator. For the bidi controls U+202A..U+202E (not in JS whitespace) it re-joins a URL and a path into one token and,
  through A3-F1, leaks the path (shown: `glueLeaks` 6 -> 7 in `mutants3-N13.json`). No test has a cell for those characters.
- **A3-F5 (info).** audit-2 `completeness.mjs` hits MCP call timeouts after `new_tab` on BOTH builds (HEAD 3 of 4 runs,
  master 2 of 3 runs; GAP-369). Not an FR2-11 regression.

Root-cause hypothesis (BLOCKED): fix-2 made rules (a) and (b) shape-independent, but the userinfo strip and the path rule
still ask "where is THE URL in this token?" (the first `scheme://`, its authority, a whole-token exemption). That is the same
fail-open class as fix-0 and fix-1, now confined to `@` and to slashes. **The implementation is wrong; the spec (R1: D5 on
every URL-bearing string) and the rule as documented are right.** The tests share the blind spot: every property cell,
isolated cell, fuzz string and auditor generator (mine too, until I read the exemption code) puts at most one URL in a
whitespace-free token. Fix direction: apply (c) to EVERY authority in a token (after every `//`, up to the last `@` before
the next separator), limit the `scheme://` exemption to the URL itself (end it at the first character that cannot belong to
the URL: a quote, comma, bracket, pipe, parenthesis or a second scheme) and reduce the rest by the path rule; add generated
cells with two or more URLs, or a URL plus a path, in one token, and cells for U+202A..U+202E.

## Privacy attack matrix (my generator `attack3.mjs`, seed 0xA3A3F11; not the builder or audit-2 generators)
720 cells (642 CLAIM: the rule says the secret is removed; 78 LIMIT: no rule character guards it) through 44 stored-string
paths of the built dist (text, selector variant, every entry field, navigate / eval / upload / wait_for targets, 26 CLI
verb positions, buildHistoryLine error / actionsUnavailable / actions, formatHistoryHuman of a raw line).
- CLAIM: 7 of 642 leak, all documented residuals: 1 bare `#id` token followed by the secret (README rule 3) and 6
  selector-variant `[k=S]` cells (GAP-364). Every encoding (`%3F %3f %253F %25253f`, JSON unicode and hex escapes,
  fullwidth and small forms, the Greek question mark), 14 whitespace characters, userinfo variants, cookie text, form bodies,
  matrix params and paths: 0 leaks. (A3-F1 shapes were not in this generator; see `glue-unit.mjs`.)
- LIMIT rulings (no rule character; documented as stored in the README "What IS stored", GAP-366 and spec R1):
  - bare token in prose, `Authorization: Bearer S`, `Basic S`, a JWT without `=` padding, `{"password":"S"}`, `token:S`:
    ACCEPTABLE documented limit (page text, eval literal). A padded JWT and `k=S` cookie text ARE cut.
  - a secret in a URL path (`/reset/S/confirm`, `/resetS`): ACCEPTABLE. It is the FR2-09 D5 display rule (origin + pathname)
    that spec R1 explicitly accepts, not a leak against a Done-when item.
  - a secret hostname (`https://S.h.test/p`; live with `S.localhost`): ACCEPTABLE, part of the D5 origin.
  - a path last segment with an extension (`/tmp/x/S.txt`): ACCEPTABLE, the documented basename rule.
  - selector `[data-k=S]`: ACCEPTABLE, GAP-364.
- Live (`live3-head.json`, `live3-bundle.json`, `sdk3.json`), shapes with one URL per token: 0 CLAIM leaks on MCP tab, MCP
  session, SDK, CLI file, `history` and `history --json` (the only `a3c` hit is the literal eval CODE `'A3Cres' + 'ult1'`,
  documented; the eval RESULT is absent). Entry keys are exactly actionType, success, executionTimeMs, timestamp, target,
  url, verification, tabId, seq, error, selector; page title, frame name and text, dialog message and console text never
  reach history.
- Caller results are NOT redacted: the navigate result keeps `?token=` and the fragment, the eval result is returned, SDK errors
  are raw. Only stored history is redacted.
- audit-1 and audit-2 probes re-run UNMODIFIED (byte-identical copies, sha256 in `sha-rerun-originals.txt`, run from a junction
  tree whose packages/ and node_modules/ point at this build): attack-gen 375 cells, 0 leaking; MCP and CLI (dist and bundle),
  SDK, paren, type_by_label, live-attack (dist and bundle), live-sdk: 0 unexpected canaries (`rerun/`).
- Over-redaction: history stays a usable timeline (action, ok / FAILED, tier, selector, origin + path URL), but free text
  degrades (an eval preview `String('/x?t=..')` becomes `<dir>`, `No visible element found for selector: [redacted]`, a
  custom-scheme navigate target becomes `<dir>`). Documented (GAP-363); acceptable.
- cwd: `~/AppData/Local/Temp/fr211a3-.../sub` under home, `<dir>` outside it; the home directory name never appears. Acceptable
  as documented (every segment under home is kept).
- CLI command line: verb from a fixed vocabulary, args through the per-verb rules, flags not recorded. Acceptable.

## Functional re-check (fresh, live)
- navigate and eval are recorded on MCP, SDK and CLI. The tab view is the default (`scope:"tab"`, the active tab id); the session
  view merges tabs by seq (contiguous) and keeps a closed tab entries; scope + tabId and an unknown session are errors.
- Eviction is exact on both scopes: 199 -> 199/0, 200 -> 200/0, 201 -> 200/1 (note "1 older entry was evicted"), 202 -> 2,
  205 -> 5 (tab view counts only its own tab: 197/198/199/200/200 with 0/0/0/0/3).
- Verification deep-equals `sanitizeHistoryEntry(result).verification` for 25 of 26 actions; select_option differs only by the
  documented `<value>` scrub of the typed value.
- CLI: `history.jsonl` sits beside `state.json`; `history --json` is byte-identical to the file; `history` with no file prints
  "No CLI history yet", exit 0, no state.json created; `--bogus` exits 1; a torn line is skipped with a Note and the next append
  starts on a new line; after `close` a command self-heals into a new session id.
- Real parallel CLI appenders: 10 `eval` + 6 `text` with 160 x 200 CJK args (about 96 KB before the guard): 16 of 16 lines valid,
  the 6 big ones truncated to 20 args (12 KB). 80 real `taskkill /F /PID` on CLI processes I started, swept across their life
  and completion window: 53 killed, 27 finished first; 0 torn or unreadable lines, the file ends with a newline, the next
  append is clean. audit-2 `concurrency.mjs` unmodified: 300 appends with 63-70 KB lines, 0 skipped, 40 of 40 kills, 0 torn.

## Build and tests
Forced rebuild (dist deleted, turbo --force both stages, 0 cached, bundle rebuilt). The rule is in index.js, cli-bin.js and
mcp-cli.js; the fix-1 identifiers (QUERY_LIKE, SCHEMELESS_HOST, FORM_PAIRS, findUrlMarker, WIN_DRIVE_PATH, ...) are absent.
typecheck 34/34. vitest: browser 1026, capability-runtime 272, mcp-server 124, cli 273, sutradhar 43, agent 56, server 28, all
pass. Spec files: against fdae749 the 3 pre-existing spec files are append-only (0 deleted lines). Against 785dc53 the changed
lines are placeholder expectations ([redacted], <dir>, file://.../f.html), one exact match that replaces a toContain (stronger),
the N12 input changed from one 10,000-character token to `'x '.repeat(5000)` (a single huge token is now wholly [redacted];
the length and ellipsis asserts stay), and the 64 KiB action count 50 -> 600 (targets are capped at 200 now). No canary
assertion was removed or weakened.

## Mutants (mine, `mut3.mjs`: 16; results in `mutants3.json`, `mutants3-N12_N13.json`, `mutants3-N13.json`)
Caught by the unit suites and my generator: N1 evidence.observed unredacted, N2 entry.url unredacted, N3 CLI line error skips
the rule (one surface), N4 human output prints the error raw (one surface), N5 decode AFTER the rule (reordered decode and
split), N6 last segment kept without a dot (weaker path rule), N7 only / is a separator (weaker path rule), N8 no
double-decode, N9 a cut keeps the rest of the text, N10 CLI args skip the rule (one surface), N11 tab view stores the raw
entry while the session ring is sanitized (one surface), N12 cwd outside home stored verbatim, N14 selector variant allows =
anywhere, N15 eval preview unredacted. N16 (the first userinfo strip removed) is equivalent: the strip runs again after the
path step. N13 (U+2028..U+202F not split) SURVIVES (A3-F4). Every source restored, sha256 identical
(`sha-src-before.txt` = `sha-src-after.txt`), then a forced full rebuild.

## Master comparison (concurrent A/B under the same load; master = the fdae749 tree at E:/AI-Cache/tmp/fr211-master, verified
blob by blob: only the 3 overlaid specs and 1 png differ; its dist was rebuilt by me with turbo --force)
- FR2-08: 478/478 vs 478/478 (L12 passes on mcp and bundle).
- FR2-07: run 1 487/488 (bundle:H2, the GAP-330 flake) vs 488/488; run 2 488/488 vs 487/488 (bundle:X12). GAP-325 tolerance
  fired 0 / 0 in run 1 and 1 (mcp:X11, cap 3) / 0 in run 2. No regression.
- FR2-04: 110 pass / 1 fail / 2 skip on both (L13 headed click fails on both).
- CLI scenario suite: 9/14 vs 10/14 concurrently. The extra HEAD failure is UC-03 (initial nav under contention); sequential
  A/B: UC-03 passes 2/2 on both. UC-04, UC-05 and UC-12 fail on both; UC-08 failed on both this time.
- Recording overhead (audit-1 probes, unmodified, interleaved blocks, monotonic clock): MCP eval +0.02 ms mean (+0.03 median),
  click +0.36 ms, get_action_history +0.83 ms; CLI +5 ms median per command (281 vs 276 ms).

## Not verified
Headed mode, non-Chrome browsers, POSIX 0600 outside WSL, a real OAuth custom-scheme redirect (simulated), the builder
`run-fr2-11-live.sh` (not re-run; my own live probes cover the same surfaces). No download/lock containment harness was run
(the unmodified audit-1 CLI probe performs one ordinary `download`).

## Side effects, all undone
The CLI suite rewrote `tools/scenario-suite/results/uc06-modal-after-clicktext.png`; restored from the HEAD blob (hash equal).
git status shows only this directory. PIDs I started are in `pids.log` and `regress/pids.log`; none is alive (checked with a CIM
query against every logged PID and its children; one match was PID reuse by another tenant). Disk before 22 GB free, after in
`audit-findings.json`.
