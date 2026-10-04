#!/bin/bash
# S11b runner: creates ISO Wbt fail-closed, runs wb-rerun.mjs under the preamble, leftover check, guarded delete.
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; R="$SP/r062"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.2/evidence"
export MSYS_NO_PATHCONV=1
ISO="$SP/Wbt"; [ ! -e "$ISO" ] || { echo "ISO exists: $ISO (STOP)"; exit 1; }; mkdir "$ISO" && : > "$ISO/.r062"
ls -1 E:/AI-Cache/tmp | grep '^sutradhar-cli-' | sort > "$R/S11/realtemp-b-wb.txt"
echo "[wb.sh] start $(date -Is)"
( cd "$ISO" && env TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 SP="$SP" WT="$WT" OUT="$EV/S11b" "$@" timeout 1500 node "$EV/S11b/wb-rerun.mjs" > "$EV/S11b/harness.stdout.log" 2> "$EV/S11b/harness.stderr.log" ); echo "[wb.sh] rc=$? end $(date -Is)"
sleep 2; echo "[wb.sh] leftover PIDs with scratchpad/Wbt: [$(bash $R/S8/leftover.sh Wbt | tr '\n' ' ')]"
node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$EV/S11b/harness.stderr.log" 2>&1 | tail -2; echo "[wb.sh] path-check exit=$?"
