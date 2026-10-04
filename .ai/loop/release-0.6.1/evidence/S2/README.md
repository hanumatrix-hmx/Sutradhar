# S2 evidence - FR2-11 ledger reconciliation (docs only)

Files: `branch-row.txt` (branch ledger row), `branch-held-entry.txt` (branch HELD entry, for reference),
`ac-precommit.txt` (S2-1, S2-3, S2-4 and the numstat before commit), `ac-staged.txt` (S2-2/S2-3 on the staged state, equal to HEAD^..HEAD; live post-commit re-run is in the builder report),
`mutants.txt`.

## AC results
| AC | result | evidence |
|---|---|---|
| S2-1 | PASS | `ac-precommit.txt`: `diff` empty, `cmp` byte-identical, `wc -l` 1 on both sides, row contains `HELD`. |
| S2-2 | PASS | `ac-staged.txt`: `git diff --stat HEAD^ HEAD` lists only ledger.md (1 line), decisions.md (additions only, `grep -c '^-[^-]'` = 0) and `$EV/S2`. |
| S2-3 | PASS | `ac-staged.txt`: `git diff origin/master...HEAD --name-only -- packages apps` is empty. |
| S2-4 | PASS | `grep -c "FR2-11 HELD" decisions.md` = 4 (>= 1; all 4 are inside the new entry: its heading plus 3 in-body mentions). |

## Mutants
- A one-character change in the live row (`552f9dd` -> `552f9de`): the S2-1 diff exits 1.
- The pre-S2 HEAD row ("SPEC") compared against branch-row.txt: diff exit 1, so the check fails on the unreconciled state.
  (`mutants.txt`.)

## False-pass analysis
- S2-1: `diff` of two empty outputs would be "empty". Ruled out by `wc -l` = 1 on both sides and `grep -c '^| FR2-11 .*HELD'` = 1; and
  the branch row is read fresh from `git show claude/fr2-11-action-history:...` (branch tip b861d3a), not from a stale copy.
- S2-2: a diff that looks additions-only could hide a CRLF rewrite of a whole file. `git diff --numstat` shows `19 0` for
  decisions.md and `1 1` for ledger.md, so no whole-file rewrite.
- S2-3: `origin/master...HEAD` (three dots) compares to the merge base; as a cross-check the pre-commit working tree vs
  `origin/master` (two dots) was also 0 files under packages/apps. The branch has no commit beyond S1 (docs/evidence only).
- S2-4: the grep could be satisfied by pre-existing text. Before this step the count was 0 (`git show HEAD:.ai/loop/field-report-2/decisions.md | grep -c "FR2-11 HELD"` = 0,
  verified); after it is 4, and the new entry's own heading is present (`grep -n '^## 2026-10-04 -- FR2-11 HELD'`).
