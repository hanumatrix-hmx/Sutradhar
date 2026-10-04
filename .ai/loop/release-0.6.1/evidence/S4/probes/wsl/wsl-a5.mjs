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
header('wsl-a5 rule 2 isolated + B2 (stand-in, real ps scan)');
const T = await mkroot('a5-');
const dir = await profileDir(path.join(T, 'sutradhar-cli-1790000000100-AbC123'), { lockfile: false }); P('dir', dir);
const sb = standin([`--user-data-dir=${dir}`]); await sleep(1000);
const r = await TP.removeSessionTempProfile(dir, undefined, { tmpRoot: T, removeTimeoutMs: 500 }); P('close-result', dir, `removed=${r.removed} reason=${r.reason}`);
check('A5 real ps scan -> in-use', r.removed === false && r.reason === 'in-use', JSON.stringify(r));
const hits = await attribution(path.basename(dir)); console.log(`INFO attribution=${JSON.stringify(hits)} standin=${sb.pid} probe=${process.pid}`);
check('A5 attribution only the stand-in, not the probe', hits.length === 1 && hits[0].startsWith(`${sb.pid}/${process.pid}`), JSON.stringify(hits));
await setOld(dir, 25);
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T });
check('B2 backdated live dir kept (real scan, default minAge)', sw.removed.length === 0 && sw.kept[0]?.reason === 'in-use', JSON.stringify(sw.kept.map((k) => k.reason)));
await fsp.writeFile(path.join(dir, '.sutradhar-owner.json'), JSON.stringify({ chromePid: sb.pid, cliPid: 1, createdAt: 'x' })); await setOld(dir, 25);
const sw2 = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [] });
check('B2 marker variant -> owner-alive', sw2.removed.length === 0 && sw2.kept[0]?.reason === 'owner-alive', JSON.stringify(sw2.kept.map((k) => k.reason)));
check('stand-in stopped', await stop(sb));
const r2 = await TP.removeSessionTempProfile(dir, undefined, { tmpRoot: T }); P('close-result-after', dir, `removed=${r2.removed}`);
check('A5 control: removed after stand-in died', r2.removed && !(await exists(dir)), JSON.stringify(r2));
done();
