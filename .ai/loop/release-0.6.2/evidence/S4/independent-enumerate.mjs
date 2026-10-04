// Independent cross-check of sites.txt: enumerates the same calls with a plain Node scanner (no ripgrep, no list-sites.mjs code)
// over `git ls-files 'packages/*/src'` and compares the file:line:col key sets. Usage: node independent-enumerate.mjs <sites.txt> <repo root>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [sitesFile, root] = process.argv.slice(2);
const names = readFileSync(`${root}/.ai/loop/release-0.6.2/evidence/S4/sync-throw-methods.txt`, 'utf8').split('\n').filter(Boolean);
const files = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', 'packages'], { encoding: 'utf8' }).split('\n').filter((f) => /^packages\/[^/]+\/src\/.*\.(ts|tsx)$/.test(f));
const keys = new Set();
for (const f of files) {
  const text = readFileSync(`${root}/${f}`, 'utf8').replace(/\r\n/g, '\n');
  // scan char by char: a '.' followed by optional whitespace, a listed name, optional whitespace and '('
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '.') continue;
    let j = i + 1; while (j < text.length && /\s/.test(text[j])) j++;
    for (const n of names) {
      if (!text.startsWith(n, j)) continue;
      let k = j + n.length; while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] !== '(') continue;
      if (/[\w$]/.test(text[j + n.length] ?? '')) continue; // whole-name match only
      const before = text.slice(0, i); const line = before.split('\n').length; const col = Buffer.byteLength(before.slice(before.lastIndexOf('\n') + 1)) + 1; // byte column, like rg -b
      keys.add(`${f}:${line}:${col}`);
    }
  }
}
const theirs = new Set(readFileSync(sitesFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[0]));
const missing = [...keys].filter((k) => !theirs.has(k)), extra = [...theirs].filter((k) => !keys.has(k));
console.log(`independent=${keys.size} sites.txt=${theirs.size} only-independent=${missing.length} only-sites=${extra.length}`);
for (const k of missing) console.log('ONLY-INDEPENDENT', k); for (const k of extra) console.log('ONLY-SITES', k);
process.exit(missing.length === 0 && extra.length === 0 ? 0 : 1);
