// Lists chrome.exe PIDs whose command line contains `marker` (a scratch path unique to one run).
import { execFile } from 'node:child_process';
const Q = String.fromCharCode(39);
export function chromePids(marker) {
  const m = marker.split(Q).join(Q + Q);
  const ps = 'Get-CimInstance Win32_Process -Filter "Name=' + Q + 'chrome.exe' + Q + '" | Where-Object { $_.CommandLine -like ' + Q + '*' + m + '*' + Q + ' } | ForEach-Object { $_.ProcessId }';
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 30000 }, (e, so) => resolve(e ? null : so.split(/\s+/).filter(Boolean).map(Number))));
}
