// Auditor probe: what does a dry run change on disk? (minimal scratch, no Chrome)
import { makeScratch, runCli } from './common.mjs';
import { readdir, stat, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import path from 'node:path';
const S = await makeScratch('fr2-03-audit-dry-');
const hourAgo = new Date(Date.now() - 3600_000);
const d = path.join(S.temp, 'sutradhar-cli-1600000000010'); await mkdir(d); await writeFile(path.join(d, 'Local State'), '{}'); await utimes(d, hourAgo, hourAgo);
const walk = async (dir, out = []) => { for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); const s = await stat(f); out.push(`${e.isDirectory() ? 'D' : 'F'} ${f} ${s.mtimeMs}`); if (e.isDirectory()) await walk(f, out); } return out; };
const a = await walk(S.R);
const r = await runCli(['doctor', '--gc', '--dry-run', '--json'], S.env, S.cwd(9));
const b = await walk(S.R);
console.log('exit', r.code);
console.log('only-before', a.filter((x) => !b.includes(x)));
console.log('only-after', b.filter((x) => !a.includes(x)));
await rm(S.R, { recursive: true, force: true });
