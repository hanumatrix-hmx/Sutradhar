# Field Report 2 loop — ledger

Statuses: `TODO -> SPEC -> DEV -> VERIFY -> AUDIT -> FIX(n) -> DONE | BLOCKED | DESCOPED`

| id | title | phase | status | attempts | last evidence | commit |
|---|---|---|---|---|---|---|
| FR2-01 | wait_for_selector visibility states | 1 | AUDIT(5) [ESCALATED bonus cycle 1/2 complete, awaiting final independent audit] | 8 | fix-4: 8 named gaps + 1 newly-found 9th site all fixed via one shared tri-state mechanism (HandleVisibilityVerdict + raceBounded), each with unit test + mutation proof; 404/404 vitest, 5/5 clean tsc, 48/48 then 47/48 (1 unrelated OS file-lock flake) live-verify; awaiting audit-5 | (fix-4 commit pending) |
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
| FR2-15 | Playwright migration guide | 4 | SPEC (HARD-blocked: needs FR2-01..FR2-14 all DONE) | 0 | evidence/FR2-15/spec.md | - |
| FR2-16 | Stealth boundary honesty | 4 | FIX(2) [audit-1 FAILED: GAP-101 major -- new wording is itself factually false] | 1 | audit-1 found new claim 'AutomationControlled is a stability flag, not detection-evasion' is FALSE (navigator.webdriver probe proves otherwise); + 4 minor gaps | (uncommitted, not yet -- audit-1 blocked it) |
| FR2-17 | Docs sweep | 4 | TODO | 0 | - | - |

## Baseline

Done 2026-09-25. Branch `claude/field-report-2-loop` created from HEAD (7073142, 3 commits ahead
of origin/master, no divergence). `pnpm install` clean. Build 9/9. Typecheck 34/34. Vitest
31/31 (excluding the pre-existing, out-of-scope `@sutradhar/llm` Ollama-dependent tests). See
`evidence/baseline/SUMMARY.md`.
