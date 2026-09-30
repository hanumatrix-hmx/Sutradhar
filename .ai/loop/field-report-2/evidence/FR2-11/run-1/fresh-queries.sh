#!/bin/bash
# Fresh re-queries run AFTER the last code change and the last forced build (nothing here reuses an earlier output):
# source/dist/state re-read from disk, plus a re-parse of the artifacts the final live run wrote.
cd "$1"
E=.ai/loop/field-report-2/evidence/FR2-11/run-1
echo "== 1. HEAD, branch, clean tracked tree"
git rev-parse --show-toplevel; git branch --show-current; git log --oneline -1; git status --short | grep -v '^??' | wc -l
echo "== 2. sources restored after every mutant (tracked tree has no modified src): diff vs HEAD"
git diff --stat HEAD -- packages | tail -1
echo "(empty above = identical)"
echo "== 3. the built bundle really contains the new code (grep counts in dist, built by turbo --force, 0 cached)"
grep -E "Cached:" $E/build-1-non-bundle.log $E/build-2-bundle.log
for s in getActionHistoryReport scrubVerification recordCliCommand; do printf "%-24s cli-bin=%s mcp-cli=%s index=%s\n" $s $(grep -c $s packages/sutradhar/dist/cli-bin.js) $(grep -c $s packages/sutradhar/dist/mcp-cli.js) $(grep -c $s packages/sutradhar/dist/index.js); done
echo "== 4. final live run: re-parse its summary from disk"
node -e "
const s=JSON.parse(require('fs').readFileSync('$E/live-final/live-summary.json','utf8'));
console.log(JSON.stringify({cases:s.cases,checks:s.checks,checksFailed:s.checksFailed,failed:s.failed,perSurface:s.perSurface}));
const fs=require('fs');
"
echo "== 5. the CLI history.jsonl the final run left as evidence: re-read the bytes"
f=$E/live-final/cli-L5-history.jsonl
wc -l $f
printf "canary matches in the raw bytes: SECRET=%s hunter2=%s token==%s ?n==%s\n" "$(grep -c SECRET $f)" "$(grep -c hunter2 $f)" "$(grep -c 'token=' $f)" "$(grep -c -F '?n=' $f)"
node -e "
const l=require('fs').readFileSync('$f','utf8').split('\n').filter(Boolean).map(JSON.parse);
for(const x of l) console.log(x.verb.padEnd(6), 'exit', x.exitCode, JSON.stringify(x.args), 'actions:', x.actions.map(a=>a.actionType+(a.success?'':'(FAILED)')).join(','));"
echo "== 6. MCP: the raw get_action_history responses of the final run (every one) contain no canary"
f=$E/live-final/mcp-raw-history-responses.txt
printf "responses=%s  SECRET=%s hunter2=%s token==%s ?n==%s\n" "$(grep -c '^----' $f)" "$(grep -c SECRET $f)" "$(grep -c hunter2 $f)" "$(grep -c 'token=' $f)" "$(grep -c -F '?n=' $f)"
echo "== 7. MCP L3: exact eviction (re-read the artifact)"
node -e "
const s=JSON.parse(require('fs').readFileSync('$E/live-final/live-mcp.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse).find(r=>r.case==='L3')&&'{}');" 2>/dev/null
grep '"case":"L3"' $E/live-final/live-mcp.jsonl | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s.trim());console.log(JSON.stringify({case:r.case,pass:r.pass,checks:r.checks,failed:r.failed}))})"
echo "== 8. mutation: re-read mutants.json"
node -e "
const j=JSON.parse(require('fs').readFileSync('$E/mutants.json','utf8'));
console.log(j.caught+'/'+j.total,'caught; all restored byte-identically:',j.allRestoredIdentical);
for(const r of j.results) console.log(r.id.padEnd(5), r.caught?'CAUGHT':'NOT CAUGHT', 'unit='+(r.unit?r.unit.caught:'-'), 'live='+(r.live?r.live.caught:'-'), 'sha-identical='+r.restoredIdentical);"
echo "== 9. unit tests fail on master fdae749 (before the change), pass here"
for p in browser capability-runtime mcp-server cli; do printf "%-18s master: %s | branch: %s\n" $p "$(sed 's/\x1b\[[0-9;]*m//g' $E/before-change/master-$p.log | grep -aE '^ +Tests ' | tr -s ' ')" "$(sed 's/\x1b\[[0-9;]*m//g' $E/vitest-$p.log | grep -aE '^ +Tests ' | tr -s ' ')"; done
