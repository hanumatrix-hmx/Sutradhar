// audit-2: for a real orphan CLI Chrome, list every planned role:child kill with its real parentage.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a2-child-')); const T = path.join(R, 'temp'), SR = path.join(R, 'sr'); mkdirSync(T); mkdirSync(SR); mkdirSync(path.join(R, 'c1'));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: SR }; delete env.SUTRADHAR_CLI_STATE_DIR;
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { env, cwd: path.join(R, 'c1'), encoding: 'utf8' });
run(['nav', 'data:text/html,<title>x</title>']);
const h = crypto.createHash('sha256').update(path.join(R, 'c1')).digest('hex').slice(0, 16);
const st = JSON.parse(readFileSync(path.join(SR, h, 'state.json'), 'utf8'));
rmSync(path.join(SR, h, 'state.json')); // orphan it
await new Promise(r => setTimeout(r, 2000));
function table() {
  const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ p=$_.ProcessId; pp=$_.ParentProcessId; t=$_.CreationDate.ToFileTimeUtc(); n=$_.Name; a=$_.CommandLine } } | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', maxBuffer: 1 << 26 }));
}
const tbl0 = table();
const dry = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--dry-run', '--json'], { env, cwd: R, encoding: 'utf8' }));
const tbl = table(); const by = new Map(tbl.map(p => [p.p, p])); const by0 = new Map(tbl0.map(p => [p.p, p]));
const kills = dry.actions.filter(a => a.type === 'kill');
const rows = kills.map(a => { const p = by.get(a.pid) ?? by0.get(a.pid); const par = p && (by.get(p.pp) ?? by0.get(p.pp)); return { pid: a.pid, role: a.role, name: p?.n, ppid: p?.pp, parentName: par?.n, parentIsKilledBrowser: kills.some(k => k.role === 'browser' && k.pid === p?.pp), childOlderThanParent: p && par ? p.t < par.t : null, cmd: (p?.a ?? '').slice(0, 140) }; });
console.log(JSON.stringify({ chromePid: st.chromePid, rows }, null, 1));
try { execFileSync('taskkill', ['/PID', String(st.chromePid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
