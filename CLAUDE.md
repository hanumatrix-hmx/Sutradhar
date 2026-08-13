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
   works, the same way a user would hit it.
4. **Benchmark it** — where a real, runnable comparison exists (an LLM-independent one today;
   an agent-level one once an LLM provider is available), use it. Don't claim "best" without a
   number or a documented, real comparison behind it.
5. **Log and repeat** — record what was found/fixed/benchmarked in
   [.ai/browsing-capability-loop.md](./.ai/browsing-capability-loop.md) (capability gaps and
   the iteration log), [.ai/competitive-benchmarks.md](./.ai/competitive-benchmarks.md)
   (competitor research and comparisons), or [.ai/known-problems.md](./.ai/known-problems.md)
   (bugs), then pick the next real task.

**Known standing blocker for agent-level benchmarks**: this environment has no LLM provider
(no Ollama running, no `OPENROUTER_API_KEY`) — `agent.runGoal`'s actual reasoning and every
agent-level benchmark (WebArena, OSWorld, Web Bench) are blocked on this. Don't try to
work around it by installing infrastructure or provisioning credentials unprompted; it's a
real external dependency, not a code gap. LLM-independent comparisons (tool surface parity,
mechanical reliability, feature completeness) remain fully actionable without it.

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
