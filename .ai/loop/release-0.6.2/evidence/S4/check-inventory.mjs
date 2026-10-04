// S4 step 1: check-inventory. Exit 0 iff the set of file:line:col keys in sites.txt equals the set of rows in the md and every
// row carries a classification (SAFE or UNSAFE). Prints missing (in sites, not in md) / extra (in md, not in sites) keys.
// Usage: node check-inventory.mjs <sites.txt> <frame-call-sites.md> [--no-unsafe]
//   --no-unsafe: additionally exit 1 if any row is UNSAFE (used on the post-fix tree).
import { readFileSync } from 'node:fs';

const [sitesFile, mdFile, ...flags] = process.argv.slice(2);
const normKey = (k) => k.trim().replaceAll('\\', '/');
const sites = new Set(readFileSync(sitesFile, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => normKey(l.split(' ')[0])));
const rowsArr = readFileSync(mdFile, 'utf8').split(/\r?\n/).filter((l) => /^\|\s*\S+:\d+:\d+\s*\|/.test(l)).map((l) => l.split('|').map((c) => c.trim()));
const rows = new Map();
let dup = 0, unclassified = 0, unsafe = 0;
for (const c of rowsArr) {
  const key = normKey(c[1]);
  if (rows.has(key)) dup++;
  rows.set(key, c);
  if (c[3] !== 'SAFE' && c[3] !== 'UNSAFE') unclassified++;
  if (c[3] === 'UNSAFE') unsafe++;
}
const missing = [...sites].filter((k) => !rows.has(k));
const extra = [...rows.keys()].filter((k) => !sites.has(k));
console.log(`sites=${sites.size} rows=${rows.size} missing=${missing.length} extra=${extra.length} duplicates=${dup} unclassified=${unclassified} unsafe=${unsafe}`);
for (const k of missing) console.log(`MISSING ${k}`);
for (const k of extra) console.log(`EXTRA ${k}`);
let ok = missing.length === 0 && extra.length === 0 && dup === 0 && unclassified === 0;
if (flags.includes('--no-unsafe') && unsafe > 0) { console.log(`FAIL: ${unsafe} UNSAFE row(s) remain`); ok = false; }
console.log(ok ? 'CHECK-INVENTORY OK' : 'CHECK-INVENTORY FAILED');
process.exit(ok ? 0 : 1);
