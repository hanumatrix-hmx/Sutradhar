# S6f - O7 source guard (b): measure the if-block end from its `{` (F-S8-1; test only)

Only file changed besides evidence: `packages/cli/tests/unit/close-session.spec.ts` (guard (b), one hunk). No product file changed
(`cli.ts` sha256 `740552c7...` before the red run, after every mutant run, and at commit time).

## Change
`cb` is the index of the `if` keyword; `cbBlock = extractBlock(elseBlock, cb)` starts at the block's `{`, 19 characters later, so
`cb + cbBlock.length - 1` landed 19 characters before the real closing `}`. Now:
`cbOpen = elseBlock.indexOf('{', cb); cbClose = cbOpen + cbBlock.length - 1; expect(elseBlock[cbClose]).toBe('}'); expect(clearAt).toBeGreaterThan(cbClose)`.
The extra `elseBlock[cbClose] === '}'` assertion pins the index arithmetic itself.

## AC table
| AC | result | evidence |
|---|---|---|
| Real code: guard passes | PASS | `test-close-session-real-code.log`: `14 passed (14)`; full cli suite `test-cli-full.log`: `Test Files 21 passed`, `Tests 349 passed \| 2 skipped` (= S8 totals, no regression) |
| RED BEFORE: the old guard misses placement (i) | PASS (confirmed red) | `mutants-BEFORE-old-guard.txt`: `M-O6-i-S8-variant-last-stmt-in-block: exit=0 ... 14 passed (14) caught=false` (survives); (ii)-(v) were already caught by the old guard |
| After the fix all placements fail guard (b) | PASS | `mutants-AFTER-fixed-guard.txt`: (i) S8 variant, (ii) S6b original (inside the try), (iii) first statement after `{`, (iv) inside the `catch {}`, (v) before `if (!closeBlocked) {` each `1 failed \| 13 passed`, FAILED test = `(b) exactly one clearState( ...`, `caught=true`, `ALL-MUTANTS-CAUGHT-AND-RESTORED`, sha256 restored every time (`restored=true`) |
| No product change | PASS | `git diff --stat HEAD` = the spec only; cli.ts sha unchanged (above) |
| tsc, spec typecheck, isolation | PASS | `tsc.txt` empty (exit 0); `spec-tsc.txt.summary`: `SPEC-TSC-SAME-AS-S5-BASELINE`, 0 errors in changed specs, planted TS2322 reported (`spec-tsc-negative.txt`); `pathcheck.txt` `cleanup-lines=404 outside-iso=0`; 52 `[iso-guard]` lines, 0 `ISOLATION GUARD` |
| Real TEMP untouched | PASS | `realtemp-compare.txt`: before/after sorted `sutradhar-cli-*` lists identical (45) |

Mutant placement (i) uses exactly the anchor of the auditor's `evidence/S8/M-O6-variant-cmdClose.txt` (catch `}` ... `await clearState();` ... `}` of the
`if (!closeBlocked)` block); (ii) is the S6b builder's original M-O6 (second edit of `S6b-defs.cjs` M-O6). Runner: S6b `mutrun.cjs` (CRLF-aware: cli.ts is CRLF,
anchors are converted; sha256 before/after; restore in `finally`). Defs: `S6f-defs.cjs`.

## False-pass analysis
| AC | how it could pass while broken | what rules it out |
|---|---|---|
| guard passes on real code | the new guard is vacuous (e.g. `cbClose` is wrong and the comparison always true) | the extra `expect(elseBlock[cbClose]).toBe('}')` fails if the index is off; and the mutants below fail it |
| all placements fail (b) | the mutant failed for another reason (anchor not applied, compile error, whole file not loading) | each row is `1 failed \| 13 passed (14)` with the named `(b)` test the only failure; the runner requires the anchor to occur exactly once; (i) is the SAME mutant that exits 0 with 14 passed on the old guard in `mutants-BEFORE-old-guard.txt` run through the same runner |
| restore | a mutant left in the tree makes later runs lie | `restored=true` per mutant, and `sha256sum packages/cli/src/cli.ts` after the run printed `740552c7...` (same as before) |
| cli suite green | a stale/cached transform | vitest runs from source on each invocation; totals equal S8's independently measured 349/2 |
| real TEMP | another session's change masks ours | path-log check passes (all `[cleanup]` paths under our ISO) and the lists are identical |
