# FR2-08 AUDIT-1 verdict: ACCEPT (minor follow-ups)

Worktree `claude/fr2-08-condition-waits` at `90dbcdb`, compared with master `75b29c6` (git-archive build in scratch, forced).
Machine-readable detail: `audit-findings.json`. Every probe is under `probes/`; the fixtures are my own, not the builder's.

## Fresh evidence
- Deleted every dist, then a forced build (0 cached, 19+9 tasks). The bundle contains the new strings (`bundle-grep.log`). Typecheck passed 34/34.
- Vitest, all green: browser 929, capability-runtime 254, mcp-server 118, cli 208, sutradhar 43, agent 56, server 28.
- The only line removed from a pre-existing spec file is one import that was widened.
- Live wait_for probes: 19/19 on MCP and 19/19 on the npm bundle; SDK 6/6; CLI 9/10. The one CLI fail was my probe's expectation: FR2-04's gate exits 3 before the wait starts. A dialog that opens mid-wait also gives exit 3.
- Settle sweep over MCP: 18/18. Nine newly covered tools return after the page's burst with settle, and before it without.
- T5, master: a click with settle that opens an alert took 30,370 ms. The dialog was auto-dismissed and never reported.
- T5, branch: the same click took 5,576 ms (the no-settle control takes 3,064 ms). The dialog is still pending, is reported, and can be handled.
- Must-fail negatives, all held:
  - dialog open, or opening mid-wait
  - hung cross-origin frame
  - hung main thread
  - navigation during textGone (0/5 false met)
  - tab closed
  - js throw, never-settling js, syntax error
  - validation
- Hidden tab: timeouts are honoured (3,000 -> 3,004 ms) and the toast is caught about 80 ms after it appears.

## Regressions (HEAD then master, back to back)
- FR2-07: 488/488 on both. The GAP-325 tolerance fired 0 times.
- FR2-04: HEAD 111 pass, 0 fail. Master 110 pass, 1 fail (a headed click stall).
- CLI suite: the same pass/fail set on both.

## Harness commits
- 0a3e467 is a legitimate premise check:
  - In the failing run, the observer itself saw 0 hung frames, so the product's "gone" was true at that moment.
  - The case now fails loudly if no frame hangs.
  - H3 passed 20/20 in reruns.
  - A live mutant that counts a hung frame as absent is caught by H3 and by my own probes.
- 6ba6dfd only adds a control measurement.

## GAP-338
Not caused by FR2-08. Master reproduced the UC-12 "click timed out after 15000ms" (225,937 ms) and the FR2-04 headed-click failure under the same load. The click code path is unchanged.

## Findings (none major)
- F1 (minor): page-settle P3 asserts no upper bound. Mutants X5 and X6 survive the unit suite.
- F2 (minor): the dialog gate is unit-tested only for `text`. Mutants X1 and X2 survive.
- F3 (minor): the docs say a dialog fails the wait "within about a second". When the dialog opens mid-pass it takes up to about 2.7 s.
- F4 (minor): on a hung page, failures add up to 1.5 s for the title read, beyond the documented pass bound.
- F5 (info): the docs don't say that a flash shorter than one poll can be missed.
- F6 (info): H2 has an observer-side flake, 1 in 20.
- F7 (info): tools/list grows by 22.5%.
