# S10 - changelog and docs

Files: `docs/22-changelog.md` (new `## [0.6.1] - unreleased` between `[Unreleased]` and `[0.6.0]`), `README.md`, `SECURITY.md`,
`packages/cli/README.md` (new "Temp profile directories and their cleanup" section + "Temp profile cleanup" limitations),
`packages/mcp-server/README.md`, `packages/sutradhar/README.md`. Applied by `fill-changelog.mjs` (values read from `S3a/moved-keys.txt`,
`S3a/dist-fast-uri.txt`; output in `fill-output.txt`) and `apply-docs.mjs` (`apply-docs-output.txt`; every anchor must occur exactly once).
Unfilled template saved before filling: `template.txt`.

Filled placeholders: FAST_URI 3.1.8 (was 3.1.5), QS 6.16.0 (was 6.15.3), HONO 4.13.12 (was 4.13.1), HONO_NODE 2.1.3 (was 2.1.0),
IP_ADDRESS 10.7.3 (was 10.3.1), CLOSE_P50 "about 1.1 s" (S7 L1 p50 1092 ms), SWEEP_P50 = S7's suggested wording.

## AC (`check-s10.out.txt`, run live after the edits)
| AC | result |
|---|---|
| S10-1 heading order Security/Fixed/Changed, placed under [Unreleased] | PASS |
| S10-2 no "as of 0.6.0" / "Status (0.6.0)" | PASS (browser README pointer justified in `notes.md`) |
| S10-3 GHSA set == S1 shipped set by script, count 6 | PASS |
| S10-4 bounds equal the constants (10 s / 15 s / 15 s / 10 min); p50 from S7 | PASS |
| S10-5 placeholder grep (case-insensitive, exact names) prints nothing; template negative control = 7 | PASS (7 in `template-placeholder-count.txt`) |

## False-pass analysis
- S10-1: heading order could be checked on the wrong block (e.g. the 0.6.0 section). The checker slices from `## [0.6.1] - unreleased` to
  `## [0.6.0] - 2026-10-03` and compares the heading list to the exact expected list.
- S10-2: grep could match nothing because of a typo in the pattern. The pattern is the same one that matched 4 lines before the edit
  (`git grep "0.6.0"` listing at the start of S10: README 33/35/46, SECURITY 39, 3 package READMEs).
- S10-3: set equality could pass vacuously with two empty sets. The check also requires size 6, and the S1 inventory's `shipped advisories: 6`.
  Mutant run (`check-s10.out.txt`, second block): one GHSA dropped -> `FAIL S10-3`, exit 1.
- S10-4: the doc bounds could drift from the code while the check reads only the doc. The checker reads the constants from
  `temp-profile.ts` / `close-session.ts` at run time and the p50 string from `S7/README.md`.
- S10-5: the grep could never match (wrong pattern case or names). Negative control: the same pattern prints 7 on `template.txt`; the mutant
  changelog with a left-over `<FAST_URI>` -> `FAIL S10-5`.
- Versions were not typed by hand: `fill-changelog.mjs` throws if the dist fast-uri differs from the lockfile's, or if a name has
  more than one moved version.
