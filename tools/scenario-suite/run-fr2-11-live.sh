#!/usr/bin/env bash
# FR2-11 live driver: one FULL pass of verify-fr2-11-history.mjs, split into 13 processes so each stays far below the 20-minute
# limit (the CLI cases alone take ~30 minutes in one process: the main cases ~7, the privacy matrix ~10, FIX2 ~6, PROP ~3). Usage: tools/scenario-suite/run-fr2-11-live.sh <evidence-root> [per-process-timeout-seconds]
# Every part writes to <evidence-root>/<part>/ (live-summary.json, live-<surface>.jsonl, console.log). Exit code: 0 only when every part passed.
# Before each part it checks free space on the evidence drive (stops under 5 GB) and afterwards lists the sutradhar-cli-* profile dirs
# that appeared in the OS temp dir (GAP-315); it never deletes anything itself.
set -u
OUT="${1:?evidence root}"
LIMIT="${2:-1150}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMPD="$(node -e "console.log(require('os').tmpdir())")"
mkdir -p "$OUT"
rc=0
run_part() {
  local name="$1"; shift
  local free_kb
  free_kb=$(df -k "$OUT" | awk 'NR==2{print $4}')
  if [ "${free_kb:-0}" -lt 5242880 ]; then echo "STOP: under 5 GB free before part $name"; rc=2; return; fi
  mkdir -p "$OUT/$name"
  ls -d "$TMPD"/sutradhar-cli-* 2>/dev/null | sort > "$OUT/$name/cli-dirs-before.txt"
  SUTRADHAR_FR2_11_EVIDENCE_DIR="$OUT/$name" timeout "$LIMIT" node "$HERE/verify-fr2-11-history.mjs" "$@" > "$OUT/$name/console.log" 2>&1
  local code=$?
  ls -d "$TMPD"/sutradhar-cli-* 2>/dev/null | sort > "$OUT/$name/cli-dirs-after.txt"
  comm -13 "$OUT/$name/cli-dirs-before.txt" "$OUT/$name/cli-dirs-after.txt" > "$OUT/$name/cli-dirs-new.txt"
  echo "part $name exit $code: $(grep -E '^\[fr2-11\] [0-9]+/[0-9]+ cases' "$OUT/$name/console.log" | head -1) new cli dirs: $(wc -l < "$OUT/$name/cli-dirs-new.txt")"
  [ "$code" -ne 0 ] && rc=1
}
run_part mcp --surface=mcp
run_part sdk --surface=sdk
run_part cli-main --surface=cli --skip=PM,FIX2,PROP,GLUE
run_part cli-pm --surface=cli --only=PM
run_part cli-fix2 --surface=cli --only=FIX2
run_part cli-prop --surface=cli --only=PROP
run_part cli-glue --surface=cli --only=GLUE
run_part bundle-mcp --surface=bundle-mcp
run_part bundle-cli-main --surface=bundle-cli --skip=PM,FIX2,PROP,GLUE
run_part bundle-cli-pm --surface=bundle-cli --only=PM
run_part bundle-cli-fix2 --surface=bundle-cli --only=FIX2
run_part bundle-cli-prop --surface=bundle-cli --only=PROP
run_part bundle-cli-glue --surface=bundle-cli --only=GLUE
echo "pass finished rc=$rc"
exit $rc
