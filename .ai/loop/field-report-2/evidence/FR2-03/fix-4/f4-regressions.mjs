// audit-4 OWN independent re-verification of GAP-175/176/177/178 (different fixtures/variants than audit-3's harness
// and fix-3's scripts):
//  R175: SUTRADHAR_CLI_STATE_DIR session; a REAL (not dry) GC from an unrelated cwd with no env var -> survives + usable
//  R176: orphan made by deleting ONLY state.json (dir left behind) -> REAL GC kills Chrome AND reclaims its dir same run
//  R177: a trusted stale state whose profileDir is the live session's dir spelled in UPPER CASE with forward slashes
//        (path-form variant) -> live dir kept, live session still usable
//  R178: degraded mode dry-run is a pure no-op (full tree snapshot of T and SR incl. mtimes before/after), an
//        owned-by-dead-owner puppeteer dir's lockfile survives the probe, unmarked old puppeteer kept, young dir kept
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, utimesSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a4-reg-'))); const T = path.join(R, 'temp'); const SR = path.join(R, 'sr');
for (const d of [T, SR, path.join(R, 'custom'), path.join(R, 'elsewhere')]) mkdirSync(d, { recursive: true });
for (let i = 1; i <= 3; i++) mkdirSync(path.join(R, `c${i}`));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: SR }; delete env.SUTRADHAR_CLI_STATE_DIR;
const cli = (args, cwd, e = env) => { try { return { code: 0, out: execFileSync(process.execPath, [CLI, ...args], { env: e, cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }) }; } catch (err) { return { code: err.status, out: String(err.stdout ?? ''), err: String(err.stderr ?? '') }; } };
const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
const cases = []; const rec = (name, pass, obs) => { cases.push({ name, pass, obs }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(obs).slice(0, 600)}`); };
const stateIn = (dir) => { for (const h of readdirSync(SR)) { const f = path.join(SR, h, 'state.json'); try { const s = JSON.parse(readFileSync(f, 'utf8')); if (s.cwd === dir) return { f, s }; } catch {} } return null; };
// run-2 note: run 1 snapshotted ALL of T, but live Chromes run with TEMP=T and continuously write their own temp files
// (scoped_dir*, chrome_*, *.tmp) and profile dirs there -- that churn is not GC. Run 2 snapshots only what GC can act on:
// top-level GC-candidate dir NAMES in T, the full contents+mtimes of the three R178 fixture dirs, and every file under SR.
const snapAll = (root) => { const out = {}; const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); let st; try { st = statSync(p); } catch { continue; } out[path.relative(root, p)] = st.isDirectory() ? `d:${st.mtimeMs}` : `f:${st.size}:${st.mtimeMs}`; if (st.isDirectory() && !/sutradhar-cli-\d{13}-/.test(n)) walk(p); } }; walk(root); return out; };
const snap = (root) => { if (root === SR) return snapAll(SR); const o = {}; for (const n of readdirSync(root)) if (/^(sutradhar-cli-|puppeteer_dev_chrome_profile-)/.test(n)) o[n] = 1; for (const n of ["puppeteer_dev_chrome_profile-OwNd01", "puppeteer_dev_chrome_profile-UnMk01"]) { try { Object.assign(o, Object.fromEntries(Object.entries(snapAll(path.join(root, n))).map(([k, v]) => [n + "/" + k, v]))); o[n + "/."] = statSync(path.join(root, n)).mtimeMs; } catch {} } return o; };
const custEnv = { ...env, SUTRADHAR_CLI_STATE_DIR: path.join(R, 'custom') };
try {
  if (cli(['nav', 'data:text/html,<title>r175</title>'], path.join(R, 'c1'), custEnv).code !== 0) throw new Error('nav custom failed');
  if (cli(['nav', 'data:text/html,<title>r176</title>'], path.join(R, 'c2')).code !== 0) throw new Error('nav c2 failed');
  if (cli(['nav', 'data:text/html,<title>r177</title>'], path.join(R, 'c3')).code !== 0) throw new Error('nav c3 failed');
  const cust = JSON.parse(readFileSync(path.join(R, 'custom', 'state.json'), 'utf8'));
  const o = stateIn(path.join(R, 'c2')); const l = stateIn(path.join(R, 'c3'));
  rmSync(o.f); // R176: only the state file is gone; the <hash> dir stays
  mkdirSync(path.join(SR, 'r177stale')); const r177f = path.join(SR, 'r177stale', 'state.json');
  writeFileSync(r177f, JSON.stringify({ sessionId: 'r177', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/r177', chromePid: 999979, profileDir: l.s.profileDir.toUpperCase().replace(/\\/g, '/'), profileDirOwned: true }));
  // R178 fixtures
  const old = new Date(Date.now() - 3600_000);
  const ownedPup = path.join(T, 'puppeteer_dev_chrome_profile-OwNd01'); mkdirSync(ownedPup); writeFileSync(path.join(ownedPup, 'lockfile'), '');
  writeFileSync(path.join(ownedPup, '.sutradhar-owner.json'), JSON.stringify({ v: 1, tool: 'sutradhar', kind: 'runtime', ownerPid: 999977, ownerStartMs: 1, createdAt: old.toISOString() })); utimesSync(ownedPup, old, old);
  const unmarkedPup = path.join(T, 'puppeteer_dev_chrome_profile-UnMk01'); mkdirSync(unmarkedPup); utimesSync(unmarkedPup, old, old);
  const young = path.join(T, `sutradhar-cli-${Date.now()}-yOuNg4`); mkdirSync(young);
  const degEnv = { ...env, PATH: path.dirname(process.execPath), Path: path.dirname(process.execPath), SystemRoot: 'C:\\nonexistent-a4' };
  const b = { T: snap(T), SR: snap(SR) };
  const dDry = JSON.parse(cli(['doctor', '--gc', '--dry-run', '--json'], path.join(R, 'elsewhere'), degEnv).out || '{}');
  const a = { T: snap(T), SR: snap(SR) };
  writeFileSync(path.join(here, 'f4-regressions-degraded-dry.json'), JSON.stringify(dDry, null, 2));
  rec('R178-0 degraded engaged', dDry.processEnumeration?.ok === false, dDry.processEnumeration);
  rec('R178a degraded dry-run is a byte-level no-op on T and SR (names+sizes+mtimes)', JSON.stringify(b) === JSON.stringify(a), { b, a });
  rec('R178b owned puppeteer dir lockfile survives the degraded lock probe', existsSync(path.join(ownedPup, 'lockfile')), {});
  rec('R178c unmarked puppeteer dir not planned for deletion in degraded mode', !(dDry.actions ?? []).some((x) => x.path === unmarkedPup) && (dDry.kept ?? []).some((k) => k.path === unmarkedPup && k.reason === 'not-sutradhar'), (dDry.kept ?? []).filter((k) => k.path === unmarkedPup));
  rec('R178d young dir kept grace in degraded mode', (dDry.kept ?? []).some((k) => k.path === young && k.reason === 'grace'), {});
  rec('R178e degraded plans no kill and no delete of any live session dir', !(dDry.actions ?? []).some((x) => x.type === 'kill') && ![cust.profileDir, l.s.profileDir].some((p) => (dDry.actions ?? []).some((x) => x.type === 'deleteDir' && x.path.toLowerCase() === p.toLowerCase())), dDry.actions);
  // real GC from an unrelated cwd, NO SUTRADHAR_CLI_STATE_DIR
  const real = JSON.parse(cli(['doctor', '--gc', '--json'], path.join(R, 'elsewhere')).out);
  writeFileSync(path.join(here, 'f4-regressions-real-gc.json'), JSON.stringify(real, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  const killed = real.actions.filter((x) => x.type === 'kill').map((x) => x.pid);
  const ev1 = cli(['eval', 'document.title'], path.join(R, 'c1'), custEnv);
  rec('R175 custom-state-dir session survives a REAL GC run without the env var (alive, dir kept, eval works, not in kill list)', alive(cust.chromePid) && existsSync(cust.profileDir) && ev1.code === 0 && ev1.out.includes('r175') && !killed.includes(cust.chromePid), { ev1, killed });
  rec('R176 orphan (state.json deleted, dir kept) Chrome killed AND its profile dir reclaimed in the same run', !alive(o.s.chromePid) && !existsSync(o.s.profileDir) && real.actions.some((x) => x.type === 'deleteDir' && x.reason === 'orphan-browser' && x.result === 'deleted'), { alive: alive(o.s.chromePid), dir: existsSync(o.s.profileDir), acts: real.actions.filter((x) => x.type !== 'kill' || x.role === 'browser') });
  const ev3 = cli(['eval', 'document.title'], path.join(R, 'c3'));
  rec('R177 stale state naming the LIVE dir in a different path form: live dir kept, live session usable, stale state cleared', existsSync(l.s.profileDir) && ev3.code === 0 && ev3.out.includes('r177') && !killed.includes(l.s.chromePid) && !existsSync(r177f), { ev3, dirExists: existsSync(l.s.profileDir), staleExists: existsSync(r177f), kept: real.kept.filter((k) => (k.path ?? '').toLowerCase().includes(path.basename(l.s.profileDir).toLowerCase())) });
  rec('R178f (enumeration ok) owned dead-owner puppeteer dir reclaimed, unmarked one kept', !existsSync(ownedPup) && existsSync(unmarkedPup), {});
  rec('exit code 0 real run', real.exitCode === 0, real.exitCode);
} catch (e) { rec('HARNESS-ERROR', false, String(e.stack)); }
finally {
  cli(['close'], path.join(R, 'c1'), custEnv); cli(['close'], path.join(R, 'c3'));
  const summary = { R, total: cases.length, passed: cases.filter((c) => c.pass).length, failed: cases.filter((c) => !c.pass).map((c) => c.name), cases };
  writeFileSync(path.join(here, 'f4-regressions-summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify({ ...summary, cases: undefined }));
}
