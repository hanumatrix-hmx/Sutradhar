#!/bin/bash
# FR2-11 regression chain (sequential: they all drive real Chrome). Usage: run-regression.sh <worktree> <run-dir>
# Outputs go under <run-dir>/regression/. Evidence-dir env vars keep each script from overwriting committed evidence.
cd "$1"
RUN="$2"
R="$RUN/regression"
mkdir -p "$R"
SUTRADHAR_FR2_08_EVIDENCE_DIR="$R/fr2-08" timeout 3300 node tools/scenario-suite/verify-fr2-08-conditions.mjs > "$R/fr2-08.log" 2>&1; echo "exit $?" >> "$R/fr2-08.log"
SUTRADHAR_FR2_07_EVIDENCE_DIR="$R/fr2-07" timeout 3300 node tools/scenario-suite/verify-fr2-07-verification.mjs > "$R/fr2-07.log" 2>&1; echo "exit $?" >> "$R/fr2-07.log"
SUTRADHAR_FR2_04_EVIDENCE_DIR="$R/fr2-04" timeout 3300 node tools/scenario-suite/verify-fr2-04-dialogs.mjs > "$R/fr2-04.log" 2>&1; echo "exit $?" >> "$R/fr2-04.log"
SCENARIO_OUTPUT_PATH="$R/run-cli.json" timeout 1500 node tools/scenario-suite/run-cli.mjs > "$R/run-cli.log" 2>&1; echo "exit $?" >> "$R/run-cli.log"
SCENARIO_OUTPUT_PATH="$R/run-mcp.json" timeout 1500 node tools/scenario-suite/run-mcp.mjs > "$R/run-mcp.log" 2>&1; echo "exit $?" >> "$R/run-mcp.log"
SCENARIO_OUTPUT_PATH="$R/run-sdk.json" timeout 1500 node tools/scenario-suite/run-sdk.mjs > "$R/run-sdk.log" 2>&1; echo "exit $?" >> "$R/run-sdk.log"
PROB043_MINUTES=5 PROB043_OUTPUT_DIR="$R/prob043" timeout 900 node tools/reliability/prob043-mcp-soak.mjs > "$R/prob043.log" 2>&1; echo "exit $?" >> "$R/prob043.log"
echo finished > "$R/all.done"
