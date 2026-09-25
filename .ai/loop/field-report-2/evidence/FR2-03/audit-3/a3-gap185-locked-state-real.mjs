// audit-3: same as a3-gap185-locked-state.mjs but (1) an ordinary DEFAULT-state-root session (no SUTRADHAR_CLI_STATE_DIR,
// GC run from the same env) and (2) a REAL (non-dry) `doctor --gc` while state.json is held with FileShare.None.
// Checks whether a genuinely live, reachable session's Chrome is actually killed and its profile actually deleted.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-lockreal-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { env, cwd: R, encoding: 'utf8' });
run(['nav', 'data:text/html,<title>lockreal</title>']);
const sub = readdirSync(path.join(R, 'sr'))[0]; const sf = path.join(R, 'sr', sub, 'state.json'); const st = JSON.parse(readFileSync(sf, 'utf8'));
const reach = async () => { try { const u = new URL(st.wsEndpoint); const r = await fetch(`http://${u.host}/json/version`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } };
const before = { reachable: await reach(), sessions: JSON.parse(run(['sessions', '--json'])).sessions.map((s) => ({ status: s.status, chromePid: s.chromePid })) };
const locker = spawn('powershell.exe', ['-NoProfile', '-Command', `$f=[System.IO.File]::Open('${sf}','Open','Read','None'); Write-Output LOCKED; Start-Sleep -Seconds 20; $f.Close()`], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => locker.stdout.on('data', (d) => { if (String(d).includes('LOCKED')) r(); }));
const real = JSON.parse(run(['doctor', '--gc', '--json']));
locker.kill(); await new Promise((r) => setTimeout(r, 1500));
const res = { R, stateFile: sf, chromePid: st.chromePid, profileDir: st.profileDir, before,
  realGcActions: real.actions, realGcExit: real.exitCode,
  after: { chromePidAlive: (() => { try { process.kill(st.chromePid, 0); return true; } catch { return false; } })(), endpointReachable: await reach(), profileDirExists: existsSync(st.profileDir), stateFileExists: existsSync(sf) } };
writeFileSync(path.join(here, 'gap185-locked-state-real.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 2));
try { run(['close']); } catch {}
