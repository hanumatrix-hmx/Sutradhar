#!/bin/bash
# final live matrix against the FINAL forced build; sequential, one Chrome session at a time
cd "$(dirname "$0")"
for spec in "c4c 5" "c4a 5" "c3a 5" "c3c 5" "c3b 5" "c2 6" "c2g 6" "c1 5"; do
  set -- $spec
  node live-cases.mjs $1 $2 final-$1.jsonl > final-$1.console.txt 2>&1
done
echo final-chain-done > final-chain-done.txt
