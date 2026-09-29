// audit-2: kill ONLY the browser pid (no /T, i.e. a crash). Do children survive and reference the dir?
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const T = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a2-crash-')); const udd = path.join(T, 'sutradhar-cli-1790000000001-crashA'); mkdirSync(udd);
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`, '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' }); c.unref();
await new Promise(r => setTimeout(r, 4000));
const q = () => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*${path.basename(T)}*' } | select ProcessId,ParentProcessId,@{n='type';e={ if ($_.CommandLine -match '--type=(\S+)') { $matches[1] } else { 'browser' } }}) | ConvertTo-Json -Compress`], { encoding: 'utf8' }) || '[]');
const before = q();
execFileSync('taskkill', ['/PID', String(c.pid), '/F']);
const after = []; for (const s of [1, 3, 8]) { await new Promise(r => setTimeout(r, s * 1000 - (after.length ? 0 : 0))); after.push({ afterS: s, procs: q() }); }
console.log(JSON.stringify({ before, after }, null, 1));
for (const p of after.at(-1).procs) try { execFileSync('taskkill', ['/PID', String(p.ProcessId), '/F'], { stdio: 'ignore' }); } catch {}
