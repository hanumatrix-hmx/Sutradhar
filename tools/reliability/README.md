# Reliability harnesses

## PROB-043: long-lived MCP keyboard delivery soak

`prob043-mcp-soak.mjs` launches the real built stdio MCP server once, keeps one browser
session and primary tab alive, and mixes typing, raw key presses, snapshots, reloads, and
temporary-tab churn. Every keyboard mutation is checked by a separate top-level `browser.eval`
query against both the live DOM value and fixture-owned application state; it does not trust the
action's own handle-based verification.

Build `packages/browser`, `packages/capability-runtime`, and `packages/mcp-server` before a run.

```powershell
$env:PROB043_CALLS='1000'
node tools\reliability\prob043-mcp-soak.mjs
```

For a time-bounded long run, both thresholds apply: the harness continues until it has reached
the requested call count and minimum wall-clock duration.

```powershell
$env:PROB043_CALLS='1000'
$env:PROB043_MINUTES='60'
$env:PROB043_OUTPUT_DIR='C:\Windows\Temp\sutradhar-prob043-results'
node tools\reliability\prob043-mcp-soak.mjs
```

Results are append-only JSONL with an immediate independent oracle after each action. A failed or
interrupted run therefore retains all evidence written before the stop. The default result folder
is `tools/reliability/results/` and is intentionally gitignored.
