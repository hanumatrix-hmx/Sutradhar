#!/bin/bash
# usage: ab-run.sh <label> <case> <bin> <expect>   (one harness run, fresh ISO, preamble form)
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence/S6g/ab"; cd "$WT"
LABEL="$1"; CASE="$2"; BIN="$3"; EXPECT="$4"; ISO="$SP/S6gi"   # P5: ISO name <= 4 chars keeps the 34-char profile path <= 200
[ -e "$ISO" ] && { echo "REFUSE: $ISO already exists (previous run not cleaned)"; exit 1; }
rm -f "$EV/run-$LABEL-$CASE.log"
mkdir -p "$ISO" "$EV"
TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 \
  AB_SP="$SP" AB_WT="$WT" AB_EV="$EV" AB_BIN="$BIN" AB_LABEL="$LABEL" AB_CASE="$CASE" EXPECT_AC="$EXPECT" \
  timeout 600 node "$EV/s6g-ab.mjs" > "$EV/run-$LABEL-$CASE.log" 2>&1
echo "harness-exit=$? label=$LABEL case=$CASE" | tee -a "$EV/run-$LABEL-$CASE.log"
if [ "$LABEL" != v060 ]; then
  MSYS_NO_PATHCONV=1 node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$EV/logs/$LABEL-$CASE-"*.stderr > "$EV/pathcheck-$LABEL-$CASE.txt" 2>&1; echo "pathcheck-exit=$?" | tee -a "$EV/pathcheck-$LABEL-$CASE.txt"; tail -2 "$EV/pathcheck-$LABEL-$CASE.txt"
fi
AB_ISO="$ISO" powershell.exe -NoProfile -NonInteractive -Command 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Replace("\","/").ToLower().Contains($env:AB_ISO.ToLower().Replace("\","/")) } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }' > "$EV/post-cim-$LABEL-$CASE.txt" 2>&1
echo "procs-referencing-ISO-after-run: $(grep -c . "$EV/post-cim-$LABEL-$CASE.txt")"
