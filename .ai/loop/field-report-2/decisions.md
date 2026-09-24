# Field Report 2 loop — decision log (append-only)

## 2026-09-25 — Model routing deviation

Context: the prompt (`.ai/autonomous-loop-prompt-field-report-2.md` §1) specifies the
Orchestrator should run on Opus 5.5. The user switched this top-level session to Sonnet 5
and explicitly asked it to follow the prompt file as-is.
Options: (a) refuse/ask to switch back, (b) proceed as Orchestrator on Sonnet 5 but keep the
Planner/Auditor roles pinned to Opus via explicit `model: "opus"` on those Agent calls so the
maker-≠-checker separation and the harder reasoning steps still get Opus, (c) run everything on
Sonnet.
Choice: (b). The user gave an explicit, current instruction to proceed; the substantive
integrity of the loop (independent Opus planning/auditing of Sonnet's implementation work) is
preserved regardless of which model drives the bookkeeping/orchestration itself. Recorded here
per prompt §0 ("every decision that would normally be a question is either pre-decided... or is
yours to make and record").

## 2026-09-25 — Working branch base

Context: this session started already inside a harness-managed worktree
(`project-understanding-696041`) on branch `claude/project-understanding-696041`, whose HEAD
(7073142) is exactly 3 commits ahead of `origin/master` (7dce0ec) with no divergence.
Choice: created `claude/field-report-2-loop` from that HEAD rather than from `origin/master`
directly, and rather than creating a nested `git worktree add`. This is a strict superset of
master's history (the 3 extra commits are the already-shipped 0.4.3 release-prep work), so no
behavior is lost or altered, and it avoids the complexity/risk of nesting worktrees inside a
worktree the harness already manages.

## 2026-09-25 — Baseline `@sutradhar/frontend` transient failure

Context: first full `turbo run test` (llm excluded) reported `@sutradhar/frontend#test` failed.
Investigated: standalone `pnpm --filter @sutradhar/frontend test` → exit 0, 29/29. A forced
(`--force`, no cache) full re-run of all 31 non-llm test tasks → 31/31 passed, including
frontend. No code in `packages/frontend` was touched.
Choice: treat as transient turbo-concurrency/resource contention (many real Chrome instances
launching in parallel from `@sutradhar/server`'s benchmark suite at the same time), not a real
regression. Documented honestly in `evidence/baseline/SUMMARY.md` rather than silently ignored.
If this recurs during any FR2 item's VERIFY step, re-run standalone before concluding a
regression, and if it keeps recurring, escalate to a real investigation (don't keep dismissing
it as flake indefinitely).

## 2026-09-25 — Stray test-run artifact cleanup

Context: running the baseline test suite left an untracked `apps/server/.sutradhar-eval/
evaluation-results.json` (a benchmark-suite side effect), never previously tracked or ignored.
Choice: deleted it and added `apps/server/.sutradhar-eval/` to `.gitignore`, since this loop will
run that suite repeatedly and it should not accumulate untracked cruft or get accidentally
committed. Not a functional change to any package.
