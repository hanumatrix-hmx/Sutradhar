// audit-5: realism check for the B2 finding (a5-legacy-orphan-and-hung.json): how often does a LIVE,
// un-suspended Chrome fail probeLegacyChromeReachable's 800ms /json/version deadline under CPU
// load (2x logical cores of busy-loop hogs), vs idle? Uses the REAL probeLegacyChromeReachable.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const gc = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/gc.js')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a5-lat-'))); const udd = path.join(R, `sutradhar-cli-${Date.now()}-A5lat1`); mkdirSync(udd);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${udd}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' });
chrome.unref();
for (let i = 0; i < 100 && !existsSync(path.join(udd, 'DevToolsActivePort')); i++) await sleep(200);
await sleep(1000);
async function sample(n) { let f = 0; const ms = []; for (let i = 0; i < n; i++) { const t = Date.now(); const ok = await gc.probeLegacyChromeReachable(udd); ms.push(Date.now() - t); if (!ok) f++; await sleep(100); } ms.sort((a, b) => a - b); return { n, falseUnreachable: f, p50: ms[n >> 1], max: ms[n - 1] }; }
const res = { chromePid: chrome.pid };
const hogs = [];
try {
  res.idle = await sample(40);
  for (let i = 0; i < os.cpus().length * 2; i++) hogs.push(spawn(process.execPath, ['-e', 'const e=Date.now()+90000;while(Date.now()<e){}'], { stdio: 'ignore', windowsHide: true }));
  await sleep(2000);
  res.underCpuLoad2x = await sample(40);
} finally {
  for (const h of hogs) h.kill();
  try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  await sleep(1500);
  try { rmSync(R, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { res.cleanupError = String(e); }
  res.cleanup = { rootExists: existsSync(R) };
  writeFileSync(path.join(here, 'a5-devtools-latency-under-load.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
}
