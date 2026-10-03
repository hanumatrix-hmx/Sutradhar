#!/bin/bash
cd "E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041" || exit 1
EV=$PWD/.ai/loop/field-report-2/evidence/FR2-14/fix-2
mkdir -p /e/AI-Cache/tmp/fr214f2/rg $EV/reg-ev08 $EV/reg-ev07 $EV/reg-ev04
export TEMP="E:\\AI-Cache\\tmp\\fr214f2\\rg" TMP="E:\\AI-Cache\\tmp\\fr214f2\\rg"
df -h /e | tail -1 >> $EV/reg-disk.txt
SUTRADHAR_FR2_08_EVIDENCE_DIR="$EV/reg-ev08" timeout 1190 node tools/scenario-suite/verify-fr2-08-conditions.mjs > $EV/reg-fr2-08.log 2>&1; echo "exit=$?" >> $EV/reg-fr2-08.log
df -h /e | tail -1 >> $EV/reg-disk.txt
SUTRADHAR_FR2_07_EVIDENCE_DIR="$EV/reg-ev07" timeout 1190 node tools/scenario-suite/verify-fr2-07-verification.mjs > $EV/reg-fr2-07.log 2>&1; echo "exit=$?" >> $EV/reg-fr2-07.log
df -h /e | tail -1 >> $EV/reg-disk.txt
SUTRADHAR_FR2_04_EVIDENCE_DIR="$EV/reg-ev04" timeout 1190 node tools/scenario-suite/verify-fr2-04-dialogs.mjs > $EV/reg-fr2-04.log 2>&1; echo "exit=$?" >> $EV/reg-fr2-04.log
df -h /e | tail -1 >> $EV/reg-disk.txt
SCENARIO_OUTPUT_PATH="$EV/reg-run-cli-results.json" timeout 1190 node tools/scenario-suite/run-cli.mjs > $EV/reg-run-cli.log 2>&1; echo "exit=$?" >> $EV/reg-run-cli.log
df -h /e | tail -1 >> $EV/reg-disk.txt
echo "REG DONE" > $EV/reg-done.txt
