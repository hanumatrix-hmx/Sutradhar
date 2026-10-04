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
header('wsl-a3 symlinks inside a stale candidate (A3, C5-live c)');
const T = await mkroot('a3-root-'); const VR = await mkroot('a3-victims-'); P('tmpRoot', T); P('victimRoot', VR);
const v = {}; for (const k of ['d', 'f', 'sl', 'cd']) { v[k] = await profileDir(path.join(VR, `victim-${k}`)); await fsp.writeFile(path.join(v[k], 'precious.txt'), 'y'.repeat(50)); P('victim', v[k]); }
const c1 = await profileDir(path.join(T, 'sutradhar-cli-1790000000030'));
await fsp.symlink(v.d, path.join(c1, 'Default', 'dlink')); await fsp.symlink(path.join(v.f, 'precious.txt'), path.join(c1, 'flink'));
const c2 = path.join(T, 'sutradhar-cli-1790000000031'); await fsp.mkdir(path.join(c2, 'Default'), { recursive: true }); await fsp.symlink(v.sl, path.join(c2, 'SingletonLock'));
const c3 = await profileDir(path.join(T, 'sutradhar-cli-1790000000033-AbC123')); await fsp.symlink(v.cd, path.join(c3, 'Default', 'dlink'));
for (const c of [c1, c2, c3]) P('candidate', c);
const before = {}; for (const k in v) before[k] = await tree(v[k]);
const r = await TP.removeSessionTempProfile(c3, undefined, { tmpRoot: T, scan: async () => [], removeTimeoutMs: 1000 }); P('close-result', c3, `removed=${r.removed}`);
check('A3 close removed candidate', r.removed && !(await exists(c3)), JSON.stringify(r));
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 }); for (const x of sw.removed) P('sweep-removed', x); for (const k of sw.kept) P('sweep-kept', k.dir, `reason=${k.reason}`);
for (const c of [c1, c2]) check(`A3 sweep removed ${path.basename(c)}`, !(await exists(c)), JSON.stringify(sw.kept.map((k) => k.reason)));
for (const k in v) { const a = await tree(v[k]); check(`A3 victim-${k} intact`, sameTree(before[k], a), `missing=${JSON.stringify(C.missing(before[k], a))}`); }
done();
