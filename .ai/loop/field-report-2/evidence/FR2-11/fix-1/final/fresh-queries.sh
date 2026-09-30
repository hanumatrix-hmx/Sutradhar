#!/bin/bash
# FR2-11 fix-1: fresh re-queries of live state, run LAST (after the final build, the 3 live runs, the probes, the mutants and the regressions).
# Each section re-reads the thing itself (git, disk, dist, logs); nothing is copied from an earlier round.
cd "E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041" || exit 1
E=.ai/loop/field-report-2/evidence/FR2-11
F=$E/fix-1/final
echo "== 1. tree and HEAD (tracked sources must equal HEAD: the mutation drivers restored them byte-identically)"
git rev-parse --show-toplevel; git branch --show-current; git rev-parse --short HEAD
echo "tracked changes under packages/ and tools/ vs HEAD: [$(git diff --name-only HEAD -- packages tools | tr '\n' ' ')]"
for f in packages/browser/src/session/action-history.ts packages/cli/src/history-file.ts packages/cli/src/cli.ts packages/mcp-server/src/tools.ts; do
  a=$(git hash-object "$f"); b=$(git ls-tree HEAD "$f" | awk '{print $3}'); echo "$f worktree-blob=$a HEAD-blob=$b $( [ "$a" = "$b" ] && echo IDENTICAL || echo DIFFERENT)"
done
echo
echo "== 2. no stale build: newest src file vs oldest dist file, per touched package (dist must be newer than every src file)"
for p in browser capability-runtime cli mcp-server sutradhar; do
  node -e "
const fs=require('fs'),path=require('path');
const walk=(d,o=[])=>{for(const n of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,n.name);if(n.isDirectory()){if(n.name==='node_modules')continue;walk(f,o);}else o.push(f);}return o;};
const src=walk('packages/$p/src').map(f=>fs.statSync(f).mtimeMs);
const dist=walk('packages/$p/dist').filter(f=>/\.(js|cjs|mjs)$/.test(f)).map(f=>fs.statSync(f).mtimeMs);
console.log('$p','newest src',new Date(Math.max(...src)).toISOString(),'oldest dist js',new Date(Math.min(...dist)).toISOString(),Math.max(...src)<=Math.min(...dist)?'DIST-NEWER':'POSSIBLY-STALE');
"
done
echo
echo "== 3. the bundle carries the new rule and not the old character-class regex"
for f in cli-bin index mcp-cli; do
  echo "$f: old=$(grep -c 'wss?|file|blob' packages/sutradhar/dist/$f.js) ENCODED_SCHEME=$(grep -c 'ENCODED_SCHEME' packages/sutradhar/dist/$f.js) FORM_PAIRS=$(grep -c 'FORM_PAIRS' packages/sutradhar/dist/$f.js) redactHistoryText=$(grep -c 'redactHistoryText' packages/sutradhar/dist/$f.js)"
done
echo
echo "== 4. unit matrices, fresh run now"
(cd packages/browser && ../../node_modules/.bin/vitest run tests/unit/privacy-matrix.spec.ts tests/unit/action-history.spec.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests |Test Files")
(cd packages/cli && ../../node_modules/.bin/vitest run tests/unit/privacy-matrix.spec.ts tests/unit/history-file.spec.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests |Test Files")
node -e "
const m=require('./tools/scenario-suite/lib/fr2-11-privacy-matrix.mjs');
" 2>/dev/null
node --input-type=module -e "
import { fullMatrix, rotatingMatrix, selfTest } from './tools/scenario-suite/lib/fr2-11-privacy-matrix.mjs';
const o={origin:'http://127.0.0.1:5000',hostPort:'127.0.0.1:5000'};
const st=selfTest(o); console.log('matrix cells', fullMatrix(o).length, 'rotating', rotatingMatrix(o).length, 'selfTest problems', JSON.stringify(st.problems));
"
echo
echo "== 5. live runs: re-read each summary JSON from disk"
for n in 1 2 3; do
  node -e "
const s=JSON.parse(require('fs').readFileSync('$F/live-3x/run-$n/live-summary.json','utf8'));
console.log('run $n', s.casesPassed+'/'+s.cases, 'checks', (s.checks-s.checksFailed)+'/'+s.checks, JSON.stringify(Object.fromEntries(Object.entries(s.perSurface).map(([k,v])=>[k,v.casesPassed+'/'+v.cases]))), 'failed', JSON.stringify(s.failed));
const pm=s.results.filter(r=>/^(PM|SDK-PM)\$/.test(r.case)).map(r=>r.surface+':'+r.case+':'+(r.pass?'PASS':'FAIL')+':'+r.checks);
console.log('  PM cases', pm.join(' '));
"
done
echo
echo "== 6. mutants: re-read the JSON"
node -e "
const fs=require('fs');const d='$F/../mutants-final/';
const big=JSON.parse(fs.readFileSync(d+fs.readdirSync(d).find(f=>f.startsWith('mutants-MF1_')),'utf8'));
const re=JSON.parse(fs.readFileSync(d+'mutants-MF23.json','utf8'));
const re25=JSON.parse(fs.readFileSync(d+'mutants-MF25.json','utf8'));
const rows=big.results.filter(r=>r.id!=='MF23').concat(re.results,re25.results);
console.log('mutants',rows.length,'caught',rows.filter(r=>r.unit&&r.unit.caught&&(!r.live||r.live.caught)).length,'unit-caught',rows.filter(r=>r.unit&&r.unit.caught).length,'live-caught',rows.filter(r=>r.live&&r.live.caught).length,'of',rows.filter(r=>r.live).length,'with a live surface','all restored identical',rows.every(r=>r.restoredIdentical));
console.log('MF23 first pass (live not caught, cell had no canary in the query):',JSON.stringify(big.results.find(r=>r.id==='MF23').live.caught),' after strengthening:',JSON.stringify(re.results[0].live.caught));
"
grep -c "KILLED" $E/audit-probes-rerun-fix-1/auditor-mutants-all.log | sed 's/^/auditor mutants KILLED: /'; grep "^A5 \|^A4 " $E/audit-probes-rerun-fix-1/auditor-mutants-all.log
echo
echo "== 7. the auditor's probes are byte-identical copies"
diff $E/audit-probes-rerun-fix-1/sha-original.txt $E/audit-probes-rerun-fix-1/sha-copy.txt && echo "probe copies byte-identical"
(cd $E/audit-probes-rerun-fix-1 && sha256sum -c sha-original.txt 2>&1 | head -8)
echo
echo "== 8. regression logs, re-read"
for t in fr2-08 fr2-07 fr2-04; do
  echo "$t: $(grep -E 'passed|PASS|FAIL' $F/regression/$t.log | tail -n 2 | tr '\n' ' ' | cut -c1-260)"
done
echo "run-cli: $(tail -n 4 $F/regression/run-cli.log | tr '\n' ' ' | cut -c1-260)"
