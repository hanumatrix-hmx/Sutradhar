#!/usr/bin/env bash
# FR2-12 audit-6: re-run the audit-1..5 attack surface (probes copied from audit-5's rerun-a*/ and
# audit-5/, outputs retargeted to audit-6/ via each script's own `here` / lib5.mjs guard).
# Usage: bash run-reruns.sh runtime|cli|a45
A6="$(cd "$(dirname "$0")" && pwd)"
case "$A6" in */evidence/FR2-12/audit-6) ;; *) echo "wrong dir $A6"; exit 1;; esac
cd "$A6" || exit 1
r() { # label timeoutSec dir cmd...
  local label=$1 to=$2 dir=$3; shift 3
  echo "=== $label start $(date +%T)"
  ( cd "$A6/$dir" && timeout "$to" node "$@" > "$A6/$dir/run-$label.log" 2>&1 ); echo "=== $label exit $? $(date +%T)"
}
if [ "$1" = runtime ]; then
  r a3-runtime-all 1800 rerun-a3 probe-runtime.mjs all 10
  r a3-runtime-heavy 900 rerun-a3 probe-runtime.mjs heavy 3
  r a3-regress-vitals 600 rerun-a3 probe-regress-concurrent-vitals.mjs
  r a3-real-docstatus 900 rerun-a3 probe-real-docstatus.mjs 3
  r a2-gap262-all 1300 rerun-a2 probe-gap262-runtime.mjs all
  r a2-regress-vitals 600 rerun-a2 probe-regress-concurrent-vitals.mjs
  r a2-gap263-ajv 120 rerun-a2 gap263-ajv.mjs
  r a1-runtime 900 rerun-a1 probe-runtime.mjs
  r a1-sdk-schema 600 rerun-a1 probe-sdk-schema.mjs
fi
if [ "$1" = cli ]; then
  for g in sweep fine shapes concurrent snap own404; do r a3-cli-$g 1500 rerun-a3 probe-cli.mjs $g; done
  r a2-cli-all 1500 rerun-a2 probe-cli.mjs all
  r a2-mcp-sdk-dialogs 900 rerun-a2 probe-mcp-sdk-dialogs.mjs
  r a1-cli 1200 rerun-a1 probe-cli.mjs
  r a1-l12-repeat 1200 rerun-a1 probe-l12-repeat.mjs 20
fi
if [ "$1" = a45 ]; then
  r a5-tablife 1800 . probe-tablife.mjs
  r a5-gap278 1500 . probe-gap278.mjs
  r a5-273x 1800 . probe-273x.mjs
  r a5-a51-mcp 1200 . probe-a51-mcp.mjs
  r a5-hang-fresh 2400 . probe-hang-fresh.mjs
fi
echo "=== DONE $1"
