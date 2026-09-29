// For each of the 12 tracked files, measure what fraction of the normalized text is a "blind
// zone": a position where ANY trigger word would be auto-approved by the guard's own
// suppression rules (within 60 chars of a canonical-template match, within 160 chars of any
// NARRATIVE_RE anchor, or within 250 chars of "pinchtab") -- i.e. positions where the allow-list
// never actually asks "does this match an approved template?". Uses the real module's exports
// plus the same windows it hardcodes.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = process.cwd();
const mod = await import(pathToFileURL(path.join(repo, 'tools/scenario-suite/fr2-16/stealth-claim-check.mjs')).href);
const src = fs.readFileSync(path.join(repo, 'tools/scenario-suite/fr2-16/stealth-claim-check.mjs'), 'utf8');
const NARR = new RegExp(src.match(/const NARRATIVE_RE =\s*\n\s*\/(.*)\/i;/)[1], 'gi');
let totalLen = 0, totalBlind = 0;
for (const f of mod.loadStealthClaimFiles()) {
  const flat = f.flat; const n = flat.length;
  const blind = new Uint8Array(n);
  const mark = (s, e) => { for (let i = Math.max(0, s); i < Math.min(n, e); i++) blind[i] = 1; };
  for (const t of mod.CANONICAL_TEMPLATES) { let i = 0; while ((i = flat.indexOf(t.flat, i)) !== -1) { mark(i - 60, i + t.flat.length + 61); i++; } }
  let m; NARR.lastIndex = 0;
  while ((m = NARR.exec(flat))) mark(m.index - 160, m.index + m[0].length + 160);
  const P = /\bpinchtab\b/gi; while ((m = P.exec(flat))) mark(m.index - 250, m.index + m[0].length + 250);
  const b = blind.reduce((a, x) => a + x, 0);
  totalLen += n; totalBlind += b;
  console.log(`${(100 * b / n).toFixed(1).padStart(5)}% blind  (${b}/${n} chars)  ${f.rel}`);
}
console.log(`\nALL 12 FILES: ${(100 * totalBlind / totalLen).toFixed(1)}% of normalized text is a blind zone (${totalBlind}/${totalLen})`);
