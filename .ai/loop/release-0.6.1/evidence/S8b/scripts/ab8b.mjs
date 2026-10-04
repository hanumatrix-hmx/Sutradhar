// S8b independent A/B for S6g (F-S8-2): one run = one binary x one case (close | selfheal) in its OWN isolated
// TEMP + state dir. F4: after the measured command NO CLI command may run (structural); the harness releases its
// own lock holder, then deletes state.json itself. Kills: only after a live CIM CommandLine ownership check
// (must contain our ISO path), never twice, never by image name. All waits capped.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http'; import net from 'node:net';
const SP = 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const norm = (p) => path.resolve(String(p)).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('HARNESS GUARD: tmpdir not under SP'); process.exit(97); }
const [label, kase, bin, isoName, outDir] = process.argv.slice(2);
if (!/^[A-Z][0-9]$/.test(isoName)) { console.error('bad iso name'); process.exit(2); }
const ISO = path.join(path.resolve(SP), isoName); const ST = path.join(ISO, 'st'); const STATE = path.join(ST, 'state.json');
fs.mkdirSync(ST, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
const SYS = 'C:/Windows/System32'; const PS = path.join(SYS, 'WindowsPowerShell', 'v1.0', 'powershell.exe'); const TK = path.join(SYS, 'taskkill.exe');
const log = (...a) => { const l = a.join(' '); console.log(l); fs.appendFileSync(path.join(outDir, `run-${label}-${kase}.log`), l + '\n'); };
const R = { label, kase, bin, iso: ISO, checks: [] }; let fails = 0;
const check = (name, ok, d = '') => { R.checks.push({ name, ok: !!ok, d: String(d) }); if (!ok) fails++; log(`${ok ? 'PASS' : 'FAIL'} ${name}${d ? ' :: ' + d : ''}`); return !!ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pidsFile = path.join(outDir, `pids-${label}-${kase}.txt`); const rec = (k, pid) => fs.appendFileSync(pidsFile, `${new Date().toISOString()} ${k} pid=${pid}\n`);
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const psFile = (f, extraEnv) => execFileSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, f)], { env: { ...process.env, ...extraEnv }, encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
const cimCmdLine = (pid) => psFile('cim-pid.ps1', { QPID: String(pid) });
const cimByNeedle = () => psFile('cim-needle.ps1', { NEEDLE: norm(ISO) + '/' }).split(/\r?\n/).filter(Boolean);
const ours = (pid) => (cimCmdLine(pid) || '').toLowerCase().split(String.fromCharCode(92)).join('/').includes(norm(ISO) + '/');
const killed = new Set();
const ownedKill = async (pid, why) => {
  if (killed.has(pid)) { log(`INFO never kill twice: pid=${pid}`); return false; }
  if (!ours(pid)) { log(`INFO no kill pid=${pid} (${why}): command line does not reference our ISO (gone or foreign)`); return false; }
  killed.add(pid); rec(`ownership-checked-kill(${why})`, pid);
  try { execFileSync(TK, ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true }); } catch (e) { log(`INFO taskkill ${String(e.stderr ?? e.message).trim()}`); }
  const t = performance.now(); while (isAlive(pid) && performance.now() - t < 15000) await sleep(200);
  return check(`owned pid ${pid} (${why}) exited within 15 s after the ownership-checked kill`, !isAlive(pid));
};
const env = { ...process.env, TEMP: ISO, TMP: ISO, TMPDIR: ISO, SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CLI_STATE_DIR: ST,
  NODE_OPTIONS: `--import=file:///${SP}/iso/assert-tmp.mjs` + (bin.includes('/S8b/bins/') ? ` --import=file:///${SP}/S8b/bins/pp-hook.mjs` : '') };
let measuredDone = false; let n = 0;
const cli = (args, timeoutMs = 120000) => {
  if (measuredDone) throw new Error('F4 VIOLATION: a CLI command after the measured command');
  return new Promise((resolve) => {
    const tag = `${label}-${kase}-${++n}-${args[0]}`; const t0 = performance.now();
    const c = spawn(process.execPath, [bin, ...args], { cwd: ISO, env, windowsHide: true }); rec(`cli(${args[0]})`, c.pid);
    let out = '', err = '', timedOut = false; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => { timedOut = true; c.kill(); }, timeoutMs);
    c.on('close', (code, signal) => { clearTimeout(timer); fs.writeFileSync(path.join(outDir, `${tag}.stdout`), out); fs.writeFileSync(path.join(outDir, `${tag}.stderr`), err);
      resolve({ code, signal, timedOut, stdout: out, stderr: err, ms: Math.round(performance.now() - t0) }); });
  });
};
const realTemp = () => fs.readdirSync('E:/AI-Cache/tmp').filter((x) => x.startsWith('sutradhar-cli-')).sort().join('\n');
const rt0 = realTemp(); if (!rt0) { console.error('real TEMP has no entries'); process.exit(97); }
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>s8b</title><p>s8b</p>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); const URL_ = `http://127.0.0.1:${server.address().port}/`;
log(`== ${label} ${kase} node=${process.version} bin=${bin} ISO=${ISO} tmpdir=${os.tmpdir()}`);
let chromePid, dir, holder; const extraPids = [];
try {
  const nav = await cli(['nav', URL_]);
  check('setup nav exit 0', nav.code === 0, `code=${nav.code} ${nav.stderr.split('\n').filter((l) => /Error|Fatal/.test(l)).join(' | ')}`);
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8')); chromePid = st.chromePid; rec('chromePid(from state)', chromePid);
  const cl = cimCmdLine(chromePid); const m = /--user-data-dir=("([^"]+)"|(\S+))/.exec(cl || '');
  dir = m ? (m[2] ?? m[3]) : undefined;
  check('Chrome command line references our ISO (ownership) and yields the profile dir', !!dir && norm(path.dirname(dir)) === norm(ISO), `dir=${dir}`);
  if (st.userDataDir !== undefined) check('state.userDataDir equals the CIM-derived dir', norm(st.userDataDir) === norm(dir));
  check('--user-data-dir length <= 200 (P5)', !!dir && dir.length <= 200, `len=${dir?.length}`);
  check('profile dir exists after nav', !!dir && fs.existsSync(dir));
  if (kase === 'selfheal') {
    const p = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const q = s.address().port; s.close(() => r(q)); }); });
    st.wsEndpoint = `ws://127.0.0.1:${p}/devtools/browser/s8b-closed-port`; fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
    log(`INFO state.json wsEndpoint rewritten to closed port ${p}; chromePid kept=${chromePid}`);
  }
  holder = spawn(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'holder.ps1')], { env: { ...process.env, LOCKPATH: STATE }, windowsHide: true });
  rec('lock-holder', holder.pid); let hout = ''; holder.stdout.on('data', (d) => (hout += d));
  const th = performance.now(); while (!hout.includes('ready') && performance.now() - th < 20000) await sleep(100);
  check('lock holder ready (FileShare ReadWrite, no Delete)', hout.includes('ready'));
  const r = await cli(kase === 'close' ? ['close'] : ['nav', URL_]); measuredDone = true;
  const aliveAtReturn = isAlive(chromePid) && ours(chromePid);
  const dirAtReturn = fs.existsSync(dir);
  const lines = r.stderr.split(/\r?\n/); const fatalIdx = lines.findIndex((l) => l.startsWith('Fatal: '));
  const fm = fatalIdx >= 0 ? /^Fatal: (E[A-Z]+): .*'([^']*state\.json)'/.exec(lines[fatalIdx]) : null;
  const removedIdx = lines.findIndex((l) => l.startsWith('[cleanup] removed ') && norm(/path="([^"]+)"/.exec(l)?.[1] ?? '') === norm(dir));
  R.measured = { code: r.code, signal: r.signal, timedOut: r.timedOut, ms: r.ms, aliveAtReturn, dirAtReturn,
    fatalLine: lines[fatalIdx] ?? null, errno: fm?.[1] ?? null, fatalStatePath: fm?.[2] ?? null, fatalIdx, removedIdx,
    sessionClosed: r.stdout.includes('Session closed.'), noteUnreachable: (r.stdout + r.stderr).includes('previous session was unreachable'),
    phaseKill: r.stderr.includes('[cleanup] phase kill'), stateCleared: r.stderr.includes('[cleanup] state-cleared'),
    couldNotClear: (r.stdout + r.stderr).includes('could not clear the session state') };
  log('MEASURED ' + JSON.stringify(R.measured));
  holder.stdin.end('\n'); const tr = performance.now(); while (holder.exitCode === null && performance.now() - tr < 15000) await sleep(100);
  check('lock holder released and exited', holder.exitCode !== null, `exit=${holder.exitCode} out=${hout.trim().replace(/\s+/g, ',')}`);
  let after = null; try { after = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
  R.stateAfter = after ? { chromePid: after.chromePid ?? null, userDataDir: after.userDataDir ?? null } : null; log('STATE-AFTER ' + JSON.stringify(R.stateAfter));
  if (fs.existsSync(STATE)) { fs.rmSync(STATE); log('INFO harness deleted state.json itself (no CLI command touches this state dir again)'); }
  if (after && after.chromePid && after.chromePid !== chromePid) { extraPids.push(after.chromePid); rec('fresh-session chromePid (control path)', after.chromePid); }
} catch (e) { check('harness ran without exception', false, e.stack); }
finally {
  if (chromePid) { const t = performance.now(); while (isAlive(chromePid) && performance.now() - t < 15000) await sleep(200);
    if (isAlive(chromePid)) await ownedKill(chromePid, 'original chrome still alive'); }
  for (const p of extraPids) await ownedKill(p, 'control fresh-session chrome');
  for (const l of cimByNeedle()) await ownedKill(Number(l.split(' ')[0]), 'leftover referencing ISO: ' + l);
  R.chromeGoneFinal = chromePid ? (!isAlive(chromePid) || !ours(chromePid)) : null;
  for (const nme of fs.readdirSync(ISO)) { const p = path.join(ISO, nme); const ls = fs.lstatSync(p);
    if (/^sutradhar-cli-\d{10,}(-[A-Za-z0-9]{1,16})?$/.test(nme) && norm(path.dirname(p)) === norm(ISO) && ls.isDirectory() && !ls.isSymbolicLink()) { fs.rmSync(p, { recursive: true, force: true }); log(`INFO harness removed leftover dir ${nme}`); } }
  const dummy = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)', path.join(ISO, 'positive-control-marker')], { windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } }); rec('dummy', dummy.pid);
  await sleep(800); const seen = cimByNeedle(); check('leftover query positive control finds the dummy', seen.some((l) => Number(l.split(' ')[0]) === dummy.pid), seen.join(';'));
  dummy.kill(); const td = performance.now(); while (dummy.exitCode === null && dummy.signalCode === null && performance.now() - td < 10000) await sleep(100);
  const left = cimByNeedle(); check('no process references the ISO at the end', left.length === 0, left.join(';'));
  if (holder && holder.exitCode === null) holder.kill();
  server.close();
  check('real TEMP sutradhar-cli-* list unchanged', realTemp() === rt0);
  R.fails = fails; fs.writeFileSync(path.join(outDir, `result-${label}-${kase}.json`), JSON.stringify(R, null, 2));
  log(`# harness-fails=${fails}`);
}
