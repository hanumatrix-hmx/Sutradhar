// usage: node mk-mutant.mjs <a|e>  -- writes dist/cli-bin.mutant.js (exactly 1 replacement) from the real dist/cli-bin.js
import { readFileSync, writeFileSync } from 'node:fs';
const D = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/packages/sutradhar/dist';
const which = process.argv[2];
const M = {
  a: { find: 'mayLaunch: isLaunchCapable(verb, cleanArgs),', repl: 'mayLaunch: true,' },
  e: { find: 'if (err?.name === "NoSessionError") {', repl: 'if (false) {' },
};
const m = M[which];
const src = readFileSync(`${D}/cli-bin.js`, 'utf8');
const n = src.split(m.find).length - 1;
if (n !== 1) { console.error(`replacement count ${n} != 1`); process.exit(3); }
writeFileSync(`${D}/cli-bin.mutant.js`, src.replace(m.find, () => m.repl));
console.log(`mutant ${which} written, replacements=${n}`);
