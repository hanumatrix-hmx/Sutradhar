#!/usr/bin/env bash
# FR2-11 fix-3: FRESH re-queries of live state after the last source commit (nothing here reuses an earlier output):
#  1 git state, 2 sources vs their HEAD blobs, 3 dist hash vs the hash taken right after the final forced build,
#  4 bundle markers, 5 the BUILT help text / tool description, 6 the BUILT functions on the audit-3 shapes (readable part kept, secret gone),
#  7 NEGATIVE CONTROL: the same independent fuzz against the fix-2 source (549a099) must report leaks, 8 chrome / temp dirs.
set -u
ROOT="$(cd "$(dirname "$0")/../../../../../../.." && pwd)"
cd "$ROOT"
F=.ai/loop/field-report-2/evidence/FR2-11/fix-3/final
echo "== 1 git"; git rev-parse --show-toplevel; git branch --show-current; git rev-parse --short HEAD; git status --short | grep -v '^??' | head -5; echo "(tracked changes above, none expected)"
echo "== 2 sources vs HEAD blobs (normalised line endings)"
for f in packages/browser/src/session/action-history.ts packages/cli/src/history-file.ts packages/cli/src/cli.ts packages/mcp-server/src/tools.ts; do
  a=$(git show HEAD:$f | tr -d '\r' | sha256sum | cut -c1-16); b=$(tr -d '\r' < $f | sha256sum | cut -c1-16); [ "$a" = "$b" ] && echo "same  $f $a" || echo "DIFF  $f $a $b"
done
echo "== 3 dist hash now vs after the final forced build"
now=$(find packages/*/dist apps/server/dist -type f 2>/dev/null | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)
was=$(cut -d' ' -f1 $F/dist-hash-final.txt)
[ "$now" = "$was" ] && echo "dist unchanged $now" || echo "DIST CHANGED $was -> $now"
echo "== 4 bundle markers (new rule present, fix-1 identifiers absent)"
for f in packages/sutradhar/dist/index.js packages/sutradhar/dist/cli-bin.js packages/sutradhar/dist/mcp-cli.js; do echo "$f SUB_DELIM=$(grep -c SUB_DELIM $f) IPV6_HOST=$(grep -c IPV6_HOST $f) TRUE_WS=$(grep -c TRUE_WS $f) QUERY_LIKE=$(grep -c QUERY_LIKE $f)"; done
echo "== 5 built help text and tool description"
node packages/cli/dist/cli.js --help 2>&1 | grep -E "EVERY @|bare #id token|only a scheme:// URL|IPv6 host" | sed 's/^ *//'
grep -o "the characters before EVERY @ are removed back to the previous /\|a bare #id token with nothing before it\|except a scheme:// URL, which keeps origin + path up to its own end\|an IPv6 host \[::1\] stays whole" packages/mcp-server/dist/tools.js | sort | uniq -c
echo "== 6 built functions on the audit-3 shapes"
node -e '
import("./packages/browser/dist/index.js").then((B) => {
  const BS = String.fromCharCode(92);
  const rows = [
    ["[\x27https://h.test/a\x27,\x27https://u:PASS@h2.test/p\x27].length", ["PASS"], ["https://h.test/a", "h2.test/p"]],
    ["{api:\x27https://h.test/x\x27,db:\x27postgres://admin:PASS@db:5432/app\x27}", ["PASS"], ["db:5432/app"]],
    ["[\x27https://h.test/a\x27,\x27C:/Users/NAME/doc.txt\x27]", ["NAME"], ["doc.txt"]],
    ["open \x27E:/x/Acme Secret Project/s.png\x27", [], []],
    ["https://h.test/p" + String.fromCharCode(0x202a) + "/home/NAME/f.txt", ["NAME"], ["f.txt"]],
    ["http://[::1]:5000/p?token=PASS", ["PASS"], ["http://[::1]:5000/p"]],
    ["postgres://admin:p(a)ss@db/app", ["p(a)"], ["db/app"]],
    ["https://u:S" + BS + String.fromCharCode(34) + "S2@h2.test/p", ["S2"], ["h2.test/p"]],
  ];
  for (const [t, secrets, keep] of rows) {
    const out = B.redactHistoryText(t);
    const ok = secrets.every((s) => !out.includes(s)) && keep.every((k) => out.includes(k)) && B.redactHistoryText(out) === out;
    console.log((ok ? "OK   " : "BAD  ") + JSON.stringify(t) + " => " + JSON.stringify(out));
  }
});'
echo "== 7 negative control: the fix-2 source (549a099) against the same independent fuzz"
mkdir -p /tmp/fz3-neg 2>/dev/null; NEG="${TMPDIR:-/tmp}/fz3-neg"; mkdir -p "$NEG/src/session"
git show 549a099:packages/browser/src/session/action-history.ts > "$NEG/src/session/action-history.ts"
node_modules/.bin/esbuild "$NEG/src/session/action-history.ts" --bundle --format=esm --platform=node --outfile="$NEG/neg.mjs" --log-level=error
node tools/scenario-suite/fuzz-fr2-11-fix3.mjs "$NEG/neg.mjs" 1 20000 | tr -d '\n' | sed 's/  */ /g' | grep -o '"count": [0-9]*, "leaks": [0-9]*, "idempotencyFailures": [0-9]*'
echo "== 8 processes / temp dirs"
TMPD="$(node -e "console.log(require('os').tmpdir())")"
echo "sutradhar-cli-* dirs: $(ls -d "$TMPD"/sutradhar-cli-* 2>/dev/null | wc -l) (the one pre-existing dir belongs to another actor)"
df -h /e | tail -1
