# Field Report 2 loop — ledger

Statuses: `TODO -> SPEC -> DEV -> VERIFY -> AUDIT -> FIX(n) -> DONE | BLOCKED | DESCOPED`

| id | title | phase | status | attempts | last evidence | commit |
|---|---|---|---|---|---|---|
| FR2-01 | wait_for_selector visibility states | 1 | FIX(4) [ESCALATED: Orchestrator-supervised bonus cycle 1/2] | 7 | audit-4: same root-cause pattern found in 3 MORE adjacent functions (GAP-081..083 major) fix-3 didn't touch, + GAP-059 claim false for visible-state path; NOT DONE | 80636b8 |
| FR2-02 | extract_data reads live values | 1 | SPEC (waits for FR2-01 audit; shared files) | 0 | evidence/FR2-02/spec.md | - |
| FR2-03 | Session/profile GC | 1 | SPEC (waits for FR2-01 DONE) | 0 | evidence/FR2-03/spec.md | - |
| FR2-04 | CLI dialog handling | 1 | SPEC (Step-1 experiment runs after FR2-01 FIX(1); DEVELOP after FR2-03) | 0 | evidence/FR2-04/spec.md | - |
| FR2-05 | Download dir / upload roots wiring | 1 | SPEC (found a real symlink-escape bug B2; DEVELOP after FR2-04) | 0 | evidence/FR2-05/spec.md | - |
| FR2-06 | Selector dialect coach | 2 | SPEC (needs FR2-02 DONE; DEVELOP after FR2-05) | 0 | evidence/FR2-06/spec.md | - |
| FR2-07 | Unified verification contract | 2 | SPEC (needs FR2-05 + FR2-06 DONE; DEVELOP after FR2-06) | 0 | evidence/FR2-07/spec.md | - |
| FR2-08 | Condition waits + settle everywhere | 2 | SPEC (needs FR2-07 DONE; DEVELOP after FR2-07) | 0 | evidence/FR2-08/spec.md | - |
| FR2-09 | Snapshot frame/shadow labels | 2 | SPEC (no hard precondition; default merge after FR2-08) | 0 | evidence/FR2-09/spec.md | - |
| FR2-10 | MCP optional sessionId | 2 | SPEC (no hard precondition; MCP-only; default merge after FR2-09) | 0 | evidence/FR2-10/spec.md | - |
| FR2-11 | Full action history | 3 | SPEC (soft dep on FR2-07 field shape; default merge after Phase 2) | 0 | evidence/FR2-11/spec.md | - |
| FR2-12 | Machine-readable audit | 3 | SPEC (Step 0 live experiment required before DEVELOP; soft deps FR2-04/07/08) | 0 | evidence/FR2-12/spec.md | - |
| FR2-13 | `sutradhar run` scenario runner | 3 | SPEC (HARD-blocked: needs FR2-07+FR2-08+FR2-11+FR2-12 all DONE) | 0 | evidence/FR2-13/spec.md | - |
| FR2-14 | `.sutradhar.json` project config | 3 | SPEC (builds on FR2-03/04/05, all still SPEC) | 0 | evidence/FR2-14/spec.md | - |
| FR2-15 | Playwright migration guide | 4 | TODO | 0 | - | - |
| FR2-16 | Stealth boundary honesty | 4 | TODO | 0 | - | - |
| FR2-17 | Docs sweep | 4 | TODO | 0 | - | - |

## Baseline

Done 2026-09-25. Branch `claude/field-report-2-loop` created from HEAD (7073142, 3 commits ahead
of origin/master, no divergence). `pnpm install` clean. Build 9/9. Typecheck 34/34. Vitest
31/31 (excluding the pre-existing, out-of-scope `@sutradhar/llm` Ollama-dependent tests). See
`evidence/baseline/SUMMARY.md`.
