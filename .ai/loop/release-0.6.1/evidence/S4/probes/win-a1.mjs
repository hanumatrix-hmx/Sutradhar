import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
header('win-a1 scope');
const ISO = os.tmpdir();
const T = await fsp.mkdtemp(path.join(ISO, 'a1-root-')); const OTHER = await fsp.mkdtemp(path.join(ISO, 'a1-other-'));
P('tmpRoot', T); P('otherRoot', OTHER);
const protectedDirs = [
  path.join(T, 'sutradhar-cli-123'),
  path.join(T, 'sutradhar-cli-1790000000000-' + 'A'.repeat(17)),
  path.join(T, 'sutradhar-cli-1790000000000..x'),
  path.join(T, 'sutradhar-cli-..1790000000000'),
  path.join(T, 'sutradhar-cli-1790000000000-a..b'),
  path.join(T, 'sutradhar-downloads'),
  path.join(T, 'sutradhar-download-locks'),
  path.join(T, 'sutradhar-cli-work'),
  path.join(T, 'work'),
  path.join(T, 'SUTRADHAR-CLI-1790000000005'),
  path.join(T, 'sutradhar-cli-1790000000000-AbC1_3'),
  path.join(T, 'sutradhar-cli-179000000'),
  path.join(T, 'sub', 'sutradhar-cli-1790000000001'),
  path.join(T, 'profiles', 'sutradhar-cli-1790000000006'),
  path.join(OTHER, 'sutradhar-cli-1790000000002'),
  path.join(OTHER, 'sutradhar-cli-1790000000003-AbC123'),
];
for (const d of protectedDirs) { await profileDir(d); await setOld(d); }
const lockHash = 'download-' + 'a'.repeat(32) + '.lock';
await fsp.writeFile(path.join(T, 'sutradhar-download-locks', lockHash), '{}');
await fsp.writeFile(path.join(T, lockHash), '{}');
await fsp.writeFile(path.join(T, 'sutradhar-cli-1790000000000.lnk'), 'L');
const files = [path.join(T, 'sutradhar-cli-1790000000000.lnk'), path.join(T, lockHash), path.join(T, 'sutradhar-download-locks', lockHash)];
const controls = [path.join(T, 'sutradhar-cli-1790000000008'), path.join(T, 'sutradhar-cli-1790000000009-AbC123')];
for (const d of controls) { await profileDir(d); await setOld(d); }
const before = new Map(); for (const d of protectedDirs) before.set(d, await tree(d));
for (const p of [...protectedDirs, ...files, ...controls]) P('created', p);
const res = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 });
for (const r of res.removed) P('sweep-removed', r); for (const k of res.kept) P('sweep-kept', k.dir, `reason=${k.reason}`);
check('A1 sweep removed exactly the 2 positive controls', JSON.stringify([...res.removed].sort()) === JSON.stringify([...controls].sort()), JSON.stringify(res.removed.map((r) => path.basename(r))));
for (const c of controls) check(`A1 control gone ${path.basename(c)}`, !(await exists(c)));
for (const d of protectedDirs) check(`A1 sweep kept intact ${path.relative(ISO, d)}`, (await exists(d)) && sameTree(before.get(d), await tree(d)));
for (const f of files) check(`A1 sweep kept file ${path.relative(ISO, f)}`, await exists(f));
// close path on every protected entry (tmpRoot T), plus traversal strings and the roots themselves
const closeTargets = [...protectedDirs, ...files, T + path.sep + 'sutradhar-cli-1790000000007-x' + path.sep + '..', T + path.sep + 'sutradhar-cli-1790000000007' + path.sep + '.', T, OTHER, ISO];
for (const d of closeTargets) {
  P('close-target', d);
  const r = await TP.removeSessionTempProfile(d, undefined, { tmpRoot: T, scan: async () => [], removeTimeoutMs: 500 });
  P('close-result', d, `removed=${r.removed} reason=${r.reason}`);
  check(`A1 close refused ${path.relative(ISO, d) || '.'}`, r.removed === false && r.reason === 'not-auto-temp', JSON.stringify(r));
}
for (const d of protectedDirs) check(`A1 after close intact ${path.relative(ISO, d)}`, (await exists(d)) && sameTree(before.get(d), await tree(d)));
for (const f of files) check(`A1 after close file ${path.relative(ISO, f)}`, await exists(f));
check('A1 roots intact', (await exists(T)) && (await exists(OTHER)));
// observation: a regular FILE whose name matches the auto-temp pattern
const fileLike = path.join(T, 'sutradhar-cli-1790000000004'); await fsp.writeFile(fileLike, 'not a dir'); await setOld(fileLike); P('created', fileLike);
const r2 = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 });
for (const r of r2.removed) P('sweep2-removed', r);
console.log(`OBS file-named-like-profile removed=${!(await exists(fileLike))}`);
done();
