# Release 0.6.2 plan, review 3 (independent, adversarial)

Reviewer: Claude Opus 5.5, 2026-10-04. Plan reviewed: `.ai/loop/release-0.6.2/plan.md` **Revision 3** (section 8 maps
`plan-review-2.md`). I did not write the plan or reviews 1-2. Read-only inspection plus one no-browser Node proof in
`$SP/review062r3/` (copies of the built `packages/browser/dist/verifier/{post-conditions,execution-verifier}.js`,
patched in the copy only). No Chrome, no real-TEMP access, no process kills, no repo writes other than this file.

## Verdict: **APPROVE** (0 BLOCKER, 0 MAJOR, 6 MINOR)

The MINORs below should be folded into the step briefs. None of them is a way to ship broken or to verify falsely.

---

## 1. Review-2 MAJOR-1 (history edge): resolved, proven

**Design check against the source.**
- `decideNavigationVerdict` (`post-conditions.ts:1091-1116`) already computes `edge`. 2.5 adds
  `<t>.history-edge` right after `history-index`, only when `edge` is true.
- `PostConditionRecorder.check` appends checks in order (`:116`). `verifyAction` builds `[...bi.checks, ...orderedExpect]`
  (`execution-verifier.ts:543`) and caps it with `capEvidence` (first 8, `:151`). Rule 5 (`:562`) replaces only
  `reason`, never `checks`. The marker therefore reaches the CLI unchanged.

**Proof.** `$SP/review062r3/proof.mjs` uses the real built `verifyAction` and `capEvidence`, with the 2.5 check spliced
into a copy of `decideNavigationVerdict`. It applies the 2.5 classifier ("edge iff the `history-edge` check is present")
and the exit precedence (edge 1 > failed expect 4 > 0).

| case | no expect | `shouldUrlChange` | `+ expectedUrlSubstring` |
|---|---|---|---|
| back EDGE | edge / 1 | edge / **1** | edge / **1** |
| forward EDGE | edge / 1 | edge / **1** | edge / **1** |
| forward NOT-MOVED | not-moved / 0 | not-moved / 4 | not-moved / 4 |
| back NOT-MOVED | not-moved / 0 | not-moved / 4 | not-moved / 4 |
| back MOVED same-document | moved / 0 | moved / 0 | moved / 4 |

- **M-NAVf is killed.** The reason-text classifier gives `not-moved / 4` on every edge row that has an `--expect-*`,
  because Rule 5 replaced the reason with "Expected URL change from …".
- **Without the fix the defect reproduces.** With `NOEDGE=1` (0.6.1 probe), forward EDGE classifies as `not-moved` with
  exits 0/4/4. That is the review-2 defect, and the new check removes it.
- **The cap holds.** Worst case is nav document, history-index, history-edge, http-status and all 3 `EXPECT_KEYS`:
  7 checks, which is ≤ 8. The edge check is kept at position 3. S7's unit test only needs to assert this.
- **Dialog path.** At an edge with a dialog open, the result is `history-index: not-run` with no edge check, which maps
  to `unconfirmed`, exit 0. This matches 2.5.

**Existing tests are not broken.**
- No `packages/**/tests` file asserts on the `go_back.*` / `go_forward.*` check arrays (grep: 0 hits).
- `post-conditions.spec.ts:382,391` and `runtime.spec.ts:2095` assert only `reason`, which is unchanged.
- `verify-fr2-07-verification.mjs` N5 (reason) and N6 (`go_back.history-index` on a passing move) are unaffected.

## 2. Review-2 MINORs 1-10: all resolved in the text

| # | where it is resolved |
|---|---|
| 1 | 2.4 `NoSessionError` by `name`; S6 exact line plus no `Fatal:`; M-051e; S3a step 2 catches inside `cmdText` |
| 2 | 0.2 item 1, fail-closed creation (see MINOR B and C below for re-run mechanics) |
| 3 | S4 step 1: escaping, argument array, `/` normalisation, `file:line:col`, regex self-test, blind-spot control asserted empty |
| 4 | S1 step 8b, `tool-count.txt` |
| 5 | 2.5, S7 unit row, H2 `back --json` |
| 6 | S11 8h, 6.4 item 2 |
| 7 | 2.1, S2 step 3 |
| 8 | Fixture `/hist/spa` inline script, H1-SPA hash assert, `window.__nav` |
| 9 | `NO_MUTANTS=1` from first version; 8i |
| 10 | 2.1, S3a, S3b by `err.name` |

## 3. New-MAJOR hunt: none found

**`Error:` instead of `Fatal:` for missing sessions.**
- I grepped every `.ts/.mjs/.js/.yml` outside `node_modules`/`dist`, plus the docs, READMEs, AGENT_SETUP and skills.
- The live parsers of `Fatal:` are:
  - `verify-fr2-12-audit.mjs:580,663`: `audit <url>` with a blocked domain. That is launch-capable and a different error.
  - `verify-fr2-14-config.mjs:1067`: `nav` with an oversized viewport. It matches `/No browser session/`, a different message, and uses `Fatal` for display only.
  - `run-cli.mjs:67`: a comment.
  - 0.6.1/FR2 evidence scripts: historical, not re-run.
- No consumer depends on a non-launch verb printing `Fatal:` with no state.
- The change follows the existing `ProjectConfigError` branch (`cli.ts:2134`) exactly.

**Refuse-pre-existing-ISO.** It cannot silently produce a false pass: it fails closed. It can stall a re-run (MINOR B and
C), but the stall is a visible STOP, not a wrong result.

**The new edge check is an additive evidence change** on MCP and SDK `go_back`/`go_forward`. Tier and reason are
unchanged. It is undocumented (MINOR A).

## 4. Executability and release gate

- Steps are literal and ACs carry negatives and named mutants. A Sonnet builder can follow them, apart from MINOR C and
  MINOR D, where it would need to improvise.
- **The gate is complete:**
  - version and dist greps; forced build and typecheck; spec typecheck; matrix;
  - advisories, consumer install and type probe; pack diff;
  - live 8a-8f on HEAD, plus 8c on the consumer install;
  - 8h scenario suite with `ci-gate`; 8i mutant and dist-hash check;
  - `check-release-ready` twice; S11b;
  - 6.4 publish preconditions: CI and the dispatch.

---

## MINOR

**A. Document the new evidence check.**
- `<verb>.history-edge` appears in MCP `browser.go_back`/`go_forward` and SDK verification evidence at an edge.
- Add one line to S10's changelog under Changed, and to the MCP README if it lists check names.

**B. Guarded delete can leave an unmarked dir, which wedges the re-run.**
- On Windows, a locked profile file makes `rm -rf` partial. If `.r062` is removed but the dir is not, the next preamble
  hits "dir without the marker is a STOP", and no allowed form can delete it.
- Fix:
  - delete the contents first and `.r062` last (`find "$ISO" -mindepth 1 ! -path "$ISO/.r062" -delete`-style, or
    `rm -rf` of the children and then the marker);
  - then assert `[ ! -e "$ISO" ]` and report if it still exists.
- S1-4 ("all names free") should also say that a `.r062` leftover from an aborted 0.6.2 S1 is removed with the guarded
  form before the check.

**C. Multiple calls in one ISO within a step.**
- Each tool call is a separate Git Bash invocation, and the preamble template always runs the fail-closed creation
  check. The second call in the same step therefore refuses:
  - S11 8a-8h all use `Sgt`;
  - S4 step 6 reuses `S4t` after step 5 deleted it.
- Fix: state the continuation form `[ -f "$ISO/.r062" ] || exit 1` (no creation) for later calls in the same step.
  Alternatively, require a guarded delete and a fresh creation between harnesses, and say which.

**D. Harness parameters needed by the gate must exist from the first version.**
- S11 8c runs `live-detach.mjs` with `RUNS=5` and against the consumer-install dist. Its sha256 must equal the S4
  record, so the harness has no room to change.
- S4 must require `RUNS` and a dist-path env (`BUNDLE`/`CLI`, as S2 does) from its first version, as it already does
  for `NO_MUTANTS`. The same applies to `live-nodeid`, `live-nosession` and `live-history` if 8d-8f need a dist path.

**E. Restoring scenario-suite results (8h).** Name the method:
- `git restore -- <each rewritten file by name>`, listed from `git status --porcelain`;
- or point the suite's output outside the tree, if the scripts support that.

Without this, a builder may reach for a directory-wide restore, which is close to the forbidden forms.

**F. A rejected `goBack`/`goForward`/`reload` outside the beforeunload branch** (for example a navigation timeout) is
unspecified in 2.5. It currently falls through to `main().catch` and prints `Fatal: …` with exit 1. State that this is
intended (exit 1, never "Navigated") and add a classifier unit row for "no checks at all", which must classify as
`unconfirmed` or be handled before the classifier.

## Reproduce
```
node "$SP/review062r3/proof.mjs"             # with edge check (2.5 design)
NOEDGE=1 node "$SP/review062r3/proof.mjs"     # 0.6.1 probe: forward EDGE classifies as not-moved (exit 0/4/4)
```
