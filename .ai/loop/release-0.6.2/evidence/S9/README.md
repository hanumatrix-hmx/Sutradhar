# S9 version bump 0.6.1 -> 0.6.2

- Step 1: only `packages/sutradhar/src/index.ts` edited -> `matrix.sh S9 sutradhar`: `Tests 1 failed | 69 passed (70)`, exit=1,
  `api.spec.ts > exports its package version` (log: `test-sutradhar-neg-index-only.log`).
- Step 2-3: the other 3 files edited. `git diff --numstat` = 4 files, 1/1 each. `git grep -nF "0.6.1" -- packages/mcp-server/src
  packages/sutradhar/src packages/sutradhar/tests packages/sutradhar/package.json` prints nothing.
  sutradhar `Tests 70 passed (70)` exit=0; mcp-server `167 passed (167)` exit=0 (`test-sutradhar.log`, `test-mcp-server.log`).

False-pass analysis: the sutradhar test could pass without exercising the constant (e.g. both sides stale) -> step 1 shows the
same test FAILS when only the source constant moves, so it does compare source to the expected literal. A stale dist is not
relevant to this step (the dist greps are S11 item 3).
