# S10b - follow-up gaps

`.ai/loop/field-report-2/gaps.md` (CRLF preserved): 20 new rows GAP-379..GAP-398, plus an appended 0.6.1 sentence and `fixed-in` on the GAP-315 row.
Applied by `add-gaps.mjs` (`add-gaps-output.txt`); checks in `check-s10b.out.txt`.

## Numbering decision
Master's last gap is GAP-357 (`origin/master`), so the literal "next free master number" would be GAP-358. But the held FR2-11 branch
(`claude/fr2-11-action-history`) already uses GAP-339..GAP-378 (max 378), and the plan forbids reusing its numbers. To satisfy both, rows start at
GAP-379 (free on master AND unused on the FR2-11 branch; checked live in `check-s10b.out.txt`: nothing >= 379 on the branch, no duplicate ids).

## Rows (id -> source)
| id | source |
|---|---|
| 379 | plan S10b 1 (no `test` script in mcp-server and dev-runtime) |
| 380 | S10b 2 (no CI guard for shipped-bundle advisories) |
| 381 | S10b 3 (in-flight rm cannot be cancelled) |
| 382 | S10b 4 (remaining dev advisories; S3b's three were refreshed) |
| 383 | S10b 5 + audit N5 (no POSIX rule-5 equivalent; other users'/elevated processes invisible to the scan) |
| 384 | S10b 6 (no deterministic live trigger for F8 / P2) |
| 385 | S10b 7 (macOS and real Chrome on Linux not executed) |
| 386 | S10b 8 (scan timing margin) |
| 387 | S10b 9 + S8b-2 (pre-existing wrong-kill hazard; "a failed state clear leaves `chromePid` recorded (as in 0.6.0)") |
| 388 | S10b 10 (8.3 short-name TEMP not testable here) |
| 389 | N1 (corrupt-marker dir kept forever) |
| 390 | N7 (reused marker PID keeps the dir) |
| 391 | S6e-1 deviation 3 ("vanished candidate returns not-a-directory" warning) |
| 392 | F-S8-3 |
| 393 | F-S8-5 |
| 394 | F-S8-6 + S8b-5 (merged: same finding) |
| 395 | S8b-1 |
| 396 | S8b-3 |
| 397 | S8b-4 |
| 398 | the deferred 0.7.0 close/recovery redesign (plan.md section 10) |

Not logged as gaps (process notes, not follow-ups): S8b-2 is merged into 387; S8b-6 and S8b-7 are audit/builder process records (no product or test impact).

## False-pass analysis
- "Rows exist": could pass with a malformed table (extra pipe) that renders as one cell. `check-s10b.out.txt`: every new row has exactly 7 pipes (6 columns), no `|` inside any description.
- "Numbers never collide": could pass if only master was checked. The same file reports the FR2-11 branch's ids (read with `git show` of the branch) and none is >= 379; there are no duplicate ids in the file.
- "Required wording present" (the 1.5 hazard text, N1, vanished candidate, 0.7.0 pointer): counted with fixed-string greps restricted to the 379..398 rows (the first regex pass mis-handled parentheses; the `-F` re-checks are recorded and all print 1).
- Line endings: the file is CRLF; the check counts lines that lack `\r` (0).
