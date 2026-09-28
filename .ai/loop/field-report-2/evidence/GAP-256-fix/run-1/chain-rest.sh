#!/bin/bash
# waits (hard timeout 20 min) for the c2 run to finish, then runs the remaining live cases sequentially
cd "$(dirname "$0")"
end=$((SECONDS+1200))
until grep -q "^leftovers" live-c2.console.txt; do [ $SECONDS -gt $end ] && { echo "timeout waiting for c2"; exit 1; }; sleep 3; done
MASTER=E:/HMX_Projects/Internal_Projects/PinchTab/packages/cli/dist/cli.js
node live-cases.mjs c3a,c3b,c3c,c4a,c4b 5 live-c34.jsonl > live-c34.console.txt 2>&1
node live-cases.mjs c1 5 live-c1.jsonl > live-c1.console.txt 2>&1
node live-cases.mjs c1 5 live-c1-master.jsonl $MASTER > live-c1-master.console.txt 2>&1
echo chain-done > chain-done.txt
