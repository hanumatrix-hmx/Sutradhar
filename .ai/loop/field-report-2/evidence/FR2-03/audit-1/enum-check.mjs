// Auditor: compare the built listProcesses() against an independent Get-Process count.
import { listProcesses } from '../../../../../../packages/cli/dist/process-list.js';
import { execFileSync } from 'node:child_process';
const t0 = Date.now();
const r = await listProcesses();
const ms = Date.now() - t0;
const indep = Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Process).Count'], { encoding: 'utf-8' }).trim());
const withCmd = r.ok ? r.processes.filter(p => p.commandLine) : [];
console.log(JSON.stringify({ ok: r.ok, reason: r.reason, count: r.ok ? r.processes.length : null, independentGetProcessCount: indep, elapsedMs: ms,
  withCommandLine: withCmd.length, chromeWithUdd: withCmd.filter(p => /chrome/i.test(p.commandLine)).length,
  zeroStart: r.ok ? r.processes.filter(p => !p.startMs).length : null }, null, 2));
