import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
import { spawn, execFile } from 'node:child_process';
header('win-a5 rule 2 isolated (stand-in, path variants)');
const BS = String.fromCharCode(92), DQ = String.fromCharCode(34);
const ISO = os.tmpdir(); const T = await fsp.mkdtemp(path.join(ISO, 'a5-'));
const PS = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const variants = { backslash: (d) => d, forwardslash: (d) => d.split(path.sep).join('/'), quotedTrailing: (d) => DQ + d + BS + DQ, upper: (d) => d.toUpperCase() };
const attrScript = '$b=$env:PROBE_BASE; Get-CimInstance Win32_Process | Where-Object { ([string]$_.CommandLine).ToLower().Contains($b.ToLower()) } | ForEach-Object { [string]$_.ProcessId + "/" + [string]$_.ParentProcessId + "/" + $_.Name }';
let n = 0;
for (const [name, fmt] of Object.entries(variants)) {
  const dir = await profileDir(path.join(T, `sutradhar-cli-17900000001${n++}-AbC123`), { lockfile: false }); P('dir', dir, `variant=${name}`);
  const sb = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', `--user-data-dir=${fmt(dir)}`], { stdio: 'ignore', windowsHide: true });
  await sleep(1500);
  const r = await TP.removeSessionTempProfile(dir, undefined, { tmpRoot: T, removeTimeoutMs: 500 });
  P('close-result', dir, `removed=${r.removed} reason=${r.reason}`);
  check(`A5 ${name}: in-use with real scan`, r.removed === false && r.reason === 'in-use', JSON.stringify(r));
  const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, minAgeMs: 0 });
  check(`A5 ${name}: sweep keeps in-use`, !sw.removed.includes(dir) && sw.kept.some((k) => k.dir === dir && k.reason === 'in-use'), JSON.stringify(sw.kept.map((k) => path.basename(k.dir) + ':' + k.reason)));
  const out = await new Promise((res) => execFile(PS, ['-NoProfile', '-NonInteractive', '-Command', attrScript], { env: { ...process.env, PROBE_BASE: path.basename(dir) }, timeout: 60000, windowsHide: true }, (e, so) => res(e ? null : so.trim().split(/\r?\n/).filter(Boolean))));
  console.log(`INFO attribution ${name}: ${JSON.stringify(out)} standin=${sb.pid} probe=${process.pid}`);
  check(`A5 ${name}: attribution is only the stand-in, never the probe`, Array.isArray(out) && out.length === 1 && out[0].startsWith(`${sb.pid}/${process.pid}/`), JSON.stringify(out));
  sb.kill('SIGKILL'); const t0 = performance.now(); while (performance.now() - t0 < 15000 && sb.exitCode === null && sb.signalCode === null) await sleep(100);
  check(`A5 ${name}: stand-in exited`, sb.exitCode !== null || sb.signalCode !== null);
  const r2 = await TP.removeSessionTempProfile(dir, undefined, { tmpRoot: T, removeTimeoutMs: 2000 });
  P('close-result-after-kill', dir, `removed=${r2.removed} reason=${r2.reason}`);
  check(`A5 ${name}: removed after stand-in died (control)`, r2.removed && !(await exists(dir)), JSON.stringify(r2));
}
done();
