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
header('wsl-c5a argv longer than 4096 chars');
const T = await mkroot('c5a-');
for (const pad of [100, 4200, 70000]) {
  const dir = await profileDir(path.join(T, `sutradhar-cli-17900000004${String(pad).length}-AbC123`), { lockfile: false }); P('dir', dir, `pad=${pad}`);
  const sb = standin(['--pad=' + 'x'.repeat(pad), `--user-data-dir=${dir}`]); await sleep(1000);
  const scan = await TP.scanCommandLines(); const hit = (scan ?? []).some((l) => l.includes(path.basename(dir)));
  console.log(`INFO pad=${pad} scan lines=${scan?.length} longest=${Math.max(0, ...(scan ?? []).map((l) => l.length))} hit=${hit}`);
  const r = await TP.removeSessionTempProfile(dir, undefined, { tmpRoot: T, removeTimeoutMs: 500 }); P('close-result', dir, `removed=${r.removed} reason=${r.reason}`);
  check(`C5a pad=${pad} -> in-use`, r.removed === false && r.reason === 'in-use', JSON.stringify(r));
  await stop(sb);
}
done();
