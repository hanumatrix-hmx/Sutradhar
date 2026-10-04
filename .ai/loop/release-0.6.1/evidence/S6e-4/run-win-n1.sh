#!/bin/sh
# usage: run-win-s6a.sh <probe-basename> <module.mjs> <label> [runtimes...]
# Same shape as the S4 probes/run-win.sh (isolation preamble per runtime), but the probe is run UNMODIFIED from
# evidence/S4/probes and TP_MODULE is a parameter. Real-TEMP sutradhar-cli-* snapshot (read-only) around each run.
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT" || exit 1
probe="$1"; mod="$2"; label="$3"; shift 3; rts="${*:-v25 v18 v20 v22}"
PROBES="$EV/S6e-4/probes"; OUT="$EV/${STEP:-S6a}/win"; mkdir -p "$OUT" "$EV/${STEP:-S6a}/snapshots"
REAL_TEMP="E:/AI-Cache/tmp"
for rt in $rts; do
  case "$rt" in
    v25) NB="$(command -v node)";;
    v18) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/83786caec519d9fd/node_modules/node/bin/node.exe";;
    v20) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/ebaba8b9e55fd0a9/node_modules/node/bin/node.exe";;
    v22) NB="C:/Users/Varad M/AppData/Local/npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe";;
  esac
  ISO="$SP/${STEP:-S6a}-tmp-$label-$rt"; mkdir -p "$ISO"; LOG="$OUT/$probe-$label-$rt.log"
  SNAPB="$EV/${STEP:-S6a}/snapshots/$probe-$label-$rt.before.txt"; SNAPA="$EV/${STEP:-S6a}/snapshots/$probe-$label-$rt.after.txt"
  ls "$REAL_TEMP" | grep '^sutradhar-cli-' | sort > "$SNAPB"
  echo "# cmd: TEMP=ISO TMP=ISO TMPDIR=ISO NODE_OPTIONS=--import=file:///\$SP/iso/assert-tmp.mjs SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE=$mod timeout 600 \"$NB\" \$EV/S4/probes/$probe.mjs ; ISO=$ISO ; module-sha=$(sha256sum "$mod" | cut -c1-64) ; start=$(date -Is)" > "$LOG"
  TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 TP_MODULE="$mod" PROBE_NODE="$NB" timeout 600 "$NB" "$PROBES/$probe.mjs" >> "$LOG" 2>&1
  ec=$?; echo "# exit=$ec end=$(date -Is)" >> "$LOG"
  ls "$REAL_TEMP" | grep '^sutradhar-cli-' | sort > "$SNAPA"
  node "$SP/iso/check-cleanup-paths.mjs" "$ISO" "$LOG" > "$LOG.pathcheck" 2>&1; pc=$?
  echo "$probe $label $rt exit=$ec pathcheck=$pc $(grep -c '^PASS' "$LOG") PASS $(grep -c '^FAIL' "$LOG") FAIL guard=$(grep -c '\[iso-guard\] tmpdir=' "$LOG") isoguardfail=$(grep -c 'ISOLATION GUARD' "$LOG") realtemp-before=$(wc -l < "$SNAPB") after=$(wc -l < "$SNAPA") realtemp-same=$(cmp -s "$SNAPB" "$SNAPA" && echo yes || echo NO) $(tail -1 "$LOG.pathcheck")"
done
