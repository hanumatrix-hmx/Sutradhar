#!/bin/sh
# usage: STEP=S6d MODREL=S6d/mod LABEL=head sh run-wsl-s6x.sh <probe...>
# Self-contained WSL call per probe (A.6 P1): mktemp, copy the compiled module + the UNMODIFIED S4 probes straight from the
# evidence dir, run under the WSL guard, guarded rm of its own /tmp/tmp.* dir, all in ONE wsl.exe call. Path check with MSYS_NO_PATHCONV=1 (P2).
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT" || exit 1
SPW=/mnt/e/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad
PRW=/mnt/e/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/.ai/loop/release-0.6.1/evidence/S4/probes
EXTRAW="${EXTRAW:-$PRW/wsl}"; STEP="${STEP:?}"; MODREL="${MODREL:?}"; LABEL="${LABEL:-head}"; mkdir -p "$EV/$STEP/wsl"
for probe in "$@"; do
  PEXTRA=""; [ "$probe" = wsl-port ] && PEXTRA="--test"
  LOG="$EV/$STEP/wsl/$probe-$LABEL.log"
  INNER="D=\$(mktemp -d) && cp $SPW/$MODREL/temp-profile.mjs $PRW/common.mjs $PRW/wsl/*.mjs $EXTRAW/*.mjs \"\$D\"/ && cd \"\$D\" && sha256sum temp-profile.mjs && R=\$(mktemp -d -p \"\$PWD\") && echo PROBE_ROOT=\$R && node -v && TMPDIR=\"\$R\" PROBE_ROOT=\"\$R\" TP_MODULE=\"\$PWD/temp-profile.mjs\" timeout 240 node $PEXTRA $probe.mjs 2>&1; echo \"# exit=\$?\"; cd /; case \"\$D\" in /tmp/tmp.*) rm -rf -- \"\$D\" && echo \"# removed own D=\$D\";; *) echo REFUSE;; esac"
  echo "# cmd: timeout 300 wsl.exe -e sh -c '$INNER' ; start=$(date -Is)" > "$LOG"
  timeout 300 wsl.exe -e sh -c "$INNER" >> "$LOG" 2>&1
  echo "# end=$(date -Is)" >> "$LOG"
  ROOTW=$(grep -m1 '^PROBE_ROOT=' "$LOG" | cut -d= -f2 | tr -d '\r')
  MSYS_NO_PATHCONV=1 node "$SP/iso/check-cleanup-paths.mjs" "$ROOTW" "$LOG" > "$LOG.pathcheck" 2>&1; pc=$?
  echo "$probe[$LABEL] $(grep '^# exit' "$LOG") pathcheck=$pc root=$ROOTW $(grep -c '^PASS' "$LOG") PASS $(grep -c '^FAIL' "$LOG") FAIL wslguard=$(grep -c '\[wsl-guard\] root=/tmp/' "$LOG") mnt-cleanup-paths=$(grep '\[cleanup\]' "$LOG" | grep -c '/mnt/') $(tail -1 "$LOG.pathcheck") mod=$(grep -m1 'temp-profile.mjs' "$LOG" | grep -v cmd | cut -c1-12)"
done
