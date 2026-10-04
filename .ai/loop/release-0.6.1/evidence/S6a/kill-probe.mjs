// S6a extra probe (builder-authored): killChromeTree must use the absolute taskkill, never a taskkill.exe planted in the cwd.
import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url'; import { spawn } from 'node:child_process';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const KC = await import(pathToFileURL(process.env.KC_MODULE).href);
let fails = 0; const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' :: ' + d : ''}`); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`== kill-probe node=${process.version} tmpdir=${os.tmpdir()} pid=${process.pid}`);
const cwdDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kp-'));
await fsp.copyFile('C:/Windows/System32/cmd.exe', path.join(cwdDir, 'taskkill.exe'));
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
let exited = false; child.on('exit', () => { exited = true; });
await sleep(1000);
console.log(`INFO child pid=${child.pid} alive-before=${!exited}`);
const prev = process.cwd(); process.chdir(cwdDir);
const t0 = performance.now(); await KC.killChromeTree(child.pid, 8000); const ms = performance.now() - t0; process.chdir(prev);
const dl = performance.now() + 8000; while (!exited && performance.now() < dl) await sleep(100);
console.log(`INFO killChromeTree resolved in ms=${ms.toFixed(0)} child-exited=${exited}`);
check('KILL: child process killed although cwd holds a planted taskkill.exe', exited);
if (!exited) { child.kill('SIGKILL'); const d2 = performance.now() + 8000; while (!exited && performance.now() < d2) await sleep(100); console.log(`INFO cleanup: killed own child by handle, exited=${exited}`); }
console.log(`RESULT fails=${fails}`); process.exitCode = fails ? 1 : 0;
