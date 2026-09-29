#!/bin/bash
# three consecutive full live-harness runs (all surfaces incl. bundle); hard timeout 1700 s each
cd "$1" || exit 2
E=.ai/loop/field-report-2/evidence/FR2-07/fix-2
for n in 1 2 3; do
  mkdir -p $E/live-$n
  SUTRADHAR_FR2_07_EVIDENCE_DIR=$PWD/$E/live-$n timeout 1700 node tools/scenario-suite/verify-fr2-07-verification.mjs > $E/live-$n.log 2>&1
  echo "run $n exit $?" >> $E/run3.status
done
echo done >> $E/run3.status
