#!/bin/bash
# Fresh re-queries of live state (run AFTER the last build / mutant / regression), for the false-pass analysis.
cd "E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041" || exit 1
EV=.ai/loop/field-report-2/evidence/FR2-14
F=$EV/fix-2
OUT=$F/false-pass-checks-fix2.out
: > $OUT
say() { echo "### $*" >> $OUT; }
say "worktree / branch / HEAD"; git rev-parse --show-toplevel >> $OUT; git branch --show-current >> $OUT; git rev-parse --short HEAD >> $OUT
say "product sources byte-identical to before the mutation phase (sha256sum -c)"
sed 's/\t/  /' $F/mutant-files-sha-before.txt > /e/AI-Cache/tmp/fr214f2/shalist.txt; echo "files OK: $(sha256sum -c /e/AI-Cache/tmp/fr214f2/shalist.txt 2>&1 | grep -c ': OK')  not OK: $(sha256sum -c /e/AI-Cache/tmp/fr214f2/shalist.txt 2>&1 | grep -vc ': OK')" >> $OUT
say "git status of product dirs (must be clean apart from committed work)"; git status --short packages apps tools | head >> $OUT
say "new specs run fresh (corpus size line, topology line)"
(cd packages/capability-runtime && ../../node_modules/.bin/vitest run tests/unit/echo-choke-point.spec.ts tests/unit/home-boundary.spec.ts tests/unit/override-matrix.spec.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "N1 corpus|home-boundary cross product|Test Files|Tests " >> ../../$OUT)
say "cli spec fresh"
(cd packages/cli && ../../node_modules/.bin/vitest run tests/unit/project-config-cli.spec.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Test Files|Tests " >> ../../$OUT)
say "bundle contains the new code (fresh grep of the built artifacts)"
for s in isLayerSet "were refused" echoPath canonCwd "max(VIEWPORT_MAX)"; do printf "%s: " "$s" >> $OUT; for f in index.js cli-bin.js mcp-cli.js; do printf "%s=%s " $f $(grep -c "$s" packages/sutradhar/dist/$f) >> $OUT; done; echo >> $OUT; done
say "dist is newer than src (no stale build): newest src vs oldest bundle (epoch seconds)"
node -e "
const fs=require('fs'),p=require('path');const w=(d,o=[])=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);e.isDirectory()?w(f,o):o.push(f)}return o};
const src=[...w('packages/capability-runtime/src'),...w('packages/cli/src'),...w('packages/mcp-server/src'),...w('packages/sutradhar/src')].map(f=>fs.statSync(f).mtimeMs);
const dist=['packages/sutradhar/dist/index.js','packages/sutradhar/dist/cli-bin.js','packages/sutradhar/dist/mcp-cli.js','packages/capability-runtime/dist/index.js','packages/cli/dist/cli.js','packages/mcp-server/dist/cli.js'].map(f=>fs.statSync(f).mtimeMs);
console.log('newest src',Math.round(Math.max(...src)/1000),'oldest dist',Math.round(Math.min(...dist)/1000),'dist newer than every src:',Math.min(...dist)>Math.max(...src))" >> $OUT
say "audit repros fresh (unmodified probes): f4 tilde, f3 reverse, mcp huge viewport"
mkdir -p /e/AI-Cache/tmp/fr214f2/fc
(cd $EV/fix-2-rerun-a2/probes && node f4-tilde-multiline.mjs E:/AI-Cache/tmp/fr214f2/fc/f4 2>&1 | head -2 | cut -c1-200 >> ../../fix-2/false-pass-checks-fix2.out; node f3-reverse.mjs E:/AI-Cache/tmp/fr214f2/fc/f3 2>&1 | grep -E '"status"|"stoppedAt"' | tr -d '\n' >> ../../fix-2/false-pass-checks-fix2.out; echo >> ../../fix-2/false-pass-checks-fix2.out; node mcp-callhuge-ab.mjs "$OLDPWD/packages/mcp-server/dist/cli.js" E:/AI-Cache/tmp/fr214f2/fc/mc 2>&1 | tail -1 | cut -c1-420 >> ../../fix-2/false-pass-checks-fix2.out)
say "probe sha256 still equal to the auditors' originals"
(cd $EV/fix-2-rerun-a2/probes && sha256sum -c ../../fix-2/audit2-probes-sha-original.txt | grep -vc ": OK" >> ../../fix-2/false-pass-checks-fix2.out)
(cd $EV/fix-2-rerun-a1/probes && sha256sum -c ../../fix-2/audit1-probes-sha-original.txt | grep -vc ": OK" >> ../../fix-2/false-pass-checks-fix2.out)
say "docs claims"
echo "doctor-does-load sentence count: $(grep -c "does\*\* load" docs/project-config.md)" >> $OUT
say "leftover Chrome from MY scratch dirs (by command-line marker, not by image name)"
powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*fr214f2*' } | Measure-Object).Count" >> $OUT
say "disk"; df -h /e | tail -1 >> $OUT
echo "FRESH DONE" >> $OUT
