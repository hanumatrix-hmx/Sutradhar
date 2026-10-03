import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
header('win-a2 link as candidate');
const ISO = os.tmpdir();
const T = await fsp.mkdtemp(path.join(ISO, 'a2-root-')); const VR = await fsp.mkdtemp(path.join(ISO, 'a2-victims-'));
P('tmpRoot', T); P('victimRoot', VR);
async function mkLink(target, link, type) { try { await fsp.symlink(target, link, type); return true; } catch (e) { console.log(`NOTE symlink type=${type} not permitted: ${e.code}`); return false; } }
const cases = [];
for (const [mode, type] of [['sweep', 'junction'], ['close', 'junction'], ['sweep', 'dir'], ['close', 'dir'], ['sweep', 'file'], ['close', 'file']]) {
  const n = cases.length;
  const victim = path.join(VR, `victim-${mode}-${type}`);
  let link;
  if (type === 'file') { await fsp.mkdir(victim); await fsp.writeFile(path.join(victim, 'precious.txt'), 'x'.repeat(100)); link = path.join(T, `sutradhar-cli-179000000002${n}`); if (!(await mkLink(path.join(victim, 'precious.txt'), link, 'file'))) { cases.push({ mode, type, skipped: true }); continue; } }
  else { await profileDir(victim); link = path.join(T, `sutradhar-cli-179000000001${n}`); if (!(await mkLink(victim, link, type))) { cases.push({ mode, type, skipped: true }); continue; } }
  P('victim', victim); P('link', link, `type=${type}`);
  cases.push({ mode, type, victim, link, before: await tree(victim) });
}
for (const c of cases.filter((c) => !c.skipped && c.mode === 'close')) {
  const r = await TP.removeSessionTempProfile(c.link, undefined, { tmpRoot: T, scan: async () => [], removeTimeoutMs: 1000 });
  P('close-result', c.link, `removed=${r.removed} reason=${r.reason}`); c.res = r;
}
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 });
for (const r of sw.removed) P('sweep-removed', r); for (const k of sw.kept) P('sweep-kept', k.dir, `reason=${k.reason}`);
for (const c of cases) {
  if (c.skipped) { console.log(`SKIP A2 ${c.mode} ${c.type}: link not permitted`); continue; }
  const after = await tree(c.victim);
  const lockOk = c.type === 'file' ? true : await exists(path.join(c.victim, 'lockfile'));
  check(`A2 ${c.mode} ${c.type} victim intact incl lockfile`, sameTree(c.before, after) && lockOk, `lockfile=${lockOk} missing=${JSON.stringify(C.missing(c.before, after))} linkStillThere=${await exists(c.link)}`);
}
done();
