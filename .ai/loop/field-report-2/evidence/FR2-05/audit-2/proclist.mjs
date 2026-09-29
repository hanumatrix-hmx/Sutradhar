// Snapshot of node/chrome processes (PID + command line) for audit-2 process hygiene.
// Usage: node proclist.mjs <outfile>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
let lines = [];
try {
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|chrome' } | ForEach-Object { \"$($_.ProcessId)`t$($_.Name)`t$($_.CommandLine)\" }";
  const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  lines = out.split(/\r?\n/).filter(Boolean);
} catch (e) {
  lines = [`ERROR listing processes: ${e.message}`];
}
const header = `# snapshot ${new Date().toISOString()} count=${lines.length}`;
fs.writeFileSync(process.argv[2], [header, ...lines].join('\n'), 'utf-8');
console.log(header);
