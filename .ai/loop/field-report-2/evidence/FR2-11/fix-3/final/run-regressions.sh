#!/usr/bin/env bash
# FR2-11 fix-3: regression suites on the final build, run SEQUENTIALLY (never beside a live pass, so no load artefacts): FR2-08 (478), FR2-07 (488),
# FR2-04 and the CLI scenario suite. Waits (hard cap 40 min) until the live pass whose runner log is $1 has finished. Each suite has a 1150 s cap
# and is preceded by a disk check (stops under 5 GB). Evidence goes under <fix-3>/regression/. Never kills anything by name.
set -u
ROOT="$(cd "$(dirname "$0")/../../../../../../.." && pwd)"
F3="$ROOT/.ai/loop/field-report-2/evidence/FR2-11/fix-3"
OUT="$F3/regression"
mkdir -p "$OUT"
WAIT_LOG="${1:-}"
if [ -n "$WAIT_LOG" ]; then
  for i in $(seq 1 240); do grep -q "pass finished" "$WAIT_LOG" 2>/dev/null && break; sleep 10; done
fi
cd "$ROOT"
TMPD="$(node -e "console.log(require('os').tmpdir())")"
run() { # name envvar script args...
  local name="$1" envvar="$2" script="$3"; shift 3
  local free_kb; free_kb=$(df -k "$OUT" | awk 'NR==2{print $4}')
  if [ "${free_kb:-0}" -lt 5242880 ]; then echo "STOP: under 5 GB free before $name"; exit 2; fi
  ls -d "$TMPD"/sutradhar-cli-* 2>/dev/null | sort > "$OUT/$name-cli-before.txt"
  echo "[$(date -Is)] start $name"
  env "$envvar=$OUT/$name" timeout 1150 node "tools/scenario-suite/$script" "$@" > "$OUT/$name.log" 2>&1
  echo "exit=$?" >> "$OUT/$name.log"
  ls -d "$TMPD"/sutradhar-cli-* 2>/dev/null | sort > "$OUT/$name-cli-after.txt"
  echo "[$(date -Is)] end $name: $(tail -1 "$OUT/$name.log")"
}
run fr2-08 SUTRADHAR_FR2_08_EVIDENCE_DIR verify-fr2-08-conditions.mjs
run fr2-07 SUTRADHAR_FR2_07_EVIDENCE_DIR verify-fr2-07-verification.mjs
run fr2-04 SUTRADHAR_FR2_04_EVIDENCE_DIR verify-fr2-04-dialogs.mjs
run cli-suite SCENARIO_OUTPUT_PATH run-cli.mjs
echo "[$(date -Is)] REGRESSIONS DONE"
