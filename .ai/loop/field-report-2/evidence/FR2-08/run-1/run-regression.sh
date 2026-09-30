#!/bin/bash
cd "$1"
RUN="$2"
R="$RUN/regression"
SUTRADHAR_FR2_07_EVIDENCE_DIR="$R/fr2-07" timeout 3300 node tools/scenario-suite/verify-fr2-07-verification.mjs > "$R/fr2-07.log" 2>&1; echo "exit $?" >> "$R/fr2-07.log"
SUTRADHAR_FR2_04_EVIDENCE_DIR="$R/fr2-04" timeout 3300 node tools/scenario-suite/verify-fr2-04-dialogs.mjs > "$R/fr2-04.log" 2>&1; echo "exit $?" >> "$R/fr2-04.log"
SCENARIO_OUTPUT_PATH="$R/run-cli-branch.json" timeout 1500 node tools/scenario-suite/run-cli.mjs > "$R/run-cli-branch.log" 2>&1; echo "exit $?" >> "$R/run-cli-branch.log"
echo finished > "$R/all.done"
