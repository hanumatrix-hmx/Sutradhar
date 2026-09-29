// Auditor harness (FR2-03 audit-1): the Done-when live proof the Executor did not build.
// 5 CLI sessions + control, crash the Node side, kill two Chromes, orphan two more (state wiped),
// plus a runtime leg (3 MCP + 2 SDK browsers, Node killed), plus legacy fake leaks and negative
// fixtures. Then dry-run, real GC, and independent-observer counts.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, rm, utimes, symlink, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  here, mcpPath, makeRecorder, makeScratch, runCli, spawnCli, observeAll, observeFor, isAlive, taskkill,
  waitUntil, readStates, stateForCwd, startFixtureServer, interlock, spawnDecoyChrome, killEverythingUnder,
} from './common.mjs';

const OUT = path.join(here, 'main');
await mkdir(OUT, { recursive: true });
const { rec, cases } = makeRecorder(path.join(OUT, 'cases.jsonl'));
const save = (n, o) => writeFile(path.join(OUT, n), typeof o === 'string' ? o : JSON.stringify(o, null, 2));

const S = await makeScratch('fr2-03-audit-main-');
const { R, temp, stateRoot, env } = S;
console.log('scratch', R);
const { srv, base } = await startFixtureServer();
const extraKill = []; // pids to kill in teardown
let mcp;

function mcpClient(child) {
  let buf = '';
  const pending = new Map();
  let id = 0;
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
    }
  });
  const send = (method, params) => new Promise((resolve) => { const i2 = ++id; pending.set(i2, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i2, method, params }) + '\n'); });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { send, notify };
}

try {
  const listTemp = async () => (await readdir(temp)).sort();
  const before = await listTemp();

  // ---------- Leg B: CLI, 5 sessions + control ----------
  const navs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => runCli(['nav', `${base}?case=main-${i}`], env, S.cwd(i))));
  rec('B1-six-navs-ok', 'all 6 navs exit 0', navs.map((n) => n.code), navs.every((n) => n.code === 0));
  const st = {};
  for (let i = 1; i <= 6; i++) st[i] = await stateForCwd(stateRoot, S.cwd(i));
  rec('B2-state-fields', 'each state has profileDir under temp, owned, cwd, createdAt, distinct dirs',
    Object.values(st).map((s) => s?.state && { pd: s.state.profileDir, o: s.state.profileDirOwned, cwd: s.state.cwd, c: s.state.createdAt, pid: s.state.chromePid }),
    Object.values(st).every((s) => s?.state?.profileDir?.toLowerCase().startsWith(temp.toLowerCase()) && s.state.profileDirOwned === true && s.state.createdAt) &&
      new Set(Object.values(st).map((s) => s.state.profileDir)).size === 6);

  // markers on the Chrome command lines (independent observer)
  const table0 = observeAll();
  const markerOk = [1, 2, 3, 4, 5, 6].every((i) => {
    const p = table0.find((x) => x.pid === st[i].state.chromePid);
    return p && p.cmd.includes('--sutradhar-launch=cli') && p.cmd.includes('--sutradhar-state=') && p.cmd.includes(st[i].state.profileDir);
  });
  rec('B3-cli-markers', 'each CLI Chrome carries --sutradhar-launch=cli + --sutradhar-state + its dir', markerOk, markerOk);

  // In-flight waits in 1..5, confirm still running after 3s, then kill -9 the Node side (no /T)
  const waits = [1, 2, 3, 4, 5].map((i) => spawnCli(['wait', '#never', '60000'], env, S.cwd(i)));
  const raced = await Promise.race([Promise.all(waits.map((w) => w.exited)).then(() => 'exited'), new Promise((r) => setTimeout(() => r('still-running'), 3000))]);
  rec('B4-waits-in-flight', 'all 5 wait commands still running at 3s', raced, raced === 'still-running');
  for (const w of waits) taskkill(w.pid, false);
  await Promise.all(waits.map((w) => w.exited));
  const allChromesAlive = [1, 2, 3, 4, 5, 6].every((i) => isAlive(st[i].state.chromePid));
  rec('B5-chromes-survive-node-kill', 'all 6 Chromes still alive after killing the CLI Node processes', allChromesAlive, allChromesAlive);

  // Kill Chrome of sessions 1 and 2 (tree) -> stale
  for (const i of [1, 2]) taskkill(st[i].state.chromePid, true);
  const gone12 = await waitUntil(() => [1, 2].every((i) => observeFor(st[i].state.profileDir).length === 0), 20000, 500);
  rec('B6-sessions-1-2-chrome-dead', 'no observed process for dirs 1,2', gone12, gone12);
  // Delete state dirs of 3, 4 -> orphans
  for (const i of [3, 4]) await rm(st[i].dir, { recursive: true, force: true });

  // ---------- Leg A: runtime (3 MCP + 2 SDK) ----------
  const pupBefore = (await listTemp()).filter((n) => n.startsWith('puppeteer_dev_chrome_profile-'));
  mcp = spawn(process.execPath, [mcpPath], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let mcpErr = ''; mcp.stderr.on('data', (d) => (mcpErr += d));
  const c = mcpClient(mcp);
  await c.send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'audit', version: '1' } });
  c.notify('notifications/initialized', {});
  const launches = [];
  for (let k = 0; k < 3; k++) launches.push(await c.send('tools/call', { name: 'browser.launch', arguments: { headless: true } }));
  rec('A1-mcp-3-launches', '3 browser.launch results without isError', launches.map((l) => l.result?.isError ?? l.error), launches.every((l) => l.result && !l.result.isError));
  const holder = spawn(process.execPath, [path.join(here, 'sdk-holder.mjs'), '2'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let holderOut = ''; holder.stdout.on('data', (d) => (holderOut += d));
  let holderErr = ''; holder.stderr.on('data', (d) => (holderErr += d));
  const holderReady = await waitUntil(() => holderOut.includes('"pid"'), 60000, 250);
  rec('A2-sdk-holder-2-launches', 'holder printed its ready line', { holderOut, holderErr: holderErr.slice(0, 500) }, holderReady);
  const pupAfter = (await listTemp()).filter((n) => n.startsWith('puppeteer_dev_chrome_profile-') && !pupBefore.includes(n));
  const ownerFiles = {};
  for (const n of pupAfter) {
    try { ownerFiles[n] = JSON.parse(readFileSync(path.join(temp, n, '.sutradhar-owner.json'), 'utf-8')); } catch (e) { ownerFiles[n] = String(e); }
  }
  const ownerPids = Object.values(ownerFiles).map((o) => o.ownerPid);
  rec('A3-five-runtime-dirs-with-owner-files', '5 new Puppeteer dirs, each owner file names the MCP or holder pid',
    { pupAfter, ownerFiles, mcpPid: mcp.pid, holderPid: holder.pid },
    pupAfter.length === 5 && ownerPids.filter((p) => p === mcp.pid).length === 3 && ownerPids.filter((p) => p === holder.pid).length === 2);
  const table1 = observeAll();
  const runtimeBrowsers = {};
  for (const n of pupAfter) {
    const b = table1.find((p) => p.cmd.includes(n) && !p.cmd.includes('--type=') && /chrome\.exe/i.test(p.cmd));
    runtimeBrowsers[n] = b ? { pid: b.pid, marked: b.cmd.includes('--sutradhar-launch=runtime'), ownerPidArg: (b.cmd.match(/--sutradhar-owner-pid=(\d+)/) ?? [])[1] } : null;
  }
  rec('A4-runtime-markers', 'each runtime browser carries --sutradhar-launch=runtime and matching owner pid', runtimeBrowsers,
    Object.entries(runtimeBrowsers).every(([n, b]) => b && b.marked && Number(b.ownerPidArg) === ownerFiles[n].ownerPid));

  // kill -9 the Node side (no /T)
  taskkill(mcp.pid, false); taskkill(holder.pid, false);
  await waitUntil(() => !isAlive(mcp.pid) && !isAlive(holder.pid), 10000);
  await new Promise((r) => setTimeout(r, 1500)); // settle: let any job-object teardown happen before judging survival
  const survivors = Object.fromEntries(Object.entries(runtimeBrowsers).map(([n, b]) => [n, b ? isAlive(b.pid) : false]));
  const nSurv = Object.values(survivors).filter(Boolean).length;
  rec('A5-runtime-browsers-survive-node-kill (precondition, honest)', 'all 5 runtime browsers alive after Node kill', { survivors, nSurv }, nSurv === 5);
  // Kill two runtime Chromes fully (one MCP, one SDK) if alive
  const mcpDirs = pupAfter.filter((n) => ownerFiles[n].ownerPid === mcp.pid);
  const sdkDirs = pupAfter.filter((n) => ownerFiles[n].ownerPid === holder.pid);
  for (const n of [mcpDirs[0], sdkDirs[0]]) if (runtimeBrowsers[n]) taskkill(runtimeBrowsers[n].pid, true);
  await waitUntil(() => [mcpDirs[0], sdkDirs[0]].every((n) => observeFor(n).length === 0), 20000, 500);

  // ---------- Fake legacy leaks + negative fixtures ----------
  const hourAgo = new Date(Date.now() - 3600_000);
  const fakes = [];
  for (let k = 10; k <= 19; k++) {
    const d = path.join(temp, `sutradhar-cli-16000000000${k}`);
    await mkdir(d); await writeFile(path.join(d, 'Local State'), '{}'); await utimes(d, hourAgo, hourAgo); fakes.push(d);
  }
  const young = path.join(temp, `sutradhar-cli-${Date.now()}-YOUNG1`);
  await mkdir(young);
  await mkdir(path.join(R, 'precious')); await writeFile(path.join(R, 'precious', 'keep.txt'), 'precious');
  const junction = path.join(temp, 'sutradhar-cli-1600000000002');
  await symlink(path.join(R, 'precious'), junction, 'junction');
  const corruptDir = path.join(stateRoot, 'deadbeefdeadbeef'); await mkdir(corruptDir); await writeFile(path.join(corruptDir, 'state.json'), '{not json');
  const deadNode = spawn(process.execPath, ['-e', '']); await new Promise((r) => deadNode.on('close', r));
  const deadPid = deadNode.pid;
  rec('N-pre-deadpid', 'the dead pid is really dead', { deadPid, alive: isAlive(deadPid) }, !isAlive(deadPid));
  const mkState = async (name, obj) => { const d = path.join(stateRoot, name); await mkdir(d); await writeFile(path.join(d, 'state.json'), JSON.stringify(obj)); return path.join(d, 'state.json'); };
  const legacyState = await mkState('1e9ac1e9ac1e9ac1', { sessionId: 'legacy', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/legacy', chromePid: deadPid });
  await utimes(legacyState, hourAgo, hourAgo);
  await mkdir(path.join(R, 'named', 'fr2p'), { recursive: true }); await writeFile(path.join(R, 'named', 'fr2p', 'Preferences'), '{}');
  const namedState = await mkState('aaaaaaaaaaaaaaaa', { sessionId: 'named', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/named', chromePid: deadPid, profileDir: path.join(R, 'named', 'fr2p'), profileDirOwned: false, cwd: S.cwd(9), createdAt: new Date().toISOString() });
  await mkdir(path.join(R, 'outside', 'sutradhar-cli-1600000000001'), { recursive: true }); await writeFile(path.join(R, 'outside', 'sutradhar-cli-1600000000001', 'x'), 'x');
  const tamperedState = await mkState('bbbbbbbbbbbbbbbb', { sessionId: 'tampered', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/t', chromePid: deadPid, profileDir: path.join(R, 'outside', 'sutradhar-cli-1600000000001'), profileDirOwned: true, cwd: S.cwd(9), createdAt: new Date().toISOString() });
  // lock-held dir: a node holder with cwd inside it
  const lockDir = path.join(temp, 'sutradhar-cli-1600000000003');
  await mkdir(lockDir); await writeFile(path.join(lockDir, 'f.txt'), 'data');
  const lockHolder = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e9)'], { cwd: lockDir, stdio: 'ignore', windowsHide: true });
  extraKill.push(lockHolder.pid);
  await new Promise((r) => setTimeout(r, 500));
  await utimes(lockDir, hourAgo, hourAgo);
  // decoys
  const d1 = path.join(temp, 'decoy-profile-1');
  const decoy1 = spawnDecoyChrome(d1); extraKill.push(decoy1);
  const d3 = path.join(temp, `sutradhar-cli-${Date.now()}-DECOY1`);
  const decoy3 = spawnDecoyChrome(d3); extraKill.push(decoy3);
  const pupBeforeD2 = (await listTemp()).filter((n) => n.startsWith('puppeteer_dev_chrome_profile-'));
  const d2 = spawn(process.execPath, [path.join(here, 'decoy-puppeteer.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let d2out = ''; d2.stdout.on('data', (x) => (d2out += x));
  await waitUntil(() => d2out.includes('chromePid'), 30000);
  const d2info = JSON.parse(d2out.trim().split('\n').pop());
  const d2dir = (await listTemp()).find((n) => n.startsWith('puppeteer_dev_chrome_profile-') && !pupBeforeD2.includes(n));
  taskkill(d2.pid, false);
  await new Promise((r) => setTimeout(r, 1500));
  extraKill.push(d2info.chromePid);
  rec('N-pre-decoys', 'decoys D1/D3 alive; D2 dir exists (and whether its Chrome survived its Node kill)',
    { decoy1: isAlive(decoy1), decoy3: isAlive(decoy3), d2dir, d2ChromeAlive: isAlive(d2info.chromePid) }, isAlive(decoy1) && isAlive(decoy3) && !!d2dir);
  await new Promise((r) => setTimeout(r, 1000));

  // ---------- C4: sessions ----------
  const sessJ = await runCli(['sessions', '--json'], env, S.cwd(5));
  const sessH = await runCli(['sessions'], env, S.cwd(5));
  await save('sessions-before.json', sessJ.stdout);
  await save('sessions-before-human.txt', sessH.stdout + '\n--stderr--\n' + sessH.stderr);
  let sj; try { sj = JSON.parse(sessJ.stdout); } catch {}
  const byCwd = (i) => sj?.sessions?.find((s) => s.cwd && s.cwd.toLowerCase() === S.cwd(i).toLowerCase() && s.sessionId !== 'named' && s.sessionId !== 'tampered');
  const legacyE = sj?.sessions?.find((s) => s.sessionId === 'legacy');
  const corruptE = sj?.sessions?.find((s) => s.status === 'unreadable');
  rec('C4-sessions', 'cwd1,2 stale pidAlive:false; cwd5,6 live reachable; legacy cwd:null stateFileMtime stale; corrupt unreadable; human has cwd-5 and legacy text',
    { code: sessJ.code, s1: byCwd(1)?.status, s2: byCwd(2)?.status, s5: byCwd(5)?.status, s6: byCwd(6)?.status, legacy: legacyE && { cwd: legacyE.cwd, src: legacyE.ageSource, st: legacyE.status }, corrupt: !!corruptE, count: sj?.sessions?.length },
    sessJ.code === 0 && byCwd(1)?.status === 'stale' && byCwd(1)?.pidAlive === false && byCwd(2)?.status === 'stale' &&
      byCwd(5)?.status === 'live' && byCwd(5)?.endpointReachable === true && byCwd(6)?.status === 'live' &&
      legacyE?.cwd === null && legacyE?.ageSource === 'stateFileMtime' && legacyE?.status === 'stale' && !!corruptE &&
      sessH.stdout.includes(S.cwd(5)) && sessH.stdout.includes('(unknown: created before 0.5.0)'));

  // ---------- C5: dry run ----------
  const snapFs = async () => {
    const out = [];
    const walk = async (d) => {
      let ents; try { ents = await readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const f = path.join(d, e.name);
        if (e.isSymbolicLink()) { out.push(`L ${f}`); continue; }
        if (e.isDirectory()) { out.push(`D ${f}`); if (!/sutradhar-cli-\d+-[A-Za-z0-9]{6}$|puppeteer_dev_chrome_profile-|decoy-profile/.test(e.name)) await walk(f); }
        else if (!/state-root/.test(d)) out.push(`F ${f}`); else out.push(`F ${f} ${readFileSync(f, 'utf-8')}`);
      }
    };
    await walk(R);
    return out.sort().join('\n');
  };
  const obsSet = () => observeFor(R).map((p) => p.pid).sort((a, b) => a - b).join(',');
  const fs1 = await snapFs(); const ob1 = obsSet();
  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], env, S.cwd(9));
  const fs2 = await snapFs(); const ob2 = obsSet();
  await save('gc-dryrun.json', dry.stdout + (dry.stderr ? '\n--stderr--\n' + dry.stderr : ''));
  let dj; try { dj = JSON.parse(dry.stdout); } catch {}
  rec('C5a-dry-run-touches-nothing', 'fs snapshot + observed process set identical, exit 0', { code: dry.code, fsSame: fs1 === fs2, procSame: ob1 === ob2 }, dry.code === 0 && fs1 === fs2 && ob1 === ob2);
  const bad = dj ? interlock(dj, R) : ['no json'];
  rec('C0-interlock-scope', 'scope roots = scratch; every planned kill/delete inside R', { scope: dj?.scope, bad }, dj?.scope?.tempRoot?.toLowerCase() === temp.toLowerCase() && bad.length === 0);
  const kills = (dj?.actions ?? []).filter((a) => a.type === 'kill' && a.role === 'browser');
  const dels = (dj?.actions ?? []).filter((a) => a.type === 'deleteDir').map((a) => a.path.toLowerCase());
  const has = (p) => dels.includes(p.toLowerCase());
  const expectKillPids = [st[3].state.chromePid, st[4].state.chromePid, ...[mcpDirs[1], mcpDirs[2], sdkDirs[1]].filter((n) => survivors[n]).map((n) => runtimeBrowsers[n].pid)];
  rec('C5b-plan-kills', 'kills exactly: CLI orphans 3,4 + surviving runtime orphans', { planned: kills.map((k) => [k.pid, k.reason]), expectKillPids },
    kills.length === expectKillPids.length && expectKillPids.every((p) => kills.some((k) => k.pid === p)));
  const expectDel = [st[1].state.profileDir, st[2].state.profileDir, st[3].state.profileDir, st[4].state.profileDir, ...pupAfter.map((n) => path.join(temp, n)), ...fakes, lockDir];
  rec('C5c-plan-deletes', 'deleteDir for 4 CLI + 5 runtime + 10 fake + lock-held; none for 5,6,young,decoys,junction,named,outside',
    { missing: expectDel.filter((p) => !has(p)), extra: dels.filter((p) => !expectDel.map((x) => x.toLowerCase()).includes(p)) },
    expectDel.every(has) && dels.length === expectDel.length);
  const keptBy = (p) => (dj?.kept ?? []).filter((k) => k.path && k.path.toLowerCase() === p.toLowerCase()).map((k) => k.reason);
  rec('C5d-kept-reasons', 'YOUNG1 grace, D2 not-sutradhar, junction symlink, named named-profile, corrupt unreadable-state, 5/6 live',
    { young: keptBy(young), d2: keptBy(path.join(temp, d2dir)), junction: keptBy(junction), named: keptBy(path.join(R, 'named', 'fr2p')), corrupt: keptBy(path.join(corruptDir, 'state.json')), s5: keptBy(st[5].file), d3: keptBy(d3), d1: keptBy(d1) },
    keptBy(young).includes('grace') && keptBy(path.join(temp, d2dir)).includes('not-sutradhar') && keptBy(junction).includes('symlink') &&
      keptBy(path.join(R, 'named', 'fr2p')).includes('named-profile') && keptBy(path.join(corruptDir, 'state.json')).includes('unreadable-state') && keptBy(st[5].file).includes('live-session'));

  // ---------- C6: real GC ----------
  if (bad.length) throw new Error('interlock failed; refusing real GC');
  const cnt = (table) => {
    const excl = [st[5].state.profileDir, st[6].state.profileDir, d1, d3, path.join(temp, d2dir)].map((x) => x.toLowerCase());
    const orphanProcs = observeFor(temp, table).filter((p) => !excl.some((e) => p.cmd.toLowerCase().includes(e)) && p.pid !== lockHolder.pid);
    return orphanProcs;
  };
  const countDirs = async () => (await listTemp()).filter((n) => /^(sutradhar-cli-|puppeteer_dev_chrome_profile-)/.test(n)).map((n) => path.join(temp, n).toLowerCase())
    .filter((p) => ![st[5].state.profileDir, st[6].state.profileDir, d3, path.join(temp, d2dir), young, junction].map((x) => x.toLowerCase()).includes(p));
  const beforeCounts = { orphanProcs: cnt(observeAll()).length, dirs: (await countDirs()).length };
  const gc1 = await runCli(['doctor', '--gc', '--json'], env, S.cwd(9));
  await save('gc-run1.json', gc1.stdout + (gc1.stderr ? '\n--stderr--\n' + gc1.stderr : ''));
  let g1; try { g1 = JSON.parse(gc1.stdout); } catch {}
  const lockAct = g1?.actions?.find((a) => a.type === 'deleteDir' && a.path.toLowerCase() === lockDir.toLowerCase());
  const othersOk = (g1?.actions ?? []).filter((a) => a !== lockAct).every((a) => ['killed', 'deleted', 'cleared'].includes(a.result));
  rec('C6-gc-run', 'exit 2; lock-held dir failed with code, still exists; everything else killed/deleted/cleared; interlock holds',
    { code: gc1.code, lockAct, lockExists: existsSync(lockDir), notOk: (g1?.actions ?? []).filter((a) => a !== lockAct && !['killed', 'deleted', 'cleared'].includes(a.result)), bad: g1 ? interlock(g1, R) : 'nojson' },
    gc1.code === 2 && lockAct?.result === 'failed' && ['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(lockAct.code) && existsSync(lockDir) && othersOk && g1 && interlock(g1, R).length === 0);
  rec('N9b-lock-held-contents', 'what happened to the lock-held dir CONTENTS on a failed delete (partial delete?)', { fTxtExists: existsSync(path.join(lockDir, 'f.txt')) }, true);
  // negatives after C6
  rec('N-after-C6', 'decoys alive, D2 dir present, named Preferences, outside dir, precious/keep.txt, corrupt bytes, YOUNG1, D3 dir',
    { d1: isAlive(decoy1), d3: isAlive(decoy3), d2dir: existsSync(path.join(temp, d2dir)), named: existsSync(path.join(R, 'named', 'fr2p', 'Preferences')), outside: existsSync(path.join(R, 'outside', 'sutradhar-cli-1600000000001', 'x')), precious: existsSync(path.join(R, 'precious', 'keep.txt')), corrupt: readFileSync(path.join(corruptDir, 'state.json'), 'utf-8') === '{not json', young: existsSync(young), d3dir: existsSync(d3), lockHolderAlive: isAlive(lockHolder.pid) },
    isAlive(decoy1) && isAlive(decoy3) && existsSync(path.join(temp, d2dir)) && existsSync(path.join(R, 'named', 'fr2p', 'Preferences')) && existsSync(path.join(R, 'outside', 'sutradhar-cli-1600000000001', 'x')) && existsSync(path.join(R, 'precious', 'keep.txt')) && readFileSync(path.join(corruptDir, 'state.json'), 'utf-8') === '{not json' && existsSync(young) && existsSync(d3) && isAlive(lockHolder.pid));
  rec('N6-N7-states-cleared', 'named, tampered, legacy states cleared', { named: existsSync(namedState), tampered: existsSync(tamperedState), legacy: existsSync(legacyState) }, !existsSync(namedState) && !existsSync(tamperedState) && !existsSync(legacyState));

  // ---------- C7: release lock, close --all-stale ----------
  taskkill(lockHolder.pid, false);
  await waitUntil(() => !isAlive(lockHolder.pid), 5000);
  const gc2 = await runCli(['close', '--all-stale', '--json'], env, S.cwd(9));
  await save('gc-run2.json', gc2.stdout + (gc2.stderr ? '\n--stderr--\n' + gc2.stderr : ''));
  let g2; try { g2 = JSON.parse(gc2.stdout); } catch {}
  await new Promise((r) => setTimeout(r, 1000));
  const afterTable = observeAll();
  const afterCounts = { orphanProcs: cnt(afterTable).map((p) => ({ pid: p.pid, cmd: p.cmd.slice(0, 200) })), dirs: await countDirs() };
  await save('observer-counts.json', { beforeCounts, afterCounts });
  rec('C7-counts-reach-zero (Done-when)', 'close --all-stale exit 0, lock dir deleted, observer orphan procs 0 and dirs 0, remaining {0,0}',
    { code: gc2.code, lockDeleted: !existsSync(lockDir), remaining: g2?.remaining, beforeCounts, afterCounts },
    gc2.code === 0 && !existsSync(lockDir) && afterCounts.orphanProcs.length === 0 && afterCounts.dirs.length === 0 && g2?.remaining?.orphanProcesses === 0 && g2?.remaining?.orphanDirs === 0);

  // ---------- C8: no harm ----------
  for (const i of [5, 6]) {
    const s = await runCli(['snap'], env, S.cwd(i));
    const now = await stateForCwd(stateRoot, S.cwd(i));
    rec(`C8-no-harm-cwd${i}`, 'snap exit 0, no self-heal, same chromePid/profileDir, chrome alive, dir exists',
      { code: s.code, selfHeal: s.stderr.includes('previous session was unreachable'), samePid: now?.state.chromePid === st[i].state.chromePid, alive: isAlive(st[i].state.chromePid), dir: existsSync(st[i].state.profileDir) },
      s.code === 0 && !s.stderr.includes('previous session was unreachable') && now?.state.chromePid === st[i].state.chromePid && isAlive(st[i].state.chromePid) && existsSync(st[i].state.profileDir));
  }
  // ---------- C9 ----------
  const cl5 = await runCli(['close'], env, S.cwd(5));
  rec('C9-close-after-gc', 'close cwd-5: exit 0, "Session closed.", dir gone, chrome gone', { code: cl5.code, out: cl5.stdout.trim(), dir: existsSync(st[5].state.profileDir) },
    cl5.code === 0 && cl5.stdout.trim() === 'Session closed.' && !existsSync(st[5].state.profileDir) && (await waitUntil(() => observeFor(st[5].state.profileDir).length === 0, 10000)));
} catch (e) {
  rec('FATAL', 'no exception', String(e?.stack ?? e), false);
} finally {
  await runCli(['close'], env, S.cwd(6)).catch(() => {});
  await runCli(['close'], env, S.cwd(5)).catch(() => {});
  for (const p of extraKill) taskkill(p, true);
  if (mcp && isAlive(mcp.pid)) taskkill(mcp.pid, true);
  const left = await killEverythingUnder(R);
  srv.close();
  await new Promise((r) => setTimeout(r, 1000));
  await rm(R, { recursive: true, force: true, maxRetries: 5 }).catch((e) => console.log('rm R failed', e.message));
  const summary = { R, total: cases.length, passed: cases.filter((c) => c.pass).length, failed: cases.filter((c) => !c.pass).map((c) => c.name), processesLeftUnderR: left, RExists: existsSync(R) };
  await save('summary.json', summary);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
