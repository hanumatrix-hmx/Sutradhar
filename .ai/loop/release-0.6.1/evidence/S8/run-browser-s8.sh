#!/bin/sh
# usage: run-browser-s8.sh <kind>; S4 win-browser.mjs + win-a4child.mjs UNMODIFIED from evidence/S4/probes, TP_MODULE = HEAD bundle.
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT" || exit 1
kind="$1"; ISO="$SP/S8b"; mkdir -p "$ISO" "$EV/S8/win"; LOG="$EV/S8/win/browser-$kind.log"; mod="${MOD:-$SP/S8/mod/temp-profile.mjs}"; [ -n "${LOGSUFFIX:-}" ] && LOG="$EV/S8/win/browser-$kind-$LOGSUFFIX.log"
BINS='{"v25":"C:/Program Files/nodejs/node.exe","v18":"C:/Users/Varad M/AppData/Local/npm-cache/_npx/83786caec519d9fd/node_modules/node/bin/node.exe","v20":"C:/Users/Varad M/AppData/Local/npm-cache/_npx/ebaba8b9e55fd0a9/node_modules/node/bin/node.exe","v22":"C:/Users/Varad M/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe"}'
ls E:/AI-Cache/tmp | grep '^sutradhar-cli-' | sort > "$LOG.rt-before"
echo "# cmd: TEMP=ISO TMP=ISO TMPDIR=ISO NODE_OPTIONS=--import=file:///\$SP/iso/assert-tmp.mjs SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE=$mod BROWSER_KIND=$kind timeout 900 node \$EV/S4/probes/win-browser.mjs; ISO=$ISO module-sha=$(sha256sum "$mod" | cut -c1-64) start=$(date -Is)" > "$LOG"
TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE="$mod" BROWSER_KIND="$kind" NODE_BINS="$BINS" timeout 900 node "$EV/S4/probes/win-browser.mjs" >> "$LOG" 2>&1; ec=$?
echo "# exit=$ec end=$(date -Is)" >> "$LOG"
ls E:/AI-Cache/tmp | grep '^sutradhar-cli-' | sort > "$LOG.rt-after"
node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$LOG" > "$LOG.pathcheck" 2>&1; pc=$?
echo "browser-$kind${LOGSUFFIX:+-$LOGSUFFIX} exit=$ec pathcheck=$pc $(grep -c 'PASS ' "$LOG") PASS $(grep -c 'FAIL ' "$LOG") FAIL guards=$(grep -c '\[iso-guard\] tmpdir=' "$LOG") isoguardfail=$(grep -c 'ISOLATION GUARD' "$LOG") realtemp-same=$(cmp -s "$LOG.rt-before" "$LOG.rt-after" && echo yes || echo NO) $(tail -1 "$LOG.pathcheck") bpid=$(grep -m1 -o 'STARTED browser pid=[0-9]*' "$LOG")"
