// Diagnose WHY the control case G1 is missed mid-file in browser-options.ts: dump what
// narrative/pinchtab/template anchor sits within the suppression window of each trigger.
import fs from 'node:fs';
import path from 'node:path';
const repo = process.cwd();
const opts = fs.readFileSync(path.join(repo, 'packages/browser/src/launcher/browser-options.ts'), 'utf8');
const src = fs.readFileSync(path.join(repo, 'tools/scenario-suite/fr2-16/stealth-claim-check.mjs'), 'utf8');
const NARR = new RegExp(src.match(/const NARRATIVE_RE =\s*\n\s*\/(.*)\/i;/)[1], 'gi');
const lines = opts.split('\n');
const at = Math.floor(lines.length / 2);
console.log('mid insertion at line', at + 1, '; surrounding raw lines:');
console.log(lines.slice(at - 4, at + 4).map((l, i) => `${at - 3 + i}: ${l}`).join('\n'));
const flatAll = opts.replace(/[`*_#]/g, '').replace(/^\s*\/\/\s?/gm, '').replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ');
let m; const hits = [];
while ((m = NARR.exec(flatAll))) hits.push([m.index, m[0]]);
console.log('\nNARRATIVE_RE anchors present in the CLEAN browser-options.ts (offset, text):');
for (const h of hits) console.log(' ', h[0], JSON.stringify(h[1]));
console.log('flat length', flatAll.length);
