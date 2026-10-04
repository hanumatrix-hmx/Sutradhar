#!/bin/bash
# scen2.sh <run-cli|run-mcp|run-sdk|ci-gate> [VAR=val ...]  -- 8h, continuation form of Sgt; real USERPROFILE/HOME (an overridden
# USERPROFILE stops Chrome from starting on this machine, see S11 README deviation 2)
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; R="$SP/r062"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"
export MSYS_NO_PATHCONV=1
ISO="$SP/Sgt"; [ -f "$ISO/.r062" ] || { echo "ISO missing or unmarked: $ISO"; exit 1; }
S=$1; shift
cd "$WT" && echo "[scen2] $S start $(date -Is)" && env TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 "$@" timeout 1500 node tools/scenario-suite/$S.mjs > "$R/S11/scen2-$S.out" 2> "$R/S11/scen2-$S.err"; echo "[scen2] $S rc=$? end $(date -Is)"
