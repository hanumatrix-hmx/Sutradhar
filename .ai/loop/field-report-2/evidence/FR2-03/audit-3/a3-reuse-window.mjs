// audit-3: how small can (reused-PID squatter creation) - (victim creation) ever get on this machine? Lower bound:
// a squatter can't reuse the dead parent P's PID until P has exited AND its last handle is closed. Here P is a minimal
// native launcher (cmd.exe /d /c start "" /b <victim>) that exits immediately after spawning the victim; we timestamp
// the moment node observes P's exit (handle released right after) and compare with the victim's CIM CreationDate.
import { spawn, execFileSync } from 'node:child_process'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { writeFileSync } from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url)); const idle = path.join(here, 'idle.cjs');
const N = Number(process.argv[2] ?? 40); const rows = [];
const EPOCH_TICKS = 621355968000000000n;
for (let i = 0; i < N; i++) {
  const tag = `fr2-03-a3-rw-${process.pid}-${i}`;
  const p = spawn('cmd.exe', ['/d', '/c', 'start', '""', '/b', process.execPath, idle, tag], { stdio: 'ignore', windowsVerbatimArguments: false });
  const exitAt = await new Promise((r) => p.on('exit', () => r(Date.now())));
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${p.pid}" | ForEach-Object { "$($_.ProcessId) $($_.CreationDate.ToUniversalTime().Ticks) $($_.Name)" }`], { encoding: 'utf8' }).trim();
  const line = out.split(/\r?\n/).find((l) => /node/i.test(l));
  if (!line) { rows.push({ i, note: 'victim not found', out }); continue; }
  const [vpid, ticks] = line.split(' ');
  const vMs = Number((BigInt(ticks) - EPOCH_TICKS) / 10n) / 1000;
  rows.push({ i, parent: p.pid, victim: Number(vpid), parentExitObservedMinusVictimCreate_ms: +(exitAt - vMs).toFixed(3) });
  try { process.kill(Number(vpid)); } catch {}
}
const d = rows.map((r) => r.parentExitObservedMinusVictimCreate_ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
const res = { N, min_ms: d[0], p10_ms: d[Math.floor(d.length * 0.1)], median_ms: d[Math.floor(d.length / 2)], max_ms: d.at(-1), rows };
writeFileSync(path.join(here, 'reuse-window.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify({ ...res, rows: undefined }));
