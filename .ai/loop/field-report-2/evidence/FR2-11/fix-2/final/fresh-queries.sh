#!/usr/bin/env bash
# FR2-11 fix-2: re-queries LIVE state after the last source commit (nothing here reuses an earlier run's output).
R="E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041"
EVD=".ai/loop/field-report-2/evidence/FR2-11"
cd "$R" || exit 1
echo "## 1. worktree, branch, HEAD"
git rev-parse --show-toplevel; git branch --show-current; git rev-parse --short HEAD
echo "commits since 719b4fe: $(git rev-list --count 719b4fe..HEAD)"
echo
echo "## 2. tracked changes under packages/ and tools/ vs HEAD (must be empty)"
git status --short -- packages tools | grep -v '^??' || echo "(none)"
echo
echo "## 3. the four redaction sources are byte-equal (CRLF-normalised) to their HEAD blobs"
for f in packages/browser/src/session/action-history.ts packages/cli/src/history-file.ts packages/mcp-server/src/tools.ts packages/cli/src/cli.ts; do
  if diff -q <(git show "HEAD:$f" | tr -d '\r') <(tr -d '\r' < "$f") > /dev/null; then echo "IDENTICAL $f"; else echo "DIFFERENT $f"; fi
done
echo
echo "## 4. dist tree hash NOW vs the hash taken right after the final build (no rebuild between the live passes and now)"
now=$(find packages -path '*/dist/*' -type f -not -path '*/node_modules/*' | sort | xargs sha256sum | sha256sum | cut -c1-64)
before=$(cut -c1-64 "$EVD/fix-2/final/dist-hash-final-2.txt")
echo "now    $now"; echo "before $before"; [ "$now" = "$before" ] && echo "SAME" || echo "DIFFERENT"
echo
echo "## 5. the shipped bundles carry the new rule and the new text, and none of the old shape machinery"
for f in packages/sutradhar/dist/index.js packages/sutradhar/dist/cli-bin.js packages/sutradhar/dist/mcp-cli.js; do
  echo "$f: decodeDelimiters=$(grep -c 'decodeDelimiters' $f) BARE_ID=$(grep -c 'BARE_ID' $f) old(findUrlMarker|SCHEMELESS_HOST|QUERY_LIKE)=$(grep -c 'findUrlMarker\|SCHEMELESS_HOST\|QUERY_LIKE' $f) newText=$(grep -c 'redacted by CHARACTERS, not by recognising URLs' $f) oldClaim=$(grep -c 'URL-looking token' $f)"
done
echo
echo "## 6. the built CLI help and the built tool description (not the source) state the rule"
node packages/cli/dist/cli.js --help | grep -c "redacted by CHARACTERS, not by recognising URLs"
node -e "import('file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/mcp-server/dist/tools.js').then(()=>console.log('tools.js loads'))" 2>&1 | head -1
grep -c "redacted by CHARACTERS, not by recognising URLs" packages/mcp-server/dist/tools.js
echo
echo "## 7. the audit copies are still byte-identical to the originals"
(cd "$EVD/audit-reruns-fix-2" && sha256sum -c sha-originals.txt | grep -vc ': OK')
echo
echo "## 8. the built functions on the audit-2 shapes (live call, built dist)"
node -e "
import('file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/browser/dist/index.js').then((B) => {
  const BS = String.fromCharCode(92);
  const cases = ['committed at about:blank#S1', 'net::ERR_ABORTED at com.example.app:/cb#access_token=S2', 'intranet:8080/p#S3', 'https://x.test/my dir#S4', 'https://x.test/cb?q=ab S5', 'C:' + BS + 'Users' + BS + 'S6' + BS + 'f.txt', BS + BS + 'srv' + BS + 'share' + BS + 'S7' + BS + 'f.txt', 'C:/Users/S8/f.txt', '#S9', 'a=S10', 'user:S11@host/', 'http://h.test/p%23S12'];
  for (const c of cases) console.log(JSON.stringify(c).padEnd(70), '=>', JSON.stringify(B.redactHistoryText(c)));
});"
echo
echo "## 9. chrome processes referencing this run's scratch dirs, and sutradhar-cli-* dirs now"
powershell -NoProfile -File E:/AI-Cache/tmp/procs.ps1 -pattern "fr2-11-|verify-fr2-11" | wc -l
ls -d E:/AI-Cache/tmp/sutradhar-cli-* 2>/dev/null
