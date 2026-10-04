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
async function attribution(base) {
  const hits = [];
  for (const e of await fsp.readdir('/proc')) { if (!/^[0-9]+$/.test(e)) continue; let cl; try { cl = (await fsp.readFile(`/proc/${e}/cmdline`, 'utf-8')).split(String.fromCharCode(0)).join(' '); } catch { continue; } if (cl.toLowerCase().includes(base.toLowerCase())) { let pp = '?'; try { pp = (await fsp.readFile(`/proc/${e}/stat`, 'utf-8')).split(') ')[1].split(' ')[1]; } catch {} hits.push(`${e}/${pp}`); } }
  return hits;
}
const standin = (argv) => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', ...argv], { stdio: 'ignore' });
async function stop(cp) { cp.kill('SIGKILL'); const t0 = performance.now(); while (performance.now() - t0 < 15000 && cp.exitCode === null && cp.signalCode === null) await sleep(100); return cp.exitCode !== null || cp.signalCode !== null; }
header('wsl-a6 rule 3 isolated');
const T = await mkroot('a6-'); const dummy = standin([]); await sleep(800);
const d1 = await profileDir(path.join(T, 'sutradhar-cli-1790000000200-AbC123'), { lockfile: false, marker: dummy.pid }); await setOld(d1); P('dir', d1);
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 });
check('A6 owner-alive', sw.removed.length === 0 && sw.kept[0]?.reason === 'owner-alive', JSON.stringify(sw.kept.map((k) => k.reason)));
check('A6 dummy killed by PID', await stop(dummy));
const sw2 = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 }); for (const x of sw2.removed) P('removed', x);
check('A6 removed after kill', sw2.removed.length === 1 && !(await exists(d1)), JSON.stringify(sw2.kept));
done();
