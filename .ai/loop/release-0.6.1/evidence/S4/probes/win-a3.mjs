import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
header('win-a3 links inside a stale candidate');
const ISO = os.tmpdir();
const T = await fsp.mkdtemp(path.join(ISO, 'a3-root-')); const VR = await fsp.mkdtemp(path.join(ISO, 'a3-victims-'));
P('tmpRoot', T); P('victimRoot', VR);
async function mkLink(target, link, type) { try { await fsp.symlink(target, link, type); return true; } catch (e) { console.log(`NOTE symlink type=${type} not permitted: ${e.code}`); return false; } }
const victims = {};
for (const k of ['j', 'd', 'f', 'jl', 'dl', 'cj', 'cl']) { victims[k] = await profileDir(path.join(VR, `victim-${k}`)); await fsp.writeFile(path.join(victims[k], 'precious.txt'), 'y'.repeat(50)); P('victim', victims[k]); }
// candidate 1 (sweep): junction + dir symlink + file symlink nested inside
const c1 = await profileDir(path.join(T, 'sutradhar-cli-1790000000030'));
await mkLink(victims.j, path.join(c1, 'Default', 'jlink'), 'junction');
const dOk = await mkLink(victims.d, path.join(c1, 'slink'), 'dir');
const fOk = await mkLink(path.join(victims.f, 'precious.txt'), path.join(c1, 'flink'), 'file');
// candidate 2 (sweep): `lockfile` itself is a junction to a victim; candidate 3: `lockfile` is a dir symlink
const c2 = path.join(T, 'sutradhar-cli-1790000000031'); await fsp.mkdir(path.join(c2, 'Default'), { recursive: true }); await mkLink(victims.jl, path.join(c2, 'lockfile'), 'junction');
const c3 = path.join(T, 'sutradhar-cli-1790000000032'); await fsp.mkdir(path.join(c3, 'Default'), { recursive: true }); const dlOk = await mkLink(victims.dl, path.join(c3, 'lockfile'), 'dir');
// candidate 4/5 (close path): nested junction / lockfile junction
const c4 = await profileDir(path.join(T, 'sutradhar-cli-1790000000033-AbC123')); await mkLink(victims.cj, path.join(c4, 'Default', 'jlink'), 'junction');
const c5 = path.join(T, 'sutradhar-cli-1790000000034-AbC123'); await fsp.mkdir(path.join(c5, 'Default'), { recursive: true }); await mkLink(victims.cl, path.join(c5, 'lockfile'), 'junction');
for (const c of [c1, c2, c3, c4, c5]) P('candidate', c);
const before = {}; for (const k in victims) before[k] = await tree(victims[k]);
for (const c of [c4, c5]) { const r = await TP.removeSessionTempProfile(c, undefined, { tmpRoot: T, scan: async () => [], removeTimeoutMs: 1000 }); P('close-result', c, `removed=${r.removed} reason=${r.reason}`); check(`A3 close removed candidate ${path.basename(c)}`, r.removed && !(await exists(c)), JSON.stringify(r)); }
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 });
for (const r of sw.removed) P('sweep-removed', r); for (const k of sw.kept) P('sweep-kept', k.dir, `reason=${k.reason}`);
for (const c of [c1, c2, c3]) check(`A3 sweep removed candidate ${path.basename(c)}`, !(await exists(c)), `kept=${JSON.stringify(sw.kept.filter((k) => k.dir === c))}`);
const used = { j: true, d: dOk, f: fOk, jl: true, dl: dlOk, cj: true, cl: true };
for (const k in victims) { if (!used[k]) { console.log(`SKIP A3 victim-${k}: link not permitted`); continue; } const a = await tree(victims[k]); check(`A3 victim-${k} intact`, sameTree(before[k], a), `missing=${JSON.stringify(C.missing(before[k], a))}`); }
done();
