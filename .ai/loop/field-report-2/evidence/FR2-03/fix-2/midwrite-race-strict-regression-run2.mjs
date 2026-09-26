// audit-2: realistic mid-write race. A live custom-state-dir session; 3 loops of real CLI commands
// that rewrite state.json (`eval ... --viewport WxH` -> writeState, non-atomic writeFile); meanwhile
// GC --dry-run in a loop. Counts dry-runs that planned to KILL the live Chrome. Dry-run only: nothing killed.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a2-midw-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr')); mkdirSync(path.join(R, 'custom'));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr'), SUTRADHAR_CLI_STATE_DIR: path.join(R, 'custom') };
const gcEnv = { ...env }; delete gcEnv.SUTRADHAR_CLI_STATE_DIR; // GC run from elsewhere, as in GAP-175
const run = (args, e) => new Promise(r => { const c = spawn(process.execPath, [CLI, ...args], { env: e, cwd: R }); let o = ''; c.stdout.on('data', d => o += d); c.on('close', code => r({ code, o })); });
await run(['nav', 'data:text/html,<title>midw</title>'], env);
const st = JSON.parse(readFileSync(path.join(R, 'custom', 'state.json'), 'utf8'));
const DUR = Number(process.argv[2] ?? 240000); const end = Date.now() + DUR;
let writes = 0, gcs = 0, killPlans = 0; const hits = [];
const writer = async (i) => { while (Date.now() < end) { await run(['eval', '1', '--viewport', `${800 + i}x600`], env); writes++; } };
const gcer = async () => { while (Date.now() < end) { const pre = (()=>{try{return JSON.parse(readFileSync(path.join(R,'custom','state.json'),'utf8')).chromePid}catch{return 'unreadable'}})(); const r = await run(['doctor', '--gc', '--dry-run', '--json'], gcEnv); gcs++; const post = (()=>{try{return JSON.parse(readFileSync(path.join(R,'custom','state.json'),'utf8')).chromePid}catch{return 'unreadable'}})(); try { const j = JSON.parse(r.o); if (pre === post && j.actions.some(a => a.type === 'kill' && a.pid === pre)) { killPlans++; hits.push({ at: new Date().toISOString(), livePid: pre, kept: j.kept.filter(k => (k.path||'').includes('custom')) }); } } catch {} } };
await Promise.all([writer(0), writer(1), writer(2), gcer(), gcer()]);
const res = { R, chromePid: st.chromePid, durationMs: DUR, stateWrites: writes, gcDryRuns: gcs, dryRunsThatPlannedKillingTheCURRENTLiveChrome_statePidStableAcrossGc: killPlans, hits: hits.slice(0, 5) };
writeFileSync(path.join(here, 'midwrite-race-strict-regression-run2.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res));
try { execFileSync('powershell.exe', ['-NoProfile','-Command', "Get-CimInstance Win32_Process | ? { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*" + path.basename(R) + "*' -and $_.CommandLine -notlike '*--type=*' } | % { taskkill /PID $_.ProcessId /T /F }"], { stdio: 'ignore' }); } catch {}
