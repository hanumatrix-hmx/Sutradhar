#!/bin/bash
# scen.sh <run-cli|run-mcp|run-sdk|ci-gate>  -- 8h, continuation form of Sgt (never creates it)
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; R="$SP/r062"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"
export MSYS_NO_PATHCONV=1
ISO="$SP/Sgt"; [ -f "$ISO/.r062" ] || { echo "ISO missing or unmarked: $ISO"; exit 1; }
cd "$WT" && echo "[scen] $1 start $(date -Is)" && TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" USERPROFILE="$ISO/home" HOME="$ISO/home" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 timeout 1500 node tools/scenario-suite/$1.mjs > "$R/S11/scen-$1.out" 2> "$R/S11/scen-$1.err"; echo "[scen] $1 rc=$? end $(date -Is)"
