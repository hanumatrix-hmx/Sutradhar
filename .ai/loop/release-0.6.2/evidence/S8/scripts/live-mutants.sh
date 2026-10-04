#!/bin/bash
SP="E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad"; R="$SP/r062"
EV="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/.ai/loop/release-0.6.2/evidence"; D="$R/S8/dc/dist"; MUT="$D/cli-bin.mutant.js"
export MSYS_NO_PATHCONV=1
one() { set=$1; id=$2; label=$3; harness=$4; shift 4
  echo "=== mutant $set/$id ($label) $(date +%T)"
  [ ! -e "$SP/A8t" ] || { echo "A8t still present: STOP batch"; exit 1; }
  rm -f "$EV/S8/live/$label.meta" "$EV/S8/live/$label.stderr.log"
  node "$EV/S8/mkmut.mjs" "$D" $set $id || { echo "VERDICT $set/$id MUTANT-BUILD-FAILED"; return; }
  bash "$R/S8/live.sh" A8t "$label" "$harness" CLI="$MUT" "$@" > /dev/null; rc=$?
  ran=$(grep -c "rc=" "$EV/S8/live/$label.meta" 2>/dev/null); fails=$(grep -c "^FAIL" "$EV/S8/live/$label.stderr.log" 2>/dev/null)
  if [ "$rc" = 1 ] && [ "${ran:-0}" -ge 1 ] && [ "${fails:-0}" -ge 1 ]; then echo "VERDICT $set/$id KILLED (harness rc=1, FAIL lines=$fails)"; else echo "VERDICT $set/$id NOT-KILLED-OR-NOT-RUN (rc=$rc ran=$ran fails=$fails)"; fi
  grep "^FAIL" "$EV/S8/live/$label.stderr.log" 2>/dev/null | head -3 | cut -c1-220
  grep -h "leftover\|ISO deleted\|NOT REMOVED" "$EV/S8/live/$label.meta"
  rm -f "$MUT"; echo "mutant-files-left=$(ls "$D" | grep -c mutant)"
}
: one S6 a mut-S6-a "$EV/S6/live-nosession.mjs" MODE=head
one S6 e mut-S6-e "$EV/S6/live-nosession.mjs" MODE=head
one OWN o051 mut-own-051 "$EV/S6/live-nosession.mjs" MODE=head
one OWN o048 mut-own-048 "$EV/S3a/live-cli-text.mjs" MODE=head NO_MUTANTS=1
one S7 a mut-S7-a "$EV/S7/live-history.mjs" HIST_GROUPS=H1
one S7 d mut-S7-d "$EV/S7/live-history.mjs" HIST_GROUPS=H1
one S7 b mut-S7-b "$EV/S7/live-history.mjs" HIST_GROUPS=H2
one S7 e mut-S7-e "$EV/S7/live-history.mjs" HIST_GROUPS=H2
one S7 f mut-S7-f "$EV/S7/live-history.mjs" HIST_GROUPS=H2
one OWN onav mut-own-nav "$EV/S7/live-history.mjs" HIST_GROUPS=H2
one S7 c mut-S7-c "$EV/S7/live-history.mjs" HIST_GROUPS=H3
one OWN o048hint mut-own-048hint "$EV/S8/own-probes.mjs" PROBES=P3
one OWN o048hint mut-own-048hint-s3a "$EV/S3a/live-cli-text.mjs" MODE=head NO_MUTANTS=1
sha256sum "$D/cli-bin.js"
echo "=== live mutants done $(date +%T)"
