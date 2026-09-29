// audit-3 independent Done-when live proof + re-verification of GAP-175/176/177/178 (own harness, own observer).
// One scratch root R with a private TEMP (tempRoot) and SUTRADHAR_CLI_STATE_ROOT, so nothing outside R is ever in scope.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js'); const MCP = path.join(repo, 'packages/mcp-server/dist/cli.js');
const R = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-dw-'))); const T = path.join(R, 'temp'); const SR = path.join(R, 'sr');
for (const d of [T, SR, path.join(R, 'custom'), path.join(R, 'precious')]) mkdirSync(d, { recursive: true });
for (let i = 1; i <= 6; i++) mkdirSync(path.join(R, `cwd-${i}`));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: SR }; delete env.SUTRADHAR_CLI_STATE_DIR;
const cases = []; const rec = (name, pass, observed) => { cases.push({ name, pass, observed }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(observed).slice(0, 500)}`); };
const cli = (args, cwd, e = env) => { try { return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { env: e, cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }) }; } catch (err) { return { code: err.status, out: String(err.stdout ?? ''), err: String(err.stderr ?? '') }; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const tk = (pid, tree) => { try { execFileSync('taskkill', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore' }); } catch {} };
const observe = () => { const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*${path.basename(R)}*' } | % { [pscustomobject]@{ pid=$_.ProcessId; name=$_.Name; cmd=$_.CommandLine } }) | ConvertTo-Json -Compress`], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim(); if (!out) return []; const j = JSON.parse(out); return Array.isArray(j) ? j : [j]; };
const browsersUnderR = () => observe().filter((p) => /chrome/i.test(p.name) && !/--type=/.test(p.cmd));
const dirsIn = (d) => readdirSync(d).filter((n) => /^(sutradhar-cli-|puppeteer_dev_chrome_profile-)/.test(n));
const stateOf = (i) => { const h = readdirSync(SR).find((h) => { try { return JSON.parse(readFileSync(path.join(SR, h, 'state.json'), 'utf8')).cwd === path.join(R, `cwd-${i}`); } catch { return false; } }); const f = path.join(SR, h ?? 'none', 'state.json'); return { f, s: JSON.parse(readFileSync(f, 'utf8')) }; };
const cleanup = [];
try {
  // ---------- Leg A: runtime (MCP) sessions, node side crashes ----------
  const mcp = spawn(process.execPath, [MCP], { env, stdio: ['pipe', 'pipe', 'ignore'] }); cleanup.push(mcp.pid);
  let buf = '', id = 0; const pend = new Map();
  mcp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); pend.get(m.id)?.(m); } catch {} } });
  const rpc = (method, params) => new Promise((r) => { const n = ++id; pend.set(n, r); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a3', version: '1' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const la = await rpc('tools/call', { name: 'browser.launch', arguments: { headless: true } }); const lb = await rpc('tools/call', { name: 'browser.launch', arguments: { headless: true } });
  const pupDirs = dirsIn(T).filter((n) => n.startsWith('puppeteer'));
  const owners = pupDirs.map((n) => { try { return JSON.parse(readFileSync(path.join(T, n, '.sutradhar-owner.json'), 'utf8')).ownerPid; } catch { return null; } });
  rec('A1 two MCP runtime launches -> 2 puppeteer dirs, each with an owner file naming the MCP pid', pupDirs.length === 2 && owners.every((o) => o === mcp.pid), { pupDirs, owners, mcp: mcp.pid, la: !la.result?.isError, lb: !lb.result?.isError });
  tk(mcp.pid, false); await new Promise((r) => setTimeout(r, 1500));
  const runtimeBrowsers = browsersUnderR().filter((p) => /--sutradhar-launch=runtime/.test(p.cmd));
  rec('A2 (informational, recorded honestly) runtime Chromes surviving kill -9 of the MCP node process: ' + runtimeBrowsers.length + ' (Windows job object usually takes them down; audit-2 recorded the same)', true, runtimeBrowsers.map((p) => p.pid));

  // ---------- Leg B: CLI sessions ----------
  for (let i = 1; i <= 5; i++) { const r = cli(['nav', `data:text/html,<title>s${i}</title>`], path.join(R, `cwd-${i}`)); if (r.code !== 0) throw new Error(`nav ${i} failed: ${r.err}`); }
  const custEnv = { ...env, SUTRADHAR_CLI_STATE_DIR: path.join(R, 'custom') };
  cli(['nav', 'data:text/html,<title>custom</title>'], path.join(R, 'cwd-6'), custEnv);
  const cust = JSON.parse(readFileSync(path.join(R, 'custom', 'state.json'), 'utf8'));
  const S = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [i, stateOf(i)]));
  // 1: stale (Chrome killed, state present). 2: orphan (state dir deleted, Chrome alive). 3: LIVE. 4: LIVE, but a hand-made
  // stale state file points at ITS dir (GAP-177). 5: LIVE control. custom: LIVE via SUTRADHAR_CLI_STATE_DIR (GAP-175).
  tk(S[1].s.chromePid, true); await new Promise((r) => setTimeout(r, 1500));
  rmSync(path.dirname(S[2].f), { recursive: true, force: true });
  const g177 = path.join(SR, 'gap177stale'); mkdirSync(g177); writeFileSync(path.join(g177, 'state.json'), JSON.stringify({ sessionId: 'g177', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/g177', chromePid: 999989, profileDir: S[4].s.profileDir, profileDirOwned: true }));
  // fixtures: 10 old legacy dirs, 1 young, junction (backdated), corrupt state, named-profile stale
  const old = new Date(Date.now() - 3600_000);
  for (let k = 10; k < 20; k++) { const d = path.join(T, `sutradhar-cli-16000000000${k}`); mkdirSync(d); writeFileSync(path.join(d, 'Local State'), '{}'); utimesSync(d, old, old); }
  const young = path.join(T, `sutradhar-cli-${Date.now()}-YOUNG1`); mkdirSync(young);
  writeFileSync(path.join(R, 'precious', 'keep.txt'), 'precious'); const junc = path.join(T, 'sutradhar-cli-1600000000002'); symlinkSync(path.join(R, 'precious'), junc, 'junction');
  mkdirSync(path.join(SR, 'deadbeefdeadbeef')); writeFileSync(path.join(SR, 'deadbeefdeadbeef', 'state.json'), '{not json');
  const named = path.join(R, 'named', 'fr2p'); mkdirSync(named, { recursive: true }); writeFileSync(path.join(named, 'Local State'), '{}');
  mkdirSync(path.join(SR, 'namedstale')); writeFileSync(path.join(SR, 'namedstale', 'state.json'), JSON.stringify({ sessionId: 'n', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/n', chromePid: 999988, profileDir: named, profileDirOwned: false }));
  // an unmarked, un-owned puppeteer dir of "another tool" (backdated) -- never Sutradhar's to delete (D2 / GAP-178a)
  const foreignPup = path.join(T, 'puppeteer_dev_chrome_profile-FoRn01'); mkdirSync(foreignPup); writeFileSync(path.join(foreignPup, 'lockfile'), ''); utimesSync(foreignPup, old, old);

  // ---------- GAP-178: degraded mode (PowerShell unreachable) -- dry-run AND real run ----------
  const degEnv = { ...env, PATH: path.dirname(process.execPath), Path: path.dirname(process.execPath), SystemRoot: 'C:\\nonexistent-a3' };
  const lockBefore = existsSync(path.join(foreignPup, 'lockfile'));
  const dDryRaw = cli(['doctor', '--gc', '--dry-run', '--json'], R, degEnv);
  const dDry = JSON.parse(dDryRaw.out || '{}');
  const dReal = { actions: [] }; writeFileSync(path.join(here, 'donewhen-degraded-dry.json'), JSON.stringify({ dDry }, null, 2));
  rec('G178-0 degraded mode really engaged (processEnumeration.ok === false)', dDry.processEnumeration?.ok === false, { dry: dDry.processEnumeration, err: dDryRaw.err });
  rec('G178a degraded mode never deletes the unmarked foreign puppeteer dir (dry+real)', !(dDry.actions ?? []).some((a) => a.path === foreignPup) && existsSync(foreignPup), { dry: (dDry.actions ?? []).filter((a) => a.type === 'deleteDir').map((a) => a.path) });
  rec('G178b degraded mode keeps the young dir under grace (dry+real)', existsSync(young) && (dDry.kept ?? []).some((k) => k.path === young && k.reason === 'grace'), (dDry.kept ?? []).filter((k) => k.path === young));
  rec('G178c degraded probe never removes a lockfile (foreign dir lockfile intact after dry+real)', lockBefore && existsSync(path.join(foreignPup, 'lockfile')), {});
  rec('G178d degraded mode kills nothing', !(dDry.actions ?? []).some((a) => a.type === 'kill') && !(dReal.actions ?? []).some((a) => a.type === 'kill'), {});
  rec('G178e degraded dry-run plans no delete of a LIVE session dir', ![S[3], S[4], S[5], { s: cust }].some((x) => (dDry.actions ?? []).some((a) => a.type === 'deleteDir' && a.path === x.s.profileDir)), {});

  // ---------- The real GC run ----------
  const dry = JSON.parse(cli(['doctor', '--gc', '--dry-run', '--json'], R).out);
  const real = JSON.parse(cli(['doctor', '--gc', '--json'], R).out);
  writeFileSync(path.join(here, 'donewhen-gc-dry.json'), JSON.stringify(dry, null, 2)); writeFileSync(path.join(here, 'donewhen-gc-real.json'), JSON.stringify(real, null, 2));
  const killed = real.actions.filter((a) => a.type === 'kill' && a.result === 'killed').map((a) => a.pid);
  const liveOk = (i) => { const r = cli(['eval', 'document.title'], path.join(R, `cwd-${i}`)); return r.code === 0 && r.out.includes(`s${i}`) && JSON.parse(readFileSync(S[i].f, 'utf8')).chromePid === S[i].s.chromePid; };
  const sig = (j) => JSON.stringify(j.actions.filter((a) => a.role !== 'child').map((a) => [a.type, a.pid ?? a.path ?? a.stateFile]).sort());
  rec('DW1 real GC exit 0 and the dry-run planned the same browser kills/clears/deletes (child pids excluded: Chrome spawns children dynamically)', real.exitCode === 0 && sig(dry) === sig(real), { exit: real.exitCode });
  rec('DW2 runtime (MCP) leg: every surviving runtime Chrome killed, both orphaned puppeteer dirs deleted (owner-dead / orphan-browser)', runtimeBrowsers.every((p) => !alive(p.pid)) && pupDirs.every((n) => !existsSync(path.join(T, n))) && pupDirs.every((n) => real.actions.some((a) => a.type === 'deleteDir' && path.basename(a.path) === n && a.result === 'deleted')), { runtimeBrowsers: runtimeBrowsers.map((p) => [p.pid, alive(p.pid)]), pup: real.actions.filter((a) => /puppeteer/.test(a.path ?? '')) });
  rec('DW3 stale session 1: state cleared, dir deleted', !existsSync(S[1].f) && !existsSync(S[1].s.profileDir), {});
  rec('G176 orphan session 2 (state wiped): Chrome killed AND its dir reclaimed in the SAME run', !alive(S[2].s.chromePid) && !existsSync(S[2].s.profileDir), { alive: alive(S[2].s.chromePid), dir: existsSync(S[2].s.profileDir) });
  rec('DW4 live sessions 3,4,5 untouched and still usable (eval returns their own title, same chromePid)', liveOk(3) && liveOk(4) && liveOk(5) && ![3, 4, 5].some((i) => killed.includes(S[i].s.chromePid)), {});
  rec('G177 hand-made stale state pointing at LIVE session 4 dir: state cleared, dir NOT deleted', !existsSync(path.join(g177, 'state.json')) && existsSync(S[4].s.profileDir), { dirExists: existsSync(S[4].s.profileDir) });
  const custEval = cli(['eval', 'document.title'], path.join(R, 'cwd-6'), custEnv);
  rec('G175 live SUTRADHAR_CLI_STATE_DIR session (GC run WITHOUT that env) survives: not killed, dir kept, still usable', alive(cust.chromePid) && existsSync(cust.profileDir) && custEval.code === 0 && custEval.out.includes('custom') && !killed.includes(cust.chromePid), { custEval });
  rec('DW5 10 old legacy dirs deleted', [...Array(10).keys()].every((k) => !existsSync(path.join(T, `sutradhar-cli-16000000000${k + 10}`))), {});
  rec('DW6 young dir kept (grace)', existsSync(young), {});
  rec('DW7 junction kept as symlink, precious target intact', existsSync(junc) && existsSync(path.join(R, 'precious', 'keep.txt')) && real.kept.some((k) => k.path === junc && k.reason === 'symlink'), {});
  rec('DW8 corrupt state file kept (unreadable-state), not deleted', existsSync(path.join(SR, 'deadbeefdeadbeef', 'state.json')), {});
  rec('DW9 named-profile stale: state cleared, named profile dir kept', !existsSync(path.join(SR, 'namedstale', 'state.json')) && existsSync(named), {});
  rec('DW10 foreign unmarked puppeteer dir kept (enumeration ok path)', existsSync(foreignPup), {});
  const liveBrowserPids = new Set([S[3].s.chromePid, S[4].s.chromePid, S[5].s.chromePid, cust.chromePid]);
  const liveDirs = new Set([S[3], S[4], S[5]].map((x) => path.basename(x.s.profileDir)).concat(path.basename(cust.profileDir)));
  const orphanBrowsers = browsersUnderR().filter((p) => !liveBrowserPids.has(p.pid));
  const leftoverDirs = dirsIn(T).filter((n) => !liveDirs.has(n) && ![young, junc, foreignPup].includes(path.join(T, n)));
  rec('DW11 orphan-process count and orphan-dir count both reach 0 (independent observer)', orphanBrowsers.length === 0 && leftoverDirs.length === 0 && real.remaining.orphanProcesses === 0 && real.remaining.orphanDirs === 0, { orphanBrowsers: orphanBrowsers.map((p) => p.pid), leftoverDirs, remaining: real.remaining });
  const again = JSON.parse(cli(['doctor', '--gc', '--json'], R).out);
  rec('DW12 a second GC run is a no-op (idempotent)', again.actions.length === 0 && again.exitCode === 0, again.actions);
  const dRealRaw = cli(['doctor', '--gc', '--json'], R, degEnv); const dReal2 = JSON.parse(dRealRaw.out || '{}'); writeFileSync(path.join(here, 'donewhen-degraded-real.json'), JSON.stringify(dReal2, null, 2));
  rec('G178f degraded REAL run (after main GC): kills nothing, live dirs + young + foreign pup + lockfile intact, live sessions still usable', dReal2.processEnumeration?.ok === false && !(dReal2.actions ?? []).some((a) => a.type === 'kill') && [S[3], S[4], S[5]].every((x) => existsSync(x.s.profileDir)) && existsSync(cust.profileDir) && existsSync(young) && existsSync(path.join(foreignPup, 'lockfile')) && liveOk(3) && liveOk(5), dReal2.actions);
  const alias = JSON.parse(cli(['close', '--all-stale', '--dry-run', '--json'], R).out || '{}');
  rec('DW13 close --all-stale alias works identically (dry-run, nothing to do)', Array.isArray(alias.actions) && alias.actions.length === 0 && alias.exitCode === 0, alias);
} catch (e) { rec('HARNESS-ERROR', false, String(e.stack)); }
finally {
  for (const i of [3, 4, 5]) cli(['close'], path.join(R, `cwd-${i}`));
  cli(['close'], path.join(R, 'cwd-6'), { ...env, SUTRADHAR_CLI_STATE_DIR: path.join(R, 'custom') });
  for (const p of cleanup) tk(p, true);
  await new Promise((r) => setTimeout(r, 1500));
  for (const p of browsersUnderR()) tk(p.pid, true);
  await new Promise((r) => setTimeout(r, 1000));
  const left = observe().filter((p) => !/powershell/i.test(p.name));
  const summary = { R, total: cases.length, passed: cases.filter((c) => c.pass).length, failed: cases.filter((c) => !c.pass).map((c) => c.name), leftoverProcsUnderR: left.length, cases };
  writeFileSync(path.join(here, 'donewhen-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, cases: undefined }));
  try { rmSync(R, { recursive: true, force: true }); } catch {}
}
