// S11 pre-gate (S8 audit A-2): re-key the S4 inventory (keyed at the S4 commit) to the final tree. Rows whose key is not in the
// new sites list must pair up, per file and in order, with new keys of the SAME column (pure line shifts); anything else is a
// real change and stops the script. Classifications are copied unchanged.
// Usage: node rekey.mjs <old md> <new sites.txt> <out md>
import { readFileSync, writeFileSync } from 'node:fs';
const [oldMd, newSites, outMd] = process.argv.slice(2);
const BS = String.fromCharCode(92);
const fwd = (s) => s.split(BS).join('/');
const sites = readFileSync(newSites, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => fwd(l.split(' ')[0].trim()));
const siteSet = new Set(sites);
const lines = readFileSync(oldMd, 'utf8').split(/\r?\n/);
const keyOf = (l) => { const m = /^\|\s*(\S+:\d+:\d+)\s*\|/.exec(l); return m ? fwd(m[1]) : null; };
const oldKeys = lines.map(keyOf).filter(Boolean);
const oldSet = new Set(oldKeys);
const gone = oldKeys.filter((k) => !siteSet.has(k));
const added = sites.filter((k) => !oldSet.has(k));
const parse = (k) => { const m = /^(.*):(\d+):(\d+)$/.exec(k); return { f: m[1], l: Number(m[2]), c: Number(m[3]), k }; };
const g = gone.map(parse), a = added.map(parse);
const map = new Map(); const deltas = {};
const files = new Set([...g, ...a].map((x) => x.f));
let bad = 0;
for (const f of files) {
  const gg = g.filter((x) => x.f === f).sort((x, y) => x.l - y.l || x.c - y.c), aa = a.filter((x) => x.f === f).sort((x, y) => x.l - y.l || x.c - y.c);
  if (gg.length !== aa.length) { console.log(`UNPAIRED ${f}: gone=${gg.length} added=${aa.length}`); bad++; continue; }
  gg.forEach((x, i) => {
    const y = aa[i];
    if (x.c !== y.c) { console.log(`COLUMN CHANGED ${x.k} -> ${y.k}`); bad++; return; }
    (deltas[f] ??= new Set()).add(y.l - x.l); map.set(x.k, y.k);
  });
}
for (const [f, s] of Object.entries(deltas)) console.log(`${f}: line deltas ${[...s].join(',')}${s.size > 1 ? '  (several hunks; every pair keeps its column)' : ''}`);
if (bad) { console.log(`REKEY FAILED (${bad})`); process.exit(1); }
const out = lines.map((l) => { const k = keyOf(l); return k && map.has(k) ? l.replace(k, map.get(k)) : l; });
writeFileSync(outMd, out.join('\n'));
console.log(`re-keyed ${map.size} rows; ${oldKeys.length} rows total; new sites ${sites.length}`);
