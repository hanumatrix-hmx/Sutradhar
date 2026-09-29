// audit-4 independent GAP-183 hunt. Differences from audit-3's a3-ppid-hunt.mjs:
//  * each victim has its OWN child, so a hit yields a 2-hop chain (grandchild -> victim -> squatter) -- exercises the
//    parent-predates-child check where the grandchild's first hop (to the victim) is GENUINE and only the second is reused
//  * runs the REAL (non-dry) `doctor --gc` on every hit, then checks the victim AND its grandchild are STILL ALIVE
//    (audit-3 only checked the dry-run plan), while the squatter and a positive control's genuine child really die
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js'); const idle = path.join(here, 'idle.cjs');
const HITS = Number(process.argv[2] ?? 5), MAXTRY = Number(process.argv[3] ?? 8000), POOL = Number(process.argv[4] ?? 60);
const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
const cim = (pids) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `@(Get-CimInstance Win32_Process -Filter "${pids.map((p) => `ProcessId=${p}`).join(' OR ')}" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; ticks=$_.CreationDate.ToUniversalTime().Ticks } }) | ConvertTo-Json -Compress`], { encoding: 'utf8' }) || '[]');
const asArr = (x) => (Array.isArray(x) ? x : [x]);
const results = []; const cleanup = [];
const t0 = Date.now();
for (let h = 0; h < HITS; h++) {
  const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a5r-ppid-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
  const victims = new Map();
  for (let i = 0; i < POOL; i++) { const o = JSON.parse(execFileSync(process.execPath, [path.join(here, 'a5r-launcher.cjs')]).toString()); victims.set(o.launcher, o); cleanup.push(o.victim); }
  for (const [l] of victims) if (alive(l)) victims.delete(l); // launcher PID already recycled by a pool process: cannot be a clean hit
  const udd = path.join(T, `sutradhar-cli-${Date.now()}-a4sqat`); mkdirSync(udd);
  const marker = [`--user-data-dir=${udd}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=999997', '--sutradhar-owner-start=1'];
  let hit = null, tries = 0;
  while (tries < MAXTRY && !hit) {
    const batch = [];
    for (let k = 0; k < 16; k++) { tries++; batch.push(spawn(process.execPath, [idle, ...marker], { detached: true, stdio: 'ignore' })); }
    for (const c of batch) {
      if (!hit && victims.has(c.pid)) { hit = { squatterPid: c.pid, ...victims.get(c.pid) }; c.unref(); cleanup.push(c.pid); continue; }
      try { process.kill(c.pid); } catch {}
    }
  }
  if (!hit) { results.push({ h, tries, hit: null }); console.log(JSON.stringify(results.at(-1))); continue; }
  const udd2 = path.join(T, `sutradhar-cli-${Date.now()}-a4ctrl`); mkdirSync(udd2);
  const ctrl = spawn(process.execPath, [path.join(here, 'a5r-marked-with-child.cjs'), `--user-data-dir=${udd2}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=999996', '--sutradhar-owner-start=1'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const ctrlInfo = await new Promise((r) => ctrl.stdout.once('data', (d) => r(JSON.parse(d.toString()))));
  ctrl.unref(); cleanup.push(ctrlInfo.fake, ctrlInfo.child);
  const kids = asArr(JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", `@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${hit.victim}" | ? { $_.CommandLine -like "*fr2-03-a5r-grandchild*" } | % { $_.ProcessId }) | ConvertTo-Json -Compress`], { encoding: "utf8" }) || "[]"));
  hit.grandchild = kids[0]; cleanup.push(hit.grandchild);
  const ids = asArr(cim([hit.victim, hit.squatterPid, hit.grandchild]));
  const v = ids.find((x) => x.pid === hit.victim), s = ids.find((x) => x.pid === hit.squatterPid), g = ids.find((x) => x.pid === hit.grandchild);
  const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
  const real = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--json'], { env, cwd: R, encoding: 'utf8' }));
  const killed = real.actions.filter((a) => a.type === 'kill').map((a) => a.pid);
  await new Promise((r) => setTimeout(r, 1500));
  results.push({ h, tries, hit,
    chainAtGc: { victimPpidEqualsSquatter: v?.ppid === hit.squatterPid, grandchildPpidEqualsVictim: g?.ppid === hit.victim,
      squatterMinusVictimCreation_us: v && s ? (s.ticks - v.ticks) / 10 : null },
    plannedKills: killed,
    squatterKilled: killed.includes(hit.squatterPid) && !alive(hit.squatterPid),
    VICTIM_PLANNED_MUST_BE_FALSE: killed.includes(hit.victim), GRANDCHILD_PLANNED_MUST_BE_FALSE: killed.includes(hit.grandchild),
    VICTIM_ALIVE_AFTER_REAL_GC_MUST_BE_TRUE: alive(hit.victim), GRANDCHILD_ALIVE_AFTER_REAL_GC_MUST_BE_TRUE: alive(hit.grandchild),
    control: { fakeKilled: killed.includes(ctrlInfo.fake) && !alive(ctrlInfo.fake), GENUINE_CHILD_KILLED_MUST_BE_TRUE: killed.includes(ctrlInfo.child) && !alive(ctrlInfo.child) },
    exitCode: real.exitCode });
  console.log(JSON.stringify(results.at(-1)));
}
for (const p of cleanup) { try { process.kill(p); } catch {} }
const hits = results.filter((r) => r.hit);
const summary = { elapsedS: Math.round((Date.now() - t0) / 1000), hitsFound: hits.length, attempts: results.map((r) => r.tries),
  hitsWithVerifiedReuseChain: hits.filter((r) => r.chainAtGc.victimPpidEqualsSquatter).length,
  victimsPlannedOrKilled: hits.filter((r) => r.VICTIM_PLANNED_MUST_BE_FALSE || !r.VICTIM_ALIVE_AFTER_REAL_GC_MUST_BE_TRUE).length,
  grandchildrenPlannedOrKilled: hits.filter((r) => r.GRANDCHILD_PLANNED_MUST_BE_FALSE || !r.GRANDCHILD_ALIVE_AFTER_REAL_GC_MUST_BE_TRUE).length,
  squattersKilled: hits.filter((r) => r.squatterKilled).length,
  controlsGenuineChildKilled: hits.filter((r) => r.control.GENUINE_CHILD_KILLED_MUST_BE_TRUE).length, results };
writeFileSync(path.join(here, 'a5r-ppid-hunt-result.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
process.exit(0);
