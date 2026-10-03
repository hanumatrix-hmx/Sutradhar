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
header('wsl-a2 symlink as candidate (A2, C5-live c)');
const T = await mkroot('a2-root-'); const VR = await mkroot('a2-victims-'); P('tmpRoot', T); P('victimRoot', VR);
const cases = []; let deadPid = 4190000; while (TP.isPidAlive(deadPid)) deadPid++; console.log('INFO victim SingletonLock uses dead pid ' + deadPid);
for (const [mode, type] of [['sweep', 'dir'], ['close', 'dir'], ['sweep', 'file'], ['close', 'file']]) {
  const n = cases.length; const victim = path.join(VR, `victim-${mode}-${type}`); let link;
  if (type === 'file') { await fsp.mkdir(victim); await fsp.writeFile(path.join(victim, 'precious.txt'), 'x'.repeat(100)); link = path.join(T, `sutradhar-cli-179000000002${n}`); await fsp.symlink(path.join(victim, 'precious.txt'), link); }
  else { await profileDir(victim); await fsp.symlink('host-' + deadPid, path.join(victim, 'SingletonLock')); link = path.join(T, `sutradhar-cli-179000000001${n}`); await fsp.symlink(victim, link); }
  P('victim', victim); P('link', link, `type=${type}`); cases.push({ mode, type, victim, link, before: await tree(victim) });
}
for (const c of cases.filter((c) => c.mode === 'close')) { const r = await TP.removeSessionTempProfile(c.link, undefined, { tmpRoot: T, scan: async () => [], removeTimeoutMs: 1000 }); P('close-result', c.link, `removed=${r.removed} reason=${r.reason}`); }
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 });
for (const r of sw.removed) P('sweep-removed', r); for (const k of sw.kept) P('sweep-kept', k.dir, `reason=${k.reason}`);
for (const c of cases) { const a = await tree(c.victim); check(`A2 ${c.mode} ${c.type} victim intact`, sameTree(c.before, a), `missing=${JSON.stringify(C.missing(c.before, a))} linkStillThere=${await exists(c.link)}`); }
done();
