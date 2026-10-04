#!/bin/sh
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT" || exit 1
kind="$1"; ISO="$SP/S4-tmp-$2"; mkdir -p "$ISO" "$EV/S4/win"; LOG="$EV/S4/win/browser-$kind.log"
BINS='{"v25":"C:/Program Files/nodejs/node.exe","v18":"C:/Users/Varad M/AppData/Local/npm-cache/_npx/83786caec519d9fd/node_modules/node/bin/node.exe","v20":"C:/Users/Varad M/AppData/Local/npm-cache/_npx/ebaba8b9e55fd0a9/node_modules/node/bin/node.exe","v22":"C:/Users/Varad M/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe"}'
echo "# cmd: TEMP=ISO TMP=ISO TMPDIR=ISO NODE_OPTIONS=--import=file:///\$SP/iso/assert-tmp.mjs SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE=\$SP/S4/mod/temp-profile.mjs BROWSER_KIND=$kind timeout 900 node \$SP/S4/win-browser.mjs; ISO=$ISO start=$(date -Is)" > "$LOG"
TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE="$SP/S4/mod/temp-profile.mjs" BROWSER_KIND="$kind" NODE_BINS="$BINS" timeout 900 node "$SP/S4/win-browser.mjs" >> "$LOG" 2>&1; ec=$?
echo "# exit=$ec end=$(date -Is)" >> "$LOG"
node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$LOG" > "$LOG.pathcheck" 2>&1; pc=$?
echo "browser-$kind exit=$ec pathcheck=$pc $(grep -c 'PASS ' "$LOG") PASS $(grep -c 'FAIL ' "$LOG") FAIL guards=$(grep -c '\[iso-guard\] tmpdir=' "$LOG") isoguardfail=$(grep -c 'ISOLATION GUARD' "$LOG") $(tail -1 "$LOG.pathcheck")"
