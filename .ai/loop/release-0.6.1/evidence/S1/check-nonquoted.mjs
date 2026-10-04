// usage: node check-cleanup-paths.mjs <isoRoot> <log...>; exit 0 = every [cleanup] path under isoRoot and >=1 such line
import { readFileSync } from 'node:fs'; import path from 'node:path';
const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const [iso, ...logs] = process.argv.slice(2); const root = norm(iso);
let lines = 0, bad = 0;
for (const f of logs) for (const l of readFileSync(f, 'utf-8').split(/\r?\n/)) {
  if (!l.includes('[cleanup]')) continue; lines++;
  for (const m of l.matchAll(/path=("([^"]+)"|(\S+))/g)) { if (m[2]) continue; const p = norm(m[3]); if (p !== root && !p.startsWith(root + '/')) { bad++; console.log('OUTSIDE-ISO', p, '<=', l.trim()); } }
}
console.log(`cleanup-lines=${lines} outside-iso=${bad}`);
process.exit(lines > 0 && bad === 0 ? 0 : 1);
