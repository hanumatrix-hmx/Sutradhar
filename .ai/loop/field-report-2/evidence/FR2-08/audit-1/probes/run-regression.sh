#!/bin/bash
# HEAD then master (git-archive 75b29c6 build), sequential, same machine load. Hard timeouts per script.
R="$1/regression"
for which in head master; do
  if [ $which = head ]; then ROOT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; else ROOT="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad/m75"; fi
  cd "$ROOT"
  echo "$which fr2-07 start $(date +%T)" >> "$R/timeline.txt"
  SUTRADHAR_FR2_07_EVIDENCE_DIR="$R/$which-fr2-07" timeout 3300 node tools/scenario-suite/verify-fr2-07-verification.mjs > "$R/$which-fr2-07.log" 2>&1; echo "exit $?" >> "$R/$which-fr2-07.log"
  echo "$which fr2-04 start $(date +%T)" >> "$R/timeline.txt"
  SUTRADHAR_FR2_04_EVIDENCE_DIR="$R/$which-fr2-04" timeout 3300 node tools/scenario-suite/verify-fr2-04-dialogs.mjs > "$R/$which-fr2-04.log" 2>&1; echo "exit $?" >> "$R/$which-fr2-04.log"
  echo "$which run-cli start $(date +%T)" >> "$R/timeline.txt"
  SCENARIO_OUTPUT_PATH="$R/$which-run-cli.json" timeout 1500 node tools/scenario-suite/run-cli.mjs > "$R/$which-run-cli.log" 2>&1; echo "exit $?" >> "$R/$which-run-cli.log"
done
echo "done $(date +%T)" >> "$R/timeline.txt"
