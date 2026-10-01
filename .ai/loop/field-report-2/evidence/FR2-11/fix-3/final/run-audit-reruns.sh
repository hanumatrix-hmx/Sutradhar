#!/usr/bin/env bash
# FR2-11 fix-3: re-run the audit-1, audit-2 and audit-3 probes, attack-gen.mjs and audit-3's glue-live / glue-sdk / glue-unit UNMODIFIED.
# The probes find the repo root as <their folder>/../../../../../.. so the byte-identical copies live in SIBLING folders of the originals
# (audit-reruns-fix-3-a1 / -a2 / -a3). Every copy is sha256-compared with its original first; a mismatch stops the run.
# Never edits an auditor file, never kills anything (the probes kill only the PIDs they start themselves). Sequential, 1100 s cap each.
set -u
ROOT="$(cd "$(dirname "$0")/../../../../../../.." && pwd)"
EV="$ROOT/.ai/loop/field-report-2/evidence/FR2-11"
OUT="$EV/audit-reruns-fix-3"
mkdir -p "$OUT"
EXCL='^(mutants|mut3|cli-kill|cli-kill-fine|kill3|kill3b|overhead|overhead-cli|robustness|verif-diff|probe-tools-list)\.mjs$'
: > "$OUT/sha-check.txt"
for n in 1 2 3; do
  D="$EV/audit-reruns-fix-3-a$n"; mkdir -p "$D"
  for f in "$EV/audit-$n"/*.mjs; do
    b="$(basename "$f")"
    echo "$b" | grep -Eq "$EXCL" && continue
    cp "$f" "$D/$b"
    a="$(sha256sum "$f" | cut -d' ' -f1)"; c="$(sha256sum "$D/$b" | cut -d' ' -f1)"
    if [ "$a" = "$c" ]; then echo "OK   a$n/$b $c" >> "$OUT/sha-check.txt"; else echo "DIFF a$n/$b" >> "$OUT/sha-check.txt"; echo "sha mismatch a$n/$b"; exit 3; fi
  done
done
echo "copies verified: $(grep -c '^OK' "$OUT/sha-check.txt")"
A1="$EV/audit-reruns-fix-3-a1"; A2="$EV/audit-reruns-fix-3-a2"; A3="$EV/audit-reruns-fix-3-a3"
MH=packages/mcp-server/dist/cli.js; CH=packages/cli/dist/cli.js; MB=packages/sutradhar/dist/mcp-cli.js; CB=packages/sutradhar/dist/cli-bin.js
r() { # name dir script args...
  local name="$1" dir="$2" script="$3"; shift 3
  local free_kb; free_kb=$(df -k "$OUT" | awk 'NR==2{print $4}')
  if [ "${free_kb:-0}" -lt 5242880 ]; then echo "STOP: under 5 GB free"; exit 2; fi
  echo "[$(date -Is)] start $name"
  ( cd "$dir" && timeout 1100 node "$script" "$@" > "$OUT/$name.log" 2>&1; echo "exit=$?" >> "$OUT/$name.log" )
  echo "[$(date -Is)] end $name: $(tail -1 "$OUT/$name.log")"
}
# attack-gen on head, on both bundles (shim root cut out of the bundle) and an identity negative control
r a2-attack-gen-head "$A2" attack-gen.mjs "$ROOT" "$OUT/a2-attack-gen-head.json"
for b in cli-bin mcp-cli; do  # (mcp-cli.js has no CLI code: its browser code is shimmed with the CLI code of cli-bin.js)
  node "$EV/fix-3/final/mkshim-bundle-attack-gen.cjs" "$ROOT/packages/sutradhar/dist/$b.js" "$ROOT/packages/sutradhar/dist/cli-bin.js" "$OUT/shim-$b" > "$OUT/shim-$b.log" 2>&1
  r a2-attack-gen-bundle-$b "$A2" attack-gen.mjs "$OUT/shim-$b" "$OUT/a2-attack-gen-bundle-$b.json"
done
node "$EV/fix-3/final/mkidentity-attack-gen.cjs" "$OUT/shim-identity" > "$OUT/shim-identity.log" 2>&1
r a2-attack-gen-negative-control "$A2" attack-gen.mjs "$OUT/shim-identity" "$OUT/a2-attack-gen-negative-control.json"
# audit-1
r a1-mcp-head "$A1" privacy-mcp.mjs "$ROOT/$MH" head
r a1-mcp-bundle "$A1" privacy-mcp.mjs "$ROOT/$MB" bundle
r a1-cli-head "$A1" privacy-cli.mjs "$ROOT/$CH" head
r a1-cli-bundle "$A1" privacy-cli.mjs "$ROOT/$CB" bundle
r a1-sdk "$A1" privacy-sdk.mjs
r a1-paren "$A1" privacy-paren.mjs
r a1-typebylabel "$A1" typebylabel.mjs
# audit-2
r a2-mcp-head "$A2" privacy-mcp.mjs "$ROOT/$MH" head
r a2-cli-head "$A2" privacy-cli.mjs "$ROOT/$CH" head
r a2-sdk "$A2" privacy-sdk.mjs
r a2-paren "$A2" privacy-paren.mjs
r a2-typebylabel "$A2" typebylabel.mjs
r a2-live-attack-head "$A2" live-attack.mjs "$ROOT/$MH" "$ROOT/$CH" head
r a2-live-attack-bundle "$A2" live-attack.mjs "$ROOT/$MB" "$ROOT/$CB" bundle
r a2-live-sdk "$A2" live-sdk.mjs
r a2-eviction "$A2" eviction.mjs
r a2-concurrency "$A2" concurrency.mjs
r a2-completeness "$A2" completeness.mjs
r a2-completeness2 "$A2" completeness2.mjs
# audit-3
r a3-glue-unit "$A3" glue-unit.mjs
r a3-glue-live-head "$A3" glue-live.mjs "$ROOT/$MH" "$ROOT/$CH" head
r a3-glue-live-bundle "$A3" glue-live.mjs "$ROOT/$MB" "$ROOT/$CB" bundle
r a3-glue-sdk "$A3" glue-sdk.mjs
r a3-attack3-head "$A3" attack3.mjs "$ROOT" "$OUT/a3-attack3-head.json"
r a3-live3-head "$A3" live3.mjs "$ROOT/$MH" "$ROOT/$CH" head
r a3-live3-bundle "$A3" live3.mjs "$ROOT/$MB" "$ROOT/$CB" bundle
r a3-cli3-head "$A3" cli3.mjs "$ROOT/$CH" head
r a3-sdk3 "$A3" sdk3.mjs
r a3-func3-head "$A3" func3.mjs "$ROOT/$MH" head
echo "[$(date -Is)] ALL DONE"
