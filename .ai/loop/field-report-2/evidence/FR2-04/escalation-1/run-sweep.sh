#!/usr/bin/env bash
# FR2-04 escalation-1: re-run every attribution attack from audit-3 AND audit-4, sequentially (one
# Chrome-driving probe at a time -- shared machine hygiene), after attrib-attack-probe.mjs finishes.
set -e
cd "$(dirname "$0")"
echo "=== link-deadend (GAP-246) ==="
node link-deadend-probe.mjs 3 2>&1 | tee link-deadend-console.txt
echo "=== recovery-wrongtab (audit-3 GAP-236) ==="
node recovery-wrongtab-probe.mjs 2 2>&1 | tee recovery-wrongtab-console.txt
echo "=== blank-escape (audit-3 GAP-238) ==="
node blank-escape-probe.mjs 2>&1 | tee blank-escape-console.txt
echo "=== policy-sibling (audit-3 GAP-239) ==="
node policy-sibling-probe.mjs 2>&1 | tee policy-sibling-console.txt
echo "=== many-blocked (audit-3 GAP-241) ==="
node many-blocked-probe.mjs 2>&1 | tee many-blocked-console.txt
echo "=== signal-attack (audit-3/4 GAP-240) ==="
node signal-attack-probe.mjs 2>&1 | tee signal-attack-console.txt
echo "=== chain-bound (audit-3 GAP-242) ==="
node chain-bound-probe.mjs 2>&1 | tee chain-bound-console.txt
echo "=== multi-unknown ==="
node multi-unknown-probe.mjs 2>&1 | tee multi-unknown-console.txt
echo "=== SWEEP DONE ==="
