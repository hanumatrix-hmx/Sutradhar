import os from 'node:os'; import path from 'node:path';
const ROOT = process.env.PROBE_ROOT ?? ''; const chk = (p) => { const r = path.resolve(p); return r.startsWith('/mnt/') || !(ROOT && (r === ROOT || r.startsWith(ROOT + '/'))) || !ROOT.startsWith('/tmp/'); };
for (const p of [os.tmpdir(), ROOT, ...(process.env.PROBE_TMPROOTS ?? '').split(':').filter(Boolean)]) if (!p || chk(p)) { console.error(`WSL GUARD: refusing ${p}`); process.exit(97); }
console.error(`[wsl-guard] root=${ROOT}`);
import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url'; import { spawn } from 'node:child_process';
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
const ISO = os.tmpdir();
const under = (p) => { const r = path.resolve(p); return r.startsWith(ROOT + '/') && !r.startsWith('/mnt/'); };
const mkroot = async (pfx) => { const t = await fsp.mkdtemp(path.join(ISO, pfx)); if (!under(t)) { console.error(`WSL GUARD: tmpRoot ${t} outside ROOT`); process.exit(97); } return t; };
header('wsl-a1 scope');
const T = await mkroot('a1-root-'); const OTHER = await mkroot('a1-other-'); P('tmpRoot', T); P('otherRoot', OTHER);
const prot = ['sutradhar-cli-123', 'sutradhar-cli-1790000000000-' + 'A'.repeat(17), 'sutradhar-cli-1790000000000..x', 'sutradhar-cli-..1790000000000', 'sutradhar-cli-1790000000000-a..b', 'sutradhar-cli-1790000000000..', 'sutradhar-downloads', 'sutradhar-download-locks', 'sutradhar-cli-work', 'work', 'SUTRADHAR-CLI-1790000000005', 'sutradhar-cli-1790000000000-AbC1_3', 'sutradhar-cli-1790000000000.'].map((n) => path.join(T, n));
prot.push(path.join(T, 'sub', 'sutradhar-cli-1790000000001'), path.join(T, 'profiles', 'sutradhar-cli-1790000000006'), path.join(OTHER, 'sutradhar-cli-1790000000002'), path.join(OTHER, 'sutradhar-cli-1790000000003-AbC123'));
for (const d of prot) { await profileDir(d); await setOld(d); P('created', d); }
const lockHash = 'download-' + 'a'.repeat(32) + '.lock';
await fsp.writeFile(path.join(T, 'sutradhar-download-locks', lockHash), '{}'); await fsp.writeFile(path.join(T, lockHash), '{}'); await fsp.writeFile(path.join(T, 'sutradhar-cli-1790000000000.lnk'), 'L');
const files = [path.join(T, 'sutradhar-cli-1790000000000.lnk'), path.join(T, lockHash), path.join(T, 'sutradhar-download-locks', lockHash)];
const controls = [path.join(T, 'sutradhar-cli-1790000000008'), path.join(T, 'sutradhar-cli-1790000000009-AbC123')];
for (const d of controls) { await profileDir(d); await setOld(d); P('created', d); }
const before = new Map(); for (const d of prot) before.set(d, await tree(d));
const res = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 });
for (const r of res.removed) P('sweep-removed', r);
check('A1 sweep removed exactly the 2 controls', JSON.stringify([...res.removed].sort()) === JSON.stringify([...controls].sort()), JSON.stringify(res.removed.map((r) => path.basename(r))));
for (const d of prot) check(`A1 sweep kept ${path.relative(ISO, d)}`, (await exists(d)) && sameTree(before.get(d), await tree(d)));
for (const f of files) check(`A1 sweep kept file ${path.relative(ISO, f)}`, await exists(f));
for (const d of [...prot, ...files, T + '/sutradhar-cli-1790000000007-x/..', T + '/sutradhar-cli-1790000000007/.', T, OTHER, ISO]) {
  P('close-target', d); const r = await TP.removeSessionTempProfile(d, undefined, { tmpRoot: T, scan: async () => [], removeTimeoutMs: 500 });
  check(`A1 close refused ${path.relative(ISO, d) || '.'}`, r.removed === false && r.reason === 'not-auto-temp', JSON.stringify(r));
}
for (const d of prot) check(`A1 after close intact ${path.relative(ISO, d)}`, (await exists(d)) && sameTree(before.get(d), await tree(d)));
done();
