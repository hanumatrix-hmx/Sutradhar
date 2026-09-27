# Field Report 2 loop — ledger

Statuses: `TODO -> SPEC -> DEV -> VERIFY -> AUDIT -> FIX(n) -> DONE | BLOCKED | DESCOPED`

| id | title | phase | status | attempts | last evidence | commit |
|---|---|---|---|---|---|---|
| FR2-01 | wait_for_selector visibility states | 1 | **BLOCKED** [6 audits, 5 fix cycles, 2 Orchestrator-supervised escalation cycles exhausted per loop's own retry bound -- audit-6 found 3 NEW instances (GAP-132 critical tab-close false-success, GAP-133/134 major) of the exact same recurring pattern] | 11 | See decisions.md 'FR2-01 BLOCKED' entry for the full diagnosis. GAP-132..137 logged, unresolved. | 61df926 (last landed fix; GAP-132/133/134 NOT fixed)
| FR2-02 | extract_data reads live values | 1 | **DONE** | 1 | audit-1 PASSED with caveats: attr:/live-value/visibility rules all independently confirmed correct including C12's ancestor-select visibility (live-verified in real Chrome, not just unit-mocked); 6 minor gaps (GAP-169..174), GAP-169 (mock leak) fixed on landing, others deferred | 520d73b |
| FR2-03 | Session/profile GC | 1 | **BLOCKED** [5 audits, 4 fix cycles, 2 Orchestrator-supervised escalation cycles exhausted per loop's own retry bound -- audit-5 found GAP-194's own remedy over-corrected into a PERMANENT leak (genuine orphans never reclaimed) plus a real data-loss bug (GAP-200) unrelated to the escalation's own focus] | 5 | See decisions.md 'FR2-03 BLOCKED' entry for the full diagnosis. GAP-198..204 logged, unresolved. GAP-193 (the marker-authorization structural fix) IS genuinely, fully closed -- confirmed by 2 independent audits. Only GAP-194's specific remedy mechanism (port-probing) is fundamentally unable to distinguish live from orphaned. | (uncommitted; fix-4 code never committed)
| FR2-04 | CLI dialog handling | ESCALATION 2 of 2 (LAST CYCLE) done -> AUDIT-6 (FINAL) | escalation-2 done: 500ms delay removed (root cause of audit-5), GAP-252 opener-anchor linking added; 904 vitest, 111/0/2 live; one pre-existing, pre-disclosed residual (busy-from-birth popup) carried forward unchanged | 1 | evidence/FR2-04/run-1/ + audit-1..5/ + fix-1..3/ + escalation-1..2/ | - |
| FR2-05 | Download dir / upload roots wiring | 1 | SPEC (unblocked once FR2-04 lands; its FR2-03 references are all soft -- per FR2-04 spec-amendment-1 section E) | 0 | evidence/FR2-05/spec.md | - |
| FR2-06 | Selector dialect coach | 2 | **DONE** | 1 | audit-2 PASSED: both real defects (GAP-205 doubled '=', GAP-206 frame-hop precheck+test) confirmed genuinely fixed via independent live re-derivation across 113+13+8+2 fresh test cases; 3 minor gaps (GAP-214..216), none blocking, GAP-216 confirmed pre-existing not caused by this item | (pending DONE commit) |
| FR2-07 | Unified verification contract | 2 | SPEC (waits for FR2-05 DONE; no FR2-03 shape dependency per amendment-1 section E) | 0 | evidence/FR2-07/spec.md | - |
| FR2-08 | Condition waits + settle everywhere | 2 | SPEC (waits for FR2-07 DONE) | 0 | evidence/FR2-08/spec.md | - |
| FR2-09 | Snapshot frame/shadow labels | 2 | **DONE** | 4 | audit-4 PASSED: all 5 Done-when bullets met, token-size exception approved, CDP-based blocked-frame fix confirmed correct across redirects/re-navigation/nesting; 4 minor gaps (GAP-158..161), GAP-158 fixed on landing, others deferred/logged, none blocking | 36a1bdf |
| FR2-10 | MCP optional sessionId | 2 | **DONE** | 1 | audit-1 PASSED: schema/race/multi-client behavior all independently re-verified correct (0/66 tools require sessionId now, launch/attach/agent.runGoal/health/shutdown_all schemas byte-identical to before); 7 minor gaps (GAP-162..168, test-integrity/evidence-accuracy, same recurring pattern as FR2-01/16/09), none blocking, all deferred | 2e5bc6c |
| FR2-11 | Full action history | 3 | SPEC (soft dep on FR2-07 field shape; default merge after Phase 2) | 0 | evidence/FR2-11/spec.md | - |
| FR2-12 | Machine-readable audit | 3 | SPEC (hard preconditions: NONE per spec; soft deps on FR2-04/07/08 are non-blocking fallback-documented; unblocked for DEVELOP) | 0 | evidence/FR2-12/spec.md | - |
| FR2-13 | `sutradhar run` scenario runner | 3 | SPEC (HARD-blocked: needs FR2-07+FR2-08+FR2-11+FR2-12 all DONE) | 0 | evidence/FR2-13/spec.md | - |
| FR2-14 | `.sutradhar.json` project config | 3 | SPEC (waits for FR2-04+FR2-05 DONE; small FR2-03 reference fixes listed in FR2-04 amendment-1 section E) | 0 | evidence/FR2-14/spec.md | - |
| FR2-15 | Playwright migration guide | 4 | BLOCKED-BY-DEPENDENCY (hard dep FR2-01 DONE, which is now itself BLOCKED) | 0 | evidence/FR2-15/spec.md | - |
| FR2-16 | Stealth boundary honesty | 4 | **BLOCKED** [5 audits, 4 fix cycles, 2 Orchestrator-supervised escalation cycles exhausted per loop's own retry bound -- audit-5 found the allow-list redesign itself is bypassable 102/118 times via untriggered vocabulary and gameable narrative exemptions] | 9 | See decisions.md 'FR2-16 BLOCKED' entry for the full diagnosis. GAP-138..143 logged, unresolved. The dead-code removal (StealthEngine/enableStealth) and the honest core boundary sentences that DO exist are real and correct -- only the enforcement mechanism (a CI check meant to guarantee no regression) is what's BLOCKED. | fd152e7 (last landed audit-logging commit; the fix-5 code changes themselves were never committed)
| FR2-17 | Docs sweep | 4 | TODO | 0 | - | - |

## Baseline

Done 2026-09-25. Branch `claude/field-report-2-loop` created from HEAD (7073142, 3 commits ahead
of origin/master, no divergence). `pnpm install` clean. Build 9/9. Typecheck 34/34. Vitest
31/31 (excluding the pre-existing, out-of-scope `@sutradhar/llm` Ollama-dependent tests). See
`evidence/baseline/SUMMARY.md`.
