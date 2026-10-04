# S3b evidence - dev-only in-range advisories (conditional): KEPT

Commands exactly as plan S3b (lockfile before-copy in scratchpad, `update -r --lockfile-only brace-expansion js-yaml nanoid`,
frozen install, audit, forced build `--concurrency=1`, forced lint `--continue --concurrency=1`, inventory equality, lint
equality) then the full 20-entry matrix with `<STEP>`=S3b (`$SP/matrix.sh S3b`). Build 04:43:10-04:43:55 (exit 0, 20/20 tasks,
0 cached); lint finished 04:45:26.

Moved keys (`moved-keys.txt`): brace-expansion 1.1.16 -> 1.1.21 and 2.1.3 -> 2.1.7, js-yaml 4.3.0 -> 4.3.2, nanoid 3.3.16 -> 3.3.19.
Full audit after (`audit-summary.txt`): 3 moderate / 2 high / 1 critical (S3a: 5/12/1); remaining items are vitest/vite/esbuild/braces
(need a major upgrade or have no fix; logged in S10b).

## Keep condition (all five hold, so the commit is made)
| # | condition | result | evidence |
|---|---|---|---|
| 1 | only the 3 packages moved | PASS | `keep-condition-details.txt`: `brace-expansion,js-yaml,nanoid` |
| 2 | no manifest changed | PASS | `git diff --name-only` = `pnpm-lock.yaml`; manifest changes 0 |
| 3 | matrix totals >= S1, 0 new failures, guard lines | PASS | `totals-vs-S1.txt` = `TOTALS-EQUAL-S1` (the S1 and S3b `test-totals.txt` are line-for-line equal after stripping the guard-line count); 20 logs, all `exit=0`, `ISOLATION-GUARD-fail=0`, mcp-server log names `tools.spec.ts` |
| 4 | LINT-SAME and equal turbo lint task count | PASS | `lint-same.txt`: `LINT-SAME`, 8 compared lines in both logs; both `Tasks: 31 successful, 32 total`, same single failure `@sutradhar/mcp-server#lint` (pre-existing, 6 no-explicit-any errors) |
| 5 | INVENTORY-SAME | PASS | `inventory-same.txt` (3 bundle lines equal to S3a's NEW inventory) |

Also re-checked after the update: dist still has exactly `fast-uri@3.1.8` (dist mtime 04:43:51, fresh), and `audit --prod` is still 0
advisories / 160 deps.

## Mutants (check-level, `mutants.txt`)
- A lint log with one extra eslint error: the LINT-SAME diff exits 1 (caught).
- An inventory line with an extra inlined package: the INVENTORY-SAME diff exits 1 (caught).

## False-pass analysis
- Keep 1/2: moved-keys regenerated from a fresh `git diff` of the lockfile after this update (S3a is already committed, so the diff
  contains only S3b's change); the manifest check reads `git diff --name-only` live.
- Keep 3: equal totals could come from reading S1 logs. The S3b logs are in `$EV/S3b/`, timestamps 04:46, and contain the
  `[iso-guard]` lines from this run; equality is a computed `diff`, not an eyeball.
- Keep 4: LINT-SAME could be vacuous (both sides empty). It compared 8 error/warning lines on each side, and the lint mutant shows the
  diff can fail. Lint ran with `--force` (0 cached).
- Keep 5: INVENTORY-SAME could be vacuous or built from a stale dist. The inventory is a fresh esbuild build from source (not the dist); the
  dist marker was separately re-read (fast-uri 3.1.8, fresh mtime); and the inventory mutant shows the diff can fail.
- Dev-only claim: that nothing shipped changed is asserted by INVENTORY-SAME, not by the audit.
