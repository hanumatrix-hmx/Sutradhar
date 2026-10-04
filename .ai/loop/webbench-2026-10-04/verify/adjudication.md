# Orchestrator adjudication (protocol 4.4) - rulings from logs/evidence only; no default to the driver

Inputs: verify/phase1.json, verify/phase2.json (12 replays, all agreeing with phase 1), verify/adjudication-brief.md
(independent Opus evidence brief with log seqs). Canary check: all 3 canaries (B2/2554, B4/1925, B4/2336 mutated copies)
classified non-COMPLETED in phase 1 -> verification valid. Control 1310 kept COMPLETED.

| Task | Driver | Verifier | Ruling | Basis |
|---|---|---|---|---|
| B4/2561 Kayak | AGENT-FAIL/partial | SUTRADHAR-FAIL | **AGENT-FAIL/reasoning** + confirmed defect D1 | detached-Frame on click/type reproduced 3x (seq 33/37/47/49; verifier replay), but on /hotels typing worked and no typeahead suggestion was selected, so "defect caused the failure" is not established; contested cause -> less favourable class |
| B3/1979 USA.gov | AGENT-FAIL/substitution | COMPLETED/interpreted | **AGENT-FAIL/substitution** | values read from /benefits, not from the search the task asked for; no interpretation ground; renamed-section rule => substitution |
| B2/1379 Polygon | TASK-INVALID/drift | AGENT-FAIL/reasoning | **AGENT-FAIL/reasoning** | drift needs two independent in-site checks; one was a repeat read, one a `text` cut at 4000 chars (cannot prove absence) |
| B3/2687 uptodown | TASK-INVALID/drift | AGENT-FAIL/reasoning | **AGENT-FAIL/reasoning** | truncated app-page read + guessed URL; Android listing unchecked |
| B5/696 goal.com | TASK-INVALID/drift | AGENT-FAIL/reasoning | **AGENT-FAIL/reasoning** | both checks only prove "no site search"; latest match page reachable (seq 20) |
| B6/597 (re-test) | COMPLETED/strict | AGENT-FAIL/unsupported | **AGENT-FAIL/substitution** | "highly cited" criterion unsupported (only "17 citations", no sort/comparison); PROB-044 probe PASS regardless |
| B6/41 (re-test) | COMPLETED/strict | COMPLETED/interpreted | **AGENT-FAIL/substitution** | first all-terms match was result #3, skipped without reason; type-append probe PASS regardless |
| B1/2253 | COMPLETED/interpreted | COMPLETED/strict | **COMPLETED/strict** | protocol 2.5 names eur-lex.europa.eu as on-site for this task |
| B4/1925 original (canary source) | COMPLETED/strict | (saw mutated copy) | **COMPLETED/strict** | all three goals are real plan goals in seq 29; sustain.ucla.edu on-site |
| B4/2336 original (canary source) | COMPLETED/interpreted | (saw mutated copy) | **COMPLETED/interpreted** | values = first five links at seq 17; en-GB auto-redirect is a valid ground. Risk noted: seq 11 vs 17 order differs for 2 of 5 |

Confirmed product defects (independent of scoring): D1 detached-Frame after same-origin navigation on kayak.com/stays
(click/type fail, clickrole/text work); D2 silent 4000-char page-text truncation (runtime.ts:2959; MCP snapshot 2000);
D3 snapshot prints `[#5]` but `#5` is rejected as a ref; D4 `back` prints "undefined". See CANDIDATE-FIXES.md.
