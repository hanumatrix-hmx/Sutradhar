# FR2-11 fix-3 evidence index (extra, user-authorised cycle after audit-3; scope A3-F1 + A3-F2/F3/F4)

| What | Where |
|---|---|
| The design conflict, the literal-design patch and the passing experiment that led to the orchestrator-approved refinement | `wip/`, `../../decisions.md` ("fix-3: executor stopped on a design conflict") |
| The new tests on the fix-2 code (37 failed / 7 passed) | `before-change/` |
| Deviations and open decisions (D1-D10) | `deviations.md` |
| Unit / property / isolated-cell tests | `packages/browser/tests/unit/glue-rule.spec.ts` (seed 20261101: 6,000 random + 4,606 grid strings, 75 tests), `packages/cli/tests/unit/glue-rule.spec.ts` (seed 20261103, 1,500 strings), generator `tools/scenario-suite/lib/fr2-11-glue.mjs` |
| Independent fuzz (own PRNG and grammar) and its results | `tools/scenario-suite/fuzz-fr2-11-fix3.mjs`, `final/fuzz-independent.txt` (1,000,000 strings, 0 leaks), negative control in `final/fresh-queries.log` section 7 |
| Mutants (26): unit run, live runs, the first live attempts that were NOT CAUGHT | `mutants/` (unit, all 26), `mutants-live/` (first live batch + `baseline*`), `mutants-live2/`, `mutants-live3/` (MG10 and MG12 after the shape / driver fixes); table `tools/scenario-suite/mutate-fr2-11-fix3-table.mjs` |
| The auditors' probes and attack-gen re-run UNMODIFIED | `../audit-reruns-fix-3/` (logs, `sha-check.txt`, shim roots), copies in `../audit-reruns-fix-3-a{1,2,3}/`, runner `final/run-audit-reruns.sh` (+ `final/mkshim-bundle-attack-gen.cjs`, `final/mkidentity-attack-gen.cjs`) |
| Live script, two full passes (+ the part re-run) | `live-pass-1/` (60 / 61 cases: the CLI GLUE check bug), `live-pass-1b-cli-glue/`, `live-pass-2/` (61 / 61 cases, 393 / 393 checks), each with `totals.json`; the final-build GLUE run `final-glue-live/` |
| Regressions | `regression/` (FR2-08 478 / 478, FR2-07 488 / 488, FR2-04 110 / 1 / 2, CLI suite 11 / 14, master A/B, UC-08 isolated A/B) |
| Final verification | `final/` (build logs incl. the two failed default-concurrency builds, `tsc*.txt`, `vitest*.txt`, `lint.txt`, bundle greps, dist hashes, `fresh-queries.sh` / `.log`, disk and `sutradhar-cli-*` listings) |
| False-pass analysis | `../run-1/false-pass-analysis.md` (section "FIX-3") |
| Changelog fragment, docs, gaps | `../changelog-fragment.md`, `docs/22-changelog.md`, `packages/cli/README.md`, `AGENT_SETUP.md`, `../../gaps.md` (GAP-372..378) |
