// S7 live harness for the MERGED 0.6.1 CLI (GAP-315 + GAP-349 + close ordering). Run ONLY under the
// ISOLATION PREAMBLE (Git Bash, TEMP/TMP/TMPDIR/NODE_OPTIONS on the same command line).
//
// Env in : S7_SP (scratchpad root), S7_WT (worktree), S7_EV (evidence dir), CASES (comma list, default all),
//          ITER (overrides L1's iteration count), SUTRADHAR_CLI_DEBUG_CLEANUP=1 (set by the caller).
// Safety : kills ONLY PIDs this harness started, or a Chrome whose live CIM CommandLine contains OUR dir's
//          basename (checked immediately before the kill). Never kills by image name. Every wait has a hard cap.
//          A probed basename never appears in a launching command text (P7): CIM queries get the PID by env.
//          Never uses the POSIX tmp dir of Git Bash (P3): scratch lives under S7_SP only.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const norm = (p) => path.resolve(String(p)).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.S7_SP, WT = process.env.S7_WT, EVD = process.env.S7_EV;
if (!SP || !WT || !EVD) { console.error('S7_SP/S7_WT/S7_EV required'); process.exit(2); }
const ISO = path.resolve(os.tmpdir());
if (process.platform !== 'win32' || !norm(ISO).startsWith(norm(SP) + '/')) { console.error(`HARNESS GUARD: tmpdir=${ISO} is not under ${SP}`); process.exit(97); }
console.log(`[iso-guard-harness] tmpdir=${norm(ISO)} pid=${process.pid} node=${process.version}`);
const ISO_SP = path.join(path.resolve(SP), 'S 7'); // TEMP containing a space (L1s). 3 chars: keeps the profile path <= 200 (P5)
const LOGS = path.join(EVD, 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const STATE = path.join(ISO, 'state');
const STATE_SP = path.join(ISO_SP, 'state');
fs.mkdirSync(STATE, { recursive: true });
const CLI_BIN = path.join(WT, 'packages/sutradhar/dist/cli-bin.js');
const CLI_JS = path.join(WT, 'packages/cli/dist/cli.js');
const DIST = path.join(WT, 'packages/sutradhar/dist');
const REAL_TEMP = 'E:/AI-Cache/tmp'; // hard-coded, never derived from TEMP/os.tmpdir()
if (norm(REAL_TEMP) === norm(ISO)) { console.error('REAL_TEMP equals ISO'); process.exit(97); }
const SYS = process.env.SystemRoot || 'C:\\Windows';
const TASKLIST = path.join(SYS, 'System32', 'tasklist.exe');
const TASKKILL = path.join(SYS, 'System32', 'taskkill.exe');
const POWERSHELL = path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const TP = await import(pathToFileURL(path.join(WT, 'packages/cli/dist/temp-profile.js')).href);
const CASES = (process.env.CASES ?? 'L1,L1s,L2,L3,L4,L5a,L5b,L7,L9,L12,L12m').split(',').map((s) => s.trim()).filter(Boolean);
const ITER = Number(process.env.ITER ?? 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let fails = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) fails++;
  return !!ok;
}
const info = (...a) => console.log('INFO', ...a);

// ---- our pids ----------------------------------------------------------------------------------
const PIDFILE = path.join(EVD, 'our-pids.txt');
const ourChromePids = new Set();
function recordPid(kind, pid, note = '') {
  fs.appendFileSync(PIDFILE, `${new Date().toISOString()} ${kind} pid=${pid} ${note}\n`);
  if (kind === 'chromePid' || kind === 'harness-chrome') ourChromePids.add(Number(pid));
}
recordPid('harness', process.pid, 'this harness');

// ---- real-TEMP snapshots (read-only) ---------------------------------------------------------------
const realList = () => fs.readdirSync(REAL_TEMP).filter((n) => n.startsWith('sutradhar-cli-')).sort();
const REAL0 = realList();
if (REAL0.length < 1) { console.error('real TEMP has no sutradhar-cli-* entries: refusing (snapshot sanity)'); process.exit(97); }
function realSnap(tag) {
  const now = realList();
  const gone = REAL0.filter((n) => !now.includes(n));
  const added = now.filter((n) => !REAL0.includes(n));
  console.log(`REALTEMP ${tag} count=${now.length} baseline=${REAL0.length} disappeared=[${gone.join(',')}] appeared=[${added.join(',')}]`);
  return { gone, added };
}

// ---- process helpers -------------------------------------------------------------------------------
function cimList() {
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 2'],
  { encoding: 'utf-8', timeout: 120_000, maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`cim list failed status=${r.status} ${r.error ?? ''}`);
  let a = JSON.parse(r.stdout); if (!Array.isArray(a)) a = [a];
  return a.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name ?? '', cmd: p.CommandLine ?? '' }));
}
function cimCmd(pid) { // the live CommandLine of ONE pid (pid passed by env: nothing probed in the command text)
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process -Filter "ProcessId=$env:S7_QPID" | ForEach-Object { $_.CommandLine }'],
  { encoding: 'utf-8', timeout: 60_000, env: { ...process.env, S7_QPID: String(pid) }, windowsHide: true });
  return (r.stdout ?? '').trim();
}
function tasklistHas(pid) {
  const r = spawnSync(TASKLIST, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf-8', timeout: 30_000, windowsHide: true });
  return new RegExp(`"${pid}"`).test(r.stdout ?? '');
}
/** read-only: is the Chrome we started (pid) still OURS and running? basename = our dir's basename */
function ourChromeAlive(pid, base) {
  if (!tasklistHas(pid)) return false;
  const cmd = cimCmd(pid).toLowerCase();
  if (base && cmd.includes(base.toLowerCase())) return true;
  info(`pid ${pid} is listed but its CommandLine does not reference ${base}: reused, not ours`);
  return false;
}
async function waitGone(pid, base, capMs = 15_000) {
  const t0 = performance.now();
  while (performance.now() - t0 < capMs) { if (!ourChromeAlive(pid, base)) return true; await sleep(250); }
  return false;
}
/** kill ONE Chrome tree by pid, only after the live ownership check (0.3). Never twice. */
async function killOurChrome(pid, base, note) {
  const cmd = cimCmd(pid).toLowerCase();
  if (!cmd.includes(base.toLowerCase())) { info(`ownership check failed for pid ${pid} (${note}): NOT killing`); return { killed: false, owned: false }; }
  info(`ownership confirmed for pid ${pid} (${note}); taskkill /T /F`);
  const r = spawnSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { encoding: 'utf-8', timeout: 30_000, windowsHide: true });
  info(`taskkill status=${r.status} ${(r.stdout || r.stderr || '').trim().split(/\r?\n/)[0]}`);
  const gone = await waitGone(pid, base, 15_000);
  return { killed: true, owned: true, gone };
}
function descendants(list, rootPid) {
  const set = new Set([rootPid]); let grew = true;
  while (grew) { grew = false; for (const p of list) if (set.has(p.ppid) && !set.has(p.pid)) { set.add(p.pid); grew = true; } }
  return set;
}
/** processes (CIM) whose command line references a path under `root` (case-insensitive, slash-insensitive) */
function procsUnder(roots) {
  const rs = roots.map((r) => norm(r) + '/');
  return cimList().filter((p) => { const c = p.cmd.replaceAll('\\', '/').toLowerCase(); return rs.some((r) => c.includes(r)); });
}
function assertNoStragglers(tag) {
  const left = procsUnder([ISO, ISO_SP]);
  const mine = [...ourChromePids].filter((p) => tasklistHas(p) && left.some((l) => l.pid === p));
  check(`${tag}: no process referencing ISO is still running`, left.length === 0 && mine.length === 0,
    `left=${left.map((l) => `${l.name}:${l.pid}`).join(',') || 'none'}`);
}

// ---- fs helpers ---------------------------------------------------------------------------------------
const cliDirs = (root) => (fs.existsSync(root) ? fs.readdirSync(root).filter((n) => n.startsWith('sutradhar-cli-')).sort() : []);
function snapshotEntries(dir) {
  const out = [];
  (function walk(d, rel) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { const r = rel ? rel + '/' + e.name : e.name; out.push(r); if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(d, e.name), r); }
  })(dir, '');
  return out;
}
function deadPid() {
  for (let p = 912000; p < 912400; p++) { try { process.kill(p, 0); } catch (e) { if (e.code === 'ESRCH' && !tasklistHas(p)) return p; } }
  throw new Error('no dead pid found');
}
function makeStaleDir(root, name, { marker = true, ageMin = 60, files = 3 } = {}) {
  const d = path.join(root, name);
  fs.mkdirSync(path.join(d, 'Default'), { recursive: true });
  for (let i = 0; i < files; i++) fs.writeFileSync(path.join(d, 'Default', `f${i}.dat`), `x${i}`.repeat(50));
  if (marker) fs.writeFileSync(path.join(d, '.sutradhar-owner.json'), JSON.stringify({ chromePid: deadPid(), cliPid: 1, createdAt: '2020-01-01T00:00:00Z' }));
  if (ageMin > 0) { const past = new Date(Date.now() - ageMin * 60_000); fs.utimesSync(d, past, past); }
  return d;
}
const readStateAt = (stateDir) => { try { return JSON.parse(fs.readFileSync(path.join(stateDir, 'state.json'), 'utf-8')); } catch { return undefined; } };
const stateFileExists = (stateDir) => fs.existsSync(path.join(stateDir, 'state.json'));
function recordWarden(stateDir) {
  try { const w = JSON.parse(fs.readFileSync(path.join(stateDir, 'warden.json'), 'utf-8')); if (w.pid) recordPid('warden', w.pid, 'from warden.json'); return w.pid; } catch { return undefined; }
}
const exists = (p) => fs.existsSync(p);
function pct(arr, q) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return (s[lo] + s[hi]) / 2; }
const stat = (arr) => `n=${arr.length} p50=${pct(arr, 0.5)} max=${arr.length ? Math.max(...arr) : NaN}`;

// ---- harness web server (a CHILD process: spawnSync below would block an in-process server) -----------------
const pages = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 's7-pages-server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
recordPid('pages-server', pages.pid, 'harness page server child');
const PORT = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('pages server did not start')), 20_000); pages.stdout.on('data', (d) => { b += d; const m = /PORT (\d+)/.exec(b); if (m) { clearTimeout(t); res(Number(m[1])); } }); });
const BASE = `http://127.0.0.1:${PORT}`;
const stopPages = () => { try { pages.stdin.end(); } catch { /* */ } try { pages.kill(); } catch { /* */ } };

// ---- CLI runner ----------------------------------------------------------------------------------------------
let callNo = 0;
function cliEnv({ tmp, stateDir, extra = {} }) {
  return { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, SUTRADHAR_CLI_STATE_DIR: stateDir, SUTRADHAR_CONFIG: 'none', SUTRADHAR_CLI_DEBUG_CLEANUP: '1', ...extra };
}
/** one CLI call through spawnSync (timeout 120 s). stderr -> logs/<tag>-<n>.stderr. */
function cli(args, { tag, tmp = ISO, stateDir = STATE, bin = CLI_BIN, extra = {} }) {
  const n = ++callNo;
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [bin, ...args], { env: cliEnv({ tmp, stateDir, extra }), cwd: tmp, encoding: 'utf-8', timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const ms = Math.round(performance.now() - t0);
  const stderr = r.stderr ?? '', stdout = r.stdout ?? '';
  const base = path.join(LOGS, `${tag}-${n}`);
  fs.writeFileSync(`${base}.stderr`, stderr);
  fs.writeFileSync(`${base}.stdout`, stdout);
  const st = readStateAt(stateDir);
  if (st?.chromePid) recordPid('chromePid', st.chromePid, `${tag}-${n} ${args[0]}`);
  recordWarden(stateDir);
  const timedOut = r.error?.code === 'ETIMEDOUT';
  if (timedOut) info(`TIMEOUT ${tag}-${n}: applying the indirect-Chrome rule`);
  console.log(`CLI ${tag}-${n} [${args.join(' ')}] exit=${r.status} ${ms}ms${timedOut ? ' TIMEOUT' : ''}`);
  return { code: r.status, stdout, stderr, ms, timedOut, n, logBase: base, state: st };
}
const lines = (s, re) => s.split(/\r?\n/).filter((l) => re.test(l));
const nums = (s, re) => lines(s, re).map((l) => Number(/ ms=(\d+)/.exec(l)?.[1])).filter((x) => Number.isFinite(x));
const T = { sweep: [], navScan: [], closeScan: [], kill: [], cleanup: [], navMs: [], closeMs: [] };

/** One nav+close iteration (L1/L2/L1s). Returns whether it fully passed. */
let iterNavStderr = '';
async function iteration(tag, i, { tmp, stateDir, bin }) {
  let ok = true;
  const sub = (name, cond, detail = '') => { if (!check(`${tag} iter ${i}: ${name}`, cond, detail)) ok = false; };
  const noCanary = (a) => a.filter((n) => n !== 'sutradhar-cli-1700000000009-CANARY');
  const pre = noCanary(cliDirs(tmp));
  const nav = cli(['nav', `${BASE}/?n=${tag}${i}`], { tag: `${tag}-nav${i}`, tmp, stateDir, bin });
  iterNavStderr = nav.stderr;
  const st = nav.state;
  sub('nav exit 0', nav.code === 0, `exit=${nav.code} ${nav.ms}ms`);
  if (!st) { sub('state.json present after nav', false); return false; }
  const dir = st.userDataDir;
  sub('tempProfile true', st.tempProfile === true);
  sub('(ii) dirname(userDataDir) == ISO', norm(path.dirname(dir)) === norm(tmp), `dirname=${norm(path.dirname(dir))}`);
  sub('--user-data-dir length <= 200 (P5)', dir.length <= 200, `len=${dir.length}`);
  sub('dir exists after nav', exists(dir));
  const base = path.basename(dir);
  T.navMs.push(nav.ms); T.sweep.push(...nums(nav.stderr, /^\[cleanup\] phase sweep /)); T.navScan.push(...nums(nav.stderr, /^\[cleanup\] scan /));
  const close = cli(['close'], { tag: `${tag}-close${i}`, tmp, stateDir, bin });
  sub('close exit 0', close.code === 0, `exit=${close.code} ${close.ms}ms`);
  sub('dir gone after close', !exists(dir));
  const alive = ourChromeAlive(st.chromePid, base);
  sub('Chrome PID gone', !alive, `pid=${st.chromePid}`);
  const iK = close.stderr.indexOf('[cleanup] phase kill'), iS = close.stderr.indexOf('[cleanup] state-cleared'), iC = close.stderr.indexOf('[cleanup] phase cleanup');
  sub('debug order phase kill -> state-cleared -> phase cleanup', iK >= 0 && iS > iK && iC > iS, `idx=${iK},${iS},${iC}`);
  sub('state.json absent after close', !stateFileExists(stateDir));
  T.closeMs.push(close.ms); T.kill.push(...nums(close.stderr, /^\[cleanup\] phase kill /)); T.cleanup.push(...nums(close.stderr, /^\[cleanup\] phase cleanup /)); T.closeScan.push(...nums(close.stderr, /^\[cleanup\] scan /));
  sub('no new sutradhar-cli-* left in TEMP', noCanary(cliDirs(tmp)).join() === pre.join(), `before=[${pre}] after=[${cliDirs(tmp)}]`);
  return ok;
}

// ---- cases ------------------------------------------------------------------------------------------------------
const CANARY = path.join(ISO, 'sutradhar-cli-1700000000009-CANARY');
let canaryDone = false;
function plantCanary() { makeStaleDir(ISO, path.basename(CANARY)); info(`canary planted ${CANARY}`); }
function checkCanary(navStderr) {
  const gone = !exists(CANARY);
  const rl = lines(navStderr, /^\[cleanup\] removed path=/).some((l) => norm(/path="([^"]+)"/.exec(l)?.[1] ?? '') === norm(CANARY));
  check('(i) canary dir swept by the first session start', gone && rl, `gone=${gone} removed-line=${rl}`);
  canaryDone = true;
}

async function caseL1(tag, count, bin) {
  info(`== ${tag}: ${count}x nav+close on ${path.relative(WT, bin)}`);
  for (let i = 1; i <= count; i++) {
    if (!canaryDone && tag === 'L1' && i === 1) {
      plantCanary();
      await iteration(tag, i, { tmp: ISO, stateDir: STATE, bin });
      checkCanary(iterNavStderr);
    } else await iteration(tag, i, { tmp: ISO, stateDir: STATE, bin });
  }
  if (tag === 'L1') {
    const lim = (name, arr, cap) => check(`L1 timing ${name} max <= ${cap}`, arr.length > 0 && Math.max(...arr) <= cap, stat(arr));
    lim('phase kill (ms)', T.kill, 10_500); lim('phase cleanup (ms)', T.cleanup, 15_500);
    const scans = [...T.navScan, ...T.closeScan];
    check('L1 timing scan max <= 4000 ms (flag for S8 if not)', scans.length > 0 && Math.max(...scans) <= 4000, stat(scans));
    console.log(`TIMING L1 whole-nav-ms ${stat(T.navMs)}`); console.log(`TIMING L1 whole-close-ms ${stat(T.closeMs)}`);
    console.log(`TIMING L1 phase-sweep-ms ${stat(T.sweep)}`); console.log(`TIMING L1 phase-kill-ms ${stat(T.kill)}`);
    console.log(`TIMING L1 phase-cleanup-ms ${stat(T.cleanup)}`); console.log(`TIMING L1 scan-ms (nav+close) ${stat(scans)}  nav-scan ${stat(T.navScan)} close-scan ${stat(T.closeScan)}`);
  }
}

async function caseL1s() {
  info('== L1s: TEMP containing a space');
  fs.mkdirSync(STATE_SP, { recursive: true });
  check('L1s TEMP really contains a space', ISO_SP.includes(' '), ISO_SP);
  for (let i = 1; i <= 2; i++) await iteration('L1s', i, { tmp: ISO_SP, stateDir: STATE_SP, bin: CLI_BIN });
}

async function startOwnChrome(dir, tag) {
  const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(exists);
  if (!chromePath) throw new Error('no Chrome');
  const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  if (dir.length > 200) throw new Error(`P5: user-data-dir too long (${dir.length})`);
  const child = spawn(chromePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'], { detached: true, stdio: 'ignore', windowsHide: true });
  let exited = false; child.on('exit', () => { exited = true; }); child.unref();
  recordPid('harness-chrome', child.pid, `${tag} started by harness; dir=${path.basename(dir)}`);
  const t0 = performance.now(); let up = false;
  while (performance.now() - t0 < 30_000 && !exited) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) { up = true; break; } } catch { /* not yet */ }
    await sleep(250);
  }
  const t1 = performance.now(); while (performance.now() - t1 < 10_000 && !exists(path.join(dir, 'lockfile'))) await sleep(200);
  return { pid: child.pid, port, up, exited: () => exited };
}
const versionUp = async (port) => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } };

async function caseL3() {
  info('== L3: in use (own Chrome on a stale-named, dead-marker dir)');
  const negDir = makeStaleDir(ISO, 'sutradhar-cli-1700000000000-NEG315', { files: 2 });
  const base = path.basename(negDir);
  const ch = await startOwnChrome(negDir, 'L3');
  check('L3 own Chrome is up and holds the dir', ch.up && exists(path.join(negDir, 'lockfile')), `pid=${ch.pid} port=${ch.port}`);
  const past = new Date(Date.now() - 3600_000); fs.utimesSync(negDir, past, past); // backdate AFTER Chrome wrote
  const sweepLines = [];
  for (let i = 1; i <= 3; i++) {
    const nav = cli(['nav', `${BASE}/?n=L3-${i}`], { tag: `L3-nav${i}` });
    const close = cli(['close'], { tag: `L3-close${i}` });
    check(`L3 session ${i}: nav/close exit 0`, nav.code === 0 && close.code === 0, `${nav.code}/${close.code}`);
    check(`L3 session ${i}: NEG315 survives`, exists(negDir));
    const inUse = lines(nav.stderr, /^\[cleanup\] decision /).some((l) => norm(/path="([^"]+)"/.exec(l)?.[1] ?? '') === norm(negDir) && /reason=in-use/.test(l));
    sweepLines.push(inUse);
    check(`L3 session ${i}: the sweep logged decision reason=in-use for NEG315`, inUse);
  }
  // direct close-path removal while the Chrome is alive: P4 criteria
  const pre = snapshotEntries(negDir);
  const res = await TP.removeSessionTempProfile(negDir, undefined, { tmpRoot: ISO });
  const post = snapshotEntries(negDir);
  const missing = pre.filter((e) => !post.includes(e));
  check('L3 direct removeSessionTempProfile -> removed:false reason in-use', res.removed === false && res.reason === 'in-use', JSON.stringify(res));
  check('L3 P4(1) every pre-call entry still present', missing.length === 0 && pre.length > 5, `pre=${pre.length} missing=[${missing}]`);
  check('L3 P4(2) lockfile present', exists(path.join(negDir, 'lockfile')));
  check('L3 P4(3) /json/version still answers', await versionUp(ch.port));
  // attribution: every process referencing the basename belongs to OUR Chrome tree; the harness never does
  const all = cimList();
  const tree = descendants(all, ch.pid);
  const refs = all.filter((p) => p.cmd.toLowerCase().includes(base.toLowerCase()));
  const outside = refs.filter((p) => !tree.has(p.pid));
  fs.writeFileSync(path.join(EVD, 'L3-attribution.txt'), refs.map((p) => `${p.pid} ppid=${p.ppid} ${p.name} inTree=${tree.has(p.pid)}`).join('\n') + '\n');
  check('L3 attribution: >=1 process references the dir, ALL are inside our Chrome tree, none is the harness', refs.length >= 1 && outside.length === 0 && !refs.some((p) => p.pid === process.pid),
    `refs=${refs.length} outsideTree=${outside.map((p) => `${p.name}:${p.pid}`)}`);
  const scanLines = await TP.scanCommandLines();
  check('L3 module scan sees the dir as referenced', scanLines !== null && TP.commandLinesReference(negDir, scanLines), `scanLines=${scanLines?.length}`);
  // kill our Chrome only after the ownership check, then removal succeeds
  const k = await killOurChrome(ch.pid, base, 'L3 own Chrome');
  check('L3 own Chrome killed (owned) and exited within 15 s', k.owned && k.killed && k.gone, JSON.stringify(k));
  const after = await TP.removeSessionTempProfile(negDir, ch.pid, { tmpRoot: ISO });
  check('L3 after the Chrome exited the same call returns removed:true and the dir is gone', after.removed === true && !exists(negDir), JSON.stringify(after));
  assertNoStragglers('L3');
}

async function caseL4() {
  info('== L4: stale sweep');
  const stale = makeStaleDir(ISO, 'sutradhar-cli-1700000000001-STALE1');
  const young = makeStaleDir(ISO, 'sutradhar-cli-1700000000002-YOUNG1', { ageMin: 0 });
  const notS = makeStaleDir(ISO, 'not-sutradhar-1700000000003', { marker: false });
  const dls = makeStaleDir(ISO, 'sutradhar-downloads', { marker: false });
  const nav = cli(['nav', `${BASE}/?n=L4`], { tag: 'L4-nav' });
  const close = cli(['close'], { tag: 'L4-close' });
  check('L4 nav/close exit 0', nav.code === 0 && close.code === 0);
  check('L4 STALE1 removed', !exists(stale));
  check('L4 YOUNG1 kept', exists(young));
  check('L4 not-sutradhar-1700000000003 kept', exists(notS));
  check('L4 sutradhar-downloads kept', exists(dls));
  const dec = lines(nav.stderr, /^\[cleanup\] (decision|removed|kept) /).filter((l) => /STALE1|YOUNG1/.test(l));
  info('L4 decisions:\n' + dec.join('\n'));
  check('L4 sweep log shows STALE1 removed and YOUNG1 not removed', dec.some((l) => /^\[cleanup\] removed .*STALE1/.test(l)) && !dec.some((l) => /^\[cleanup\] removed .*YOUNG1/.test(l)));
  // cleanup of what the harness itself made
  const r = await TP.removeSessionTempProfile(young, undefined, { tmpRoot: ISO });
  check('L4 YOUNG1 removed by removeSessionTempProfile (test cleanup)', r.removed && !exists(young), JSON.stringify(r));
  for (const p of [notS, dls]) { if (norm(path.dirname(p)) !== norm(ISO)) throw new Error('refuse rm ' + p); await fsp.rm(p, { recursive: true, force: true }); }
}

async function caseL5a() {
  info('== L5a (P0): CHROME_PATH is a non-executable file');
  const bad = path.join(ISO, 'notchrome.txt'); fs.writeFileSync(bad, 'not a program');
  const pre = cliDirs(ISO);
  const r = cli(['nav', `${BASE}/?n=L5a`], { tag: 'L5a-nav', extra: { CHROME_PATH: bad } });
  check('L5a exit 1', r.code === 1, `exit=${r.code} ${r.ms}ms`);
  check('L5a stderr/stdout mention EFTYPE', /EFTYPE/.test(r.stderr + r.stdout), (r.stderr + r.stdout).split(/\r?\n/).filter((l) => /EFTYPE/.test(l))[0]);
  const created = lines(r.stderr, /^\[cleanup\] created /).map((l) => norm(/path="([^"]+)"/.exec(l)?.[1] ?? ''));
  const removed = lines(r.stderr, /^\[cleanup\] removed /).map((l) => norm(/path="([^"]+)"/.exec(l)?.[1] ?? ''));
  check('L5a created and removed lines name the same path', created.length === 1 && removed.includes(created[0]), `created=${created} removed=${removed}`);
  check('L5a no dir left', cliDirs(ISO).join() === pre.join() && !stateFileExists(STATE), `after=[${cliDirs(ISO)}]`);
  await fsp.rm(bad, { force: true });
}

async function caseL5b() {
  info('== L5b (P2x): CHROME_PATH is a copy of node.exe (exits 9 at once)');
  const fake = path.join(ISO, 'fakechrome.exe'); fs.copyFileSync(process.execPath, fake);
  const pre = cliDirs(ISO);
  const r = cli(['nav', `${BASE}/?n=L5b`], { tag: 'L5b-nav', extra: { CHROME_PATH: fake } });
  check('L5b exit 1', r.code === 1, `exit=${r.code}`);
  check('L5b well under 10 s (< 8000 ms)', r.ms < 8000, `${r.ms}ms`);
  check('L5b a "Chrome exited (code N) before it was ready" line', /Chrome exited \(code \d+\) before it was ready/.test(r.stderr + r.stdout), (r.stderr + r.stdout).split(/\r?\n/).filter((l) => /Chrome exited/.test(l))[0]);
  const disc = lines(r.stderr, /^\[cleanup\] discard /);
  check('L5b discard line carries alive=false (the no-kill branch) and no kill phase ran', disc.length === 1 && /alive=false/.test(disc[0]) && !/phase kill/.test(r.stderr), disc[0]);
  const created = lines(r.stderr, /^\[cleanup\] created /).map((l) => norm(/path="([^"]+)"/.exec(l)?.[1] ?? ''));
  const removed = lines(r.stderr, /^\[cleanup\] removed /).map((l) => norm(/path="([^"]+)"/.exec(l)?.[1] ?? ''));
  check('L5b dir created then removed, none left', created.length === 1 && removed.includes(created[0]) && cliDirs(ISO).join() === pre.join(), `created=${created} removed=${removed}`);
  await fsp.rm(fake, { force: true });
}

/** build a sibling mutant bundle: exactly one replacement (CRLF-tolerant), real bundle sha256 unchanged. */
function makeMutant(file, from, to, label) {
  const src = fs.readFileSync(CLI_BIN, 'utf-8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutant ${label}: expected exactly 1 occurrence, found ${n}`);
  const out = path.join(DIST, file);
  fs.writeFileSync(out, src.replace(from, to));
  const marks = fs.readFileSync(out, 'utf-8').split(`S7 mutant ${label}`).length - 1;
  info(`mutant ${label}: occurrences-replaced=${n} marker-count=${marks} -> ${out}`);
  return out;
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function caseL7() {
  info('== L7: mutant bundle with the cleanup call inside stopSpawnedChrome disabled');
  const before = sha(CLI_BIN);
  const mut = makeMutant('cli-bin.mutant.js',
    '      await deps.cleanup({ userDataDir: dir, tempProfile: true }, pid, now2() + CLOSE_CLEANUP_DEADLINE_MS);',
    '      void 0; /* S7 mutant L7: cleanup disabled */', 'L7');
  let st;
  try {
    const nav = cli(['nav', `${BASE}/?n=L7`], { tag: 'L7-nav', bin: mut });
    st = nav.state; const dir = st?.userDataDir;
    check('L7 mutant nav exit 0 and dir exists', nav.code === 0 && !!dir && exists(dir));
    const close = cli(['close'], { tag: 'L7-close', bin: mut });
    check('L7 mutant close exit 0', close.code === 0);
    check('L7 EXPECTED: the dir REMAINS after the mutant close (so L1 passing is due to the cleanup, not the sweep)', exists(dir), `dir=${dir}`);
    check('L7 no cleanup phase ran in the mutant close', !/phase cleanup/.test(close.stderr));
    const rr = await TP.removeSessionTempProfile(dir, st.chromePid, { tmpRoot: ISO });
    check('L7 leftover dir removed through removeSessionTempProfile', rr.removed && !exists(dir), JSON.stringify(rr));
  } finally {
    if (path.basename(mut) !== 'cli-bin.mutant.js') throw new Error('refuse');
    await fsp.rm(mut, { force: true });
  }
  check('L7 mutant file deleted and the real cli-bin.js sha256 unchanged', !exists(mut) && sha(CLI_BIN) === before, `sha=${before}`);
  assertNoStragglers('L7');
}

async function caseL9() {
  info('== L9: interrupted close (kill the CLI child as soon as state-cleared appears)');
  const nav = cli(['nav', `${BASE}/?n=L9`], { tag: 'L9-nav' });
  const st = nav.state; const dir = st.userDataDir; const base = path.basename(dir);
  check('L9 session up', nav.code === 0 && !!st.chromePid);
  const logf = path.join(LOGS, 'L9-close-streamed.stderr');
  const child = spawn(process.execPath, [CLI_BIN, 'close'], { env: cliEnv({ tmp: ISO, stateDir: STATE }), cwd: ISO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  recordPid('cli-child', child.pid, 'L9 close, to be killed after state-cleared');
  let buf = '', killedAt = null, exitInfo = null;
  const exited = new Promise((res) => child.on('exit', (c, s) => { exitInfo = { code: c, signal: s }; res(); }));
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => {
    buf += d.toString(); fs.appendFileSync(logf, d);
    if (killedAt === null && buf.includes('[cleanup] state-cleared')) { killedAt = performance.now(); child.kill(); }
  });
  const capT = setTimeout(() => { if (exitInfo === null) { info('L9 hard cap: killing OUR close child'); child.kill(); } }, 90_000);
  await exited; clearTimeout(capT);
  check('L9 the CLI child was killed after state-cleared appeared (not exited by itself first)', killedAt !== null && exitInfo?.signal !== null && exitInfo?.code !== 0, JSON.stringify(exitInfo));
  const cleanupLineSeen = /phase cleanup/.test(buf);
  info(`L9 cleanup finished before the kill landed: ${cleanupLineSeen} (O2 is the authority if true)`);
  const stAfter = readStateAt(STATE);
  check('L9 state.json absent or has no chromePid', !stAfter || stAfter.chromePid === undefined, stAfter ? JSON.stringify(stAfter).slice(0, 80) : 'absent');
  const second = cli(['close'], { tag: 'L9-close2' });
  check('L9 second close reports no session and kills nothing', second.code === 0 && /No active session/.test(second.stdout) && !/phase kill/.test(second.stderr), `exit=${second.code} out=${second.stdout.trim()}`);
  check('L9 the Chrome is gone (killed by the first close before state-cleared)', !ourChromeAlive(st.chromePid, base), `pid=${st.chromePid}`);
  info(`L9 dir exists after the interrupt: ${exists(dir)}`);
  const rr = await TP.removeSessionTempProfile(dir, st.chromePid, { tmpRoot: ISO });
  check('L9 the dir is removed afterwards by removeSessionTempProfile', rr.removed && !exists(dir), JSON.stringify(rr));
  assertNoStragglers('L9');
}

async function caseL12(tag, bin, mutantExpectation) {
  info(`== ${tag}: legacy state (no chromePid) + open dialog, on ${path.basename(bin)}`);
  const nav = cli(['nav', `${BASE}/c?n=${tag}`], { tag: `${tag}-nav`, bin });
  const st = nav.state;
  check(`${tag} nav exit 0 with state`, nav.code === 0 && !!st?.chromePid, `exit=${nav.code} ${nav.ms}ms`);
  const dir = st.userDataDir, base = path.basename(dir), pid = st.chromePid;
  recordPid('chromePid', pid, `${tag} before the legacy rewrite`);
  await sleep(2000); // the page opens confirm() 300 ms after load; leave margin
  fs.writeFileSync(path.join(STATE, 'state.json'), JSON.stringify({ ...st, chromePid: undefined }, null, 2));
  check(`${tag} state.json rewritten without chromePid (legacy shape)`, readStateAt(STATE)?.chromePid === undefined && stateFileExists(STATE));
  const close = cli(['close'], { tag: `${tag}-close`, bin });
  check(`${tag} close exit 0`, close.code === 0, `exit=${close.code} ${close.ms}ms`);
  check(`${tag} close fast (< 10 s, no 180 s attach hang)`, close.ms < 10_000, `${close.ms}ms`);
  check(`${tag} "Session closed." printed`, /Session closed\./.test(close.stdout), close.stdout.trim());
  check(`${tag} the dialog really was open (close warned about it)`, /a confirm dialog is open/.test(close.stderr), (close.stderr.match(/Warning: a confirm.*/) ?? [''])[0]);
  const present = stateFileExists(STATE);
  if (mutantExpectation) check(`${tag} EXPECTED under M-O6: state.json REMAINS (L12 must fail on the mutant)`, present === true, `state.json present=${present}`);
  else check(`${tag} state.json ABSENT`, present === false, `state.json present=${present}`);
  check(`${tag} the legacy close did not kill the Chrome (as on master)`, ourChromeAlive(pid, base), `pid=${pid}`);
  // clean up: kill our Chrome after the ownership check, remove the dir, and (mutant only) the leftover state file
  const k = await killOurChrome(pid, base, `${tag} Chrome`);
  check(`${tag} own Chrome killed after the ownership check and exited`, k.owned && k.gone, JSON.stringify(k));
  const rr = await TP.removeSessionTempProfile(dir, pid, { tmpRoot: ISO });
  check(`${tag} dir removed through removeSessionTempProfile`, rr.removed && !exists(dir), JSON.stringify(rr));
  if (stateFileExists(STATE)) await fsp.rm(path.join(STATE, 'state.json'), { force: true });
  assertNoStragglers(tag);
}

async function caseL12m() {
  const before = sha(CLI_BIN);
  const mut = makeMutant('cli-bin.mutant-o6.js',
    '        await runtime.shutdown(sessionId);\n      } catch {\n      }\n    }\n    await clearState();',
    '        await runtime.shutdown(sessionId);\n      } catch {\n      }\n    /* S7 mutant O6: clearState moved inside if (!closeBlocked) */ await clearState();\n    }', 'O6');
  try { await caseL12('L12m', mut, true); }
  finally { if (path.basename(mut) !== 'cli-bin.mutant-o6.js') throw new Error('refuse'); await fsp.rm(mut, { force: true }); }
  check('L12m mutant file deleted and the real cli-bin.js sha256 unchanged', !exists(mut) && sha(CLI_BIN) === before);
}

// ---- main ---------------------------------------------------------------------------------------------------------
const startedAt = new Date().toISOString();
info(`harness start ${startedAt} CASES=${CASES.join(',')} ITER=${ITER} ISO=${ISO} cli-bin sha256=${sha(CLI_BIN)}`);
info(`profile path length for ISO: ${ISO.length + 1 + 34} (limit 200), for ISO_SP: ${ISO_SP.length + 1 + 34}`);
check('P5: ISO leaves room for a 34-char profile name within 200 chars', ISO.length + 1 + 34 <= 200 && ISO_SP.length + 1 + 34 <= 200, `${ISO.length + 35}/${ISO_SP.length + 35}`);
check('ISO starts with no sutradhar-cli-* entries', cliDirs(ISO).length === 0, cliDirs(ISO).join(','));
realSnap('start');
const table = { L1: () => caseL1('L1', ITER, CLI_BIN), L1s: caseL1s, L2: () => caseL1('L2', 3, CLI_JS), L3: caseL3, L4: caseL4, L5a: caseL5a, L5b: caseL5b, L7: caseL7, L9: caseL9, L12: () => caseL12('L12', CLI_BIN, false), L12m: caseL12m };
try {
  for (const c of CASES) {
    if (!table[c]) { check(`unknown case ${c}`, false); continue; }
    try { await table[c](); } catch (e) { check(`${c} threw`, false, e?.stack ?? e); }
    assertNoStragglers(`after ${c}`);
    realSnap(`after ${c}`);
  }
} finally {
  stopPages();
  fs.writeFileSync(path.join(EVD, 'results.json'), JSON.stringify({ startedAt, cases: CASES, iter: ITER, fails, results, timing: T }, null, 2));
}
const fin = realSnap('end');
check('real TEMP sutradhar-cli-* list is IDENTICAL at the end (or every difference is external)', fin.gone.length === 0 && fin.added.length === 0, `gone=${fin.gone} added=${fin.added}`);
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
