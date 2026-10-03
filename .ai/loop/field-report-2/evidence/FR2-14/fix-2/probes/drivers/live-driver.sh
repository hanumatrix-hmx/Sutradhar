#!/bin/bash
cd "E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041" || exit 1
EV=$PWD/.ai/loop/field-report-2/evidence/FR2-14/fix-2
for n in 1 2; do
  mkdir -p /e/AI-Cache/tmp/fr214f2/lt$n $EV/live-final-$n
  df -h /e | tail -1 >> $EV/live-final-disk.txt
  TEMP="E:\\AI-Cache\\tmp\\fr214f2\\lt$n" TMP="E:\\AI-Cache\\tmp\\fr214f2\\lt$n" SUTRADHAR_FR2_14_EVIDENCE_DIR="$EV/live-final-$n" timeout 1190 node tools/scenario-suite/verify-fr2-14-config.mjs > $EV/live-final-$n.log 2>&1
  echo "exit=$?" >> $EV/live-final-$n.log
done
echo "LIVE DONE" > $EV/live-final-done.txt
