#!/bin/bash
# usage: vt.sh <STEP> <pkg> [vitest args...]   (runs under the isolation preamble; creates ISO $R/<STEP>-tmp if absent-marked)
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; R="$SP/r062"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"
STEP=$1; PKG=$2; shift 2
ISO="$R/$STEP-tmp"; [ -f "$ISO/.r062" ] || { echo "ISO missing or unmarked: $ISO"; exit 1; }
export MSYS_NO_PATHCONV=1
cd "$WT/packages/$PKG" && TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" timeout 900 node "$WT/node_modules/vitest/vitest.mjs" run --globals "$@"
