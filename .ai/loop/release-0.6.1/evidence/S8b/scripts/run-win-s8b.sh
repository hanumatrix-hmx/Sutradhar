#!/bin/sh
# usage: run-win-s8b.sh <probe-dir> <probe-basename> <label> [runtimes...]
# Probe runs UNMODIFIED from <probe-dir>; TP_MODULE = HEAD-compiled $SP/S8b/mod/temp-profile.mjs. Preamble per runtime.
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT" || exit 1
PD="$1"; probe="$2"; label="$3"; shift 3; rts="${*:-v25 v18 v20 v22}"
mod="${MOD:-$SP/S8b/mod/temp-profile.mjs}"; OUT="$EV/S8b/win"; mkdir -p "$OUT" "$EV/S8b/snapshots"; REAL_TEMP="E:/AI-Cache/tmp"
for rt in $rts; do
  case "$rt" in
    v25) NB="C:/Program Files/nodejs/node.exe";;
    v18) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/83786caec519d9fd/node_modules/node/bin/node.exe";;
    v20) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/ebaba8b9e55fd0a9/node_modules/node/bin/node.exe";;
    v22) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe";;
  esac
  ISO="$SP/S8b-tmp-$label-$rt"; mkdir -p "$ISO"; LOG="$OUT/$probe-$label-$rt.log"
  SNAPB="$EV/S8b/snapshots/$probe-$label-$rt.before.txt"; SNAPA="$EV/S8b/snapshots/$probe-$label-$rt.after.txt"
  ls "$REAL_TEMP" | grep '^sutradhar-cli-' | sort > "$SNAPB"
  echo "# cmd: TEMP=ISO TMP=ISO TMPDIR=ISO NODE_OPTIONS=--import=file:///\$SP/iso/assert-tmp.mjs SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE=$mod timeout 600 \"$NB\" $PD/$probe.mjs ; ISO=$ISO ; node=$("$NB" -v) ; module-sha=$(sha256sum "$mod" | cut -c1-64) ; probe-sha=$(sha256sum "$PD/$probe.mjs" | cut -c1-64) ; start=$(date -Is)" > "$LOG"
  TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE="$mod" S4_COMMON="$EV/S4/probes/common.mjs" PROBE_NODE="$NB" timeout 600 "$NB" "$PD/$probe.mjs" >> "$LOG" 2>&1
  ec=$?; echo "# exit=$ec end=$(date -Is)" >> "$LOG"
  ls "$REAL_TEMP" | grep '^sutradhar-cli-' | sort > "$SNAPA"
  node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$LOG" > "$LOG.pathcheck" 2>&1; pc=$?
  echo "$probe $label $rt exit=$ec pathcheck=$pc $(grep -c '^PASS' "$LOG") PASS $(grep -c '^FAIL' "$LOG") FAIL guard=$(grep -c '\[iso-guard\] tmpdir=' "$LOG") isoguardfail=$(grep -c 'ISOLATION GUARD' "$LOG") realtemp-same=$(cmp -s "$SNAPB" "$SNAPA" && echo yes || echo NO) $(tail -1 "$LOG.pathcheck")"
done
