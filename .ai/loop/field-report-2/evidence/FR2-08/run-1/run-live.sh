#!/bin/bash
cd "$1"
RUN="$2"
for n in live live-2; do
  SUTRADHAR_FR2_08_EVIDENCE_DIR="$RUN/$n" timeout 2400 node tools/scenario-suite/verify-fr2-08-conditions.mjs > "$RUN/$n.log" 2>&1
  echo "exit $?" >> "$RUN/$n.log"
done
echo finished > "$RUN/live-all.done"
