#!/usr/bin/env bash
# AUDIT-4: re-run audit-1/2/3 probes UNMODIFIED from byte-identical copies under junction tree Z (packages/ and node_modules/ are
# junctions to the worktree build). Outputs go to Z (scratch) and logs to $1.
Z=E:/AI-Cache/tmp/fr211-a4z; E=$Z/.ai/loop/field-report-2/evidence/FR2-11; OUT="$1"
MH=packages/mcp-server/dist/cli.js; CH=packages/cli/dist/cli.js; MB=packages/sutradhar/dist/mcp-cli.js; CB=packages/sutradhar/dist/cli-bin.js
r() { local name="$1" dir="$2"; shift 2; echo "[$(date -Is)] start $name"; ( cd "$E/$dir" && timeout 1100 node "$@" > "$OUT/$name.log" 2>&1; echo "exit=$?" >> "$OUT/$name.log" ); }
r a2-attack-gen audit-2 attack-gen.mjs "$Z" "$OUT/a2-attack-gen.json"
r a3-attack3 audit-3 attack3.mjs "$Z" "$OUT/a3-attack3.json"
r a3-glue-unit audit-3 glue-unit.mjs
r a1-mcp-head audit-1 privacy-mcp.mjs "$Z/$MH" head
r a1-mcp-bundle audit-1 privacy-mcp.mjs "$Z/$MB" bundle
r a1-cli-head audit-1 privacy-cli.mjs "$Z/$CH" head
r a1-cli-bundle audit-1 privacy-cli.mjs "$Z/$CB" bundle
r a1-sdk audit-1 privacy-sdk.mjs
r a1-paren audit-1 privacy-paren.mjs
r a1-typebylabel audit-1 typebylabel.mjs
r a2-mcp-head audit-2 privacy-mcp.mjs "$Z/$MH" head
r a2-cli-head audit-2 privacy-cli.mjs "$Z/$CH" head
r a2-sdk audit-2 privacy-sdk.mjs
r a2-live-attack-head audit-2 live-attack.mjs "$Z/$MH" "$Z/$CH" head
r a2-live-attack-bundle audit-2 live-attack.mjs "$Z/$MB" "$Z/$CB" bundle
r a2-live-sdk audit-2 live-sdk.mjs
r a3-glue-live-head audit-3 glue-live.mjs "$Z/$MH" "$Z/$CH" head
r a3-glue-live-bundle audit-3 glue-live.mjs "$Z/$MB" "$Z/$CB" bundle
r a3-glue-sdk audit-3 glue-sdk.mjs
r a3-live3-head audit-3 live3.mjs "$Z/$MH" "$Z/$CH" head
r a3-live3-bundle audit-3 live3.mjs "$Z/$MB" "$Z/$CB" bundle
r a3-sdk3 audit-3 sdk3.mjs
echo "[$(date -Is)] ALL DONE"
