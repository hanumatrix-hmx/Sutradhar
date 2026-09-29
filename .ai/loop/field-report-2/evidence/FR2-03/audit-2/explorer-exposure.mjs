// audit-2: if an orphan Sutradhar browser were ever assigned explorer.exe's dangling parent PID,
// how many processes would planGc's PPID walk (<=10 hops, stop only at a *captured* browser cmdline)
// classify as that browser's "children"? Uses the real planGc against the real process table with ONE
// synthetic orphan browser whose pid is set to explorer's dead parent pid. Pure planning, no kills.
import { listProcesses } from '../../../../../../packages/cli/dist/process-list.js';
import { planGc } from '../../../../../../packages/cli/dist/gc.js';
import { execSync } from 'node:child_process'; import path from 'node:path';
const r = await listProcesses();
const byPid = new Map(r.processes.map(p => [p.pid, p]));
const explorerPids = execSync('powershell -NoProfile -Command "(Get-Process explorer).Id"').toString().trim().split(/\s+/).map(Number);
const out = { explorerPids, explorer: [] };
for (const e of explorerPids) {
  const ex = byPid.get(e);
  const deadParent = ex.ppid;
  out.explorer.push({ pid: e, ppid: deadParent, parentAlive: byPid.has(deadParent) });
  if (byPid.has(deadParent)) continue;
  const tempRoot = 'C:\fake-temp-root';
  const fake = { pid: deadParent, ppid: 1, startMs: Date.now() - 1000, commandLine: `chrome.exe --user-data-dir=${path.join(tempRoot, "sutradhar-cli-1790000000000-abcdef")} --sutradhar-launch=cli --sutradhar-owner-pid=999999 --sutradhar-owner-start=1` };
  const plan = planGc({ scope: { tempRoot, stateRoot: 'C:\fake-state', extraStateDirs: [] }, sessions: { sessions: [] }, processEnumeration: { ok: true, processes: [...r.processes, fake] }, candidateDirs: [], lockProbes: {}, now: Date.now() });
  const childKills = plan.actions.filter(a => a.type === 'kill' && a.role === 'child').map(a => a.pid);
  const names = childKills.length === 0 ? [] : execSync(`powershell -NoProfile -Command "Get-Process -Id ${childKills.slice(0, 400).join(',')} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName | Sort-Object -Unique"`).toString().trim().split(/\r?\n/);
  out.plan = plan.actions.filter(a=>a.role!=="child"); out.keptFake = plan.kept.filter(k=>k.pid===deadParent); out.wouldKillAsChildren = childKills.length; out.processNames = names;
}
console.log(JSON.stringify(out, null, 2));
