import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
header('win-n1 corrupt/unreadable owner marker fails closed');
const T = await fsp.mkdtemp(path.join(os.tmpdir(), 'n1-'));
// BODY shared by win-n1.mjs and wsl-n1.mjs. `T` (a fresh root under the guarded temp dir) is defined by the per-platform prelude.
// N1: an owner marker that is present but unreadable/corrupt is "owner unknown": the dir is KEPT (reason owner-unknown) by close and by sweep.
import { spawn as spawnChild } from 'node:child_process';
const MARK = '.sutradhar-owner.json';
const bad = {
  'corrupt JSON': (p) => fsp.writeFile(p, '{"chromePid":"123"'),
  'chromePid is a string': (p) => fsp.writeFile(p, JSON.stringify({ chromePid: 'abc', cliPid: 1 })),
  'marker path is a directory (EISDIR)': (p) => fsp.mkdir(p),
  'chromePid is 0': (p) => fsp.writeFile(p, JSON.stringify({ chromePid: 0 })),
  'empty marker file': (p) => fsp.writeFile(p, ''),
};
const mk = async (root, name, make) => { const d = await profileDir(path.join(root, name), { lockfile: false }); if (make) await make(path.join(d, MARK)); await setOld(d); P('dir', d); return d; };
let i = 0;
for (const [name, make] of Object.entries(bad)) {
  const rc = await fsp.mkdtemp(path.join(T, 'close-')); const dc = await mk(rc, `sutradhar-cli-17900000006${i++}-AbC123`, make);
  console.log(`INFO [${name}] readOwnerPid=${await TP.readOwnerPid(dc)}`);
  const r = await TP.removeSessionTempProfile(dc, undefined, { tmpRoot: rc, scan: async () => [] });
  P('close-result', dc, `removed=${r.removed} reason=${r.reason}`);
  check(`N1 [${name}] close keeps (owner-unknown)`, r.removed === false && r.reason === 'owner-unknown' && (await exists(dc)), JSON.stringify(r));
  const rs = await fsp.mkdtemp(path.join(T, 'sweep-')); const ds = await mk(rs, `sutradhar-cli-17900000006${i++}-AbC123`, make);
  const sw = await TP.sweepStaleTempProfiles({ tmpRoot: rs, scan: async () => [], minAgeMs: 0 });
  check(`N1 [${name}] sweep keeps (owner-unknown)`, sw.removed.length === 0 && sw.kept.some((k) => k.dir === ds && k.reason === 'owner-unknown') && (await exists(ds)), JSON.stringify(sw.kept.map((k) => path.basename(k.dir) + ':' + k.reason)));
}
// Negative controls (the probe can FAIL): the same dir shape WITHOUT a bad marker is removed.
const rn = await fsp.mkdtemp(path.join(T, 'ctl-')); const dn = await mk(rn, 'sutradhar-cli-1790000000701-AbC123');
const r1 = await TP.removeSessionTempProfile(dn, undefined, { tmpRoot: rn, scan: async () => [] });
check('N1 control: no marker, no lock -> removed (close)', r1.removed === true && !(await exists(dn)), JSON.stringify(r1));
const rn2 = await fsp.mkdtemp(path.join(T, 'ctl-')); const dn2 = await mk(rn2, 'sutradhar-cli-1790000000702-AbC123');
const sw2 = await TP.sweepStaleTempProfiles({ tmpRoot: rn2, scan: async () => [], minAgeMs: 0 });
check('N1 control: no marker, no lock -> removed (sweep)', sw2.removed.includes(dn2) && !(await exists(dn2)), JSON.stringify(sw2));
// valid marker, dead owner (a child that has exited): removed
const ch = spawnChild(process.execPath, ['-e', '0'], { stdio: 'ignore' }); const deadPid = ch.pid; await new Promise((res) => ch.on('exit', res)); await sleep(300);
const rd = await fsp.mkdtemp(path.join(T, 'ctl-')); const dd = await mk(rd, 'sutradhar-cli-1790000000703-AbC123', (p) => fsp.writeFile(p, JSON.stringify({ chromePid: deadPid, cliPid: 1 })));
const r3 = await TP.removeSessionTempProfile(dd, undefined, { tmpRoot: rd, scan: async () => [] });
check('N1 control: VALID marker with a dead owner -> removed', r3.removed === true && !(await exists(dd)), `deadPid=${deadPid} ${JSON.stringify(r3)}`);
// valid marker, live owner (this probe process): owner-alive (kept)
const rl = await fsp.mkdtemp(path.join(T, 'ctl-')); const dl = await mk(rl, 'sutradhar-cli-1790000000704-AbC123', (p) => fsp.writeFile(p, JSON.stringify({ chromePid: process.pid, cliPid: 1 })));
const r4 = await TP.removeSessionTempProfile(dl, undefined, { tmpRoot: rl, scan: async () => [] });
check('N1 control: VALID marker with a live owner -> owner-alive (kept)', r4.removed === false && r4.reason === 'owner-alive' && (await exists(dl)), JSON.stringify(r4));
done();
