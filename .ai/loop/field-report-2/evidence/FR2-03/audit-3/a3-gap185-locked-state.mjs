// audit-3: GAP-185's fix only covers a state file whose CONTENT fails to parse. What if the READ ITSELF throws
// (Windows sharing violation -- e.g. AV/indexer/backup holding it open with FileShare.None -- or EACCES)?
// scanStateFiles does `catch { continue; }` on stat/readFile errors: the session is silently DROPPED, not marked
// 'unreadable', so unreadableStateFiles never learns about it and the marked Chrome falls through to the dead-owner check.
// Scenario = GAP-175's own: a live session using SUTRADHAR_CLI_STATE_DIR, GC run from elsewhere. DRY-RUN ONLY.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-lock-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr')); mkdirSync(path.join(R, 'custom'));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr'), SUTRADHAR_CLI_STATE_DIR: path.join(R, 'custom') };
const gcEnv = { ...env }; delete gcEnv.SUTRADHAR_CLI_STATE_DIR;
const run = (args, e) => execFileSync(process.execPath, [CLI, ...args], { env: e, cwd: R, encoding: 'utf8' });
run(['nav', 'data:text/html,<title>lock</title>'], env);
const sf = path.join(R, 'custom', 'state.json'); const st = JSON.parse(readFileSync(sf, 'utf8'));
const gcDry = () => JSON.parse(run(['doctor', '--gc', '--dry-run', '--json'], gcEnv));
const summarize = (j) => ({ killsLiveChrome: j.actions.some((a) => a.type === 'kill' && a.pid === st.chromePid), deletesLiveProfile: j.actions.some((a) => a.type === 'deleteDir' && a.path.toLowerCase() === st.profileDir.toLowerCase()),
  actions: j.actions, keptForSession: j.kept.filter((k) => k.pid === st.chromePid || (k.path || '').toLowerCase().includes(path.basename(R).toLowerCase())) });
const baseline = summarize(gcDry());
// hold state.json open with FileShare.None for 25s
const locker = spawn('powershell.exe', ['-NoProfile', '-Command', `$f=[System.IO.File]::Open('${sf}','Open','Read','None'); Write-Output LOCKED; Start-Sleep -Seconds 25; $f.Close()`], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => locker.stdout.on('data', (d) => { if (String(d).includes('LOCKED')) r(); }));
let readErr = null; try { readFileSync(sf, 'utf8'); } catch (e) { readErr = e.code; }
const whileLocked = summarize(gcDry());
const sessionsWhileLocked = JSON.parse(run(['sessions', '--json'], gcEnv));
locker.kill(); await new Promise((r) => setTimeout(r, 1500));
const after = summarize(gcDry());
const stillAlive = (() => { try { process.kill(st.chromePid, 0); return true; } catch { return false; } })();
const res = { R, chromePid: st.chromePid, profileDir: st.profileDir, readErrorWhileLocked: readErr, baseline, whileLocked, sessionsWhileLockedCount: sessionsWhileLocked.sessions?.length, sessionsWhileLocked: sessionsWhileLocked.sessions, after, liveChromeAliveAtEnd: stillAlive };
writeFileSync(path.join(here, 'gap185-locked-state.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ readErrorWhileLocked: readErr, baselineKills: baseline.killsLiveChrome, whileLockedKills: whileLocked.killsLiveChrome, whileLockedDeletesProfile: whileLocked.deletesLiveProfile, afterKills: after.killsLiveChrome, liveChromeAliveAtEnd: stillAlive }, null, 2));
try { run(['close'], env); } catch {}
