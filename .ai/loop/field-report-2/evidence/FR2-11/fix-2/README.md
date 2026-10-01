# FR2-11 fix-2 evidence index (cycle 2, the character rule)

Status: VERIFY (fix-2). Not self-audited: audit-3 follows and is the last standard audit. Root cause and plan: the entry "FR2-11: two failed audits; ROOT-CAUSE
RE-DERIVATION and revised plan" in `.ai/loop/field-report-2/decisions.md`, then the entry "FR2-11 fix cycle 2 (Executor)". Deviations and the decisions the plan left
open: `deviations.md`. False-pass analysis: the fix-2 section at the end of `../run-1/false-pass-analysis.md`.

| What | Where |
|---|---|
| Tests that FAILED before the change (the new browser spec on the fix-1 code: 17 failed, 8 passed) | `before-change/browser-char-rule-before.log` |
| Final build (`turbo run build --force`, both stages), tsc 34/34, vitest on the 7 packages, lint, bundle grep, dist tree hash | `final/tsc.txt`, `final/vitest.txt`, `final/lint.txt`, `final/bundle-grep.txt`, `final/dist-hash-final-2.txt` |
| Fresh re-queries of live state after the last source commit (git state, sources vs HEAD blobs, dist hash, bundle markers, built help / description, the audit copies, the built functions on the audit-2 shapes, chrome / temp dirs) | `final/fresh-queries.sh`, `final/fresh-queries.log` |
| Fuzz, independent of the unit generator: 720,000 generator strings (120 seeds) and 400,000 hostile-alphabet oracle strings (10 seeds), 0 leaks / 0 violations | `final/fuzz.mjs`, `final/fuzz2.mjs`, `final/fuzz-generator-final.txt`, `final/fuzz-oracle-final.txt` |
| The auditors' probes and `attack-gen.mjs` (375 cells) re-run UNMODIFIED on head and on both bundles (sha256-verified copies, shim that cuts the bundled code out for the generator, identity negative control) | `../audit-reruns-fix-2/` (`sha-originals.txt`, `attack-head.log`, `attack-bundle-*.log`, `attack-gen-negative-control.log`, `rerun-*.log`, `privacy-*.json`, `live-attack-*.json`, `rerun-audit2-mutant*.log`) and `final/mkshim-bundle-attack-gen.cjs` |
| Live verify on the final build, driven by `tools/scenario-suite/run-fr2-11-live.sh` (11 processes per pass). Passes 2, 3 and 4: 56/56 cases, 364/364 checks each (mcp 11/80, cli 16/93, sdk 3/21, bundle 26/170). Pass 1: 55/56, see the note below | `final-live-2/`, `final-live-3/`, `final-live-4/` (each with `totals.json`, per-part `console.log`, `live-*.jsonl`, `cli-dirs-*.txt`), `final-live-1-cli-pm-download-hang/` |
| Regression on the final build: FR2-08 478/478, FR2-07 488/488 (GAP-325 tolerance fired 0 times), FR2-04 110/1/2 (L13 headed, as on master), CLI scenario suite 10/14 (UC-04 / UC-05 / UC-08 / UC-12), A/B against master | `final-chain/regression/`, `final-chain/ab/` |
| The audit probes on the final build (head and bundle), runner log | `../audit-reruns-fix-2/runner.log` |
| Mutants of the character rule (38: MX1..MX36, MX5b, MX6b): final unit run, and the live runs | `mutants-unit-final2/` (final unit run of all 38), `mutants-unit-final/` (earlier unit runs, MX33 .. MX36), `mutants-live-before-step6/`, `mutants-live2-before-step6/` (live runs on the MCP and CLI surfaces; the source changed afterwards only in the `#` handling, the wait_for selector and the upload targets), `final-chain/mutants-live-final/`, `final-chain/mutants-live-final2/` (MX12 re-run after its build fix) |
| Superseded, kept and not hidden: the exploratory live passes (one timed out in the CLI privacy part), the pre-step-9 final passes and regressions (FR2-08 was 476/478 under the rule before the wait_for fix) | `superseded/` |
| `sutradhar-cli-*` Chrome profile directories: lists before / after, what was removed (only directories this work created, each checked for a running Chrome first) | `sutradhar-cli-*.txt`, `final-chain/cli-dirs-*.txt`, `final-chain/ab/cli-dirs-new.txt`, per-part `cli-dirs-*.txt` |

## Notes

- **Pass 1 (55/56).** The CLI privacy part failed 2 of 12 checks because the `download` command hung (exit null after 90 s, no output, one history line fewer): the
  intermittent headed-download hang that also appears as UC-08 on master. It happened while I was running a UC-04 A/B concurrently on the same machine (my mistake: I do not
  run anything beside a live pass any more). The pass is kept as-is; pass 4 is the replacement. UC-08 isolated: 3/3 on this branch and 3/3 on master (`final-chain/ab/`).
- **UC-04 (Google Maps, an external site)** fails 9/9 here and 8/9 on master (`final-chain/regression/ab-uc04/`): environmental, not history related.
- **Not verified:** headed mode of the privacy cases, non-Chrome browsers, POSIX file mode 0600 outside WSL, a POSIX host with a real POSIX path tool call, a real OAuth
  redirect to a custom scheme (the redirect text is injected through a real failing eval and a real `navigate` that Chrome aborts), and the line endings of
  `run-fr2-11-live.sh` after a Windows checkout with autocrlf (it is tracked 100755).
