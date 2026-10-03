#!/bin/bash
# usage: regress.sh <root> <tag> <suites...>
ROOT="$1"; TAG="$2"; shift 2
EV=/e/AI-Cache/tmp/fr214a3/reg
mkdir -p $EV
export TEMP='E:\AI-Cache\tmp\fr214a3\t' TMP='E:\AI-Cache\tmp\fr214a3\t'
for s in "$@"; do
  df -h /e | tail -1 > $EV/$TAG-$s.disk
  case $s in
    f08) SUTRADHAR_FR2_08_EVIDENCE_DIR="E:\AI-Cache\tmp\fr214a3\reg\$TAG-ev08" timeout 1200 node "$ROOT/tools/scenario-suite/verify-fr2-08-conditions.mjs" > $EV/$TAG-f08.log 2>&1; echo "exit=$?" >> $EV/$TAG-f08.log ;;
    f07) SUTRADHAR_FR2_07_EVIDENCE_DIR="E:\AI-Cache\tmp\fr214a3\reg\$TAG-ev07" timeout 1200 node "$ROOT/tools/scenario-suite/verify-fr2-07-verification.mjs" > $EV/$TAG-f07.log 2>&1; echo "exit=$?" >> $EV/$TAG-f07.log ;;
    f04) SUTRADHAR_FR2_04_EVIDENCE_DIR="E:\AI-Cache\tmp\fr214a3\reg\$TAG-ev04" timeout 1200 node "$ROOT/tools/scenario-suite/verify-fr2-04-dialogs.mjs" > $EV/$TAG-f04.log 2>&1; echo "exit=$?" >> $EV/$TAG-f04.log ;;
    cli) SCENARIO_OUTPUT_PATH="E:\AI-Cache\tmp\fr214a3\reg\$TAG-run-cli.json" timeout 1200 node "$ROOT/tools/scenario-suite/run-cli.mjs" > $EV/$TAG-run-cli.log 2>&1; echo "exit=$?" >> $EV/$TAG-run-cli.log ;;
  esac
  echo "$s done $(date +%T)" >> $EV/$TAG-progress.txt
done
