#!/bin/bash
# S8b: T5 x10 consecutive under the F6-limited generator (quarter cores, self-terminating <=180 s). Own PIDs only.
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; OUT="$WT/.ai/loop/release-0.6.1/evidence/S8b/load"; mkdir -p "$OUT"; cd "$WT/packages/cli"
ISO="$SP/S8b-tmp-load"; mkdir -p "$ISO"
export MARKER_FILE="$SP/S8b/load/marker.txt" PIDS_FILE="$SP/S8b/load/pids.txt"; rm -f "$MARKER_FILE" "$PIDS_FILE"
cpu() { powershell.exe -NoProfile -NonInteractive -Command '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average' | tr -d '\r'; }
echo "cpu-before=$(cpu)% start=$(date -Is)"
node "$SP/S8b/load/gen.mjs"; cp "$PIDS_FILE" "$OUT/loadgen-pids.txt"
sleep 3
node "$SP/S8b/load/stop.mjs" query | sed 's/^/POSITIVE-CONTROL (workers must be found): /'
echo "cpu-during=$(cpu)%"
T0=$SECONDS; pass=0; fail=0
for i in $(seq 1 10); do
  [ $((SECONDS-T0)) -gt 150 ] && { echo "ABORT: 150 s budget (workers self-terminate at 180 s)"; break; }
  out=$(TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" NO_COLOR=1 timeout 120 node ../../node_modules/vitest/vitest.mjs run --globals tests/unit/temp-profile.spec.ts -t "T5" 2>&1 | grep -v "^\[iso-guard\]")
  if echo "$out" | grep -q "Tests  1 passed"; then pass=$((pass+1)); r=PASS; else fail=$((fail+1)); r=FAIL; echo "$out" > "$OUT/run$i-FAILED.log"; fi
  echo "run $i $r $(echo "$out" | grep -o 'T5 INFO: module remaining-ms at each attempt=[0-9,-]*')"
done
echo "RESULT pass=$pass fail=$fail elapsed=$((SECONDS-T0))s cpu-end=$(cpu)%"
node "$SP/S8b/load/stop.mjs" stop
node "$SP/S8b/load/stop.mjs" query | sed 's/^/FINAL LEFTOVER QUERY: /'
echo "end=$(date -Is)"
