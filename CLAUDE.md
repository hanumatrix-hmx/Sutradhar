# CLAUDE.md

Standing operating guidance for Claude (or any AI agent) working in this repository. See
[README.md](./README.md) for what Sutradhar is and how to use it.

## Sutradhar's goal: the best browsing/web tool for an AI, period — not just "good enough"

This repo isn't just a product Claude helps build — it's also meant to become **Claude's own
primary tool for web browsing and automation**, and the bar is competitive, not just
functional: **be genuinely better than Playwright, Puppeteer, the real `pinchtab/pinchtab`,
and the browser tools built by other AI companies (Anthropic's own computer-use, OpenAI's
Operator/computer-use, etc.)** — not just "has no known bugs." The standing directive is a
continuous loop, now explicitly benchmark- and competitor-aware:

1. **Discover** a real limitation — by actually using Sutradhar for a real task (via its MCP
   tools, CLI, or SDK), not by reading code and guessing, AND by comparing against what named
   competitors actually offer (their real tool surface, their real benchmark scores) — not
   assumptions about them. See
   [.ai/competitive-benchmarks.md](./.ai/competitive-benchmarks.md) for the researched
   landscape: agent-level benchmarks (WebArena, OSWorld, Web Bench, Mind2Web) that need a real
   LLM driving the loop, and LLM-independent comparisons (tool surface, reliability, feature
   parity) that don't.
2. **Fix** it — small, scoped fixes. If something looks like it needs a multi-day rework
   (e.g. the DOM-attribute grounding path's default), log it in the backlog below rather than
   building it reflexively.
3. **Verify live** — typechecking is necessary, not sufficient. Verification means actually
   driving the fix through Sutradhar's own tools against a real target and confirming it
   works, the same way a user would hit it. **Also run the actual `vitest` suite for every
   touched package** (`node_modules/.bin/vitest run`, works even when `pnpm` isn't available in
   this environment) — live scripts and `tsc` alone won't catch a stale test fixture (found
   live: a hardcoded expected-tool-count assertion silently drifted out of sync across several
   milestones of adding tools, and only a real test run caught it).
4. **Benchmark it** — where a real, runnable comparison exists, use it. That includes
   agent-level task benchmarks (e.g. WebBench) attempted *live by Claude driving `browser.*`
   directly* — no LLM provider needed for that mode, see below — as well as LLM-independent
   tool-surface/reliability comparisons. Don't claim "best" without a number or a documented,
   real comparison behind it.
5. **Log and repeat** — record what was found/fixed/benchmarked in
   [.ai/browsing-capability-loop.md](./.ai/browsing-capability-loop.md) (capability gaps and
   the iteration log), [.ai/competitive-benchmarks.md](./.ai/competitive-benchmarks.md)
   (competitor research and comparisons), or [.ai/known-problems.md](./.ai/known-problems.md)
   (bugs), then pick the next real task.

**Primary benchmarking mode: Claude (or another host AI) driving `browser.*` directly** — the
same way Claude already drives Playwright MCP in other sessions. This needs no LLM provider
at all; the host AI supplies the reasoning, Sutradhar supplies the tools. Two real WebBench
samples have been run this way (2026-08-13, 15 tasks total — see
`.ai/competitive-benchmarks.md` and `tools/webbench/claude-direct-run-2026-08-13*.md`):
**5/15 completed with real, verifiable answers; 10/15 blocked by external anti-bot/auth
walls; 0 Sutradhar-attributable failures.** That's the honest current number — not "we don't
know," and not "100%, we're the best." This is the default way to "benchmark it" going
forward: pick real tasks (WebBench's task set or similar), attempt them live via `browser.*`,
record what actually happened, and let the completion/external-block split stand as the
result rather than only reporting the flattering half.

**Secondary, currently-blocked mode**: `agent.runGoal` is Sutradhar's own separate internal
agent loop (`AgentCore` + an LLM provider it manages itself) — a different use case from the
primary one above, not the main benchmarking path. This environment has no LLM provider for
it (no Ollama running, no `OPENROUTER_API_KEY`), so this specific mode and any benchmark that
requires it end-to-end (an autonomous `agent.runGoal` run with no host AI involved) stay
blocked. Don't try to work around it by installing infrastructure or provisioning credentials
unprompted; it's a real external dependency, not a code gap.

**Claude self-directs milestones.** Don't ask for approval before every individual fix — batch
related work into a milestone, then checkpoint with the user: report what was tested, what was
found, what was fixed and verified, and what's proposed next. Checkpoint after a themed batch
of work, or before anything architecturally significant or risky — not after every step.

## Scope boundary — read this before assuming "maximum freedom" means fewer constraints

This directive is about **tool capability**, not about loosening Claude's actual operating
safety norms:

- Destructive or hard-to-reverse actions (git push, npm publish, deletions, force operations)
  still get confirmed with the user before acting — this directive doesn't change that.
- Things this project has already deliberately excluded stay excluded unless the user
  explicitly reopens the decision — most notably **stealth / bot-detection / CAPTCHA evasion**.
  Chasing "can bypass anti-bot measures" as a capability gap is out of scope.
- Legal and ethical use of the browsing capability (site terms of service, rate limits,
  authorized access only) is not something this loop overrides.

If a limitation looks like it can only be "fixed" by crossing one of these lines, log it as
deliberately excluded, don't build it.

## Where things live

- [.ai/browsing-capability-loop.md](./.ai/browsing-capability-loop.md) — the loop's persistent
  state: capability taxonomy (what's covered/partial/untested/excluded) and the iteration log.
- [.ai/competitive-benchmarks.md](./.ai/competitive-benchmarks.md) — researched benchmark
  landscape (WebArena/OSWorld/Web Bench/Mind2Web etc.) and real, sourced feature/tool-surface
  comparisons against Playwright, Puppeteer, `pinchtab/pinchtab`, and AI-company browser tools.
- [.ai/known-problems.md](./.ai/known-problems.md) — active bugs/tech debt, existing convention.
- [.ai/next-task.md](./.ai/next-task.md), [.ai/milestones.md](./.ai/milestones.md) — older
  project-management docs from an earlier planning phase; treat with caution, some content
  predates the pivot to real-usage-driven development and is stale (aspirational epics that
  were never built). `known-problems.md` and this file are the current source of truth.
