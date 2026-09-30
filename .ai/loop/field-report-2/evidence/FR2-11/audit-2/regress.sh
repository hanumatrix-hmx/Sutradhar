#!/usr/bin/env bash
# AUDIT-2 regression A/B: HEAD worktree vs master scratch tree (fdae749 content), each suite run CONCURRENTLY on both
# builds so both see the same load. Evidence dirs on C: (E: is nearly full); logs copied into audit-2/regress.
HEAD_ROOT="$1"; MASTER_ROOT="$2"; OUT="$3"; EV="$4"
mkdir -p "$OUT" "$EV"
pair() { # name script envvar extra-args...
  local name="$1" script="$2" envvar="$3"; shift 3
  echo "[$(date -Is)] start $name"
  ( cd "$HEAD_ROOT" && env "$envvar=$EV/head-$name" timeout 1150 node "tools/scenario-suite/$script" "$@" > "$OUT/head-$name.log" 2>&1; echo "exit=$?" >> "$OUT/head-$name.log" ) &
  local p1=$!
  ( cd "$MASTER_ROOT" && env "$envvar=$EV/master-$name" timeout 1150 node "tools/scenario-suite/$script" "$@" > "$OUT/master-$name.log" 2>&1; echo "exit=$?" >> "$OUT/master-$name.log" ) &
  local p2=$!
  echo "$(date -Is) $p1 subshell head-$name" >> "$OUT/pids.log"; echo "$(date -Is) $p2 subshell master-$name" >> "$OUT/pids.log"
  wait $p1 $p2
  echo "[$(date -Is)] end $name"
}
pair fr208 verify-fr2-08-conditions.mjs SUTRADHAR_FR2_08_EVIDENCE_DIR
pair fr207 verify-fr2-07-verification.mjs SUTRADHAR_FR2_07_EVIDENCE_DIR
pair fr204 verify-fr2-04-dialogs.mjs SUTRADHAR_FR2_04_EVIDENCE_DIR
pair cli run-cli.mjs SCENARIO_OUTPUT_PATH
echo "[$(date -Is)] ALL DONE"
