// audit-3: writes a process snapshot (chrome.exe / node.exe with command lines) to argv[2].
// Listing is wrapped in try/catch so a failing CIM call never breaks the caller.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const out = process.argv[2];
let text;
try {
  const raw = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @(\'chrome.exe\',\'node.exe\') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 2"', { encoding: 'utf-8', maxBuffer: 64 << 20 });
  let arr = JSON.parse(raw || '[]'); if (!Array.isArray(arr)) arr = [arr];
  const summ = arr.map((p) => `${p.ProcessId}\t${p.ParentProcessId}\t${p.Name}\t${(p.CommandLine || '').slice(0, 220)}`);
  const ours = arr.filter((p) => /fr2-04-audit6|__dialog-warden/.test(p.CommandLine || ''));
  text = `at ${new Date().toISOString()}\ncounts: chrome=${arr.filter((p) => p.Name === 'chrome.exe').length} node=${arr.filter((p) => p.Name === 'node.exe').length}\naudit3-or-warden-matching=${ours.length}\n` + ours.map((p) => `  OURS? ${p.ProcessId} ${(p.CommandLine || '').slice(0, 300)}`).join('\n') + '\n---\n' + summ.join('\n') + '\n';
} catch (e) {
  text = `process listing failed: ${e.message}\n`;
}
fs.writeFileSync(out, text);
console.log(text.split('\n').slice(0, 4).join('\n'));
