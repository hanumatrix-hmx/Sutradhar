# S11 item 5 re-run after the llm test-gate fix

Code under test: `3a3cb75` (test(llm): run live Ollama tests only when the required model is installed). Command: identical matrix as S11 item 5
(`evidence/S11/scripts/matrix.sh S11-rerun`, 20 entries, same per-package `vitest run --globals` / frontend config, same iso preamble); logs in `../S11-rerun/test-*.log`.
Daemon state at the time: `curl localhost:11434/api/tags` = `{"models":[]}` (reachable, no models) - the exact condition that failed S11.

llm: before (S11) 5 failed / 6 passed, exit 1; after 17 passed (11 old + 6 new gate-helper tests), 0 failed, exit 0. The gated live tests return early (they
are not vitest "skipped"; they count as passed), so the evidence that they did not run is that no request to /api/chat is made and the 404 is gone.

## Matrix result: 20/20 exit 0
```
agent | Tests 56 passed (56) | exit=0
apps-server | Tests 28 passed (28) | exit=0
browser | Tests 960 passed (960) | exit=0
capability-runtime | Tests 557 passed (557) | exit=0
capability | Tests 6 passed (6) | exit=0
cli | Tests 437 passed | 2 skipped (439) | exit=0
config | Tests 6 passed (6) | exit=0
contracts | Tests 7 passed (7) | exit=0
dev-runtime | Tests 4 passed (4) | exit=0
events | Tests 6 passed (6) | exit=0
frontend | Tests 29 passed (29) | exit=0
llm | Tests 17 passed (17) | exit=0
mcp-server | Tests 167 passed (167) | exit=0
memory | Tests 8 passed (8) | exit=0
observability | Tests 13 passed (13) | exit=0
sdk | Tests 16 passed (16) | exit=0
storage | Tests 7 passed (7) | exit=0
sutradhar | Tests 70 passed (70) | exit=0
utils | Tests 20 passed (20) | exit=0
workflow | Tests 5 passed (5) | exit=0
```

## check-release-ready (run at 1f4953e, clean tree)
`node scripts/check-release-ready.mjs` -> rc=0
```
[check-release-ready] working tree clean, all workspace dependencies fresh - OK to publish.
```
