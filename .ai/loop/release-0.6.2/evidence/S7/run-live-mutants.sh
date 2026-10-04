#!/bin/bash
# S7 same-build live mutants (sibling dist/cli-bin.mutant.js, exactly 1 replacement each). Run under Git Bash; builds nothing.
# usage: bash run-live-mutants.sh   (needs $SP/r062/iso.sh; re-creates ISO S7t fail-closed for each mutant, guarded delete after)
set -u
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"
R="$SP/r062"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"
EV="$WT/.ai/loop/release-0.6.2/evidence"; D="$WT/packages/sutradhar/dist"; ISO="$SP/S7t"
export MSYS_NO_PATHCONV=1
sha256sum "$D/cli-bin.js" > "$R/S7/dist-sha-pre-mut.txt"
LOG="$EV/S7/mutants-live.txt"; : > "$LOG"
# mutant -> harness groups that must kill it (M-NAVd is killed by the same-document back, see diag-spa.mjs / README)
for spec in "a:H1" "b:H2" "e:H2" "f:H2" "c:H3"; do
  m="${spec%%:*}"; g="${spec##*:}"
  bash "$R/iso.sh" create "$ISO" || exit 1
  node "$R/S7/mk-mutant.mjs" "$m" | tee -a "$LOG"
  TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 WT="$WT" SP="$SP" HIST_GROUPS="$g" CLI="$D/cli-bin.mutant.js" OUT="$EV/S7/live-history-mutant-$m.json" LOGDIR="$EV/S7/logs-mutant-$m" timeout 900 node "$EV/S7/live-history.mjs" > "$EV/S7/live-history-mutant-$m.stdout.log" 2> "$EV/S7/live-history-mutant-$m.stderr.log"
  echo "mutant $m groups=$g harness rc=$? (expected 1)" | tee -a "$LOG"
  grep -E "^FAIL" "$EV/S7/live-history-mutant-$m.stderr.log" | cut -c1-230 | tee -a "$LOG"
  rm -f "$D/cli-bin.mutant.js"; echo "mutant-files-left=$(ls "$D" | grep -c mutant)" | tee -a "$LOG"
  echo "chrome-left=$(powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -match 'chrome|msedge' -and \$_.CommandLine -like '*S7t*' } | ForEach-Object { \$_.ProcessId }" | wc -l)" | tee -a "$LOG"
  bash "$R/iso.sh" delete "$ISO"
done
sha256sum -c "$R/S7/dist-sha-pre-mut.txt" | tee -a "$LOG"
echo DONE | tee -a "$LOG"
