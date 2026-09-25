// audit-2: how many processes on THIS machine right now have a PPID that points at a LIVE process
// created AFTER them (i.e. a recycled PID -- Windows never rewrites PPID when a parent exits)?
import { listProcesses } from '../../../../../../packages/cli/dist/process-list.js';
const r = await listProcesses();
if (!r.ok) { console.log('enum failed', r.reason); process.exit(1); }
const byPid = new Map(r.processes.map(p => [p.pid, p]));
const stale = [];
for (const p of r.processes) {
  const par = byPid.get(p.ppid);
  if (par && p.ppid !== 0 && par.startMs > p.startMs + 1000) stale.push({ pid: p.pid, ppid: p.ppid, childStart: new Date(p.startMs).toISOString(), parentStart: new Date(par.startMs).toISOString(), parentHasCmd: !!par.commandLine });
}
console.log(JSON.stringify({ total: r.processes.length, staleParentLinks: stale.length, sample: stale.slice(0, 15) }, null, 2));
const dangling = r.processes.filter(p => p.ppid !== 0 && !byPid.has(p.ppid));
console.log(JSON.stringify({ processesWithDeadParentPid: dangling.length, distinctDeadParentPids: new Set(dangling.map(p=>p.ppid)).size }, null, 2));
