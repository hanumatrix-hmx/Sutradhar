#!/usr/bin/env bash
# FR2-04 audit-6: every live attack probe, strictly sequential (one Chrome-driving probe at a time -- shared machine).
cd "$(dirname "$0")"
echo "=== [1] NEW shapes (a6-probe group:N, 2 trials) ==="; node a6-probe.mjs group:N 2 new > a6-console-new.txt 2>&1
echo "=== [2] CLI-only residual ==="; node cli-residual-probe.mjs 3 all run1 > cli-residual-console.txt 2>&1
echo "=== [3] two sessions ==="; node cli-two-sessions-probe.mjs 3 > cli-two-sessions-console.txt 2>&1
echo "=== [4] audit-5 surface re-run incl. GAP-251 sweep (a6-probe, non-N scenarios, 1 trial) ==="; node a6-probe.mjs "group:older|chain|opener|blank|url|xsite|reactive|xhr|popup|warden|oopif|bootstrap" 1 a5surface > a6-console-a5surface.txt 2>&1
echo "=== [5] audit-3/4 attribution attacks (2 trials) ==="; node attrib-attack-probe.mjs all 2 > attrib-attack-console.txt 2>&1
echo "=== [6] GAP-252 CLI repro + xhr-after-open ==="; node cli-repro-probe.mjs 3 xhr-after-open,xhr-after-open-timer,type-two-popups a6 > cli-repro-console.txt 2>&1
echo "=== [7] link-deadend (GAP-246) ==="; node link-deadend-probe.mjs 3 > link-deadend-console.txt 2>&1
echo "=== [8] recovery-wrongtab (GAP-236) ==="; node recovery-wrongtab-probe.mjs 2 . 200000 a6 > recovery-wrongtab-console.txt 2>&1
echo "=== [9] blank-escape (GAP-238) ==="; node blank-escape-probe.mjs 3 60000 a6 > blank-escape-console.txt 2>&1
echo "=== [10] policy-sibling (GAP-239) ==="; node policy-sibling-probe.mjs 5 a6 > policy-sibling-console.txt 2>&1
echo "=== [11] many-blocked (GAP-241, K to 40) ==="; node many-blocked-probe.mjs 4,14,30,40 2 200000 a6 > many-blocked-console.txt 2>&1
echo "=== [12] signal-attack (GAP-240) ==="; node signal-attack-probe.mjs 2 . a6 > signal-attack-console.txt 2>&1
echo "=== [13] chain-bound (GAP-242) ==="; node chain-bound-probe.mjs 3 . 200000 a6 > chain-bound-console.txt 2>&1
echo "=== [14] multi-unknown ==="; node multi-unknown-probe.mjs 3 a6 > multi-unknown-console.txt 2>&1
echo "=== SWEEP DONE ==="
