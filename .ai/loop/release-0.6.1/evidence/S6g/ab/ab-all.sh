#!/bin/bash
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; AB="$WT/.ai/loop/release-0.6.1/evidence/S6g/ab"
V060="$SP/verify060/inst/node_modules/sutradhar/dist/cli-bin.js"; HEAD_BIN="$WT/packages/sutradhar/dist/cli-bin.js"
# leftover real-TEMP list before the whole batch
ls -1 "E:/AI-Cache/tmp" | grep '^sutradhar-cli-' | sort > "$AB/realtemp-batch-before.txt"
for spec in "v060 close $V060 true" "head close $HEAD_BIN true" "ctl close $SP/S6g-ctl/cli-bin.bff46db.js false" "mutB2e close $SP/S6g-ctl/cli-bin.mutB2e.js false" \
            "v060 selfheal $V060 true" "head selfheal $HEAD_BIN true" "ctl selfheal $SP/S6g-ctl/cli-bin.bff46db.js false" "mutB2d selfheal $SP/S6g-ctl/cli-bin.mutB2d.js false"; do
  set -- $spec
  echo "=== $1 $2"; bash "$SP/S6g-scripts/ab-run.sh" "$1" "$2" "$3" "$4" 2>&1 | grep -E "REFUSE|harness-exit|pathcheck-exit|procs-referencing"
  grep -E "^(FAIL|RESULT)" "$AB/run-$1-$2.log" | cut -c1-250
  bash "$SP/S6g-scripts/iso-rm.sh" | tee -a "$AB/iso-cleanup.txt"
done
ls -1 "E:/AI-Cache/tmp" | grep '^sutradhar-cli-' | sort > "$AB/realtemp-batch-after.txt"; diff "$AB/realtemp-batch-before.txt" "$AB/realtemp-batch-after.txt" && echo "REALTEMP-BATCH-IDENTICAL $(wc -l < "$AB/realtemp-batch-after.txt")"
node "$AB/compare.mjs"; echo compare-exit=$?
