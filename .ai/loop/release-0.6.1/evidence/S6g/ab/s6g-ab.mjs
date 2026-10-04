// S6g live A/B harness: a FAILING state clear during `close` (CASE=close) or during session self-heal (CASE=selfheal),
// run against ONE CLI binary per invocation (AB_LABEL = v060 | head | ctl). Run ONLY under the ISOLATION PREAMBLE (Git Bash,
// TEMP/TMP/TMPDIR/NODE_OPTIONS on the same command line, fresh `<SP>/S6g-tmp` per run).
//
// Env in : AB_SP, AB_WT, AB_EV (evidence dir), AB_BIN (cli-bin.js under test), AB_LABEL, AB_CASE, EXPECT_AC (true|false).
// Method : nav (the CLI under test starts a real Chrome in the isolated TEMP) -> [selfheal: rewrite wsEndpoint to a closed port] ->
//          a lock holder (PowerShell, FileShare ReadWrite, NO Delete) keeps state.json undeletable -> ONE measured CLI command
//          (close | nav) -> the harness releases the holder, deletes state.json ITSELF, and only then does any other cleanup.
// SAFETY (plan-review-B F4): after the measured command NO CLI command is ever run against this state dir (cli() throws);
//          a PID is killed only after a live CIM check that its CommandLine references OUR isolated dir, never twice, never by
//          image name; leaked dirs are removed with an exact-path guard (direct child of ISO, sutradhar-cli-<digits>[-xyz]).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const norm = (p) => path.resolve(String(p)).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const slashnorm = (s) => String(s).replaceAll('\\', '/').toLowerCase();
const { AB_SP: SP, AB_WT: WT, AB_EV: EVD, AB_BIN: BIN, AB_LABEL: LABEL, AB_CASE: CASE, EXPECT_AC } = process.env;
if (!SP || !WT || !EVD || !BIN || !LABEL || !CASE || !['true', 'false'].includes(EXPECT_AC ?? '')) { console.error('AB_SP/AB_WT/AB_EV/AB_BIN/AB_LABEL/AB_CASE/EXPECT_AC required'); process.exit(2); }
if (!['close', 'selfheal'].includes(CASE)) { console.error('CASE must be close|selfheal'); process.exit(2); }
const ISO = path.resolve(os.tmpdir());
if (process.platform !== 'win32' || !norm(ISO).startsWith(norm(SP) + '/')) { console.error(`HARNESS GUARD: tmpdir=${ISO} is not under ${SP}`); process.exit(97); }
console.log(`[iso-guard-harness] tmpdir=${norm(ISO)} pid=${process.pid} node=${process.version} label=${LABEL} case=${CASE}`);
const STATE = path.join(ISO, 'st');
const STATE_FILE = path.join(STATE, 'state.json');
fs.mkdirSync(STATE, { recursive: true });
const LOGS = path.join(EVD, 'logs'); fs.mkdirSync(LOGS, { recursive: true });
const TAG = `${LABEL}-${CASE}`;
const REAL_TEMP = 'E:/AI-Cache/tmp'; // hard-coded, never derived from TEMP/os.tmpdir()
if (norm(REAL_TEMP) === norm(ISO)) { console.error('REAL_TEMP equals ISO'); process.exit(97); }
const SYS = process.env.SystemRoot || 'C:\\Windows';
const TASKLIST = path.join(SYS, 'System32', 'tasklist.exe');
const TASKKILL = path.join(SYS, 'System32', 'taskkill.exe');
const POWERSHELL = path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const info = (...a) => console.log('INFO', ...a);
const R = { label: LABEL, case: CASE, bin: BIN, binSha256: sha(BIN), checks: [], notes: [] };
let fails = 0;
function check(name, ok, detail = '') { R.checks.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) fails++; return !!ok; }
const PIDFILE = path.join(EVD, `our-pids-${TAG}.txt`); fs.writeFileSync(PIDFILE, '');
const recordPid = (kind, pid, note = '') => fs.appendFileSync(PIDFILE, `${new Date().toISOString()} ${kind} pid=${pid} ${note}\n`);
recordPid('harness', process.pid, `label=${LABEL} case=${CASE}`);
info(`binary ${BIN} sha256=${R.binSha256}`);

// ---- real TEMP snapshot (read-only) -----------------------------------------------------------------------------
const realList = () => fs.readdirSync(REAL_TEMP).filter((n) => n.startsWith('sutradhar-cli-')).sort();
const REAL0 = realList();
if (REAL0.length < 1) { console.error('real TEMP has no sutradhar-cli-* entries: refusing (snapshot sanity)'); process.exit(97); }
fs.writeFileSync(path.join(LOGS, `${TAG}.realtemp-before.txt`), REAL0.join('\n') + '\n');

// ---- process helpers ------------------------------------------------------------------------------------------
function ps(script, env = {}) { return spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf-8', timeout: 120_000, maxBuffer: 256 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...env } }); }
function cimList() {
  const r = ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 2');
  if (r.status !== 0) throw new Error(`cim list failed status=${r.status}`);
  let a = JSON.parse(r.stdout); if (!Array.isArray(a)) a = [a];
  return a.map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name ?? '', cmd: p.CommandLine ?? '' }));
}
function cimCmd(pid) { return (ps('Get-CimInstance Win32_Process -Filter "ProcessId=$env:AB_QPID" | ForEach-Object { $_.CommandLine }', { AB_QPID: String(pid) }).stdout ?? '').trim(); }
function tasklistHas(pid) { const r = spawnSync(TASKLIST, ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf-8', timeout: 30_000, windowsHide: true }); return new RegExp(`"${pid}"`).test(r.stdout ?? ''); }
/** is `pid` alive AND still our process (its live CommandLine references `needle`, a path fragment)? */
const ourAlive = (pid, needle) => tasklistHas(pid) && slashnorm(cimCmd(pid)).includes(slashnorm(needle));
const procsUnder = (root) => cimList().filter((p) => slashnorm(p.cmd).includes(norm(root) + '/') || slashnorm(p.cmd).includes(norm(root) + '"') || slashnorm(p.cmd).endsWith(norm(root)));
const killed = new Set();
async function killOurs(pid, needle, note) { // ownership check immediately before; never twice
  if (killed.has(pid)) { R.notes.push(`refused second kill of ${pid}`); return { killed: false, why: 'already-killed-once' }; }
  if (!slashnorm(cimCmd(pid)).includes(slashnorm(needle))) { R.notes.push(`ownership check failed pid ${pid} (${note}): not killed`); return { killed: false, why: 'not-ours-or-gone' }; }
  killed.add(pid); recordPid('harness-kill', pid, note);
  const r = spawnSync(TASKKILL, ['/PID', String(pid), '/T', '/F'], { encoding: 'utf-8', timeout: 30_000, windowsHide: true });
  const t0 = performance.now(); while (performance.now() - t0 < 15_000 && ourAlive(pid, needle)) await sleep(250);
  return { killed: true, status: r.status, gone: !ourAlive(pid, needle) };
}

// ---- CLI runner: the measured command is the LAST CLI command (F4) ------------------------------------------------
let measuredDone = false, callNo = 0;
function cli(args, { measured = false } = {}) {
  if (measuredDone) throw new Error('F4 VIOLATION: no CLI command may run against this state dir after the measured command');
  if (measured) measuredDone = true;
  const n = ++callNo; const t0 = performance.now();
  const env = { ...process.env, TEMP: ISO, TMP: ISO, TMPDIR: ISO, SUTRADHAR_CLI_STATE_DIR: STATE, SUTRADHAR_CONFIG: 'none', SUTRADHAR_CLI_DEBUG_CLEANUP: '1' };
  const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd: ISO, encoding: 'utf-8', timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const ms = Math.round(performance.now() - t0);
  const base = path.join(LOGS, `${TAG}-${n}-${args[0]}`);
  fs.writeFileSync(`${base}.stderr`, r.stderr ?? ''); fs.writeFileSync(`${base}.stdout`, r.stdout ?? '');
  console.log(`CLI ${n} [${args.join(' ')}] status=${r.status} signal=${r.signal ?? ''} error=${r.error?.code ?? ''} ${ms}ms`);
  return { status: r.status, signal: r.signal, error: r.error, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms };
}
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch { return undefined; } };

// ---- harness page server (child) --------------------------------------------------------------------------------------
const pages = spawn(process.execPath, [path.join(WT, '.ai/loop/release-0.6.1/evidence/S7/s7-pages-server.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
recordPid('pages-server', pages.pid);
const PORT = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('pages server did not start')), 20_000); pages.stdout.on('data', (d) => { b += d; const m = /PORT (\d+)/.exec(b); if (m) { clearTimeout(t); res(Number(m[1])); } }); });
const BASE = `http://127.0.0.1:${PORT}`;
let holder; let dummy;
const leftovers = [];

async function releaseHolder() {
  if (!holder) return true;
  try { holder.stdin.end(); } catch { /* */ }
  const t0 = performance.now(); while (performance.now() - t0 < 15_000 && holder.exitCode === null) await sleep(100);
  const exited = holder.exitCode !== null && !tasklistHas(holder.pid);
  R.holderExited = exited; info(`holder pid=${holder.pid} exited=${exited}`);
  return exited;
}
async function main() {
  // 1. start a real session with the binary under test
  const nav = cli(['nav', `${BASE}/?ab-${TAG}`]);
  check('setup: nav exit 0', nav.status === 0, `status=${nav.status}`);
  const st0 = readState();
  if (!st0?.chromePid) { check('setup: state.json has chromePid', false); return; }
  const chromePid = st0.chromePid; recordPid('chromePid', chromePid, 'setup nav');
  R.chromePid = chromePid;
  const cmd0 = cimCmd(chromePid);
  const m = /--user-data-dir=(?:"([^"]+)"|(\S+))/.exec(cmd0);
  const dir = m ? (m[1] ?? m[2]) : undefined;
  R.userDataDir = dir; R.stateHasUserDataDir = typeof st0.userDataDir === 'string';
  check('setup: Chrome CommandLine carries --user-data-dir', !!dir, (cmd0 || '').slice(0, 120));
  if (!dir) return;
  const base = path.basename(dir);
  check('setup: profile dir is a direct child of ISO and --user-data-dir length <= 200 (P5)', norm(path.dirname(dir)) === norm(ISO) && dir.length <= 200, `len=${dir.length}`);
  check('setup: ownership proven (live CommandLine references OUR isolated dir)', slashnorm(cmd0).includes(slashnorm(base)) && slashnorm(cmd0).includes(norm(ISO)), base);
  if (R.stateHasUserDataDir) check('setup: state.userDataDir equals the CIM dir', norm(st0.userDataDir) === norm(dir));
  check('setup: profile dir exists', fs.existsSync(dir));
  if (CASE === 'selfheal') { // a state whose wsEndpoint points at a closed port (reattach fails), chromePid still our live Chrome
    const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    const ws = String(st0.wsEndpoint).replace(/:\d+\//, `:${port}/`);
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...st0, wsEndpoint: ws }, null, 2));
    check('setup: wsEndpoint rewritten to a closed port', readState()?.wsEndpoint === ws && ws !== st0.wsEndpoint, ws);
  }
  // 2. lock state.json (no FILE_SHARE_DELETE) with a holder this harness owns
  holder = spawn(POWERSHELL, ['-NoProfile', '-Command', "$f=[IO.File]::Open($env:AB_LOCKPATH,'Open','Read','ReadWrite'); 'ready'; [Console]::In.ReadLine() | Out-Null; $f.Close()"], { env: { ...process.env, AB_LOCKPATH: STATE_FILE }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  recordPid('state-holder', holder.pid);
  const ready = await new Promise((res) => { const t = setTimeout(() => res(false), 15_000); holder.stdout.on('data', (d) => { if (/ready/.test(String(d))) { clearTimeout(t); res(true); } }); });
  check('setup: lock holder ready (state.json open without delete-share)', ready);
  const dirsBefore = fs.readdirSync(ISO).filter((n) => n.startsWith('sutradhar-cli-'));
  R.dirsBefore = dirsBefore;

  // 3. the ONE measured command
  const out = cli(CASE === 'close' ? ['close'] : ['nav', `${BASE}/?ab-heal-${TAG}`], { measured: true });
  R.status = out.status; R.signal = out.signal; R.errorCode = out.error?.code ?? null; R.ms = out.ms;
  const aliveRightAfter = ourAlive(chromePid, base);
  const dirExistsRightAfter = fs.existsSync(dir);
  const stAfter = readState();
  R.stateAfter = stAfter ? { present: true, chromePid: stAfter.chromePid, userDataDir: stAfter.userDataDir } : { present: false };
  R.aliveRightAfter = aliveRightAfter; R.dirExistsRightAfter = dirExistsRightAfter;
  const lines = out.stderr.split(/\r?\n/);
  const fatalIdx = lines.findIndex((l) => l.startsWith('Fatal: '));
  const fatal = fatalIdx >= 0 ? lines[fatalIdx] : '';
  R.fatalLine = fatal;
  const code = /\b(EBUSY|EPERM|EACCES)\b/.exec(fatal)?.[1] ?? null; R.errnoCode = code;
  const hasStatePath = /state\.json/i.test(fatal); R.fatalNamesStateJson = hasStatePath;
  R.sessionClosedPrinted = /Session closed\./.test(out.stdout);
  R.debug = {
    phaseKill: lines.some((l) => l.startsWith('[cleanup] phase kill')),
    stateCleared: lines.some((l) => l.startsWith('[cleanup] state-cleared')),
    couldNotClearWarning: out.stderr.includes('could not clear the session state'),
    removedIdx: lines.findIndex((l) => l.startsWith('[cleanup] removed path=') && slashnorm(l).includes(slashnorm(base))),
    fatalIdx, cleanupLines: lines.filter((l) => l.startsWith('[cleanup]')).length,
  };
  R.noteLine = lines.find((l) => l.startsWith('Note: previous session was unreachable')) ?? '';
  info(`measured: status=${out.status} errno=${code} fatal=${JSON.stringify(fatal.slice(0, 200))} sessionClosed=${R.sessionClosedPrinted} aliveRightAfter=${aliveRightAfter} dirExistsRightAfter=${dirExistsRightAfter} state.json-after=${stAfter ? 'PRESENT chromePid=' + stAfter.chromePid : 'absent'}`);

  // 4. F4 teardown: release the holder FIRST, then the harness deletes state.json itself; no CLI command is ever run again
  const released = await releaseHolder();
  check('teardown: lock holder released and exited before any other cleanup', released);
  if (path.resolve(STATE_FILE) !== path.join(path.resolve(ISO), 'st', 'state.json')) throw new Error('refuse: state path');
  fs.rmSync(STATE_FILE, { force: true });
  check('teardown: harness deleted state.json itself (state.json absent)', !fs.existsSync(STATE_FILE));

  // 5. Chrome gone? (poll <= 15 s; the 0.6.0 kill is fire-and-forget)
  let goneAt = null; const t0 = performance.now();
  while (performance.now() - t0 < 15_000) { if (!ourAlive(chromePid, base)) { goneAt = Math.round(performance.now() - t0); break; } await sleep(250); }
  R.chromeGoneWithin15s = goneAt !== null; R.chromeGoneAfterMs = goneAt;
  if (goneAt === null) { R.notes.push('Chrome still alive 15 s after the CLI exited (product kill incomplete): harness kills it after the ownership check'); const k = await killOurs(chromePid, base, 'chrome not gone after the measured command'); R.harnessKillOfChrome = k; }
  R.chromeGoneFinal = !ourAlive(chromePid, base);
  // every other process of ours that still references the isolated dir (e.g. a fresh Chrome the control build spawned)
  const rest = procsUnder(ISO).filter((p) => ![process.pid, pages.pid, holder?.pid].includes(p.pid));
  R.processesStillReferencingIso = rest.map((p) => `${p.name}:${p.pid}`);
  if (rest.length) {
    const set = new Set(rest.map((p) => p.pid)); const roots = rest.filter((p) => !set.has(p.ppid));
    for (const p of roots) { const k = await killOurs(p.pid, norm(ISO), `straggler ${p.name}`); R.notes.push(`straggler root ${p.name}:${p.pid} -> ${JSON.stringify(k)}`); }
    const t1 = performance.now(); while (performance.now() - t1 < 15_000 && procsUnder(ISO).filter((p) => ![process.pid, pages.pid, holder?.pid].includes(p.pid)).length) await sleep(500);
  }
  // 6. leaked dirs: exact-path guarded delete of OUR dirs only
  const dirsNow = () => fs.readdirSync(ISO).filter((n) => n.startsWith('sutradhar-cli-'));
  R.dirsAfterRun = dirsNow();
  R.productRemovedProfileDir = !dirExistsRightAfter;
  for (const n of dirsNow()) {
    if (!/^sutradhar-cli-\d{10,}(-[A-Za-z0-9]{3,8})?$/.test(n)) { R.notes.push(`refused delete of ${n}`); continue; }
    const d = path.join(ISO, n); if (path.dirname(path.resolve(d)) !== path.resolve(ISO)) throw new Error('refuse: not a direct child');
    let ok = false; const t2 = performance.now();
    while (performance.now() - t2 < 20_000 && !ok) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); ok = !fs.existsSync(d); } catch (e) { R.notes.push(`rm retry ${n}: ${e.code}`); await sleep(500); } }
    R.notes.push(`harness removed leaked dir ${n}: ${ok}`);
  }
  R.dirsAfterHarnessCleanup = dirsNow();
  check('teardown: no sutradhar-cli-* dir left in ISO', R.dirsAfterHarnessCleanup.length === 0, R.dirsAfterHarnessCleanup.join(','));

  // 7. the AC(4)/F2 predicate (the SAME function for v060, head and the negative control)
  const a = typeof R.status === 'number' && R.status !== 0 && !out.error && /Fatal: /.test(fatal) && code !== null && hasStatePath;
  const noClosed = CASE === 'close' ? !R.sessionClosedPrinted : true;
  const noteOk = CASE === 'selfheal' ? R.noteLine !== '' : true;
  const chromeGone = R.chromeGoneFinal && R.chromeGoneWithin15s;
  let headOnly = true;
  if (LABEL === 'head') {
    const d = R.debug;
    headOnly = d.phaseKill && !d.stateCleared && d.removedIdx >= 0 && d.fatalIdx >= 0 && d.removedIdx < d.fatalIdx && !d.couldNotClearWarning && R.productRemovedProfileDir && !R.aliveRightAfter;
    info(`HEAD-only (b)+(c): phaseKill=${d.phaseKill} stateCleared=${d.stateCleared} removedIdx=${d.removedIdx} < fatalIdx=${d.fatalIdx} couldNotClearWarning=${d.couldNotClearWarning} productRemovedDir=${R.productRemovedProfileDir} chromeDeadWhenCliReturned=${!R.aliveRightAfter}`);
  }
  R.ac = { a_statusNumberNonZeroFatalErrnoStateJson: a, noSessionClosed: noClosed, noteLine: noteOk, chromeGone, headOnlyBC: headOnly };
  R.acPredicate = a && noClosed && noteOk && chromeGone && headOnly;
  info(`AC predicate (${CASE}) = ${R.acPredicate} ${JSON.stringify(R.ac)}; expected ${EXPECT_AC}`);
  check(`AC predicate equals the expectation for ${LABEL} (expected ${EXPECT_AC})`, String(R.acPredicate) === EXPECT_AC, JSON.stringify(R.ac));
}

try { await main(); }
catch (e) { check('harness threw', false, e.stack); }
finally {
  try { await releaseHolder(); } catch { /* */ }
  try { pages.stdin.end(); } catch { /* */ } try { pages.kill(); } catch { /* */ }
  // leftover query WITH a positive control (a dummy node whose argv references ISO), then the real query
  dummy = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', path.join(ISO, 'dummy-control-marker')], { stdio: 'ignore', windowsHide: true });
  recordPid('leftover-control-dummy', dummy.pid);
  await sleep(1500);
  const withControl = procsUnder(ISO).filter((p) => p.pid === dummy.pid).length;
  check('leftover query positive control: the dummy with an ISO path in argv IS found', withControl === 1, `found=${withControl}`);
  dummy.kill(); const t = performance.now(); while (performance.now() - t < 10_000 && tasklistHas(dummy.pid)) await sleep(200);
  await sleep(500);
  const left = procsUnder(ISO).filter((p) => p.pid !== process.pid);
  R.leftoverProcesses = left.map((p) => `${p.name}:${p.pid}`);
  check('leftover query: no process references the isolated dir (and the harness children are gone)', left.length === 0, left.map((p) => `${p.name}:${p.pid}`).join(','));
  check('page server child exited', await (async () => { const t0 = performance.now(); while (performance.now() - t0 < 10_000 && tasklistHas(pages.pid)) await sleep(200); return !tasklistHas(pages.pid); })());
  const realNow = realList(); fs.writeFileSync(path.join(LOGS, `${TAG}.realtemp-after.txt`), realNow.join('\n') + '\n');
  R.realTempIdentical = REAL0.join('|') === realNow.join('|');
  check('real TEMP sutradhar-cli-* list identical before/after', R.realTempIdentical, `before=${REAL0.length} after=${realNow.length}`);
  R.fails = fails; fs.writeFileSync(path.join(EVD, `result-${TAG}.json`), JSON.stringify(R, null, 2));
  console.log(`RESULT ${TAG} fails=${fails} acPredicate=${R.acPredicate}`);
  process.exitCode = fails ? 1 : 0;
}
