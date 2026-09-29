#!/usr/bin/env bash
# FR2-04 audit-5: the rest of audit-3/audit-4's attack probes against e70394a, sequentially (one
# Chrome-driving probe at a time -- shared machine).
cd "$(dirname "$0")"
echo "=== link-deadend (GAP-246) ==="; node link-deadend-probe.mjs 3 > link-deadend-console.txt 2>&1
echo "=== recovery-wrongtab (GAP-236) ==="; node recovery-wrongtab-probe.mjs 2 . 200000 a5 > recovery-wrongtab-console.txt 2>&1
echo "=== blank-escape (GAP-238) ==="; node blank-escape-probe.mjs 3 60000 a5 > blank-escape-console.txt 2>&1
echo "=== policy-sibling (GAP-239) ==="; node policy-sibling-probe.mjs 5 a5 > policy-sibling-console.txt 2>&1
echo "=== many-blocked (GAP-241, K to 40) ==="; node many-blocked-probe.mjs 4,14,30,40 2 200000 a5 > many-blocked-console.txt 2>&1
echo "=== signal-attack (GAP-240) ==="; node signal-attack-probe.mjs 2 . a5 > signal-attack-console.txt 2>&1
echo "=== chain-bound (GAP-242) ==="; node chain-bound-probe.mjs 3 . 200000 a5 > chain-bound-console.txt 2>&1
echo "=== multi-unknown ==="; node multi-unknown-probe.mjs 3 a5 > multi-unknown-console.txt 2>&1
echo "=== SWEEP DONE ==="
