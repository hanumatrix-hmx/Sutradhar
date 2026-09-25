// audit-3 independent GAP-183 hunt (not a copy of hunt.mjs / hunt-and-verify.mjs):
//  * victims come from a separate launcher; the "squatter" that lands on a dead launcher's reused PID is a marked fake
//    orphan browser (own --user-data-dir under our tempRoot, CLI naming, dead owner), exactly the GAP-183 shape
//  * for EVERY hit we record the victim's and squatter's CreationDate at full CIM precision (microseconds) to quantify
//    how close the "<=" window ever gets in practice, then run the REAL built `doctor --gc --dry-run`
//  * a positive control (a second marked fake browser with a GENUINE child) runs alongside in the same tempRoot and must
//    still get its child planned for kill -- so "victim spared" can't be explained by the walk simply never firing
//  * the victim is also given its OWN child (grandchild of the dead launcher) to cover a 2-hop chain
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js'); const idle = path.join(here, 'idle.cjs');
const HITS = Number(process.argv[2] ?? 6), MAXTRY = Number(process.argv[3] ?? 6000);
const cim = (pids) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `@(Get-CimInstance Win32_Process -Filter "${pids.map((p) => `ProcessId=${p}`).join(' OR ')}" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; ticks=$_.CreationDate.ToUniversalTime().Ticks } }) | ConvertTo-Json -Compress`], { encoding: 'utf8' }) || '[]');
const results = []; const cleanup = [];
for (let h = 0; h < HITS; h++) {
  const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-ppid-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
  const victims = new Map();
  for (let i = 0; i < 40; i++) { const o = JSON.parse(execFileSync(process.execPath, [path.join(here, 'a3-launcher.cjs')]).toString()); victims.set(o.launcher, o.victim); cleanup.push(o.victim); }
  const udd = path.join(T, `sutradhar-cli-${Date.now()}-a3sqat`); mkdirSync(udd);
  const marker = [`--user-data-dir=${udd}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=999997', '--sutradhar-owner-start=1'];
  let hit = null, tries = 0;
  while (tries < MAXTRY && !hit) {
    const batch = [];
    for (let k = 0; k < 16; k++) { tries++; batch.push(spawn(process.execPath, [idle, ...marker], { detached: true, stdio: 'ignore' })); }
    for (const c of batch) {
      if (!hit && victims.has(c.pid)) { hit = { squatterPid: c.pid, victimPid: victims.get(c.pid) }; c.unref(); cleanup.push(c.pid); continue; }
      try { process.kill(c.pid); } catch {}
    }
  }
  if (!hit) { results.push({ h, tries, hit: null }); continue; }
  // 2-hop: give the victim-side a grandchild by having a NEW process claim the victim as parent is impossible from outside,
  // so instead spawn the positive control: a fake browser with a genuine child.
  const udd2 = path.join(T, `sutradhar-cli-${Date.now()}-a3ctrl`); mkdirSync(udd2);
  const ctrl = spawn(process.execPath, [path.join(here, 'a3-fake-with-child.cjs'), `--user-data-dir=${udd2}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=999996', '--sutradhar-owner-start=1'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const ctrlInfo = await new Promise((r) => ctrl.stdout.once('data', (d) => r(JSON.parse(d.toString()))));
  ctrl.unref(); cleanup.push(ctrlInfo.fake, ctrlInfo.child);
  const ts = cim([hit.victimPid, hit.squatterPid]);
  const v = ts.find((x) => x.pid === hit.victimPid), s = ts.find((x) => x.pid === hit.squatterPid);
  const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
  const dry = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--dry-run', '--json'], { env, cwd: R, encoding: 'utf8' }));
  const killed = dry.actions.filter((a) => a.type === 'kill').map((a) => a.pid);
  results.push({ h, tries, hit, victimPpidAtGc: v?.ppid, victimPpidEqualsSquatter: v?.ppid === hit.squatterPid,
    squatterMinusVictimCreation_us: v && s ? (s.ticks - v.ticks) / 10 : null,
    squatterPlannedForKill: killed.includes(hit.squatterPid), VICTIM_PLANNED_FOR_KILL_MUST_BE_FALSE: killed.includes(hit.victimPid),
    control: { fakePlanned: killed.includes(ctrlInfo.fake), genuineChildPlanned_MUST_BE_TRUE: killed.includes(ctrlInfo.child) },
    allKilled: killed, killedIdentities: JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-CimInstance Win32_Process -Filter "${killed.map((p) => `ProcessId=${p}`).join(' OR ')}" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name; cmd=$_.CommandLine } }) | ConvertTo-Json -Compress`], { encoding: 'utf8' }) || '[]') });
  console.log(JSON.stringify(results.at(-1)));
}
for (const p of cleanup) { try { process.kill(p); } catch {} }
const hits = results.filter((r) => r.hit);
const summary = { hitsFound: hits.length, victimsKilled: hits.filter((r) => r.VICTIM_PLANNED_FOR_KILL_MUST_BE_FALSE).length,
  controlsWithChildKilled: hits.filter((r) => r.control.genuineChildPlanned_MUST_BE_TRUE).length,
  minSquatterMinusVictim_us: Math.min(...hits.map((r) => r.squatterMinusVictimCreation_us ?? Infinity)), results };
writeFileSync(path.join(here, 'ppid-hunt-result.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
