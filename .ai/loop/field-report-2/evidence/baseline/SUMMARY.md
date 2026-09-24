# Baseline gate — Field Report 2 loop

Date: 2026-09-25
Branch: claude/field-report-2-loop (from HEAD 7073142, 3 commits ahead of origin/master, no divergence)

## Install
`pnpm install` — clean, 412 packages, no errors. See install output in terminal (not logged to file).

## Build
`pnpm build` — 9/9 turbo tasks successful (8 cached, 1 executed: sutradhar bundle).
Full log: build.log

## Typecheck
`pnpm typecheck` — 34/34 turbo tasks successful, 0 errors.
Full log: typecheck.log

## Vitest
- `@sutradhar/llm` test — **2 test files / 5 tests FAIL** (pre-existing, NOT caused by this loop):
  requires a real local Ollama server with model `qwen3.5:9b` pulled; neither is present in this
  environment. Documented in CLAUDE.md ("Secondary, currently-blocked mode") as a known,
  deliberate environment gap — no LLM provider configured. Not touched by any FR2 item.
- All other 30 packages/apps — **PASS** on a clean (`--force`) re-run: 31/31 turbo tasks
  successful. `@sutradhar/frontend#test` failed once on the very first run (turbo concurrency /
  resource contention while `@sutradhar/server`'s benchmark suite was launching many real Chrome
  instances in parallel) but passed standalone (`pnpm --filter @sutradhar/frontend test`, exit 0,
  29/29) and passed again on a forced full re-run alongside everything else (31/31). Treated as
  transient, not a real regression — logged here for honesty, not swept under the rug.
- `@sutradhar/server`'s Phase 9 regression suite reports some individual scripted-task failures
  (nav_01, srch_01, knw_02, etc.) inside its own internal benchmark loop — this is expected
  without a real LLM (it falls back to a heuristic provider) and the suite's own 90%+ threshold
  check is what's asserted, not 100% of individual tasks; the suite itself still reports PASS.

Full logs: vitest.log (initial run, stops at llm failure), vitest-rest.log (llm excluded, first
pass, frontend flake), and the forced re-run (console-only, not saved to file — see this summary
for its result: 31/31 turbo tasks successful).

## Verdict
Baseline is GREEN for the purposes of this loop: build clean, typecheck clean, all vitest suites
pass except the pre-existing Ollama-dependent llm tests, which are out of scope. The loop may
proceed. Any FR2 item that regresses this baseline must be caught by that item's own VERIFY/AUDIT
step.
