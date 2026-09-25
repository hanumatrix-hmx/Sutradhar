// audit-2 PPID-reuse hunt: create N victims whose parents died, then spawn marked "fake browsers"
// (CLI marker, dead owner, udd under a scratch temp root) until one lands on a dead parent PID.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a2-ppid-')); const T = path.join(R, 'temp'); mkdirSync(T);
const N = Number(process.argv[2] ?? 60), MAXTRY = Number(process.argv[3] ?? 4000);
const victims = new Map(); // deadParentPid -> victimPid
for (let i = 0; i < N; i++) {
  const o = JSON.parse(execFileSync(process.execPath, [path.join(here, 'launcher.cjs')]).toString());
  victims.set(o.launcher, o.victim);
}
const udd = path.join(T, 'sutradhar-cli-1790000000000-abcdef'); mkdirSync(udd);
const markerArgs = [`--user-data-dir=${udd}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=999999', '--sutradhar-owner-start=1'];
let hit = null, tries = 0;
while (tries < MAXTRY && !hit) {
  const batch = [];
  for (let k = 0; k < 16; k++) { tries++; batch.push(spawn(process.execPath, [path.join(here, 'idle.cjs'), ...markerArgs], { detached: true, stdio: 'ignore' })); }
  for (const c of batch) {
    if (!hit && victims.has(c.pid)) { hit = { fakeBrowserPid: c.pid, victimPid: victims.get(c.pid) }; c.unref(); continue; }
    try { process.kill(c.pid); } catch {}
  }
}
const res = { R, T, udd, victims: [...victims].map(([p, v]) => ({ deadParent: p, victim: v })), tries, hit };
writeFileSync(path.join(here, 'hunt-result.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ R, tries, hit }));
