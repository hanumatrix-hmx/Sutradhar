import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
header('win-a7 fail closed');
const ISO = os.tmpdir(); const T = await fsp.mkdtemp(path.join(ISO, 'a7-'));
const d = await profileDir(path.join(T, 'sutradhar-cli-1790000000300-AbC123'), { lockfile: false }); await setOld(d); P('dir', d);
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => null, minAgeMs: 0 });
check('A7 null scan sweep keeps', sw.removed.length === 0 && sw.kept[0]?.reason === 'scan-unavailable' && (await exists(d)), JSON.stringify(sw.kept.map((k) => k.reason)));
const r = await TP.removeSessionTempProfile(d, undefined, { tmpRoot: T, scan: async () => null });
check('A7 null scan close keeps', r.removed === false && r.reason === 'scan-unavailable' && (await exists(d)), JSON.stringify(r));
const t0 = performance.now(); const s1 = await TP.scanCommandLines(1);
check('A7 scanCommandLines(1) -> null', s1 === null, `got=${Array.isArray(s1) ? 'array(' + s1.length + ')' : s1} in ${(performance.now() - t0).toFixed(0)}ms`);
const real = await TP.scanCommandLines();
check('A7 real scan ran (array)', Array.isArray(real), `len=${real?.length}`);
const self = (real ?? []).filter((l) => l.includes("LIKE '%sutradhar-cli-%'"));
console.log(`INFO real scan lines=${real?.length} selfLines=${self.length} (the query's own powershell.exe matches its own filter, so a Windows scan never returns [])`);
check('A7 real scan: every line carries the prefix', (real ?? []).every((l) => l.includes('sutradhar-cli-')));
const savedPath = process.env.PATH; process.env.PATH = '';
const s2 = await TP.scanCommandLines(); const r2 = await TP.removeSessionTempProfile(d, undefined, { tmpRoot: T });
process.env.PATH = savedPath;
check('A7 powershell unresolvable -> scan null', s2 === null, `got=${Array.isArray(s2) ? 'array(' + s2.length + ')' : s2}`);
check('A7 powershell unresolvable -> close keeps', r2.removed === false && r2.reason === 'scan-unavailable' && (await exists(d)), JSON.stringify(r2));
const d3 = await profileDir(path.join(T, 'sutradhar-cli-1790000000301'), { lockfile: false }); await fsp.writeFile(path.join(d3, '.sutradhar-owner.json'), '{"chromePid":"123"'); await setOld(d3); P('dir', d3);
console.log(`OBS corrupt marker -> readOwnerPid=${await TP.readOwnerPid(d3)} (unknown owner is treated as not alive)`);
let threw = 'no'; try { await TP.removeSessionTempProfile(123, undefined, { tmpRoot: T, scan: async () => [] }); } catch (e) { threw = e.code ?? e.message; }
console.log(`OBS removeSessionTempProfile(non-string dir) throws=${threw}`);
let threw2 = 'no'; try { await TP.removeSessionTempProfile(d3, undefined, { tmpRoot: T, scan: async () => { throw new Error('scan boom'); } }); } catch (e) { threw2 = e.message; }
console.log(`OBS removeSessionTempProfile(rejecting scan) throws=${threw2}; d3 exists=${await exists(d3)}`);
done();
