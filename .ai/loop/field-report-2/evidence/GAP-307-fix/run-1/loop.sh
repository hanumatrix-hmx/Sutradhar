#!/bin/bash
# usage: loop.sh <label> <N> <mode: dl|full>
# Runs vitest N times sequentially in packages/browser, records per-run failures as JSON summary lines.
ROOT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"
OUT="$ROOT/.ai/loop/field-report-2/evidence/GAP-307-fix/run-1"
LABEL=$1; N=$2; MODE=$3
cd "$ROOT/packages/browser" || exit 1
echo "PID $$ start $(date +%T)" > "$OUT/$LABEL.log"
for i in $(seq 1 "$N"); do
  J="$OUT/$LABEL-$i.json"
  if [ "$MODE" = dl ]; then
    ../../node_modules/.bin/vitest run tests/unit/browser-action-engine.spec.ts -t "download_file" --reporter=json --outputFile="$J" >/dev/null 2>&1
  else
    ../../node_modules/.bin/vitest run --reporter=json --outputFile="$J" >/dev/null 2>&1
  fi
  node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const f=[];for(const t of r.testResults)for(const a of t.assertionResults)if(a.status==="failed")f.push(a.title+" :: "+(a.failureMessages[0]||"").split("\n")[0]);
console.log("run "+process.argv[2]+" passed="+r.numPassedTests+" failed="+r.numFailedTests+" total="+r.numTotalTests+(f.length?"\n  "+f.join("\n  "):""));
' "$J" "$i" >> "$OUT/$LABEL.log" 2>&1
done
echo "DONE $(date +%T)" >> "$OUT/$LABEL.log"
