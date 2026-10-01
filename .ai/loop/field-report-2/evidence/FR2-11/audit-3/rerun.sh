#!/usr/bin/env bash
# AUDIT-3: re-run the audit-1 and audit-2 probes UNMODIFIED (byte-identical copies under a junction tree Z whose
# packages/ and node_modules/ are junctions to the worktree, so repo = Z resolves to the real HEAD build).
Z=E:/AI-Cache/tmp/fr211-a3z; E=$Z/.ai/loop/field-report-2/evidence/FR2-11; OUT="$1"
MH=packages/mcp-server/dist/cli.js; CH=packages/cli/dist/cli.js; MB=packages/sutradhar/dist/mcp-cli.js; CB=packages/sutradhar/dist/cli-bin.js
r() { local name="$1" dir="$2"; shift 2; echo "[$(date -Is)] start $name"; ( cd "$E/$dir" && timeout 1100 node "$@" > "$OUT/$name.log" 2>&1; echo "exit=$?" >> "$OUT/$name.log" ); }
r a2-attack-gen audit-2 attack-gen.mjs "$Z" "$OUT/a2-attack-gen.json"
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
r a2-paren audit-2 privacy-paren.mjs
r a2-typebylabel audit-2 typebylabel.mjs
r a2-live-attack-head audit-2 live-attack.mjs "$Z/$MH" "$Z/$CH" head
r a2-live-attack-bundle audit-2 live-attack.mjs "$Z/$MB" "$Z/$CB" bundle
r a2-live-sdk audit-2 live-sdk.mjs
echo "[$(date -Is)] ALL DONE"
