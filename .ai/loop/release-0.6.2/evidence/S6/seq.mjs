// For each driver script: list every literal CLI-verb array in file order, and flag the verb that follows a `close` (or is the first call).
import { readFileSync, readdirSync } from 'node:fs';
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const files = process.argv.slice(2);
const VERBS = new Set(['nav','snap','axsnap','text','click','clicktext','clickrole','type','press','screenshot','audit','compare','select','wait','waitfor','eval','hover','scroll','upload','drag','clickpoint','dragpoints','setclipboard','getclipboard','grant','tabs','newtab','focustab','closetab','download','close','dialog','doctor','profile','back','forward','reload']);
const NONLAUNCH = new Set([...VERBS].filter((v) => !['nav','close','dialog','doctor','profile','newtab','audit','compare'].includes(v)));
for (const f of files) {
  const src = readFileSync(`${WT}/${f}`, 'utf8').split(/\r?\n/);
  const rows = [];
  src.forEach((line, i) => {
    for (const m of line.matchAll(/\[\s*'([a-z]+)'/g)) if (VERBS.has(m[1])) rows.push({ line: i + 1, verb: m[1], text: line.trim().slice(0, 110) });
  });
  const flags = [];
  let prev = 'START';
  for (const r of rows) {
    if ((prev === 'START' || prev === 'close') && NONLAUNCH.has(r.verb)) flags.push(`${r.line}: ${r.verb} after ${prev}  :: ${r.text}`);
    prev = r.verb;
  }
  console.log(`== ${f}: ${rows.length} literal verb arrays; flagged ${flags.length}`);
  for (const x of flags) console.log('   ' + x);
}
