#!/bin/bash
# S11 gate live runner (from the S8 runner): live.sh <Sgt|Ngt> <label> <harness.mjs> [VAR=value ...]
# Creates the ISO fail-closed (0.2 item 1), runs the harness UNMODIFIED under the preamble, checks for leftover processes
# with the ISO path in their command line (ownership-checked PID kill only), then guarded delete (0.2 item 8).
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; R="$SP/r062"; WT="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"; EV="$WT/.ai/loop/release-0.6.2/evidence"
export MSYS_NO_PATHCONV=1
NAME=$1; LABEL=$2; H=$3; shift 3
case "$NAME" in Sgt|Ngt) ;; *) echo "bad ISO name"; exit 2;; esac
ISO="$SP/$NAME"; OUTD="$EV/S11/live"; mkdir -p "$OUTD"
[ ! -e "$ISO" ] || { echo "ISO exists: $ISO (STOP)"; exit 1; }; mkdir "$ISO" && : > "$ISO/.r062"
echo "[live.sh] $LABEL start $(date -Is) harness=$H sha256=$(sha256sum "$H" | cut -c1-64)" | tee "$OUTD/$LABEL.meta"
( cd "$ISO" && env TEMP="$ISO" TMP="$ISO" TMPDIR="$ISO" NODE_OPTIONS="--import=file:///$SP/iso/assert-tmp.mjs" SUTRADHAR_CLI_DEBUG_CLEANUP=1 SP="$SP" WT="$WT" OUT="$OUTD/$LABEL.json" LOGDIR="$OUTD/logs-$LABEL" "$@" timeout 1500 node "$H" > "$OUTD/$LABEL.stdout.log" 2> "$OUTD/$LABEL.stderr.log" ); RC=$?
echo "[live.sh] $LABEL rc=$RC end $(date -Is)" | tee -a "$OUTD/$LABEL.meta"
sleep 2
LEFT=$(bash "$R/S8/leftover.sh" "$NAME")
echo "[live.sh] leftover PIDs with scratchpad/$NAME in command line: [${LEFT}]" | tee -a "$OUTD/$LABEL.meta"
for p in $LEFT; do taskkill /PID $p /T /F >/dev/null 2>&1 && echo "[live.sh] killed owned PID $p" | tee -a "$OUTD/$LABEL.meta"; done
grep -c "\[iso-guard\]" "$OUTD/$LABEL.stderr.log" | sed 's/^/[live.sh] iso-guard lines: /' | tee -a "$OUTD/$LABEL.meta"
grep -c "ISOLATION GUARD" "$OUTD/$LABEL.stderr.log" | sed 's/^/[live.sh] ISOLATION GUARD lines: /' | tee -a "$OUTD/$LABEL.meta"
set -u; [ -n "${SP:-}" ] && [ -d "$SP" ] && [ -f "$ISO/.r062" ] || { echo "REFUSE: SP unset or no .r062 marker"; exit 1; }
case "$ISO" in "$SP"/r062/S[0-9]*-tmp|"$SP"/r062/S[0-9]*-tmp-*|"$SP"/[ANSW][0-9a-z]t) ;; *) echo "REFUSE rm $ISO"; exit 1 ;; esac
for try in 1 2 3 4 5 6 7 8 9 10 11 12; do find "$ISO" -mindepth 1 -maxdepth 1 ! -name .r062 -exec rm -rf -- {} + 2>/dev/null; [ -z "$(find "$ISO" -mindepth 1 -maxdepth 1 ! -name .r062 -print -quit)" ] && break; echo "[live.sh] delete retry $try (holder still open)"; sleep 10; done
if [ -z "$(find "$ISO" -mindepth 1 -maxdepth 1 ! -name .r062 -print -quit)" ]; then rm -f -- "$ISO/.r062" && rmdir -- "$ISO"; fi
[ ! -e "$ISO" ] || { echo "ISO NOT REMOVED (marker kept, retry after the holder exits): $ISO"; ls -la "$ISO"; exit 1; }
echo "[live.sh] ISO deleted" | tee -a "$OUTD/$LABEL.meta"
grep -E "^(PASS|FAIL)" "$OUTD/$LABEL.stderr.log" | cut -c1-5 | sort | uniq -c
grep -E "^FAIL" "$OUTD/$LABEL.stderr.log" | cut -c1-400
tail -1 "$OUTD/$LABEL.stderr.log"
exit $RC
