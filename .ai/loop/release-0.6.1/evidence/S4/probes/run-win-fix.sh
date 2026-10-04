#!/bin/sh
# usage: run-win.sh <probe-basename-without-.mjs> [runtimes...]; runs under the ISOLATION PREAMBLE per runtime
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT" || exit 1
probe="$1"; shift; rts="${*:-v25 v18 v20 v22}"
mkdir -p "$EV/S4/win"
for rt in $rts; do
  case "$rt" in
    v25) NB="$(command -v node)";;
    v18) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/83786caec519d9fd/node_modules/node/bin/node.exe";;
    v20) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/ebaba8b9e55fd0a9/node_modules/node/bin/node.exe";;
    v22) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe";;
  esac
  ISO="$SP/S4-tmp-fix-$probe-$rt"; mkdir -p "$ISO"; LOG="$EV/S4/win/$probe-$rt-FIXCONTROL.log"
  echo "# cmd: TEMP=ISO TMP=ISO TMPDIR=ISO NODE_OPTIONS=--import=file:///\$SP/iso/assert-tmp.mjs SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE=\$SP/S4/modfix/temp-profile.mjs timeout 600 \"$NB\" \$SP/S4/$probe.mjs ; ISO=$ISO ; start=$(date -Is)" > "$LOG"
  TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE="$SP/S4/modfix/temp-profile.mjs" PROBE_NODE="$NB" timeout 600 "$NB" "$SP/S4/$probe.mjs" >> "$LOG" 2>&1
  ec=$?; echo "# exit=$ec end=$(date -Is)" >> "$LOG"
  node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$LOG" > "$LOG.pathcheck" 2>&1; pc=$?
  echo "$probe $rt exit=$ec pathcheck=$pc $(grep -c '^PASS' "$LOG") PASS $(grep -c '^FAIL' "$LOG") FAIL guard=$(grep -c '\[iso-guard\] tmpdir=' "$LOG") isoguardfail=$(grep -c 'ISOLATION GUARD' "$LOG") $(tail -1 "$LOG.pathcheck")"
done
