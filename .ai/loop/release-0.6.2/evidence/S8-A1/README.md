# S8 A-1 close-out: continue-offset hint for a window after the first

Added one row to `packages/cli/tests/unit/text-output.spec.ts`:
`textOutput({offset:4000, returnedChars:4000, totalChars:10037, truncated:true}, false)` must end with
`Continue with: sutradhar text --offset 8000]`.

Evidence (cli vitest, ISO `$R/S0b-tmp`, `[iso-guard]` lines present):
- Before the row existed, with auditor mutant A-048a applied (`textContinueHint(r.offset + r.returnedChars)` ->
  `textContinueHint(r.returnedChars)` in `packages/cli/src/text-output.ts`): `text-output.spec.ts 13 passed (13)` -> mutant SURVIVES.
- With the row, mutant applied: `Tests 1 failed | 13 passed (14)`; Expected `--offset 8000]`, Received `--offset 4000]` -> KILLED.
- With the row, HEAD source (sha256 `3ae3c165...375b` restored, equal to the pre-mutation value): `Tests 14 passed (14)`.

False-pass analysis: the row could pass because the mutant was never applied -> the same row failed with the mutant applied
(grep -c of the mutated line = 1), and the source sha256 after restore equals the one before. It could pass because both
the window start and length equal (offset 0 case) -> the row uses offset 4000 != length 4000? They are equal numbers
(4000/4000) but the expected 8000 differs from both the offset and the length alone only as their SUM, and the mutant's
output (4000) differs from 8000, which is exactly what failed.
