# Field Report 2 loop — ledger

Statuses: `TODO -> SPEC -> DEV -> VERIFY -> AUDIT -> FIX(n) -> DONE | BLOCKED | DESCOPED`

| id | title | phase | status | attempts | last evidence | commit |
|---|---|---|---|---|---|---|
| FR2-01 | wait_for_selector visibility states | 1 | AUDIT | 1 | evidence/FR2-01/live-summary.json (42/42) | - |
| FR2-02 | extract_data reads live values | 1 | TODO | 0 | - | - |
| FR2-03 | Session/profile GC | 1 | TODO | 0 | - | - |
| FR2-04 | CLI dialog handling | 1 | TODO | 0 | - | - |
| FR2-05 | Download dir / upload roots wiring | 1 | TODO | 0 | - | - |
| FR2-06 | Selector dialect coach | 2 | TODO | 0 | - | - |
| FR2-07 | Unified verification contract | 2 | TODO | 0 | - | - |
| FR2-08 | Condition waits + settle everywhere | 2 | TODO | 0 | - | - |
| FR2-09 | Snapshot frame/shadow labels | 2 | TODO | 0 | - | - |
| FR2-10 | MCP optional sessionId | 2 | TODO | 0 | - | - |
| FR2-11 | Full action history | 3 | TODO | 0 | - | - |
| FR2-12 | Machine-readable audit | 3 | TODO | 0 | - | - |
| FR2-13 | `sutradhar run` scenario runner | 3 | TODO | 0 | - | - |
| FR2-14 | `.sutradhar.json` project config | 3 | TODO | 0 | - | - |
| FR2-15 | Playwright migration guide | 4 | TODO | 0 | - | - |
| FR2-16 | Stealth boundary honesty | 4 | TODO | 0 | - | - |
| FR2-17 | Docs sweep | 4 | TODO | 0 | - | - |

## Baseline

Done 2026-09-25. Branch `claude/field-report-2-loop` created from HEAD (7073142, 3 commits ahead
of origin/master, no divergence). `pnpm install` clean. Build 9/9. Typecheck 34/34. Vitest
31/31 (excluding the pre-existing, out-of-scope `@sutradhar/llm` Ollama-dependent tests). See
`evidence/baseline/SUMMARY.md`.
