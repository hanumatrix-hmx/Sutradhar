#!/bin/bash
# T5 x20 consecutive runs under the F6-limited CPU-load generator. Own PIDs only; leftover query with positive control.
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence/S6h"; cd "$WT/packages/cli"
ISO="$SP/S6h-tmp"; mkdir -p "$ISO"
export LOAD_MARKER_FILE="$SP/S6h-scripts/loadgen.marker" LOAD_PIDS_FILE="$SP/S6h-scripts/loadgen.pids"; rm -f "$LOAD_MARKER_FILE" "$LOAD_PIDS_FILE"
cpu() { powershell.exe -NoProfile -NonInteractive -Command '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average' | tr -d '\r'; }
echo "cpu-load-percent before generator: $(cpu)"
node "$EV/load/s6h-load.mjs" | tee "$EV/load/loadgen-start.txt"
cp "$LOAD_PIDS_FILE" "$EV/load/loadgen-pids.txt"
sleep 3
node "$EV/load/s6h-load-stop.mjs" query | sed 's/^/POSITIVE-CONTROL (workers must be found): /'
echo "cpu-load-percent during load: $(cpu)"
T0=$SECONDS; pass=0; fail=0
for i in $(seq 1 20); do
  [ $((SECONDS-T0)) -gt 240 ] && { echo "ABORT: 240 s budget used before run $i (workers self-terminate at 270 s)"; break; }
  out=$(TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" timeout 120 node ../../node_modules/vitest/vitest.mjs run --globals tests/unit/temp-profile.spec.ts -t "T5" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -v "^\[iso-guard\]")
  if echo "$out" | grep -q "Tests  1 passed | 54 skipped"; then pass=$((pass+1)); r=PASS; else fail=$((fail+1)); r=FAIL; echo "$out" > "$EV/load/run$i-FAILED.log"; fi
  echo "run $i $r $(echo "$out" | grep -o 'T5 INFO: module remaining-ms at each attempt=[0-9,-]*') $(echo "$out" | grep -o 'Duration  [0-9.]*m\?s' | head -1)"
done
echo "RESULT pass=$pass fail=$fail elapsed=$((SECONDS-T0))s"
node "$EV/load/s6h-load-stop.mjs" stop
node "$EV/load/s6h-load-stop.mjs" query | sed 's/^/FINAL LEFTOVER QUERY: /'
echo "cpu-load-percent after: $(cpu)"
