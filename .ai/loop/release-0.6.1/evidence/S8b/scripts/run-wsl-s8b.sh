#!/bin/sh
# usage: run-wsl-s8b.sh <probe...>; self-contained wsl.exe call per probe (A.6 P1): mktemp, copy (probes verbatim from
# evidence, module = HEAD bundle), run, guarded rm of its own /tmp/tmp.* dir.
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.1/evidence"; cd "$WT" || exit 1
MM=/mnt/e/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad/S8b/mod
ME=/mnt/e/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/.ai/loop/release-0.6.1/evidence
for probe in "$@"; do
  LOG="$EV/S8b/wsl/$probe.log"; extra=""; [ "$probe" = wsl-port ] && extra="--test"
  INNER="D=\$(mktemp -d) && cp $MM/temp-profile.mjs $ME/S4/probes/common.mjs $ME/S4/probes/wsl/*.mjs $ME/S6e/probes/wsl-a7b.mjs \"\$D\"/ && cd \"\$D\" && sha256sum temp-profile.mjs $probe.mjs && R=\$(mktemp -d -p \"\$PWD\") && echo PROBE_ROOT=\$R && node -v && TMPDIR=\"\$R\" PROBE_ROOT=\"\$R\" TP_MODULE=\"\$PWD/temp-profile.mjs\" timeout 600 node $extra $probe.mjs 2>&1; echo \"# exit=\$?\"; cd /; case \"\$D\" in /tmp/tmp.*) rm -rf -- \"\$D\" && echo \"# removed own D=\$D\";; *) echo REFUSE;; esac"
  echo "# cmd: timeout 700 wsl.exe -e sh -c '$INNER' ; start=$(date -Is)" > "$LOG"
  MSYS_NO_PATHCONV=1 timeout 700 wsl.exe -e sh -c "$INNER" >> "$LOG" 2>&1
  echo "# end=$(date -Is)" >> "$LOG"
  ROOTW=$(grep -m1 '^PROBE_ROOT=' "$LOG" | cut -d= -f2 | tr -d '\r')
  MSYS_NO_PATHCONV=1 node "$SP/iso/check-cleanup-paths.mjs" "$ROOTW" "$LOG" > "$LOG.pathcheck" 2>&1; pc=$?
  echo "$probe $(grep '^# exit' "$LOG" | tr -d '\r') pathcheck=$pc root=$ROOTW $(grep -c '^PASS' "$LOG") PASS $(grep -c '^FAIL' "$LOG") FAIL wslguard=$(grep -c '\[wsl-guard\] root=/tmp/' "$LOG") mnt-cleanup-paths=$(grep '\[cleanup\]' "$LOG" | grep -c '/mnt/') $(tail -1 "$LOG.pathcheck")"
done
