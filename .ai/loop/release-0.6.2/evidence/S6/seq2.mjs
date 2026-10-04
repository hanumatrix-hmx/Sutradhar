// Second pass: a non-launch CLI verb array with NO launch-capable verb array (nav/newtab/audit/compare) in the previous N lines.
import { readFileSync } from 'node:fs';
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const N = Number(process.env.WINDOW ?? 25);
const NON = ['snap','axsnap','text','click','clicktext','clickrole','type','press','screenshot','select','wait','waitfor','eval','hover','scroll','upload','drag','clickpoint','dragpoints','setclipboard','getclipboard','grant','tabs','focustab','closetab','download','back','forward','reload'];
const LAUNCH = ['nav','newtab','audit','compare'];
const reNon = new RegExp(`\\[\\s*'(${NON.join('|')})'`);
const reLaunch = new RegExp(`\\[\\s*'(${LAUNCH.join('|')})'`);
for (const f of process.argv.slice(2)) {
  const src = readFileSync(`${WT}/${f}`, 'utf8').split(/\r?\n/);
  const hits = [];
  src.forEach((line, i) => {
    if (!reNon.test(line)) return;
    let ok = false;
    for (let j = Math.max(0, i - N); j <= i; j++) if (reLaunch.test(src[j])) { ok = true; break; }
    if (!ok) hits.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  console.log(`== ${f}: ${hits.length} non-launch call(s) with no launch-capable call in the previous ${N} lines`);
  for (const h of hits.slice(0, 40)) console.log('   ' + h);
}
