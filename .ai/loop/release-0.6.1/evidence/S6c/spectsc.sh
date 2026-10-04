#!/bin/sh
# usage: spectsc.sh <STEP>  -> writes $EV/<STEP>/spec-tsc.txt ; compares with the S5 baseline (7 errors) ; planted control
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT" || exit 1
STEP="$1"; OUT="$EV/$STEP/spec-tsc.txt"
node_modules/.bin/tsc -p "$SP/S6/tsconfig.specs.json" > "$OUT.raw" 2>&1
cp "$OUT.raw" "$OUT"
echo "total-errors=$(wc -l < "$OUT")  TS6059=$(grep -c TS6059 "$OUT")" | tee -a "$OUT.summary"
if diff -q "$EV/S5/spec-tsc-baseline.txt" "$OUT" >/dev/null; then echo "SPEC-TSC-SAME-AS-S5-BASELINE" | tee -a "$OUT.summary"; else echo "SPEC-TSC-DIFFERS-FROM-BASELINE"; diff "$EV/S5/spec-tsc-baseline.txt" "$OUT" | tee -a "$OUT.summary"; fi
echo "errors in new/changed specs: $(grep -E 'spawn-failure-cleanup|system-binaries|close-session|temp-profile\.spec|help-text' "$OUT" | wc -l)" | tee -a "$OUT.summary"
node_modules/.bin/tsc -p "$EV/S5/tsconfig.neg.json" 2>&1 | grep -E "planted.ts" | tee "$EV/$STEP/spec-tsc-negative.txt"
rm -f "$OUT.raw"
