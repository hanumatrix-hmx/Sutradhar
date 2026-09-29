// audit-5: ownerAliveAndSame() judges a LIVE owner "a different process that reused the PID" when
// |WMI CreationDate - marker.ownerStartMs| > 5000ms, and then GC kills that owner's runtime Chrome
// (orphan-runtime) and deletes its owner-file'd Puppeteer dir (owner-dead) -- on a live MCP/SDK
// session. marker.ownerStartMs = Date.now() - process.uptime()*1000, which excludes the OS
// process-creation -> node-main startup latency. Measures that skew for real node processes on this
// machine, idle and under CPU load (2x logical cores of busy-loop hogs).
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sample(n) {
  const kids = [];
  for (let i = 0; i < n; i++) {
    const c = spawn(process.execPath, ['-e', 'console.log(JSON.stringify({pid:process.pid,startMs:Math.round(Date.now()-process.uptime()*1000)}));setTimeout(()=>{},30000)'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    kids.push(new Promise((r) => { let s = ''; c.stdout.on('data', (d) => { s += d; if (s.includes('\n')) r({ c, ...JSON.parse(s) }); }); }));
  }
  const got = await Promise.all(kids);
  const ids = got.map((g) => g.pid).join(',');
  const wmi = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process | ? { @(${ids}) -contains $_.ProcessId } | % { [pscustomobject]@{p=$_.ProcessId;c=[int64](($_.CreationDate.ToUniversalTime()-[datetime]'1970-01-01').TotalMilliseconds)} }) | ConvertTo-Json -Compress`], { encoding: 'utf8' }));
  const deltas = got.map((g) => { const w = wmi.find((x) => x.p === g.pid); return w ? g.startMs - w.c : null; }).filter((d) => d !== null);
  for (const g of got) g.c.kill();
  deltas.sort((a, b) => a - b);
  return { n: deltas.length, min: deltas[0], median: deltas[Math.floor(deltas.length / 2)], max: deltas[deltas.length - 1], over5000: deltas.filter((d) => Math.abs(d) > 5000).length };
}
const res = { logicalCores: os.cpus().length };
res.idle = await sample(30);
const hogs = [];
for (let i = 0; i < os.cpus().length * 2; i++) hogs.push(spawn(process.execPath, ['-e', 'const e=Date.now()+60000;while(Date.now()<e){}'], { stdio: 'ignore', windowsHide: true }));
await sleep(2000);
try { res.underCpuLoad = await sample(30); } finally { for (const h of hogs) h.kill(); }
res.note = 'delta = marker-style processStartMs - WMI CreationDate (ms). GC treats |delta| > 5000 on a LIVE owner as PID reuse.';
writeFileSync(path.join(here, 'a5-owner-start-skew.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
