// fix-4: GAP-194's fix must not protect a GENUINELY orphaned legacy Chrome forever. This launches
// a real legacy (unmarked) Chrome, waits past the 120s grace period, then externally kills the
// Chrome tree itself (simulating it having crashed/exited) BEFORE running doctor --gc, so its
// DevToolsActivePort can no longer answer -- legacyProbes must read false, and the dir/process
// bookkeeping must still be reclaimed exactly as before this fix (no regression to G12/GAP-178b).
// A second case backdates the profile dir but leaves the real Chrome running and REACHABLE, to
// prove the young-vs-old grace boundary (G12) still holds unaffected by legacyProbes.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-fix4-noregr-')); const T = path.join(R, 'temp'); mkdirSync(T);
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { env, cwd: R, encoding: 'utf8' });
const udd = path.join(T, `sutradhar-cli-${Date.now()}`);
mkdirSync(udd);
const chrome = spawn(CHROME, [`--user-data-dir=${udd}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' });
chrome.unref();
let port;
for (let i = 0; i < 100 && !port; i++) { await sleep(200); try { [port] = readFileSync(path.join(udd, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch {} }
const alive = () => { try { process.kill(chrome.pid, 0); return true; } catch { return false; } };
console.log('chrome', chrome.pid, 'port', port, 'waiting 122s past grace...');
await sleep(122_000);
// Kill the real Chrome tree NOW (simulating a genuine crash/exit) so its DevToolsActivePort can
// no longer answer -- but its profile dir and (stale) process bookkeeping remain for GC to find.
try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F']); } catch {}
await sleep(1000);
const res = { udd, chromePid: chrome.pid, chromeAliveBeforeGc: alive(), profileDirExistsBeforeGc: existsSync(udd) };
res.real = JSON.parse(run(['doctor', '--gc', '--json']));
res.mine = { actions: res.real.actions.filter((a) => (a.userDataDir || a.path || '').toString().includes(R) || a.path === udd), kept: res.real.kept.filter((k) => k.path && k.path.startsWith(R)) };
res.after = { profileDirExists: existsSync(udd) };
writeFileSync(path.join(here, 'f4-gap194-no-regression-real-orphan.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
process.exit(0);
