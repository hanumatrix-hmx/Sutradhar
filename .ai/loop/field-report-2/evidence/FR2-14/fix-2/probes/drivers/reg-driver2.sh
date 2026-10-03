#!/bin/bash
# A/B and flake re-runs for the regression failures of the first pass (each with a hard timeout; own TEMP scratch).
cd "E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041" || exit 1
EV=$PWD/.ai/loop/field-report-2/evidence/FR2-14/fix-2
MASTER=/e/AI-Cache/tmp/fr211-master
mkdir -p /e/AI-Cache/tmp/fr214f2/rg2 $EV/reg2-ev07 $EV/reg2-ev04 $EV/reg2-ev04-master
export TEMP="E:\\AI-Cache\\tmp\\fr214f2\\rg2" TMP="E:\\AI-Cache\\tmp\\fr214f2\\rg2"
df -h /e | tail -1 >> $EV/reg2-disk.txt
SUTRADHAR_FR2_07_EVIDENCE_DIR="$EV/reg2-ev07" timeout 1190 node tools/scenario-suite/verify-fr2-07-verification.mjs > $EV/reg2-fr2-07.log 2>&1; echo "exit=$?" >> $EV/reg2-fr2-07.log
df -h /e | tail -1 >> $EV/reg2-disk.txt
SUTRADHAR_FR2_04_EVIDENCE_DIR="$EV/reg2-ev04" timeout 1190 node tools/scenario-suite/verify-fr2-04-dialogs.mjs > $EV/reg2-fr2-04-head.log 2>&1; echo "exit=$?" >> $EV/reg2-fr2-04-head.log
df -h /e | tail -1 >> $EV/reg2-disk.txt
(cd $MASTER && SUTRADHAR_FR2_04_EVIDENCE_DIR="$EV/reg2-ev04-master" timeout 1190 node tools/scenario-suite/verify-fr2-04-dialogs.mjs > $EV/reg2-fr2-04-master.log 2>&1; echo "exit=$?" >> $EV/reg2-fr2-04-master.log)
df -h /e | tail -1 >> $EV/reg2-disk.txt
(cd $MASTER && SCENARIO_OUTPUT_PATH="$EV/reg2-run-cli-master-results.json" timeout 1190 node tools/scenario-suite/run-cli.mjs > $EV/reg2-run-cli-master.log 2>&1; echo "exit=$?" >> $EV/reg2-run-cli-master.log)
df -h /e | tail -1 >> $EV/reg2-disk.txt
echo "REG2 DONE" > $EV/reg2-done.txt
