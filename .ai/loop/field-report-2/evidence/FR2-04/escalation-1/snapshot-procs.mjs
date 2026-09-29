// FR2-04 escalation-1: process hygiene snapshot (chrome.exe/node.exe), same convention as
// audit-3/4's lib.mjs `procs()` -- never kills by image name, only records for before/after diff.
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';

const outFile = process.argv[2] ?? 'process-snapshot.txt';
let out = '';
try {
  out = execSync(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @(\'chrome.exe\',\'node.exe\') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 2"',
    { encoding: 'utf-8', maxBuffer: 64 << 20 },
  );
} catch (e) {
  out = 'ERROR: ' + String(e?.message ?? e);
}
await fs.writeFile(outFile, out);
try {
  const p = JSON.parse(out || '[]');
  const arr = Array.isArray(p) ? p : [p];
  const chrome = arr.filter((x) => /chrome/i.test(x.Name || ''));
  const node = arr.filter((x) => /node/i.test(x.Name || ''));
  const wardens = arr.filter((x) => /__dialog-warden/.test(x.CommandLine || ''));
  console.log(`chrome=${chrome.length} node=${node.length} wardens=${wardens.length}`);
  if (wardens.length) console.log('warden PIDs:', wardens.map((w) => w.ProcessId).join(','));
} catch {
  console.log('could not parse process listing —', outFile, 'written raw for inspection');
}
