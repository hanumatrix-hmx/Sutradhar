// Auditor adversarial harness (FR2-03 audit-1). Each case runs in its own scratch root.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, rm, utimes, symlink, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  here, mcpPath, makeRecorder, makeScratch, runCli, observeAll, observeFor, isAlive, taskkill,
  waitUntil, readStates, stateForCwd, startFixtureServer, interlock, killEverythingUnder,
} from './common.mjs';

const OUT = path.join(here, 'adv');
await mkdir(OUT, { recursive: true });
const { rec, cases } = makeRecorder(path.join(OUT, 'cases.jsonl'));
const save = (n, o) => writeFile(path.join(OUT, n), typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const { srv, base } = await startFixtureServer();
const hourAgo = () => new Date(Date.now() - 3600_000);
const parse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
const only = process.argv[2];

async function scoped(name, fn) {
  if (only && !name.startsWith(only)) return;
  const S = await makeScratch(`fr2-03-adv-${name}-`);
  console.log(`--- ${name} (${S.R})`);
  const extra = [];
  try { await fn(S, extra); } catch (e) { rec(`${name}-FATAL`, 'no exception', String(e?.stack ?? e), false); }
  finally {
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9]) if (existsSync(path.join(S.stateRoot))) await runCli(['close'], S.env, S.cwd(i), 20000).catch(() => {});
    for (const p of extra) taskkill(p, true);
    await killEverythingUnder(S.R);
    await new Promise((r) => setTimeout(r, 800));
    await rm(S.R, { recursive: true, force: true, maxRetries: 5 }).catch((e) => console.log('rm failed', e.message));
  }
}

// ADV-crashpad: which non-browser processes carry --user-data-dir for a CLI Chrome?
await scoped('crashpad', async (S) => {
  await runCli(['nav', `${base}?c=cp`], S.env, S.cwd(1));
  const st = await stateForCwd(S.stateRoot, S.cwd(1));
  const t = observeAll();
  const refs = t.filter((p) => p.cmd.toLowerCase().includes(`--user-data-dir=${st.state.profileDir}`.toLowerCase()) || p.cmd.toLowerCase().includes(st.state.profileDir.toLowerCase()));
  const summary = refs.map((p) => ({ pid: p.pid, type: (p.cmd.match(/--type=(\S+)/) ?? [])[1] ?? '(browser)', hasUddFlag: p.cmd.includes('--user-data-dir=') }));
  await save('crashpad-processes.json', summary);
  rec('ADV-crashpad-evidence', 'record which child processes carry --user-data-dir (explains orphan dir kept in-use)', summary, true);
});

// ADV1: SUTRADHAR_CLI_STATE_DIR (documented feature) session is live; does doctor --gc kill it?
await scoped('adv1-statedir', async (S) => {
  const custom = path.join(S.R, 'custom-state');
  const envCustom = { ...S.env, SUTRADHAR_CLI_STATE_DIR: custom };
  const nav = await runCli(['nav', `${base}?c=adv1`], envCustom, S.cwd(1));
  const state = JSON.parse(readFileSync(path.join(custom, 'state.json'), 'utf-8'));
  // (a) GC from another terminal without the env var (a user running doctor --gc elsewhere)
  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], S.env, S.cwd(2));
  const dj = parse(dry.stdout);
  await save('adv1-dryrun-no-env.json', dry.stdout);
  const plannedKill = dj?.actions?.some((a) => a.type === 'kill' && a.pid === state.chromePid);
  const plannedDel = dj?.actions?.some((a) => a.type === 'deleteDir' && a.path.toLowerCase() === state.profileDir.toLowerCase());
  rec('ADV1a-live-STATE_DIR-session-not-targeted (GC without env)', 'no kill/delete planned for a live session whose state lives in SUTRADHAR_CLI_STATE_DIR', { navCode: nav.code, plannedKill, plannedDel }, !plannedKill && !plannedDel);
  // (b) GC run WITH the env var set (same terminal as the session)
  const dry2 = await runCli(['doctor', '--gc', '--dry-run', '--json'], envCustom, S.cwd(1));
  const dj2 = parse(dry2.stdout);
  await save('adv1-dryrun-with-env.json', dry2.stdout);
  const k2 = dj2?.actions?.some((a) => a.type === 'kill' && a.pid === state.chromePid);
  rec('ADV1b-live-STATE_DIR-session-not-targeted (GC with env)', 'no kill planned even with SUTRADHAR_CLI_STATE_DIR set in the GC env', { plannedKill: k2 }, !k2);
  // (c) real run (with env): does the live session survive?
  if (interlock(dj2 ?? {}, S.R).length === 0) {
    const run = await runCli(['doctor', '--gc', '--json'], envCustom, S.cwd(1));
    await save('adv1-run-with-env.json', run.stdout);
    const snap = await runCli(['snap'], envCustom, S.cwd(1));
    rec('ADV1c-live-session-survives-real-gc', 'chrome alive, dir exists, next snap does not self-heal',
      { gcCode: run.code, alive: isAlive(state.chromePid), dir: existsSync(state.profileDir), selfHeal: snap.stderr.includes('previous session was unreachable'), snapCode: snap.code },
      isAlive(state.chromePid) && existsSync(state.profileDir) && !snap.stderr.includes('previous session was unreachable'));
  }
  await runCli(['close'], envCustom, S.cwd(1));
});

// ADV2: a stale state that references a LIVE session's profile dir (spec rules 3/4: never delete).
await scoped('adv2-stale-refs-live-dir', async (S) => {
  await runCli(['nav', `${base}?c=adv2`], S.env, S.cwd(1));
  const live = await stateForCwd(S.stateRoot, S.cwd(1));
  const deadNode = spawn(process.execPath, ['-e', '']); await new Promise((r) => deadNode.on('close', r));
  const d = path.join(S.stateRoot, 'cccccccccccccccc'); await mkdir(d);
  await writeFile(path.join(d, 'state.json'), JSON.stringify({ sessionId: 'dup', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/dup', chromePid: deadNode.pid, profileDir: live.state.profileDir, profileDirOwned: true, cwd: S.cwd(2), createdAt: new Date().toISOString() }));
  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], S.env, S.cwd(3));
  await save('adv2-dryrun.json', dry.stdout);
  const dj = parse(dry.stdout);
  const del = dj?.actions?.find((a) => a.type === 'deleteDir' && a.path.toLowerCase() === live.state.profileDir.toLowerCase());
  rec('ADV2a-live-dir-not-planned-for-delete', 'no deleteDir for a dir a live session (and running Chrome) references', { del }, !del);
  if (del && interlock(dj, S.R).length === 0) {
    const filesBefore = (await readdir(live.state.profileDir)).length;
    const run = await runCli(['doctor', '--gc', '--json'], S.env, S.cwd(3));
    await save('adv2-run.json', run.stdout);
    const rj = parse(run.stdout);
    const act = rj?.actions?.find((a) => a.type === 'deleteDir' && a.path.toLowerCase() === live.state.profileDir.toLowerCase());
    const filesAfter = existsSync(live.state.profileDir) ? (await readdir(live.state.profileDir)).length : 0;
    const localState = existsSync(path.join(live.state.profileDir, 'Local State'));
    const snap = await runCli(['snap'], S.env, S.cwd(1));
    rec('ADV2b-real-gc-harm-to-live-profile', 'live profile dir untouched', { gcCode: run.code, act, filesBefore, filesAfter, localStateExists: localState, liveChromeAlive: isAlive(live.state.chromePid), snapCode: snap.code, snapSelfHeal: snap.stderr.includes('unreachable') },
      filesAfter === filesBefore && localState);
  }
});

// ADV3: a user's own dir that happens to match the naming, containing a junction to precious data.
await scoped('adv3-user-dir-junction', async (S) => {
  const precious = path.join(S.R, 'precious'); await mkdir(precious); await writeFile(path.join(precious, 'keep.txt'), 'precious');
  const userDir = path.join(S.temp, 'sutradhar-cli-1234567890');
  await mkdir(userDir); await writeFile(path.join(userDir, 'notes.txt'), 'mine');
  await symlink(precious, path.join(userDir, 'link-to-precious'), 'junction');
  await utimes(userDir, hourAgo(), hourAgo());
  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], S.env, S.cwd(1));
  await save('adv3-dryrun.json', dry.stdout);
  const dj = parse(dry.stdout);
  const planned = dj?.actions?.find((a) => a.type === 'deleteDir' && a.path.toLowerCase() === userDir.toLowerCase());
  rec('ADV3a-name-convention-dir-planned', 'record: an unowned, unmarked, name-matching dir is deleted by convention (spec-accepted)', { planned: !!planned, reason: planned?.reason }, true);
  if (interlock(dj ?? {}, S.R).length === 0) {
    const run = await runCli(['doctor', '--gc', '--json'], S.env, S.cwd(1));
    await save('adv3-run.json', run.stdout);
    rec('ADV3b-junction-target-survives', 'precious/keep.txt survives deletion of a dir that contains a junction to it', { preciousExists: existsSync(path.join(precious, 'keep.txt')), userDirExists: existsSync(userDir), gcCode: run.code }, existsSync(path.join(precious, 'keep.txt')));
  }
});

// ADV4: degraded mode (process enumeration unavailable): unmarked Puppeteer dir + a young CLI dir.
await scoped('adv4-degraded', async (S) => {
  const foreign = path.join(S.temp, 'puppeteer_dev_chrome_profile-ForEiG');
  await mkdir(foreign); await writeFile(path.join(foreign, 'lockfile'), ''); await writeFile(path.join(foreign, 'Preferences'), '{}');
  await utimes(foreign, hourAgo(), hourAgo());
  const young = path.join(S.temp, `sutradhar-cli-${Date.now()}-MidSpn`);
  await mkdir(young);
  const envNoPs = { ...S.env, PATH: path.dirname(process.execPath), Path: path.dirname(process.execPath) };
  delete envNoPs.PSModulePath;
  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], envNoPs, S.cwd(1));
  await save('adv4-dryrun.json', dry.stdout + '\n--stderr--\n' + dry.stderr);
  const dj = parse(dry.stdout);
  rec('ADV4-pre-degraded', 'enumeration reported unavailable', dj?.processEnumeration, dj?.processEnumeration?.ok === false);
  const delForeign = dj?.actions?.some((a) => a.type === 'deleteDir' && a.path.toLowerCase() === foreign.toLowerCase());
  const delYoung = dj?.actions?.some((a) => a.type === 'deleteDir' && a.path.toLowerCase() === young.toLowerCase());
  rec('ADV4a-foreign-puppeteer-dir-not-planned', 'unmarked Puppeteer dir (no owner file) never deleted, even degraded (D2)', { delForeign }, !delForeign);
  rec('ADV4b-young-dir-grace-respected', 'a <120s-old CLI dir is not deleted in degraded mode (mid-spawn race)', { delYoung }, !delYoung);
  rec('ADV4c-dry-run-did-not-mutate', 'dry run left the foreign lockfile in place', { lockfileExists: existsSync(path.join(foreign, 'lockfile')) }, existsSync(path.join(foreign, 'lockfile')));
  rec('ADV4d-degraded-exit-code', 'dry-run exit 0 (spec) - recorded', { code: dry.code }, dry.code === 0);
});

// ADV5: two concurrent doctor --gc runs over the same leaks (1 orphan CLI Chrome + 6 old dirs).
await scoped('adv5-concurrent', async (S) => {
  await runCli(['nav', `${base}?c=adv5`], S.env, S.cwd(1));
  const st = await stateForCwd(S.stateRoot, S.cwd(1));
  await rm(st.dir, { recursive: true, force: true }); // orphan it
  const fakes = [];
  for (let k = 0; k < 6; k++) { const d = path.join(S.temp, `sutradhar-cli-17000000000${k}`); await mkdir(d); for (let f = 0; f < 50; f++) await writeFile(path.join(d, `f${f}`), 'x'.repeat(1000)); await utimes(d, hourAgo(), hourAgo()); fakes.push(d); }
  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], S.env, S.cwd(2));
  if (interlock(parse(dry.stdout) ?? {}, S.R).length) throw new Error('interlock');
  const [a, b] = await Promise.all([runCli(['doctor', '--gc', '--json'], S.env, S.cwd(2)), runCli(['close', '--all-stale', '--json'], S.env, S.cwd(3))]);
  await save('adv5-run-a.json', a.stdout + '\n--stderr--\n' + a.stderr);
  await save('adv5-run-b.json', b.stdout + '\n--stderr--\n' + b.stderr);
  const ja = parse(a.stdout), jb = parse(b.stdout);
  const lies = [...(ja?.actions ?? []), ...(jb?.actions ?? [])].filter((x) => x.type === 'deleteDir' && x.result === 'deleted' && existsSync(x.path));
  const failed = [...(ja?.actions ?? []), ...(jb?.actions ?? [])].filter((x) => x.result === 'failed');
  rec('ADV5a-no-crash-no-false-deleted', 'both produce JSON, no unhandled error, no "deleted" for an existing path', { codes: [a.code, b.code], jsonA: !!ja, jsonB: !!jb, stderr: [a.stderr.slice(0, 300), b.stderr.slice(0, 300)], lies }, !!ja && !!jb && lies.length === 0);
  rec('ADV5b-no-spurious-failure', 'neither run reports a failed action / exit 2 purely from racing the other', { codes: [a.code, b.code], failed }, failed.length === 0 && a.code === 0 && b.code === 0);
  rec('ADV5c-all-fakes-gone', 'all 6 fake dirs gone after both runs', fakes.map(existsSync), fakes.every((f) => !existsSync(f)));
  rec('ADV5d-orphan-dir-gone', 'orphan CLI dir gone after both runs (same-run reclaim)', { exists: existsSync(st.state.profileDir) }, !existsSync(st.state.profileDir));
});

// ADV6: self-heal (spec C2 / Done-when bullet 2) live.
await scoped('adv6-selfheal', async (S) => {
  await runCli(['nav', `${base}?c=adv6`], S.env, S.cwd(1));
  const A = await stateForCwd(S.stateRoot, S.cwd(1));
  taskkill(A.state.chromePid, true);
  await waitUntil(() => observeFor(A.state.profileDir).length === 0, 20000, 500);
  const snap = await runCli(['snap'], S.env, S.cwd(1));
  const B = await stateForCwd(S.stateRoot, S.cwd(1));
  rec('ADV6-self-heal-removes-old-dir', 'stderr has "previous session was unreachable", exit 0, old dir gone, new dir exists',
    { code: snap.code, note: snap.stderr.includes('previous session was unreachable'), oldExists: existsSync(A.state.profileDir), newDir: B?.state.profileDir, newExists: B && existsSync(B.state.profileDir) },
    snap.code === 0 && snap.stderr.includes('previous session was unreachable') && !existsSync(A.state.profileDir) && B && B.state.profileDir !== A.state.profileDir && existsSync(B.state.profileDir));
  const cl = await runCli(['close'], S.env, S.cwd(1));
  rec('ADV6b-close-after-heal', 'close removes new dir', { code: cl.code, exists: existsSync(B.state.profileDir) }, cl.code === 0 && !existsSync(B.state.profileDir));
});

// ADV7: MCP stdin EOF (Done-when bullet 5) + not spurious.
await scoped('adv7-mcp-stdin', async (S) => {
  const start = () => {
    const c = spawn(process.execPath, [mcpPath], { env: S.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    c.err = ''; c.stderr.on('data', (d) => (c.err += d));
    let buf = ''; const pending = new Map(); let id = 0;
    c.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const m = parse(l); if (m?.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
    c.send = (method, params) => new Promise((r) => { const i2 = ++id; pending.set(i2, r); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i2, method, params }) + '\n'); });
    c.exitP = new Promise((r) => c.on('exit', (code) => r(code)));
    return c;
  };
  const c = start();
  await c.send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'audit', version: '1' } });
  c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const before = (await readdir(S.temp)).filter((n) => n.startsWith('puppeteer_dev_chrome_profile-'));
  await c.send('tools/call', { name: 'browser.launch', arguments: { headless: true } });
  await c.send('tools/call', { name: 'browser.launch', arguments: { headless: true } });
  const dirs = (await readdir(S.temp)).filter((n) => n.startsWith('puppeteer_dev_chrome_profile-') && !before.includes(n)).map((n) => path.join(S.temp, n));
  const t = observeAll();
  const browsers = dirs.map((d) => t.find((p) => p.cmd.includes(d) && !p.cmd.includes('--type=') && /chrome\.exe/i.test(p.cmd))?.pid);
  // not spurious: idle 10s with stdin open
  const idle = await Promise.race([c.exitP.then(() => 'exited'), new Promise((r) => setTimeout(() => r('idle-ok'), 10000))]);
  const tl = await c.send('tools/list', {});
  rec('ADV7a-mcp-idle-no-shutdown', 'server stays up 10s with stdin open; tools/list answers', { idle, tools: tl?.result?.tools?.length }, idle === 'idle-ok' && (tl?.result?.tools?.length ?? 0) > 0);
  const t0 = Date.now();
  c.stdin.end();
  const code = await Promise.race([c.exitP, new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  await waitUntil(() => browsers.every((p) => !p || !isAlive(p)), 5000);
  rec('ADV7b-mcp-stdin-eof-shutdown', 'exit 0 within 15s, stderr "shutting down (stdin-", both browsers dead, both dirs gone',
    { code, ms: Date.now() - t0, stderrHas: /shutting down \(stdin-(end|close)\)/.test(c.err), browsers, alive: browsers.map((p) => p && isAlive(p)), dirsExist: dirs.map(existsSync), nDirs: dirs.length },
    code === 0 && /shutting down \(stdin-(end|close)\)/.test(c.err) && dirs.length === 2 && browsers.every((p) => p && !isAlive(p)) && dirs.every((d) => !existsSync(d)));
});

// ADV8 (N15): close with chromePid = an unrelated live node process, dead endpoint.
await scoped('adv8-n15', async (S) => {
  const victim = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e9)'], { stdio: 'ignore', windowsHide: true });
  const d = path.join(S.stateRoot, 'dddddddddddddddd'); await mkdir(d);
  const envX = { ...S.env, SUTRADHAR_CLI_STATE_DIR: d };
  await writeFile(path.join(d, 'state.json'), JSON.stringify({ sessionId: 'x', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/x', chromePid: victim.pid, profileDir: path.join(S.temp, 'sutradhar-cli-1600000000099-AbCdEf'), profileDirOwned: true, cwd: S.cwd(1), createdAt: new Date().toISOString() }));
  const cl = await runCli(['close'], envX, S.cwd(1));
  rec('ADV8-N15-close-does-not-kill-unverified-pid', 'victim alive, stderr "not killing PID", state cleared, exit 0',
    { code: cl.code, alive: isAlive(victim.pid), stderr: cl.stderr.trim(), stateExists: existsSync(path.join(d, 'state.json')) },
    isAlive(victim.pid) && cl.stderr.includes('not killing PID') && !existsSync(path.join(d, 'state.json')) && cl.code === 0);
  taskkill(victim.pid, false);
});

// ADV9 (N17): mid-spawn race: GC as soon as the new dir appears.
await scoped('adv9-n17', async (S) => {
  const navP = runCli(['nav', `${base}?c=adv9`], S.env, S.cwd(1));
  await waitUntil(async () => (await readdir(S.temp)).some((n) => n.startsWith('sutradhar-cli-')), 15000, 20);
  const gc = await runCli(['doctor', '--gc', '--json'], S.env, S.cwd(2));
  const nav = await navP;
  await save('adv9-gc.json', gc.stdout);
  const g = parse(gc.stdout);
  const st = await stateForCwd(S.stateRoot, S.cwd(1));
  rec('ADV9-N17-mid-spawn', 'nav succeeds, GC did not kill/delete the new session, dir exists',
    { navCode: nav.code, navErr: nav.stderr.slice(0, 300), gcActions: g?.actions, dirExists: st && existsSync(st.state.profileDir), alive: st && isAlive(st.state.chromePid) },
    nav.code === 0 && !(g?.actions ?? []).some((a) => a.type !== 'clearState') && st && existsSync(st.state.profileDir) && isAlive(st.state.chromePid));
});

// ADV10: what does a dry run change when live Chromes use the TEMP override? (diagnose main C5a)
await scoped('adv10-dryrun-diff', async (S) => {
  await runCli(['nav', `${base}?c=adv10`], S.env, S.cwd(1));
  await new Promise((r) => setTimeout(r, 2000));
  const ls = async () => (await readdir(S.temp)).sort();
  const a1 = await ls(); await new Promise((r) => setTimeout(r, 3000)); const a2 = await ls(); // no GC: baseline churn
  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], S.env, S.cwd(2));
  const a3 = await ls();
  rec('ADV10-dryrun-temp-diff', 'record churn in TEMP without GC vs across a dry run', { churnNoGc: { added: a2.filter((x) => !a1.includes(x)), removed: a1.filter((x) => !a2.includes(x)) }, acrossDry: { added: a3.filter((x) => !a2.includes(x)), removed: a2.filter((x) => !a3.includes(x)) }, code: dry.code }, a3.filter((x) => !a2.includes(x) && /^(sutradhar|puppeteer)/.test(x)).length === 0 && a2.filter((x) => !a3.includes(x)).length === 0);
});

srv.close();
const summary = { total: cases.length, passed: cases.filter((c) => c.pass).length, failed: cases.filter((c) => !c.pass).map((c) => c.name) };
await save(only ? `summary-${only}.json` : 'summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
