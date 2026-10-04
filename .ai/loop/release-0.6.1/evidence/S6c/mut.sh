#!/bin/sh
# usage: mut.sh <STEP> <defs.cjs> <out.txt> [mutant ids...]  (mutation runner under the isolation preamble; ISO=$SP/<STEP>-tmp)
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; cd "$WT" || exit 1
STEP="$1"; DEFS="$2"; OUT="$3"; shift 3
ISO="$SP/$STEP-tmp"; mkdir -p "$ISO"
TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 timeout 1500 node "$SP/mutrun.cjs" "$DEFS" "$OUT" "$@"
