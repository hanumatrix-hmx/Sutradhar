// audit-5: GAP-183 closed PID reuse in the PPID-ancestry WALK. Does the EXECUTOR re-verify identity
// before it kills? executeGc() kills by raw PID (taskkill /PID <pid> /T /F, or process.kill for
// children) from a plan computed off a snapshot taken earlier -- no start-time / command-line
// re-check at kill time. If the planned orphan exits during the snapshot->kill window and its PID
// is reused, GC tree-kills whatever now owns that PID.
// Method: a stand-in orphan F (plain node carrying a CLI marker with a dead owner -- exactly what
// planGc treats as an orphan CLI Chrome) is planned for kill by the REAL collectGcSnapshot+planGc.
// F then exits (as a real orphan might, e.g. a crash) and we spawn our own harmless `ping` processes
// until one reuses F's PID, then run the REAL executeGc on the plan's own kill action for F.
// Also measures the real snapshot->plan window on this machine.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a5-pidreuse-'))); const T = path.join(R, 'temp'); const SR = path.join(R, 'sr');
mkdirSync(T); mkdirSync(SR);
process.env.TEMP = T; process.env.TMP = T; process.env.SUTRADHAR_CLI_STATE_ROOT = SR; delete process.env.SUTRADHAR_CLI_STATE_DIR;
const gc = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/gc.js')).href);
const pl = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/process-list.js')).href);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const res = { R };
const spawned = [];
try {
  // window measurement
  let t = Date.now(); await pl.listProcesses(); res.listProcessesMs = Date.now() - t;
  const POOL = Number(process.argv[2] ?? 40); const Fs = []; globalThis.__Fs = Fs;
  for (let i = 0; i < POOL; i++) { const udd = path.join(T, `sutradhar-cli-${Date.now()}${i}-A5pid${String(i).padStart(2,'0').slice(-1)}`); const Fi = spawn(process.execPath, [path.join(here, 'a5-idle.cjs'), `--user-data-dir=${udd}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=999991', '--sutradhar-owner-start=1'], { detached: true, stdio: 'ignore', windowsHide: true }); Fi.unref(); Fs.push(Fi); }
  res.orphanPids = Fs.map((f) => f.pid);
  await sleep(1500);
  t = Date.now(); const snap = await gc.collectGcSnapshot(); res.collectGcSnapshotMs = Date.now() - t;
  t = Date.now(); const plan = gc.planGc(snap); res.planGcMs = Date.now() - t;
  const pidSet = new Set(Fs.map((f) => f.pid)); const kills = new Map(plan.actions.filter((a) => a.type === 'kill' && pidSet.has(a.pid)).map((a) => [a.pid, a]));
  res.plannedKillsForOrphans = kills.size;
  if (!kills.size) throw new Error('orphans not planned for kill; nothing to test');
  // the planned orphan exits on its own
  for (const f of Fs) f.kill(); await sleep(800); res.orphansExited = Fs.filter((f) => !alive(f.pid)).length;
  // hunt for PID reuse with our own harmless processes
  let victim; let tries = 0; const t0 = Date.now();
  while (tries < 20000 && Date.now() - t0 < 300_000) {
    tries++;
    const p = spawn('ping', ['-n', '600', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
    if (kills.has(p.pid)) { victim = p; break; }
    try { p.kill(); } catch {}
    if (tries % 50 === 0) await sleep(5);
  }
  res.spawnsUntilReuse = victim ? tries : null; res.huntMs = Date.now() - t0;
  if (victim) {
    spawned.push(victim);
    res.victimCommand = 'ping -n 600 127.0.0.1 (spawned by this script, unrelated to any Chrome)';
    res.victimAliveBeforeExecute = alive(victim.pid);
    const killF = kills.get(victim.pid); res.reusedPlannedKill = killF;
    const report = await gc.executeGc({ actions: [killF], kept: [], incomplete: false }, snap, false);
    res.executeResult = report.actions;
    await sleep(500);
    res.victimAliveAfterExecute = alive(victim.pid);
    res.verdict = res.victimAliveBeforeExecute && !res.victimAliveAfterExecute
      ? 'UNRELATED PROCESS KILLED: executeGc killed a PID-reused process with no identity re-check'
      : 'victim survived';
  }
} catch (e) {
  res.error = String(e);
} finally {
  for (const cp of [...spawned, ...(globalThis.__Fs ?? [])]) { try { cp.kill(); } catch {} } // kill via our own process handle only (never by raw PID -- that is the bug under test)
  await sleep(500);
  try { rmSync(R, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { res.cleanupError = String(e); }
  res.cleanup = { rootExists: existsSync(R), anyAlive: spawned.filter((cp) => cp.exitCode === null && cp.signalCode === null).map((cp) => cp.pid) };
  writeFileSync(path.join(here, 'a5-exec-pid-reuse.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
}
