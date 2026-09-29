// FR2-03 audit-2 -- independent Done-when + adversarial harness. Written from scratch by audit-2;
// imports NOTHING from the code under test (own CIM observer, own dir counting, own MCP client).
//
// Scenario (own design, differs from audit-1/fix-1's):
//   CLI leg (detached Chromes survive their CLI node process by design):
//     S1 default state, cwd-1  -> Chrome hard-killed (/T)            => stale session: dir must go
//     S2 default state, cwd-2  -> state.json deleted, Chrome running  => orphan-cli: kill + dir must go
//     S3 CUSTOM state dir A    -> LIVE control, must survive + stay usable (GAP-175)
//     S4 CUSTOM state dir B    -> LIVE control, simultaneously with S3 (two custom dirs)
//     S5 default state, cwd-5  -> LIVE control
//     S6 CUSTOM state dir C    -> Chrome hard-killed (/T); its state file is OUTSIDE the root and no
//                                 process references it any more => plain orphan dir (backdated)
//     S7 CUSTOM state dir E    -> relaunch orphan: state overwritten with a dead endpoint, then `nav`
//                                 self-heals into a NEW Chrome Y in the same state file; old Chrome X
//                                 still runs. Marker of X points at a state file that now references Y.
//                                 => X must be killed, Y must survive.
//   Runtime leg: MCP server x2 browser.launch + SDK holder x1 -> Node side hard-killed WITHOUT /T.
//   Decoys: unmarked puppeteer-core Chrome (running), unmarked stopped puppeteer-named dir (backdated,
//           no owner file), foreign Chrome on a non-Sutradhar-named dir, YOUNG sutradhar-cli dir.
//   Then: dry-run (fs snapshot of every non-live path must be byte/mtime identical), real GC,
//   independent counts, controls usable, interlocks.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, utimes, stat } from 'node:fs/promises';
import { existsSync, realpathSync, appendFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages', 'cli', 'dist', 'cli.js');
const MCP = path.join(repo, 'packages', 'mcp-server', 'dist', 'cli.js');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(here, process.argv[2] ?? 'main');
await mkdir(OUT, { recursive: true });
const CASES = path.join(OUT, 'cases.jsonl');
writeFileSync(CASES, '');
const results = [];
function rec(name, expected, observed, pass) {
  const c = { name, expected, observed, pass };
  results.push(c);
  appendFileSync(CASES, JSON.stringify(c) + '\n');
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : '  ' + JSON.stringify(observed).slice(0, 500)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const tk = (pid, tree) => { try { execFileSync('taskkill', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore' }); } catch {} };
async function until(fn, ms, step = 250) { const d = Date.now() + ms; while (Date.now() < d) { if (await fn()) return true; await sleep(step); } return !!(await fn()); }

// ---- independent observer: raw CIM incl. CreationDate; descendant walk WITH a parent-older-than-child guard
function table() {
  const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ p=$_.ProcessId; pp=$_.ParentProcessId; t=$_.CreationDate.ToFileTimeUtc(); a=$_.CommandLine } } | ConvertTo-Json -Compress`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf-8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  const arr = JSON.parse(raw.trim());
  return (Array.isArray(arr) ? arr : [arr]).map((o) => ({ pid: o.p, ppid: o.pp, t: o.t, cmd: (o.a ?? '').toLowerCase() }));
}
function procsFor(sub, tbl) {
  const s = sub.toLowerCase();
  const by = new Map(tbl.map((p) => [p.pid, p]));
  const hit = new Set(tbl.filter((p) => p.cmd.includes(s)).map((p) => p.pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of tbl) {
      const par = by.get(p.ppid);
      if (!hit.has(p.pid) && par && hit.has(p.ppid) && par.t <= p.t) { hit.add(p.pid); grew = true; }
    }
  }
  return tbl.filter((p) => hit.has(p.pid));
}
const DIR_RE = /^(sutradhar-cli-\d{10,}(-[A-Za-z0-9]{6})?|puppeteer_dev_chrome_profile-[A-Za-z0-9]{6})$/;
const profileDirs = (T) => readdirSync(T).filter((n) => DIR_RE.test(n));

// ---- scratch
const R = realpathSync.native(await mkdtemp(path.join(os.tmpdir(), 'fr2-03-a2-')));
const T = path.join(R, 'temp'), SR = path.join(R, 'state-root');
for (const d of [T, SR, ...['A', 'B', 'C', 'D', 'E'].map((x) => path.join(R, 'custom-' + x)), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => path.join(R, 'cwd-' + i))]) await mkdir(d, { recursive: true });
const baseEnv = { ...process.env, TEMP: T, TMP: T, TMPDIR: T, SUTRADHAR_CLI_STATE_ROOT: SR };
delete baseEnv.SUTRADHAR_CLI_STATE_DIR;
const envFor = (custom) => (custom ? { ...baseEnv, SUTRADHAR_CLI_STATE_DIR: path.join(R, 'custom-' + custom) } : baseEnv);
const cwdOf = (i) => path.join(R, 'cwd-' + i);
console.log('R =', R);
writeFileSync(path.join(OUT, 'scratch.txt'), R);

function cli(args, env, cwd, ms = 90000) {
  return new Promise((res) => {
    const c = spawn(process.execPath, [CLI, ...args], { env, cwd, windowsHide: true });
    let o = '', e = '';
    const t = setTimeout(() => c.kill(), ms);
    c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d));
    c.on('close', (code) => { clearTimeout(t); res({ code, stdout: o, stderr: e, pid: c.pid }); });
  });
}
const gcJson = async (extra = [], env = baseEnv) => { const r = await cli(['doctor', '--gc', ...extra, '--json'], env, R); let j; try { j = JSON.parse(r.stdout); } catch {} return { ...r, j }; };
function stateFileFor(custom, cwd) {
  if (custom) return path.join(R, 'custom-' + custom, 'state.json');
  const h = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 16);
  return path.join(SR, h, 'state.json');
}
const readState = async (f) => { try { return JSON.parse(await readFile(f, 'utf-8')); } catch { return undefined; } };

// fixture
const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(`<!doctype html><title>a2 ${q.url}</title><p id=x>ok</p>`); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/`;

const realTempBefore = readdirSync(realpathSync.native(os.tmpdir())).filter((n) => DIR_RE.test(n));
const cleanupPids = [];
try {
  // ---------------- CLI leg
  const S = {
    1: { custom: null, cwd: cwdOf(1) }, 2: { custom: null, cwd: cwdOf(2) }, 3: { custom: 'A', cwd: cwdOf(3) },
    4: { custom: 'B', cwd: cwdOf(4) }, 5: { custom: null, cwd: cwdOf(5) }, 6: { custom: 'C', cwd: cwdOf(6) }, 7: { custom: 'E', cwd: cwdOf(7) },
  };
  const navs = await Promise.all(Object.entries(S).map(async ([k, s]) => [k, await cli(['nav', `${BASE}?s=${k}`], envFor(s.custom), s.cwd)]));
  rec('M0-seven-cli-navs', 'all exit 0', navs.map(([k, r]) => [k, r.code, r.stderr.slice(0, 200)]), navs.every(([, r]) => r.code === 0));
  for (const [k, s] of Object.entries(S)) { s.file = stateFileFor(s.custom, s.cwd); s.st = await readState(s.file); }
  rec('M1-state-files-where-expected', 'custom sessions write state OUTSIDE state root', Object.fromEntries(Object.entries(S).map(([k, s]) => [k, { file: s.file, ok: !!s.st, pid: s.st?.chromePid, dir: s.st?.profileDir }])), Object.values(S).every((s) => s.st?.chromePid && s.st?.profileDir?.toLowerCase().startsWith(T.toLowerCase())));

  // S7 relaunch orphan: poison state endpoint -> nav self-heals to new Chrome Y; old X keeps running
  S[7].X = { pid: S[7].st.chromePid, dir: S[7].st.profileDir };
  const poisoned = { ...S[7].st, wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/dead', chromePid: 4 }; // chromePid 4 = System: alive but never Chrome
  await writeFile(S[7].file, JSON.stringify(poisoned));
  const heal = await cli(['nav', `${BASE}?s=7b`], envFor('E'), S[7].cwd);
  S[7].st = await readState(S[7].file);
  S[7].Y = { pid: S[7].st?.chromePid, dir: S[7].st?.profileDir };
  rec('M2-relaunch-orphan-built', 'old Chrome X still alive, new Chrome Y in the same custom state file', { heal: heal.code, X: S[7].X, Y: S[7].Y, xAlive: alive(S[7].X.pid), stderr: heal.stderr.slice(0, 300) }, heal.code === 0 && alive(S[7].X.pid) && S[7].Y.pid && S[7].Y.pid !== S[7].X.pid);

  // S2 orphan: delete its state file (Chrome keeps running, its CLI owner long dead)
  await rm(S[2].file);
  // S1 & S6: hard-kill their Chromes (the "2 Chromes" of the Done-when)
  tk(S[1].st.chromePid, true); tk(S[6].st.chromePid, true);
  await until(() => procsFor(S[1].st.profileDir, table()).length === 0 && procsFor(S[6].st.profileDir, table()).length === 0, 20000, 500);

  // ---------------- runtime leg: MCP x2 + SDK holder x1, then hard-kill Node side (no /T)
  const pupBefore = new Set(profileDirs(T).filter((n) => n.startsWith('puppeteer')));
  const mcp = spawn(process.execPath, [MCP], { env: baseEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  cleanupPids.push(mcp.pid);
  let buf = '', id = 0; const pend = new Map();
  mcp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch {} } });
  const rpc = (method, params) => new Promise((r) => { const n = ++id; pend.set(n, r); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a2', version: '1' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const l1 = await rpc('tools/call', { name: 'browser.launch', arguments: { headless: true } });
  const l2 = await rpc('tools/call', { name: 'browser.launch', arguments: { headless: true } });
  const holderSrc = path.join(OUT, 'sdk-holder-a2.mjs');
  await writeFile(holderSrc, `import { launch } from ${JSON.stringify('file:///' + path.join(repo, 'packages/sutradhar/dist/index.js').replace(/\\/g, '/'))};\nawait launch({ headless: true });\nconsole.log('ready');\nsetInterval(()=>{},1e9);\n`);
  const holder = spawn(process.execPath, [holderSrc], { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  cleanupPids.push(holder.pid);
  await new Promise((r) => { holder.stdout.on('data', (d) => String(d).includes('ready') && r()); setTimeout(r, 30000); });
  const runtimeDirs = profileDirs(T).filter((n) => n.startsWith('puppeteer') && !pupBefore.has(n));
  const ownerFiles = Object.fromEntries(runtimeDirs.map((n) => { try { return [n, JSON.parse(readFileSyncSafe(path.join(T, n, '.sutradhar-owner.json')))]; } catch { return [n, null]; } }));
  rec('M3-runtime-3-dirs-with-owner-files', '3 runtime dirs, each with owner file naming MCP or holder', { runtimeDirs, owners: Object.values(ownerFiles).map((o) => o?.ownerPid), mcp: mcp.pid, holder: holder.pid, l1: !l1.result?.isError, l2: !l2.result?.isError },
    runtimeDirs.length === 3 && Object.values(ownerFiles).every((o) => o && (o.ownerPid === mcp.pid || o.ownerPid === holder.pid)));
  tk(mcp.pid, false); tk(holder.pid, false);
  await until(() => !alive(mcp.pid) && !alive(holder.pid), 10000);
  await sleep(1500);
  const rtSurvivors = runtimeDirs.filter((n) => procsFor(n, table()).length > 0);
  rec('M4-runtime-chromes-after-node-kill (informational)', 'recorded honestly: Windows libuv job object usually takes non-detached children down', { survivors: rtSurvivors }, true);

  // ---------------- decoys
  const decoyPupDir = path.join(T, 'puppeteer_dev_chrome_profile-Dcy0AA'); // stopped, unmarked, no owner file
  await mkdir(decoyPupDir); await writeFile(path.join(decoyPupDir, 'Preferences'), '{}');
  const foreignDir = path.join(T, 'some-other-tool-profile');
  await mkdir(foreignDir);
  const foreign = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${foreignDir}`, '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' }); foreign.unref();
  const pupDecoySrc = path.join(OUT, 'pup-decoy-a2.mjs');
  await writeFile(pupDecoySrc, `import { createRequire } from 'node:module';\nconst req = createRequire(${JSON.stringify(path.join(repo, 'packages/browser/package.json'))});\nconst p = req('puppeteer-core');\nconst b = await p.launch({ headless: true, executablePath: ${JSON.stringify(CHROME)} });\nconsole.log('ready ' + b.process().pid);\nsetInterval(()=>{},1e9);\n`);
  const pupBefore2 = new Set(profileDirs(T));
  const pupDecoy = spawn(process.execPath, [pupDecoySrc], { env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  cleanupPids.push(pupDecoy.pid);
  await new Promise((r) => { pupDecoy.stdout.on('data', (d) => String(d).includes('ready') && r()); setTimeout(r, 30000); });
  const livePupDecoyDir = profileDirs(T).find((n) => !pupBefore2.has(n) && n.startsWith('puppeteer'));
  const youngDir = path.join(T, `sutradhar-cli-${Date.now()}-yNg0AA`); await mkdir(youngDir);

  // backdate every NON-control, NON-young dir by 10 min (spec §0.4 sanctions utimes for the harness)
  const controlDirs = [S[3].st.profileDir, S[4].st.profileDir, S[5].st.profileDir, S[7].Y.dir].map((d) => path.basename(d));
  const old = new Date(Date.now() - 10 * 60_000);
  for (const n of profileDirs(T)) if (!controlDirs.includes(n) && path.join(T, n) !== youngDir && n !== livePupDecoyDir) await utimes(path.join(T, n), old, old);
  await utimes(decoyPupDir, old, old);

  // expected sets
  const expectGone = [S[1].st.profileDir, S[2].st.profileDir, S[6].st.profileDir, S[7].X.dir, ...runtimeDirs.map((n) => path.join(T, n))].map((d) => path.basename(d));
  const expectKept = [...controlDirs, path.basename(decoyPupDir), livePupDecoyDir, path.basename(youngDir)];
  const excluded = new Set(expectKept.map((n) => n.toLowerCase()).concat(['some-other-tool-profile']));
  const indepCount = () => {
    const tbl = table();
    const dirs = profileDirs(T).filter((n) => !excluded.has(n.toLowerCase()));
    const procs = procsFor(T, tbl).filter((p) => ![...excluded].some((x) => p.cmd.includes(x)));
    // children with no dir in cmdline: exclude those whose (guarded) ancestor is a control
    const ctlPids = new Set([...excluded].flatMap((x) => procsFor(path.join(T, x), tbl).map((p) => p.pid)));
    return { dirs, procs: procs.filter((p) => !ctlPids.has(p.pid)).map((p) => ({ pid: p.pid, cmd: p.cmd.slice(0, 160) })) };
  };
  const before = indepCount();
  writeFileSync(path.join(OUT, 'counts-before.json'), JSON.stringify(before, null, 2));
  rec('M5-nonvacuous-precondition', 'there IS something to collect: >=7 orphan dirs and >=1 orphan process before GC', { dirs: before.dirs.length, procs: before.procs.length }, before.dirs.length >= 7 && before.procs.length >= 1);

  // ---------------- dry run: snapshot every path under R EXCEPT inside live Chrome profile dirs
  const liveDirNames = new Set([...controlDirs, livePupDecoyDir, 'some-other-tool-profile', path.basename(S[2].st.profileDir), path.basename(S[7].X.dir)].map((n) => n.toLowerCase()));
  function fsSnap(dir, acc = {}) {
    for (const n of readdirSync(dir)) {
      const f = path.join(dir, n); let st; try { st = statSync(f); } catch { continue; }
      if (dir === T && liveDirNames.has(n.toLowerCase())) { acc[f] = 'LIVE-DIR-PRESENT'; continue; }
      acc[f] = st.isDirectory() ? `d:${st.mtimeMs}` : `f:${st.size}:${st.mtimeMs}`;
      if (st.isDirectory()) fsSnap(f, acc);
    }
    return acc;
  }
  const tblPre = table();
  const pidsBefore = new Set(procsFor(R, tblPre).map((p) => p.pid));
  const fs1 = fsSnap(R);
  const dry = await gcJson(['--dry-run']);
  const fs2 = fsSnap(R);
  const pidsAfter = new Set(procsFor(R, table()).map((p) => p.pid));
  const removedOrChanged = Object.keys(fs1).filter((k) => k !== T && fs1[k] !== fs2[k]);
  const added = Object.keys(fs2).filter((k) => !(k in fs1));
  writeFileSync(path.join(OUT, 'gc-dryrun.json'), dry.stdout);
  const lost = [...pidsBefore].filter((p) => !pidsAfter.has(p));
  const lostBrowsers = lost.filter((p) => tblPre.find((x) => x.pid === p && !x.cmd.includes('--type=')));
  rec('D1-dry-run-mutates-nothing', 'no pre-existing path under R removed/modified (TEMP own mtime excepted); no browser process vanished; exit 0; added files recorded as noise', { code: dry.code, removedOrChanged, added: added.map((f) => path.relative(R, f)), lostBrowsers, lostChildren: lost.length - lostBrowsers.length }, dry.code === 0 && removedOrChanged.length === 0 && lostBrowsers.length === 0);
  const interlock = (j) => (j?.actions ?? []).filter((a) => (a.type === 'kill' && a.role === 'browser' && !(a.userDataDir ?? '').toLowerCase().startsWith(R.toLowerCase())) || (a.type === 'deleteDir' && !a.path.toLowerCase().startsWith(R.toLowerCase())));
  rec('D2-interlock-scope', 'scope.tempRoot is scratch; every planned browser kill / delete is under R', { scope: dry.j?.scope, bad: interlock(dry.j) }, dry.j?.scope?.tempRoot?.toLowerCase() === T.toLowerCase() && interlock(dry.j).length === 0);
  const planKills = (dry.j?.actions ?? []).filter((a) => a.type === 'kill');
  const planDel = (dry.j?.actions ?? []).filter((a) => a.type === 'deleteDir').map((a) => path.basename(a.path));
  const protectedPids = [S[3].st.chromePid, S[4].st.chromePid, S[5].st.chromePid, S[7].Y.pid];
  rec('D3-plan-never-touches-controls', 'no kill of a live control Chrome (S3/S4/S5/S7-Y), no delete of any expected-kept dir', { killsOfControls: planKills.filter((a) => protectedPids.includes(a.pid)), delOfKept: planDel.filter((n) => expectKept.includes(n)) }, planKills.every((a) => !protectedPids.includes(a.pid)) && planDel.every((n) => !expectKept.includes(n)));
  rec('D4-plan-kills-true-orphans', 'plan kills S2 Chrome and S7 old Chrome X', { planKills: planKills.map((a) => [a.pid, a.role]), want: [S[2].st.chromePid, S[7].X.pid] }, [S[2].st.chromePid, S[7].X.pid].every((p) => planKills.some((a) => a.pid === p && a.role === 'browser')));
  // every planned child kill must be a genuine (guarded) descendant of a planned browser kill
  const tblPost = table(); const byPid = new Map([...tblPre, ...tblPost].map((p) => [p.pid, p]));
  const genuine = (pid) => { let p = byPid.get(pid); if (!p) return 'vanished'; for (let h = 0; p && h < 12; h++) { const par = byPid.get(p.ppid); if (!par) return 'no-parent'; if (par.t > p.t) return 'PARENT-YOUNGER-THAN-CHILD'; if (planKills.some((a) => a.role === 'browser' && a.pid === par.pid)) return 'ok'; p = par; } return 'no-browser-ancestor'; };
  const childVerdicts = planKills.filter((a) => a.role === 'child').map((a) => ({ pid: a.pid, v: genuine(a.pid), cmd: byPid.get(a.pid)?.cmd.slice(0, 90) }));
  const badChildren = childVerdicts.filter((c) => c.v !== 'ok' && c.v !== 'vanished');
  rec('D5-planned-child-kills-are-genuine-descendants', 'every role:child kill is a creation-time-consistent descendant of a planned browser kill', { badChildren, childVerdicts }, badChildren.length === 0);

  // ---------------- real GC
  const run = await gcJson([]);
  writeFileSync(path.join(OUT, 'gc-run.json'), run.stdout);
  rec('G1-gc-exit-0', 'real GC exit 0, no failed actions', { code: run.code, failed: (run.j?.actions ?? []).filter((a) => a.result === 'failed') }, run.code === 0 && (run.j?.actions ?? []).every((a) => a.result !== 'failed'));
  rec('G2-interlock-real-run', 'every browser kill / delete under R', interlock(run.j), interlock(run.j).length === 0);
  await sleep(1500);
  const after = indepCount();
  writeFileSync(path.join(OUT, 'counts-after.json'), JSON.stringify(after, null, 2));
  rec('G3-DONE-WHEN-independent-counts-reach-0', 'independent observer: 0 orphan dirs and 0 orphan processes under scratch temp', after, after.dirs.length === 0 && after.procs.length === 0);
  rec('G4-tool-remaining-agrees', 'tool remaining {0,0} AND matches independent count', { tool: run.j?.remaining, indep: { dirs: after.dirs.length, procs: after.procs.length } }, run.j?.remaining?.orphanDirs === 0 && run.j?.remaining?.orphanProcesses === 0 && after.dirs.length === 0 && after.procs.length === 0);
  rec('G5-expected-dirs-gone', 'S1,S2,S6,S7-X and 3 runtime dirs removed', expectGone.filter((n) => existsSync(path.join(T, n))), expectGone.every((n) => !existsSync(path.join(T, n))));
  rec('G6-kept-dirs-intact', 'controls, both puppeteer decoys, young dir, foreign dir intact', [...expectKept, 'some-other-tool-profile'].filter((n) => !existsSync(path.join(T, n))), [...expectKept, 'some-other-tool-profile'].every((n) => existsSync(path.join(T, n))));
  rec('G7-control-chromes-alive', 'S3,S4,S5,S7-Y Chrome PIDs alive; decoy + foreign Chrome alive', { ctl: protectedPids.map((p) => [p, alive(p)]), foreign: alive(foreign.pid), pupDecoy: procsFor(livePupDecoyDir, table()).length }, protectedPids.every(alive) && alive(foreign.pid) && procsFor(livePupDecoyDir, table()).length > 0);
  const usable = await Promise.all([[3, 'A'], [4, 'B'], [5, null], [7, 'E']].map(async ([i, c]) => { const r = await cli(['eval', 'document.title'], envFor(c), cwdOf(i)); return [i, r.code, r.stdout.trim().slice(0, 60), r.stderr.slice(0, 120)]; }));
  rec('G8-controls-still-usable', 'eval document.title works in each surviving session WITHOUT self-heal (title shows original ?s=)', usable, usable.every(([i, code, out, err]) => code === 0 && out.includes(`?s=${i === 7 ? '7b' : i}`) && !/fresh session/.test(err)));
  const stAfter = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(async (i) => [i, existsSync(S[i].file)]));
  rec('G9-state-files', 'S1 state cleared; S3,S4,S5,S7 state intact; S6 custom state untouched (unreferenced, outside root)', stAfter, !stAfter[0][1] && stAfter[2][1] && stAfter[3][1] && stAfter[4][1] && stAfter[6][1]);
  const realAfter = new Set(readdirSync(realpathSync.native(os.tmpdir())));
  rec('G10-real-temp-untouched', 'every real-temp profile dir present before still exists', realTempBefore.filter((n) => !realAfter.has(n)), realTempBefore.every((n) => realAfter.has(n)));

  // second GC: idempotent, nothing more to do
  const run2 = await gcJson([]);
  writeFileSync(path.join(OUT, 'gc-run2.json'), run2.stdout);
  rec('G11-second-gc-noop', 'second GC: no kills/deletes, controls still alive', { actions: run2.j?.actions, code: run2.code }, run2.code === 0 && (run2.j?.actions ?? []).filter((a) => a.type !== 'clearState').length === 0 && protectedPids.every(alive));

  // ---------------- ADV-R: concurrency race -- in-flight custom-state-dir launch while GC runs repeatedly
  const raceFile = path.join(R, 'custom-D', 'state.json');
  const racer = cli(['nav', `${BASE}?s=race`], envFor('D'), cwdOf(8));
  const raceGcs = [];
  for (let i = 0; i < 8; i++) { raceGcs.push(await gcJson([])); await sleep(150); }
  const rr = await racer;
  const rst = await readState(raceFile);
  const raceKills = raceGcs.flatMap((g) => (g.j?.actions ?? []).filter((a) => a.type === 'kill' || a.type === 'deleteDir'));
  const raceUse = await cli(['eval', 'document.title'], envFor('D'), cwdOf(8));
  rec('R1-inflight-launch-survives-concurrent-gc', 'nav ok; 8 concurrent GCs kill/delete nothing; session usable afterwards', { nav: rr.code, pid: rst?.chromePid, alive: rst && alive(rst.chromePid), raceKills, use: [raceUse.code, raceUse.stdout.trim(), raceUse.stderr.slice(0, 120)] },
    rr.code === 0 && rst && alive(rst.chromePid) && raceKills.length === 0 && raceUse.code === 0 && raceUse.stdout.includes('?s=race'));
  protectedPids.push(rst?.chromePid);

  // ---------------- ADV-C: live custom-state session with a CORRUPT / EMPTY (mid-write) state file (dry-run only)
  const s3raw = await readFile(S[3].file, 'utf-8');
  const probeCorrupt = {};
  for (const [label, content] of [['empty-mid-write', ''], ['garbage', '{not json'], ['truncated', s3raw.slice(0, 40)]]) {
    await writeFile(S[3].file, content);
    const d = await gcJson(['--dry-run']);
    probeCorrupt[label] = { killsS3: (d.j?.actions ?? []).some((a) => a.type === 'kill' && a.pid === S[3].st.chromePid), deletesS3Dir: (d.j?.actions ?? []).some((a) => a.type === 'deleteDir' && a.path.toLowerCase() === S[3].st.profileDir.toLowerCase()), kept: (d.j?.kept ?? []).filter((k) => k.path?.toLowerCase().includes('custom-a')) };
  }
  await writeFile(S[3].file, s3raw);
  writeFileSync(path.join(OUT, 'adv-corrupt-state.json'), JSON.stringify(probeCorrupt, null, 2));
  rec('C1-live-chrome-with-unreadable-state (characterisation)', 'recorded: does GC plan to kill a LIVE, reachable Chrome whose state file is momentarily unreadable?', probeCorrupt, true);

  const finalUse = await cli(['eval', 'document.title'], envFor('A'), cwdOf(3));
  rec('Z1-S3-survived-everything', 'S3 still usable after all dry-run probes', [finalUse.code, finalUse.stdout.trim()], finalUse.code === 0 && finalUse.stdout.includes('?s=3'));
} catch (err) {
  rec('HARNESS-ERROR', 'no exception', String(err?.stack ?? err), false);
} finally {
  for (const p of cleanupPids) if (alive(p)) tk(p, true);
  for (let i = 0; i < 3; i++) { const ps = procsFor(R, table()); if (!ps.length) break; for (const p of ps) tk(p.pid, true); await sleep(800); }
  srv.close();
  const summary = { R, total: results.length, passed: results.filter((c) => c.pass).length, failed: results.filter((c) => !c.pass).map((c) => c.name), leftoverProcsUnderR: procsFor(R, table()).length };
  writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
function readFileSyncSafe(f) { return execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(f)},'utf8'))`]).toString(); }
