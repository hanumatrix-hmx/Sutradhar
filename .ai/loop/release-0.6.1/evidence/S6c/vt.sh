#!/bin/sh
# usage: vt.sh <STEP> <logfile> [vitest args...]   (cli package vitest under the isolation preamble; ISO = $SP/<STEP>-tmp)
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; cd "$WT/packages/cli" || exit 1
STEP="$1"; LOG="$2"; shift 2
ISO="$SP/$STEP-tmp"; mkdir -p "$ISO"
echo "# cmd: TEMP=ISO TMP=ISO TMPDIR=ISO NODE_OPTIONS=--import=file:///\$SP/iso/assert-tmp.mjs SUTRADHAR_CLI_DEBUG_CLEANUP=1 timeout 900 ../../node_modules/.bin/vitest run --globals $* ; ISO=$ISO ; start=$(date -Is)" > "$LOG"
TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 timeout 900 ../../node_modules/.bin/vitest run --globals "$@" >> "$LOG" 2>&1
ec=$?
echo "# vitest-exit=$ec end=$(date -Is)" >> "$LOG"
echo "vitest-exit=$ec guard-lines=$(grep -c '\[iso-guard\] tmpdir=' "$LOG") isoguardfail=$(grep -c 'ISOLATION GUARD' "$LOG")"
exit $ec
