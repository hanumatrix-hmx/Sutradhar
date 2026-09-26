// audit-4: GAP-188 "unified" claim, novel attack via a sibling downstream path. fix-3 unified every read/parse failure
// into one `unreadable` scan outcome -- but that outcome only PROTECTS a browser in pass 2 via `unreadableStateFiles`
// matched against the browser's own `--sutradhar-state` marker. A pre-0.5.0 (legacy, UNMARKED) CLI Chrome -- which the
// spec explicitly supports (G12, `legacy-orphan`) and which is protected only via its readable state's `chromePid`
// landing in `referencedPids` -- gets no such link. Scenario: user upgraded to 0.5.0 while a pre-0.5.0 session's Chrome
// is still running; the state.json is transiently unreadable (held open / mid-write) at the moment GC scans it.
//   step 1 (control): state readable -> dry-run must keep it (live-session), no kill.
//   step 2: state content garbage (parse failure) -> dry-run plan recorded (then restored).
//   step 3: state held open FileShare.None (read failure, audit-3's exact GAP-188 trigger) -> REAL doctor --gc.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a4-legacy-')); const T = path.join(R, 'temp'); mkdirSync(T);
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { env, cwd: R, encoding: 'utf8' });
const udd = path.join(T, `sutradhar-cli-${Date.now()}`); // exact pre-0.5.0 naming: sutradhar-cli-<ms>, no suffix
mkdirSync(udd);
// pre-0.5.0 CLI Chrome: no --sutradhar-* marker args at all
const chrome = spawn(CHROME, [`--user-data-dir=${udd}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' });
chrome.unref();
let port, wsPath;
for (let i = 0; i < 100 && !port; i++) { await sleep(200); try { [port, wsPath] = readFileSync(path.join(udd, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch {} }
const wsEndpoint = `ws://127.0.0.1:${port}${wsPath}`;
const sd = path.join(R, 'sr', 'a1b2c3d4e5f60718'); mkdirSync(sd, { recursive: true }); const sf = path.join(sd, 'state.json');
const legacyState = JSON.stringify({ sessionId: 'legacy-sess-1', wsEndpoint, chromePid: chrome.pid, lastUrl: 'about:blank' }, null, 2); // pre-0.5.0 shape: no profileDir/createdAt/cwd
writeFileSync(sf, legacyState);
const reach = async () => { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } };
const alive = () => { try { process.kill(chrome.pid, 0); return true; } catch { return false; } };
console.log('chrome', chrome.pid, wsEndpoint, 'waiting 125s so the legacy process is past the 120s grace...');
await sleep(125_000);
const mine = (p) => ({ actions: p.actions, kept: p.kept.filter((k) => (k.path && k.path.startsWith(R)) || k.pid === chrome.pid), exitCode: p.exitCode });
const res = { R, udd, stateFile: sf, chromePid: chrome.pid, wsEndpoint };
res.step1_readable = { sessions: JSON.parse(run(['sessions', '--json'])).sessions.map((s) => ({ status: s.status, chromePid: s.chromePid })), dry: mine(JSON.parse(run(['doctor', '--gc', '--dry-run', '--json']))) };
writeFileSync(sf, '{"sessionId":"legacy-sess-1","wsEnd'); // truncated mid-write
res.step2_garbage = { dry: mine(JSON.parse(run(['doctor', '--gc', '--dry-run', '--json']))), chromeAliveAfterDry: alive() };
writeFileSync(sf, legacyState);
const locker = spawn('powershell.exe', ['-NoProfile', '-Command', `$f=[System.IO.File]::Open('${sf}','Open','Read','None'); Write-Output LOCKED; Start-Sleep -Seconds 20; $f.Close()`], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => locker.stdout.on('data', (d) => { if (String(d).includes('LOCKED')) r(); }));
res.step3_locked_real = { reachableBefore: await reach(), real: mine(JSON.parse(run(['doctor', '--gc', '--json']))) };
locker.kill(); await sleep(2000);
res.after = { chromeAlive: alive(), endpointReachable: await reach(), profileDirExists: existsSync(udd), stateFileExists: existsSync(sf) };
writeFileSync(path.join(here, 'f4-gap194-legacy-sibling.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 2));
if (alive()) { try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F']); } catch {} }
process.exit(0);
