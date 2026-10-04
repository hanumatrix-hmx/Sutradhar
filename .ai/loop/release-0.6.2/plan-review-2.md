# Release 0.6.2 plan, review 2 (independent, adversarial)

Reviewer: Claude Opus 5.5, 2026-10-04. Plan reviewed: `.ai/loop/release-0.6.2/plan.md` **Revision 2** (with its
section 7 mapping of `plan-review-1.md`). I did not write the plan or review 1. I used only read-only commands and
one no-browser Node proof, `$SP/review062r2/edge-proof.mjs`, which imports the built
`packages/browser/dist/verifier/post-conditions.js`. I touched no real-TEMP dirs and killed no processes.

## Verdict: **REVISE** (1 MAJOR, 0 BLOCKER, 10 MINOR)

One MAJOR stops approval. The fix is small: one field in `post-conditions.ts`, one added file in S7's scope, and one
live case.

---

## 1. Review-1 findings: resolved in the text?

| # | resolved? | check |
|---|---|---|
| M1 | yes | `readTextWindow` and `pageTextWindow` are new names. S1-3 greps NEG061 for count 0 and also counts `async readPageText(tab)` >= 1, which proves the right files were read. The S2 negative control is behavioural. |
| M2 | yes | Uses `data-sd-current-gen` and `data-sd-gen`, with a non-null assert. The control `snap` is a real discriminator: generation is `String(Date.now())` (`dom-semantic-engine.ts:338`), so two CLI processes stamp different values. M-048i runs live. |
| M3 | **partly**, see MAJOR-1 | History-index binding, the `/hist/spa` fixture and M-NAVd are all good. But the classifier cannot tell a *forward* edge from "not moved" using the fields 2.5 allows it to read. |
| M4 | yes | Rejects with `PageTextReadError` on DOM and PDF failures, CLI exits 1, MCP `isError`, SDK rejects. `snapshot()` stays tolerant with `pageTextError`. Unit S2-4, live S3a(j), mutants p/q/r/s. |
| MINOR 1-17 | yes | All mapped in section 7. I checked these in the text: S1-1 exact untracked line; `cli.ts` 100644; the 1.3 reclassification including `:1197`; `packages/*/src` scope; same-build mutants; L2 at 2500 ms with `t1-t0 > 1000`; SP-1/SP-2 spikes; precedence; surrogate extend; MCP 40000; `$R`; `tools/` consumers; both AGENT_SETUP copies with `cmp`; S10b 7/8; S11 consumer `tsc` probe; S11/S11b split; HANDOFF/STATE. |

## 2. New-gap checks requested

### PageTextReadError across consumers: OK
- The private `readPageText` has exactly one caller, `snapshot()` (`runtime.ts:716`). `snapshot()` keeps catching and
  adds `pageTextError`, so these callers keep the 0.6.1 degrade-to-`''` behaviour:
  - MCP `browser.snapshot` (`tools.ts:503`);
  - SDK `page.snapshot()` (`page.ts:252`);
  - CLI `snap` (`cli.ts:796,815`, which never prints page text);
  - agent `agent-loop.ts:705`;
  - `apps/server`.
- No caller other than CLI `text` changes from degrading to throwing, and that change is intended and listed in Changed.
- `requirePage` was already outside the old `try` (`runtime.ts:2945`), so "no page" already threw before 0.6.2.
- `wait_for`, `expect.text`, `extract` and `audit` read text independently, as review 1 said.
- One unspecified case, MINOR 7: a PDF that parses to empty text. In 0.6.1 it fell back to DOM text.

### History-index success rule
- The probe reads `Page.getNavigationHistory` through a fresh CDP session (`post-conditions.ts:1143-1149`). It does not
  depend on loaderId or on in-page state, so it is:
  - agnostic to bfcache (a restore moves `currentIndex` like any other history step);
  - safe across cross-origin process swaps (the top-level target is kept);
  - indifferent to redirects (the index moves and the URL is reported as committed).
- **about:blank:** H2 correctly assumes nothing about entry 0. A `back` onto an initial about:blank entry prints
  "Navigated back to about:blank" with exit 0, which is truthful.
- **Reload:** judged by `newDoc` (the loaderId changed), which is correct for a reload.
- **Probe unavailable:** the dialog case and the not-run case produce `not-run` or no history-index check. 2.5 maps both
  to `unconfirmed`, which is correct.
- **The defect is MAJOR-1:** the classifier is told to decide edge versus not-moved "from the history-index check
  only". That check carries no detail and no `count`, and `verifyAction` replaces the edge reason whenever an
  `--expect-*` fails.

### Sync-throw inventory completeness: adequate for today's tree
I grepped `packages/*/src` and `apps/*/src` for the shapes the `\.\s*(m)\s*\(` regex cannot see:
- `.call/.apply/.bind` on a listed method: 0 hits;
- optional call `m?.(`: 0 hits;
- bracket call `x['evaluate'](`: 0 hits (the only bracket hits are type positions, `Frame['frameElement']` and
  `Hoppable['$']`);
- destructured methods: 0 hits;
- bare method references: only `typeof frame.evaluate === 'function'` guards and comments;
- `apps/*/src`: no `frames()` or `mainFrame()` calls, so the `packages/*/src` scope loses nothing.

Optional chaining `x?.evaluate(` still matches, because the regex starts at the `.`. Remaining executability issues are
MINOR 3: `$` escaping, Windows `\` separators in `rg` output, and two calls on one line collapsing into one key.
`check-inventory` proves set equality, not that the classification is correct. The auditor's re-derivation (F1)
carries that, which is acceptable.

### PROB-051 exit codes and dependents: OK, with one gap (MINOR 1)
- `withSessionFlow` (`session-flow.ts:48-54`) has exactly the `if (!state)` branch 2.4 targets. The mutant placements
  M-051b and M-051c are real and distinct.
- **The gap.** A plain `Error` thrown from `noSession()` reaches `main().catch`, which prints `Fatal: <msg>`, not
  `Error: <msg>` (`cli.ts`, tail of `main()`). The S6 live AC checks substrings, so it passes either way, but the
  2.4/S10 text promises `Error:`.
- **Dependents.** `run-cli.mjs` flows start with `nav`, including UC-03's relaunch (`nav ... --profile` then `text`)
  and the popup flow (`tabs`/`focustab` after a `nav`). PR CI (`ci.yml`) runs only typecheck/build/test. The scenario
  suite runs only on dispatch or nightly (MINOR 6).
- `audit` without a url creates its out dir before `withSession` (`cli.ts:949-955`). That is harmless under cwd=ISO,
  and it is still exit 1 with an empty stdout.

### 3-character ISO dirs outside `$SP/r062`: isolation intact
- `ls -d "$SP"/[ANSW][0-9a-z]t` currently matches nothing. The existing `B1t..B6t`, `Kt`, `Mt` and `V1t` dirs fall
  outside the delete pattern.
- The guarded delete requires both the `case` pattern and the `.r062` marker, and `v061`, `r5` and the 0.6.1 dirs never
  match.
- The path-length arithmetic holds: 160 + 1 + 3 + 1 + 35 = 200.
- One weakness (MINOR 2): `mkdir -p "$ISO" && : > "$ISO/.r062"` adopts an existing dir. A leftover from an aborted
  attempt would be reused with stale `state/state.json`, and a foreign dir that happens to match would get marked and
  later deleted.

---

## MAJOR

### MAJOR-1. A forward-history edge cannot be classified as specified, so "edge -> exit 1 regardless of `--expect-*`" can ship broken for `forward`

**Evidence.** Proof `$SP/review062r2/edge-proof.mjs` against the built `decideNavigationVerdict`:
```
forward EDGE (index 1 of 2)      {"outcome":"fail","expected":2,"observed":1,"detail":null} | reason: there was no forward history entry
forward NOT-MOVED (index 0 of 2) {"outcome":"fail","expected":1,"observed":0,"detail":null} | reason: the history index did not move (still 0)
back EDGE (index 0 of 2)         {"outcome":"fail","expected":-1,"observed":0,"detail":null} | reason: there was no history entry to go back to ...
```
- **The fields cannot separate the two forward cases.** The `go_forward.history-index` check is identical in shape for
  "edge" and "not moved": `fail`, `expected = observed + 1`, no `detail`, no `count`. Only the verdict *reason* string
  tells them apart.
- **The reason disappears exactly in the precedence case.** `ExecutionVerifier.verifyAction` Rule 5
  (`execution-verifier.ts`, "any failed expectation") sets `verification.reason = failReasons[0]`. With
  `--expect-url-changed` at an edge, the CLI receives "Expected URL change from ...", and the edge text is gone.
- **2.5 forbids the only other source.** It says the classifier works "from the `<verb>.history-index` / reload checks
  only". S7's file list leaves out `packages/browser/src/verifier/post-conditions.ts`, so the builder cannot add the
  missing signal.
- **What the builder is left with:**
  - Matching the reason text works only without `--expect-*`.
  - The heuristic `expected === -1` works only for `back`.
- **Why this ships.** H2 tests precedence only with `back --expect-url-changed`. A build that passes every S7 AC can
  still exit **4** on `forward --expect-*` at the newest entry, where the CLI README and changelog promise exit 1.
  M-NAVe does not catch this, because it is phrased for `back`/H2.

**Fix.**
1. **Probe.** Make the edge machine-readable in `post-conditions.ts`. Either add `detail: 'edge'` to the
   `${t}.history-index` check when `edge` is true, or emit a separate `${t}.history-edge` check. Add the file to S7's
   Files list.
2. **Unit tests** in the browser package's verifier tests:
   - edge for back and for forward;
   - not-moved carries no edge marker;
   - `capEvidence` keeps the check: navigation checks come first and the cap is 8, so record that.
3. **Classifier.** 2.5/S7 classifies `edge` from that marker only. Never from the reason text, and never from
   `expected === -1`.
4. **Unit table rows:**
   - forward edge with a failed `--expect-*` gives 1;
   - back edge with a failed `--expect-*` gives 1;
   - forward not-moved with a failed `--expect-*` gives 4.
5. **Live H2:** add `forward --expect-url-changed` at the newest entry, which must exit 1.
6. **Mutant M-NAVf:** edge detected from the reason string. The live forward+expect case and the unit row must kill it.
7. **S8 checklist:** the I-NAV H2 item names forward precedence.
8. **Browser vitest:** S7 runs it, and the count rises by the new tests.

---

## MINOR

1. **The PROB-051 stderr prefix is unspecified.** `main().catch` prints `Fatal:` for a plain Error.
   - Fix: define a `NoSessionError` (detected by `name`, like `ProjectConfigError`) that is handled in
     `main().catch` with `Error: ` and exit 1.
   - S6-3 asserts the **exact** stderr line, including the `Error:` prefix and the em dash, so it is not a substring
     check.
   - Do the same for `Error: text read failed:` (S3a): catch it inside `cmdText`, and assert that stdout is empty.

2. **Live ISO creation adopts existing dirs.** Replace `mkdir -p "$ISO"` for live ISOs with
   `[ ! -e "$ISO" ] || { echo "ISO exists: $ISO"; exit 1; }; mkdir "$ISO"`. If a dir is left over from this release
   (it carries a `.r062` marker), delete it with the guarded form first. Without this, S6's "fresh state dir" and the
   S1/S2 reuse of `S2t` can read a stale `state.json`.

3. **Inventory mechanics** (S4 step 1):
   - **Escape the regex.** The script must regex-escape method names. `$`, `$$`, `$eval` and `$$eval` are
     unescaped `$` anchors otherwise.
   - **Normalise separators.** `rg` on Windows prints `packages/browser/src\verifier\...`. Normalise to `/` before
     computing keys in both `sites.txt` and the md, or `check-inventory` fails on separators.
   - **One key per call.** Key on `file:line:col` (`rg --column`) so two calls on one line each get a row.
   - **Positive control.** Add a third control: a scratch copy of one source file with an added
     `frame.evaluate.call(frame, ...)`. Record that the grep **misses** it, as a documented limitation, and assert
     `rg '\.(call|apply|bind)\(' ` hits stay 0 on the post-fix tree.

4. **S3b uses an "S1-observed count" that S1 never records.**
   - Fix: add an S1 step that runs `$EV061/S3a/mcp-probe.mjs` on the HEAD build (`EXPECT_TOOLS=73`). Record the
     `tools/list` length and `EXPECTED_BROWSER_TOOLS.length` to `$EV/S1/tool-count.txt`.
   - S3b and S10 read it from there.

5. **The edge output in `--json` mode is unspecified** (2.5). State it: the JSON document goes on stdout, exit 1, and
   the edge line goes on stderr. Add a unit row and include `back --json` at the edge in H2/H4.

6. **The scenario suite is not a publish precondition.**
   - `ci.yml` runs only typecheck, build and test. `scenario-suite.yml` (run-cli, run-mcp, run-sdk) runs nightly or on
     dispatch.
   - 0.6.2 changes CLI startup semantics, `text` output and the MCP snapshot block, and 6.4 item 5 only "recommends"
     the dispatch.
   - Fix: make "dispatch green, per `ci-gate.mjs`, on `release/0.6.2`" a pre-publish item next to CI green in 6.4.
     Alternatively, run `run-cli.mjs`, `run-mcp.mjs`, `run-sdk.mjs` and `ci-gate.mjs` locally in S11 under the
     preamble, with external blocks recorded.

7. **PDF that parses to empty text.** In 0.6.1, `if (pdfText) return pdfText;` fell back to DOM text. 2.1 should state
   the 0.6.2 result (`source:'pdf'`, `totalChars:0`, not an error), and S2 should add a unit case.

8. **The `/hist/spa` timing.** If the `pushState` and hash change run on `load`, the CLI `nav` may return before they
   do, and the first `back` then targets the previous document. That is a flaky H1-SPA, and it could even mask
   M-NAVd.
   - Fix: run the pushes from an inline script at the end of `<body>`.
   - In H1-SPA, assert `eval "location.hash"` == `#x` and record `history.length` before the first `back`.
   - Also record in H1 whether `back` was a bfcache restore (`performance.getEntriesByType('navigation')[0].type` and a
     `pageshow` `persisted` flag the fixture stores), so the evidence names the path it exercised.

9. **S11 live re-runs (8b-8f) and mutant files.** Several step harnesses embed same-build mutant runs
   (`*.mutant.js`, S3a and S4). Pack and dry-run happen in items 6-7, before item 8.
   - Fix: re-assert `ls dist/*.mutant.js` is empty, and the real dist sha256 is unchanged, **after** item 8.
   - Alternatively, give the harnesses a `NO_MUTANTS=1` switch for the gate.

10. **Class identity across bundles (informational, make it explicit).** `PageTextReadError` is duplicated into
    `cli-bin.js`, `mcp-cli.js` and `index.js`. Each surface catches inside its own bundle, so `instanceof` works.
    For safety, state "match by `err.name === 'PageTextReadError'`", the existing `ProjectConfigError` pattern, in
    S3a and S3b.

---

## 3. Executability by a Sonnet builder
- **Generally high.** Commands are literal, ISO names are enumerated, the ACs carry negatives and named mutants, and
  "spec contradictions are a STOP" is stated.
- **Where a builder would stall or improvise today:**
  - MAJOR-1: the forward edge cannot be classified within S7's file scope, so it is a STOP or a fragile workaround.
  - MINOR 1: `Fatal:` versus `Error:`.
  - MINOR 3: `$` escaping and separators make `check-inventory` fail on the first run.
  - MINOR 4: the missing S1 count.

## 4. Release gate completeness
- **What the gate covers:**
  - version in 4 files, and dist greps for the version and for each new feature string;
  - forced build and typecheck, the spec typecheck baseline, the full matrix;
  - advisories, the consumer install and its type probe;
  - the pack diff;
  - live I-047 re-runs on the consumer-resolved Puppeteer;
  - the MCP probe positive and negative;
  - path-log negatives, `check-release-ready` twice, and the WebBench mini re-run.
- **Gaps:**
  - the scenario-suite precondition (MINOR 6);
  - a post-item-8 mutant-file check (MINOR 9);
  - after MAJOR-1, the gate's 8f re-run inherits the forward-precedence case automatically, because the harness is
    re-run unmodified.

## 5. Resolution required for APPROVE
Apply MAJOR-1: the probe field, the S7 file scope, the unit rows, live H2 `forward --expect-url-changed` giving exit 1,
and M-NAVf. MINORs 1-10 should be folded in. None of them blocks approval on its own.
