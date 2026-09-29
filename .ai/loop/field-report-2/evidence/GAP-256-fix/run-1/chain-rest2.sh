#!/bin/bash
cd "$(dirname "$0")"
MASTER=E:/HMX_Projects/Internal_Projects/PinchTab/packages/cli/dist/cli.js
node live-cases.mjs c3a,c3b,c3c,c4a,c4b 5 live-c34.jsonl > live-c34.console.txt 2>&1
node live-cases.mjs c2g 6 live-c2g.jsonl > live-c2g.console.txt 2>&1
node live-cases.mjs c1 5 live-c1.jsonl > live-c1.console.txt 2>&1
node live-cases.mjs c1 5 live-c1-master.jsonl $MASTER > live-c1-master.console.txt 2>&1
echo chain-done > chain-done.txt
