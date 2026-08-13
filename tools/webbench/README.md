# WebBench harness

Runs Sutradhar's real autonomous agent (`agent.runGoal`'s actual production composition —
`SutradharRuntime` + `AgentCore` + a real LLM provider, wired exactly the way
`packages/mcp-server/src/server.ts` wires them) against a curated sample of real
[WebBench](https://github.com/Halluminate/WebBench) tasks. See `.ai/competitive-benchmarks.md`
for why this exists and what it's evidence for.

## Why WebBench

Of the agent-level browsing benchmarks researched (WebArena, OSWorld, Web Bench, Mind2Web —
see `.ai/competitive-benchmarks.md`), WebBench is the most current, the most directly
browser-focused, and — critically — the only one with a **simple, directly downloadable,
real task set** (`webbenchfinal.csv` in its GitHub repo, no signup/API required). 2,454 of its
5,750 tasks are open-sourced.

## What's here

- `tasks.json` — a small, curated, real sample (one task per WebBench category —
  READ/CREATE/UPDATE/DELETE/FILE_MANIPULATION — plus 2 extra READ tasks), reproduced verbatim
  from the dataset including its own task-scoping instructions. **Not** the full 2,454-task
  set — this is a harness smoke-test sample, not a full benchmark run.
- `run.mjs` — the harness. Loads `tasks.json`, runs each through the real agent loop, captures
  status/answer/step-trace/duration per task, writes a timestamped JSON report to `results/`
  (gitignored — these are run artifacts, not source).

## Running it

```bash
# From the repo root, with dist builds up to date:
node tools/webbench/run.mjs
```

Needs a real LLM provider — set `OPENROUTER_API_KEY`, or have Ollama running locally
(`SUTRADHAR_LLM_BASE`/`SUTRADHAR_MODEL` to override the defaults `http://localhost:11434` /
`qwen3.5:9b`). Runs headless by default; set `HEADFUL=1` to watch it.

**Without a provider**, every task fails with an honest "no LLM provider configured" or a real
network error — that still proves the harness itself works end-to-end (loads tasks, drives the
real production API, captures structured results, writes a report); it's the reasoning step
that's unavailable, not a harness bug.

## Scoring: there's no automated answer key, on purpose

WebBench's own published methodology is human-in-the-loop review, not exact-match scoring —
many of its tasks have variable-format correct answers (e.g. "list specifications" has no
single canonical string). This harness matches that: it does **not** invent a scoring
function. `status: "completed"` in a result means *the agent loop itself* reported success
(passed its own internal verification step) — it does **not** mean a human or judge confirmed
the answer is actually correct. Score a real run by reading `answer`/`steps` per task, the same
way WebBench's own creators do.

## Provenance

Task text and starting URLs are reproduced from `webbenchfinal.csv` in
[Halluminate/WebBench](https://github.com/Halluminate/WebBench), fetched 2026-08-13. Not
affiliated with Halluminate/Skyvern — this is Sutradhar's own harness against their published,
open-sourced task data.
