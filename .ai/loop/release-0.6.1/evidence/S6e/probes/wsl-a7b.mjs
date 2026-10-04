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
import { execFile } from 'node:child_process';
header('wsl-a7b scanner unavailable -> null -> dir KEPT (additive to wsl-a7; replaces its two PATH checks)');
// The S4 wsl-a7 checks "ps unresolvable" set PATH='' and assumed the scanner is a bare `ps`. The 0.6.1 Linux scanner reads
// /proc and the other POSIX scanner is the absolute /bin/ps, so PATH is irrelevant. The property they protected is proven here
// through the module's own seams: when the scanner source is unreadable / missing / too slow the scan is null and the dir is KEPT.
// Negative controls (so this probe can FAIL): with a working scanner and a dir nobody uses the very same dir shape IS removed.
const T = await mkroot('a7b-');
const stale = async (name) => { const d = await profileDir(path.join(T, name), { lockfile: false }); await setOld(d); P('dir', d); return d; };
const ENOENT = Object.assign(new Error('no /proc'), { code: 'ENOENT' }); const EACCES = Object.assign(new Error('denied'), { code: 'EACCES' });
const scannerVariants = {
  'readdir of /proc fails (ENOENT)': (ms) => TP.scanCommandLines(ms, { platform: 'linux', readProc: (m) => TP.readProcCommandLines(m, { readdir: async () => { throw ENOENT; }, readFile: async () => { throw ENOENT; } }) }),
  'every /proc/<pid>/cmdline unreadable (EACCES)': (ms) => TP.scanCommandLines(ms, { platform: 'linux', readProc: (m) => TP.readProcCommandLines(m, { readdir: (d) => fsp.readdir(d), readFile: async () => { throw EACCES; } }) }),
  'scanner binary missing (absolute path does not exist)': (ms) => TP.scanCommandLines(ms, { platform: 'darwin', run: (file, args, t) => new Promise((res) => execFile('/nonexistent-dir/ps', args, { timeout: t }, (e, so) => res(e ? null : so))) }),
  'scan timed out (1 ms) on the real /proc reader': () => TP.scanCommandLines(1),
};
let i = 0;
for (const [name, scan] of Object.entries(scannerVariants)) {
  const d = await stale(`sutradhar-cli-17900000005${i++}-AbC123`);
  const s = await scan(5000); check(`A7b [${name}] -> scan is null`, s === null, `got=${JSON.stringify(s)}`);
  const r = await TP.removeSessionTempProfile(d, undefined, { tmpRoot: T, scan });
  P('close-result', d, `removed=${r.removed} reason=${r.reason}`);
  check(`A7b [${name}] -> close keeps (scan-unavailable)`, r.removed === false && r.reason === 'scan-unavailable' && (await exists(d)), JSON.stringify(r));
  const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan, minAgeMs: 0 });
  check(`A7b [${name}] -> sweep keeps (scan-unavailable)`, !sw.removed.includes(d) && sw.kept.some((k) => k.dir === d && k.reason === 'scan-unavailable') && (await exists(d)), JSON.stringify(sw.kept.map((k) => path.basename(k.dir) + ':' + k.reason)));
}
// NEGATIVE CONTROL 1: scanner available (real /proc, default scan), dir not in use, same shape -> REMOVED.
const dc = await stale('sutradhar-cli-1790000000590-AbC123');
const real = await TP.scanCommandLines(); check('A7b control: real /proc scan works (array, not null)', Array.isArray(real), `len=${real?.length}`);
const rc = await TP.removeSessionTempProfile(dc, undefined, { tmpRoot: T });
P('close-result', dc, `removed=${rc.removed} reason=${rc.reason}`);
check('A7b control: scanner available + dir not in use -> removed (close)', rc.removed === true && !(await exists(dc)), JSON.stringify(rc));
const ds = await stale('sutradhar-cli-1790000000591-AbC123');
const swc = await TP.sweepStaleTempProfiles({ tmpRoot: T, minAgeMs: 0 });
check('A7b control: scanner available + dir not in use -> removed (sweep)', swc.removed.includes(ds) && !(await exists(ds)), JSON.stringify(swc));
// NEGATIVE CONTROL 2: scanner available, dir IN USE by a stand-in (path only in the stand-in's argv) -> in-use, kept.
const du = await stale('sutradhar-cli-1790000000592-AbC123');
const sb = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', `--user-data-dir=${du}`], { stdio: 'ignore' }); await sleep(1000);
const ru = await TP.removeSessionTempProfile(du, undefined, { tmpRoot: T });
P('close-result', du, `removed=${ru.removed} reason=${ru.reason}`);
check('A7b control: scanner available + dir in use -> in-use (kept)', ru.removed === false && ru.reason === 'in-use' && (await exists(du)), JSON.stringify(ru));
sb.kill('SIGKILL'); const t0 = performance.now(); while (performance.now() - t0 < 15000 && sb.exitCode === null && sb.signalCode === null) await sleep(100);
check('A7b control: stand-in exited', sb.exitCode !== null || sb.signalCode !== null);
const ru2 = await TP.removeSessionTempProfile(du, undefined, { tmpRoot: T });
check('A7b control: after the stand-in died the same dir is removed', ru2.removed === true && !(await exists(du)), JSON.stringify(ru2));
done();
