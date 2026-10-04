// S8 auditor: writes <dc>/dist/cli-bin.mutant.js (exactly 1 replacement) from the auditor's dist COPY (never the real dist).
// usage: node mkmut.mjs <dcDist> <S6|S7|OWN> <id>
// S6/S7 specs are extracted verbatim from the builders' mk-mutant.mjs (the `M` object) without executing those files.
import { readFileSync, writeFileSync } from 'node:fs';
const [D, set, id] = process.argv.slice(2);
const EV = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/.ai/loop/release-0.6.2/evidence';
let M;
if (set === 'OWN') {
  M = {
    // I-048 own: the last window prints marker A instead of B (end >= total -> end > total)
    o048: { find: 'if (end >= r.totalChars) {', repl: 'if (end > r.totalChars) {' },
    // I-051 own: the no-session line goes to stdout instead of stderr
    o051: { find: 'if (err?.name === "NoSessionError") {\n      console.error(', repl: 'if (err?.name === "NoSessionError") {\n      console.log(' },
    // I-NAV own: in --json mode the edge line is written to stdout (breaks the one-JSON-document contract)
    // I-048 own (A-048a live twin): the CLI continue hint names returnedChars instead of offset+returnedChars
    o048hint: { find: 'textContinueHint(r.offset + r.returnedChars)', repl: 'textContinueHint(r.returnedChars)' },
    onav: { find: 'if (outcome === "edge") stderr.push(edgeLine());', repl: 'if (outcome === "edge") stdout.push(edgeLine());' },
  };
} else {
  const src = readFileSync(`${EV}/${set}/mk-mutant.mjs`, 'utf8');
  const start = src.indexOf(src.includes('const classifyEdge') ? 'const classifyEdge' : 'const M = {');
  const end = src.indexOf('const m = M[which];');
  M = new Function(`${src.slice(start, end)}; return M;`)();
}
const m = M[id]; if (!m) { console.error('no such mutant ' + id); process.exit(2); }
const src = readFileSync(`${D}/cli-bin.js`, 'utf8').replace(/\r\n/g, '\n');
const n = src.split(m.find).length - 1;
if (n !== 1) { console.error(`replacement count ${n} != 1 for ${set}/${id}`); process.exit(3); }
writeFileSync(`${D}/cli-bin.mutant.js`, src.replace(m.find, () => m.repl));
console.log(`mutant ${set}/${id} written, replacements=${n}`);
