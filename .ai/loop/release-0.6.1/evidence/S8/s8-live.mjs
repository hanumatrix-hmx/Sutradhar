// S8 auditor live harness: B1 (two concurrent sessions), B4 (sweep of 50 small + 1 ~200 MB stale dir), B5 (TEMP mismatch at close),
// C4 (FR2-14: nav with a real .sutradhar.json), CLR (a clearState failure during close: exit code vs 0.6.0).
// Run ONLY under the ISOLATION PREAMBLE. Env: S8_SP, S8_WT, S8_EV, CASES. Kills only Chrome whose live CIM CommandLine holds OUR dir basename.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { pathToFileURL } from 'node:url';
const norm = (p) => path.resolve(String(p)).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.S8_SP, WT = process.env.S8_WT, EVD = process.env.S8_EV;
if (!SP || !WT || !EVD) { console.error('S8_SP/S8_WT/S8_EV required'); process.exit(2); }
const ISO = path.resolve(os.tmpdir());
if (process.platform !== 'win32' || !norm(ISO).startsWith(norm(SP) + '/')) { console.error(`HARNESS GUARD: tmpdir=${ISO} not under ${SP}`); process.exit(97); }
console.log(`[iso-guard-harness] tmpdir=${norm(ISO)} pid=${process.pid} node=${process.version}`);
const TEMPB = path.join(path.resolve(SP), 'S8y');
const LOGS = path.join(EVD, 'logs'); fs.mkdirSync(LOGS, { recursive: true });
const CLI_BIN = path.join(WT, 'packages/sutradhar/dist/cli-bin.js');
const TP = await import(pathToFileURL(path.join(WT, 'packages/cli/dist/temp-profile.js')).href);
const SYS = process.env.SystemRoot || 'C:\Windows';
const TASKLIST = path.join(SYS, 'System32', 'tasklist.exe'), TASKKILL = path.join(SYS, 'System32', 'taskkill.exe'), POWERSHELL = path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const CASES = (process.env.CASES ?? 'B1,B5,C4,CLR,B4').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' :: ' + d : ''}`); if (!ok) fails++; return !!ok; };
const info = (...a) => console.log('INFO', ...a);
const PIDS = path.join(EVD, 'our-pids.txt'); const ours = [];
const rec = (kind, pid, note = '') => { fs.appendFileSync(PIDS, `${new Date().toISOString()} ${kind} pid=${pid} ${note}\n`); ours.push({ kind, pid, note }); };
rec('harness', process.pid);
const REAL_TEMP = 'E:/AI-Cache/tmp'; const realList = () => fs.readdirSync(REAL_TEMP).filter((n) => n.startsWith('sutradhar-cli-')).sort(); const REAL0 = realList();
if (REAL0.length < 1) { console.error('real TEMP snapshot empty: refusing'); process.exit(97); }
const realSnap = (t) => { const now = realList(); console.log(`REALTEMP ${t} count=${now.length} baseline=${REAL0.length} disappeared=[${REAL0.filter((n) => !now.includes(n))}] appeared=[${now.filter((n) => !REAL0.includes(n))}]`); };
function cimCmd(pid) { const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process -Filter "ProcessId=$env:S8_QPID" | ForEach-Object { $_.CommandLine }'], { encoding: 'utf-8', timeout: 60_000, env: { ...process.env, S8_QPID: String(pid) }, windowsHide: true }); return (r.stdout ?? '').trim(); }
function tasklistHas(pid) { const r = spawnSync(TASKLIST, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf-8', timeout: 30_000, windowsHide: true }); return new RegExp(`"${pid}"`).test(r.stdout ?? ''); }
const ourAlive = (pid, base) => tasklistHas(pid) && cimCmd(pid).toLowerCase().includes(base.toLowerCase());
async function killOurs(pid, base, note) { if (!pid || !base) return; if (!cimCmd(pid).toLowerCase().includes(base.toLowerCase())) { info(`not ours / gone: pid ${pid} (${note})`); return; } info(`ownership confirmed pid ${pid} (${note}); taskkill /T /F`); spawnSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { timeout: 30_000, windowsHide: true }); const t0 = performance.now(); while (performance.now() - t0 < 15_000 && ourAlive(pid, base)) await sleep(250); info(`pid ${pid} gone=${!ourAlive(pid, base)}`); }
const pages = spawn(process.execPath, [path.join(WT, '.ai/loop/release-0.6.1/evidence/S7/s7-pages-server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }); rec('pages-server', pages.pid);
const PORT = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('pages server did not start')), 20_000); pages.stdout.on('data', (d) => { b += d; const m = /PORT (\d+)/.exec(b); if (m) { clearTimeout(t); res(Number(m[1])); } }); });
const BASE = `http://127.0.0.1:${PORT}`;
let n = 0;
function env(o) { const { tmp, stateDir, extra = {} } = o; const config = 'config' in o ? o.config : 'none'; const e = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, SUTRADHAR_CLI_STATE_DIR: stateDir, SUTRADHAR_CLI_DEBUG_CLEANUP: '1', ...extra }; if (config === undefined) delete e.SUTRADHAR_CONFIG; else e.SUTRADHAR_CONFIG = config; return e; }
const readSt = (sd) => { try { return JSON.parse(fs.readFileSync(path.join(sd, 'state.json'), 'utf-8')); } catch { return undefined; } };
function save(tag, r) { const b = path.join(LOGS, `${tag}-${++n}`); fs.writeFileSync(b + '.stderr', r.stderr ?? ''); fs.writeFileSync(b + '.stdout', r.stdout ?? ''); return b; }
function cli(args, o, tag) { const t0 = performance.now(); const r = spawnSync(process.execPath, [CLI_BIN, ...args], { env: env(o), cwd: o.cwd ?? o.tmp, encoding: 'utf-8', timeout: 120_000, windowsHide: true, maxBuffer: 64 << 20 }); const ms = Math.round(performance.now() - t0); save(tag, r); const st = readSt(o.stateDir); if (st?.chromePid) rec('chromePid', st.chromePid, tag); console.log(`CLI ${tag} [${args.join(' ')}] exit=${r.status} ${ms}ms${r.error ? ' ERR ' + r.error.code : ''}`); return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms, st }; }
function cliAsync(args, o, tag) { return new Promise((res) => { const t0 = performance.now(); const c = spawn(process.execPath, [CLI_BIN, ...args], { env: env(o), cwd: o.cwd ?? o.tmp, windowsHide: true }); rec('cli-async', c.pid, tag); let so = '', se = ''; c.stdout.on('data', (d) => (so += d)); c.stderr.on('data', (d) => (se += d)); const k = setTimeout(() => c.kill(), 120_000); c.on('exit', (code) => { clearTimeout(k); const ms = Math.round(performance.now() - t0); save(tag, { stdout: so, stderr: se }); console.log(`CLI ${tag} [${args.join(' ')}] exit=${code} ${ms}ms (async)`); res({ code, stdout: so, stderr: se, ms }); }); }); }
const reason = (stderr, dir) => stderr.split(/\r?\n/).filter((l) => /^\[cleanup\] (kept|decision)/.test(l) && norm(/path="([^"]+)"/.exec(l)?.[1] ?? '') === norm(dir)).map((l) => /reason=(\S+)/.exec(l)?.[1]);
const listing = (d) => { const out = []; (function w(x, r) { let es; try { es = fs.readdirSync(x, { withFileTypes: true }); } catch { return; } for (const e of es) { const rr = r ? r + '/' + e.name : e.name; out.push(rr); if (e.isDirectory()) w(path.join(x, e.name), rr); } })(d, ''); return out; };
const live = [];
async function caseB1() {
  console.log('==== B1 two sessions at once (+ a third session sweeping while both are live, backdated)');
  const sA = path.join(ISO, 'stA'), sB = path.join(ISO, 'stB'), sC = path.join(ISO, 'stC');
  const [a, b] = await Promise.all([cliAsync(['nav', `${BASE}/?b1a`], { tmp: ISO, stateDir: sA }, 'B1-navA'), cliAsync(['nav', `${BASE}/?b1b`], { tmp: ISO, stateDir: sB }, 'B1-navB')]);
  const A = readSt(sA), B = readSt(sB);
  if (A?.chromePid) { rec('chromePid', A.chromePid, 'B1 A'); live.push({ pid: A.chromePid, base: path.basename(A.userDataDir) }); }
  if (B?.chromePid) { rec('chromePid', B.chromePid, 'B1 B'); live.push({ pid: B.chromePid, base: path.basename(B.userDataDir) }); }
  check('B1 both concurrent navs exit 0', a.code === 0 && b.code === 0, `A=${a.code} B=${b.code}`);
  if (!A || !B) return check('B1 both states present', false);
  check('B1 distinct temp dirs under ISO', A.userDataDir !== B.userDataDir && norm(path.dirname(A.userDataDir)) === norm(ISO) && norm(path.dirname(B.userDataDir)) === norm(ISO), `${path.basename(A.userDataDir)} ${path.basename(B.userDataDir)}`);
  check('B1 neither concurrent start removed the other dir', fs.existsSync(A.userDataDir) && fs.existsSync(B.userDataDir));
  const preA = listing(A.userDataDir), preB = listing(B.userDataDir);
  const past = new Date(Date.now() - 25 * 60_000); fs.utimesSync(A.userDataDir, past, past); fs.utimesSync(B.userDataDir, past, past);
  info(`B1 backdated both dirs by 25 min; A entries=${preA.length} B entries=${preB.length}`);
  const c = cli(['nav', `${BASE}/?b1c`], { tmp: ISO, stateDir: sC }, 'B1-navC'); const C = c.st; if (C?.chromePid) live.push({ pid: C.chromePid, base: path.basename(C.userDataDir) });
  check('B1 third session start exit 0', c.code === 0);
  const rA = reason(c.stderr, A.userDataDir), rB = reason(c.stderr, B.userDataDir);
  check('B1 third session sweep CONSIDERED both live dirs and kept them (in-use/owner-alive)', rA.length > 0 && rB.length > 0 && [...rA, ...rB].every((r) => r === 'in-use' || r === 'owner-alive'), `A=${rA} B=${rB}`);
  const misA = preA.filter((e) => !fs.existsSync(path.join(A.userDataDir, e))), misB = preB.filter((e) => !fs.existsSync(path.join(B.userDataDir, e)));
  check('B1 no pre-existing entry missing in either live dir', misA.length === 0 && misB.length === 0, `missA=${JSON.stringify(misA.slice(0, 5))} missB=${JSON.stringify(misB.slice(0, 5))}`);
  const eA = cli(['eval', '1+41'], { tmp: ISO, stateDir: sA }, 'B1-evalA'), eB = cli(['eval', '2+40'], { tmp: ISO, stateDir: sB }, 'B1-evalB');
  check('B1 both sessions still work after the third start', eA.code === 0 && /42/.test(eA.stdout) && eB.code === 0 && /42/.test(eB.stdout), `A=${eA.code}:${eA.stdout.trim()} B=${eB.code}:${eB.stdout.trim()}`);
  const [ca, cb] = await Promise.all([cliAsync(['close'], { tmp: ISO, stateDir: sA }, 'B1-closeA'), cliAsync(['close'], { tmp: ISO, stateDir: sB }, 'B1-closeB')]);
  check('B1 concurrent closes exit 0', ca.code === 0 && cb.code === 0, `A=${ca.code} B=${cb.code}`);
  check('B1 each close removed its own dir', !fs.existsSync(A.userDataDir) && !fs.existsSync(B.userDataDir));
  check('B1 the third session dir survived both closes', C && fs.existsSync(C.userDataDir));
  const eC = cli(['eval', '6*7'], { tmp: ISO, stateDir: sC }, 'B1-evalC'); check('B1 third session still works', eC.code === 0 && /42/.test(eC.stdout));
  const cc = cli(['close'], { tmp: ISO, stateDir: sC }, 'B1-closeC'); check('B1 third close exit 0 + dir gone', cc.code === 0 && C && !fs.existsSync(C.userDataDir));
  for (const [p, s] of [[A.chromePid, A], [B.chromePid, B], [C?.chromePid, C]]) if (p) check(`B1 chrome ${p} gone`, !ourAlive(p, path.basename(s.userDataDir)));
}
async function caseB5() {
  console.log('==== B5 TEMP mismatch between nav and close');
  const sd = path.join(ISO, 'stD'); fs.mkdirSync(TEMPB, { recursive: true });
  const nv = cli(['nav', `${BASE}/?b5`], { tmp: ISO, stateDir: sd }, 'B5-nav'); const st = nv.st;
  if (!st) return check('B5 state after nav', false);
  live.push({ pid: st.chromePid, base: path.basename(st.userDataDir) });
  const cl = cli(['close'], { tmp: TEMPB, stateDir: sd }, 'B5-closeOtherTemp');
  check('B5 close exit 0', cl.code === 0, `exit=${cl.code}`);
  check('B5 warning names not-auto-temp', /could not remove temp profile .*\(not-auto-temp\)/.test(cl.stderr), cl.stderr.split(/\r?\n/).find((l) => l.startsWith('Warning')) ?? '');
  check('B5 dir kept', fs.existsSync(st.userDataDir));
  check('B5 state cleared', !fs.existsSync(path.join(sd, 'state.json')));
  check('B5 chrome gone (kill unchanged)', !ourAlive(st.chromePid, path.basename(st.userDataDir)));
  const r = await TP.removeSessionTempProfile(st.userDataDir, undefined, { tmpRoot: ISO }); check('B5 leftover removed via the module with the right root', r.removed === true, JSON.stringify(r));
}
async function caseC4() {
  console.log('==== C4 FR2-14: nav with a real .sutradhar.json (viewport) in cwd, SUTRADHAR_CONFIG unset');
  const proj = path.join(ISO, 'proj'); fs.mkdirSync(proj, { recursive: true }); fs.writeFileSync(path.join(proj, '.sutradhar.json'), JSON.stringify({ viewport: { width: 901, height: 677 } }));
  const sd = path.join(ISO, 'stE');
  const nv = cli(['nav', `${BASE}/?c4`], { tmp: ISO, stateDir: sd, cwd: proj, config: undefined }, 'C4-nav'); const st = nv.st;
  if (st) live.push({ pid: st.chromePid, base: path.basename(st.userDataDir) });
  check('C4 nav exit 0', nv.code === 0, nv.stderr.split(/\r?\n/).filter((l) => /Error|Warning/.test(l)).join(' | '));
  const ev = cli(['eval', "innerWidth+'x'+innerHeight"], { tmp: ISO, stateDir: sd, cwd: proj, config: undefined }, 'C4-eval');
  check('C4 viewport from .sutradhar.json applied (901x677)', ev.code === 0 && /901x677/.test(ev.stdout), ev.stdout.trim());
  const cl = cli(['close'], { tmp: ISO, stateDir: sd, cwd: proj, config: undefined }, 'C4-close');
  check('C4 close exit 0, temp dir removed', cl.code === 0 && st && !fs.existsSync(st.userDataDir));
}
async function caseCLR() {
  console.log('==== CLR clearState fails during close (state.json held open without FILE_SHARE_DELETE)');
  const sd = path.join(ISO, 'stF');
  const nv = cli(['nav', `${BASE}/?clr`], { tmp: ISO, stateDir: sd }, 'CLR-nav'); const st = nv.st;
  if (!st) return check('CLR state after nav', false);
  live.push({ pid: st.chromePid, base: path.basename(st.userDataDir) });
  const holder = spawn(POWERSHELL, ['-NoProfile', '-Command', "$f=[IO.File]::Open($env:S8_LOCKPATH,'Open','Read','ReadWrite'); 'ready'; [Console]::In.ReadLine() | Out-Null; $f.Close()"], { env: { ...process.env, S8_LOCKPATH: path.join(sd, 'state.json') }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  rec('state-holder', holder.pid);
  await new Promise((res) => { const t = setTimeout(res, 15_000); holder.stdout.on('data', (d) => { if (/ready/.test(String(d))) { clearTimeout(t); res(); } }); });
  const cl = cli(['close'], { tmp: ISO, stateDir: sd }, 'CLR-close');
  const after = readSt(sd);
  info(`CLR close exit=${cl.code} stdout=${JSON.stringify(cl.stdout.trim())} warn=${JSON.stringify(cl.stderr.split(/\r?\n/).filter((l) => /^Warning|Error/.test(l)))} state.json-after=${after ? 'PRESENT chromePid=' + after.chromePid : 'absent'}`);
  console.log(`OBS CLR 0.6.1 close with a failing clearState -> exit=${cl.code}, "Session closed." printed=${/Session closed\./.test(cl.stdout)}, state.json still records chromePid=${after?.chromePid} (0.6.0 code: an unguarded "await clearState()" rejects -> main().catch -> exit 1)`);
  holder.stdin.end(); const t0 = performance.now(); while (performance.now() - t0 < 15_000 && holder.exitCode === null) await sleep(100); info(`holder exited=${holder.exitCode !== null}`);
  check('CLR chrome killed anyway', !ourAlive(st.chromePid, path.basename(st.userDataDir)));
  const second = cli(['close'], { tmp: ISO, stateDir: sd }, 'CLR-close2');
  console.log(`OBS CLR second close exit=${second.code} phase-kill-line=${/phase kill/.test(second.stderr)} (a stale recorded PID ${st.chromePid} is killed again)`);
  if (fs.existsSync(st.userDataDir)) { const r = await TP.removeSessionTempProfile(st.userDataDir, undefined, { tmpRoot: ISO }); info(`CLR leftover removal ${JSON.stringify(r)}`); }
}
async function caseB4() {
  console.log('==== B4 sweep: 50 small stale dirs + one ~200 MB stale dir, via a real session start');
  const mk = (name, files, size) => { const d = path.join(ISO, name); fs.mkdirSync(path.join(d, 'Default'), { recursive: true }); const buf = Buffer.alloc(size, 7); for (let i = 0; i < files; i++) fs.writeFileSync(path.join(d, 'Default', `f${i}.bin`), buf); const past = new Date(Date.now() - 60 * 60_000); fs.utimesSync(d, past, past); return d; };
  const small = []; for (let i = 0; i < 50; i++) small.push(mk(`sutradhar-cli-17000000${String(10000 + i)}-B4s${String(i).padStart(2, '0')}`, 3, 1024));
  const t0 = performance.now(); const big = mk('sutradhar-cli-1700000099999-B4BIG', 2000, 100 * 1024); info(`B4 created 51 dirs, big=2000x100KiB in ${Math.round(performance.now() - t0)} ms`);
  const sd = path.join(ISO, 'stG');
  const nv = cli(['nav', `${BASE}/?b4`], { tmp: ISO, stateDir: sd }, 'B4-nav'); const st = nv.st; if (st) live.push({ pid: st.chromePid, base: path.basename(st.userDataDir) });
  const sweepMs = Number(/\[cleanup\] phase sweep ms=(\d+)/.exec(nv.stderr)?.[1]);
  const removed = (nv.stderr.match(/^\[cleanup\] removed path=/gm) ?? []).length; const keptDeadline = (nv.stderr.match(/^\[cleanup\] kept .*reason=deadline/gm) ?? []).length;
  info(`B4 phase sweep ms=${sweepMs} removed=${removed} kept-deadline=${keptDeadline} whole-nav=${nv.ms}`);
  check('B4 nav exit 0', nv.code === 0);
  check('B4 sweep phase <= 15 s + one in-flight rm (<= 20 s observed bound)', Number.isFinite(sweepMs) && sweepMs <= 20_000, `sweep=${sweepMs}`);
  check('B4 every candidate either removed or kept with reason=deadline', removed + keptDeadline === 51, `removed=${removed} keptDeadline=${keptDeadline}`);
  const cl = cli(['close'], { tmp: ISO, stateDir: sd }, 'B4-close'); check('B4 close exit 0', cl.code === 0);
  for (const d of [...small, big]) if (fs.existsSync(d)) { const r = await TP.removeSessionTempProfile(d, undefined, { tmpRoot: ISO }); info(`B4 leftover ${path.basename(d)} ${JSON.stringify(r)}`); }
}
const startedAt = new Date().toISOString(); info(`start ${startedAt} CASES=${CASES} cli-bin=${CLI_BIN}`);
try {
  for (const c of CASES) { try { await ({ B1: caseB1, B5: caseB5, C4: caseC4, CLR: caseCLR, B4: caseB4 })[c](); } catch (e) { check(`${c} threw`, false, e.stack); } realSnap(c); }
} finally {
  for (const l of live) if (l.pid && ourAlive(l.pid, l.base)) await killOurs(l.pid, l.base, 'end-of-run straggler');
  try { pages.stdin.end(); pages.kill(); } catch {}
  console.log(`RESULT fails=${fails}`); process.exitCode = fails ? 1 : 0;
}
