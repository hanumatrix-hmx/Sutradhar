# S11b - WebBench 982/2561 re-run on the packed CLI (evidence only)

See `wb-rerun.md` (results, honest summary, false-pass analysis). Files: `wb-rerun.mjs` (+ `wb-rerun.run1.mjs`, the version of run 1; shas in
`wb-rerun.sha256-run1/run2`), `982.jsonl`, `2561.jsonl`, `raw/` (per-call stdout/err), `wb-rerun-run1.json`, `wb-rerun.json`, `harness*.log`,
`pathcheck-and-leftovers.txt`. Results: 982 COMPLETED (regression AC holds), 2561 INCOMPLETE (regression AC holds; site-side `ERR_ABORTED` in attempt 1).
