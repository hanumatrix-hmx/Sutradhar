#!/bin/bash
# FR2-11 A/B against master fdae749 built in E:/AI-Cache/tmp/fr211-master (git archive + pnpm install --offline + pnpm run build).
cd "$1"; A="$2"
node "$A/l13-ab.mjs" > "$A/l13-ab.log" 2>&1; echo "exit $?" >> "$A/l13-ab.log"
node "$A/headed-click-ab.mjs" > "$A/headed-click-ab.log" 2>&1; echo "exit $?" >> "$A/headed-click-ab.log"
for who in master mine; do
  if [ $who = master ]; then ROOT=E:/AI-Cache/tmp/fr211-master; else ROOT="$1"; fi
  SCENARIO_FILTER=UC-05,UC-08,UC-12 SCENARIO_OUTPUT_PATH="$A/run-cli-$who.json" timeout 1500 node "$ROOT/tools/scenario-suite/run-cli.mjs" > "$A/run-cli-$who.log" 2>&1; echo "exit $?" >> "$A/run-cli-$who.log"
  SCENARIO_FILTER=UC-01 SCENARIO_OUTPUT_PATH="$A/run-sdk-$who.json" timeout 900 node "$ROOT/tools/scenario-suite/run-sdk.mjs" > "$A/run-sdk-$who.log" 2>&1; echo "exit $?" >> "$A/run-sdk-$who.log"
done
echo finished > "$A/ab.done"
