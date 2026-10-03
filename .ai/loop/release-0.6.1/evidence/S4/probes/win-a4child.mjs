import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
import { execFile } from 'node:child_process';
header('win-a4child (A4-pre, A4, B2, A5 on a live browser)');
const dir = process.env.PROBE_DIR, T = process.env.PROBE_ROOT, port = process.env.PROBE_PORT, bpid = Number(process.env.PROBE_BPID);
P('dir', dir); P('tmpRoot', T);
check('PROBE_DIR under os.tmpdir()', path.resolve(dir).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep));
const ver = async () => { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); return r.ok; } catch { return false; } };
check('browser answers /json/version at start', await ver());
// A4-pre
const lf = path.join(dir, 'lockfile'); P('lockfile', lf);
check('A4-pre lockfile exists', await exists(lf));
let code = 'NO-ERROR'; try { await fsp.rm(lf, { force: true }); } catch (e) { code = e.code; }
check('A4-pre rm(lockfile) rejects EBUSY/EPERM', code === 'EBUSY' || code === 'EPERM', `code=${code}`);
check('A4-pre lockfile still there', await exists(lf));
// churn control: two snapshots with no removal in between
const c0 = await tree(dir); await sleep(1500); const c1 = await tree(dir);
console.log(`INFO churn-control count ${c0.count}->${c1.count} bytes ${c0.bytes}->${c1.bytes} missing=${JSON.stringify(C.missing(c0, c1))}`);
// A4 close path, rule 5 isolated (no marker, scan [], no chromePid, minAge 0)
check('A4 no marker present (isolation)', !(await exists(path.join(dir, '.sutradhar-owner.json'))));
const b = await tree(dir);
const r = await TP.removeSessionTempProfile(dir, undefined, { tmpRoot: T, scan: async () => [], removeTimeoutMs: 1500 });
P('close-result', dir, `removed=${r.removed} reason=${JSON.stringify(r.reason)}`);
const a = await tree(dir);
check('A4 close removed:false', r.removed === false, JSON.stringify(r));
check('A4 close no file missing', C.missing(b, a).length === 0, `count ${b.count}->${a.count} bytes ${b.bytes}->${a.bytes} missing=${JSON.stringify(C.missing(b, a))}`);
console.log(`INFO A4 close count ${b.count}->${a.count} bytes ${b.bytes}->${a.bytes}`);
check('A4 /json/version still answers after close attempt', await ver());
// A4 sweep variant
const b2 = await tree(dir);
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [], minAgeMs: 0 });
for (const k of sw.kept) P('sweep-kept', k.dir, `reason=${JSON.stringify(k.reason)}`); for (const x of sw.removed) P('sweep-removed', x);
const a2 = await tree(dir);
check('A4 sweep kept the live dir', sw.removed.length === 0 && (await exists(dir)));
check('A4 sweep no file missing', C.missing(b2, a2).length === 0, `count ${b2.count}->${a2.count} bytes ${b2.bytes}->${a2.bytes} missing=${JSON.stringify(C.missing(b2, a2))}`);
check('A4 /json/version still answers after sweep', await ver());
// B2: backdated > 10 min, REAL scan, default minAge
await setOld(dir, 25);
const st = await fsp.stat(dir); console.log(`INFO B2 dir ageMin=${((Date.now() - st.mtimeMs) / 60000).toFixed(1)}`);
const sw2 = await TP.sweepStaleTempProfiles({ tmpRoot: T });
for (const k of sw2.kept) P('b2-kept', k.dir, `reason=${JSON.stringify(k.reason)}`); for (const x of sw2.removed) P('b2-removed', x);
check('B2 real-scan sweep keeps backdated live dir as in-use', sw2.removed.length === 0 && sw2.kept.some((k) => k.dir === dir && k.reason === 'in-use'), JSON.stringify(sw2.kept.map((k) => k.reason)));
// B2 variant: marker with live browser PID, scan [] -> owner-alive
await fsp.writeFile(path.join(dir, '.sutradhar-owner.json'), JSON.stringify({ chromePid: bpid, cliPid: process.pid, createdAt: new Date().toISOString() }));
await setOld(dir, 25);
const sw3 = await TP.sweepStaleTempProfiles({ tmpRoot: T, scan: async () => [] });
check('B2 marker variant keeps as owner-alive', sw3.removed.length === 0 && sw3.kept.some((k) => k.dir === dir && k.reason === 'owner-alive'), JSON.stringify(sw3.kept.map((k) => k.reason)));
await fsp.rm(path.join(dir, '.sutradhar-owner.json'));
// A5 real scan, rule 2 isolated (no marker, no chromePid, minAge 0 on close path)
const r5 = await TP.removeSessionTempProfile(dir, undefined, { tmpRoot: T, removeTimeoutMs: 1500 });
P('a5-close-result', dir, `removed=${r5.removed} reason=${JSON.stringify(r5.reason)}`);
check('A5 real scan -> in-use', r5.removed === false && r5.reason === 'in-use', JSON.stringify(r5));
// attribution: processes whose command line holds the basename (basename via env, never argv)
const ps = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const script = "$b=$env:PROBE_BASE; Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; hit=([string]$_.CommandLine).ToLower().Contains($b.ToLower()) } } | ConvertTo-Json -Compress";
const out = await new Promise((res) => execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, PROBE_BASE: path.basename(dir) }, maxBuffer: 64 << 20, timeout: 60000, windowsHide: true }, (e, so) => res(e ? null : so)));
if (out === null) check('A5 attribution query ran', false); else {
  const all = JSON.parse(out); const byPid = new Map(all.map((p) => [p.pid, p]));
  const isDesc = (pid) => { for (let i = 0, p = pid; i < 50 && p; i++) { if (p === bpid) return true; p = byPid.get(p)?.ppid; } return false; };
  const hits = all.filter((p) => p.hit);
  console.log(`INFO A5 attribution hits=${JSON.stringify(hits.map((h) => `${h.pid}/${h.ppid}/${h.name}`))}`);
  check('A5 attribution non-empty', hits.length > 0);
  check('A5 attribution only our browser tree', hits.every((h) => isDesc(h.pid)), JSON.stringify(hits.filter((h) => !isDesc(h.pid))));
  check('A5 attribution excludes the probe', !hits.some((h) => h.pid === process.pid));
}
check('final /json/version answers', await ver());
done();
