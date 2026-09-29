#!/usr/bin/env bash
# FR2-04 audit-6, second sequential batch (runs only after run-sweep-a6.sh has finished).
cd "$(dirname "$0")"
echo "=== [S2-1] crash compare (cur vs pre-FR2-04 master dist) ==="; node crash-compare-probe.mjs 2 > crash-compare-console.txt 2>&1
echo "=== [S2-2] GAP-252 anchor removed, pure CLI ==="; node cli-252-openerclosed-probe.mjs 5 600 > cli-252-openerclosed-console.txt 2>&1
echo "=== [S2-3] N3 type252 opener-closed g0, more trials ==="; node a6-probe.mjs N3-type252-openerclosed-g0 6 n3g0 > a6-console-n3g0.txt 2>&1
echo "=== [S2-4] CLI residual (fixed window.open) ==="; node cli-residual-probe.mjs 3 all run2 > cli-residual-console.txt 2>&1
echo "=== [S2-5] two sessions (fixed) ==="; node cli-two-sessions-probe.mjs 3 > cli-two-sessions-console.txt 2>&1
echo "=== [S2-6] esc-2 cli-repro with window.open fix ==="; node cli-repro-fixed-probe.mjs 3 xhr-after-open,xhr-after-open-timer,url-open-xhr fixed > cli-repro-fixed-console.txt 2>&1
echo "=== SWEEP2 DONE ==="
