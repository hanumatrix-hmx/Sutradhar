// fix-2 live verification of GAP-183: reproduce audit-2's exact PID-reuse scenario (spawn
// throwaway processes until one lands on a dead parent's reused PID), mark it as a fake
// "orphan browser child" via a real CLI-marked fake browser process, then run the REAL, BUILT
// `doctor --gc --dry-run` against it and confirm the unrelated reused-pid process (and its own
// genuinely unrelated child) are NEVER planned for a kill.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-fix2-ppid-'));
const T = path.join(R, 'temp'); mkdirSync(T);
const N = Number(process.argv[2] ?? 60), MAXTRY = Number(process.argv[3] ?? 4000);
const victims = new Map(); // deadParentPid -> victimPid (the genuinely orphaned structural child)
for (let i = 0; i < N; i++) {
  const o = JSON.parse(execFileSync(process.execPath, [path.join(here, 'launcher.cjs')]).toString());
  victims.set(o.launcher, o.victim);
}
// The "fake browser": a real Chrome-shaped marker (own --user-data-dir under our own tempRoot,
// matching CLI naming, so it IS trusted per the fixed discoverMarkerStateFiles/main-loop scope
// checks) with a dead owner, so planGc will plan to kill IT -- then the PPID walk is exercised
// to see whether it wrongly also kills whatever now squats on a dead parent's reused pid.
const uddDir = path.join(T, `sutradhar-cli-${Date.now()}-fake01`);
mkdirSync(uddDir, { recursive: true });
const markerArgs = [`--user-data-dir=${uddDir}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=999999', '--sutradhar-owner-start=1'];
let hit = null, tries = 0;
while (tries < MAXTRY && !hit) {
  const batch = [];
  for (let k = 0; k < 16; k++) { tries++; batch.push(spawn(process.execPath, [path.join(here, 'idle.cjs'), ...markerArgs], { detached: true, stdio: 'ignore' })); }
  for (const c of batch) {
    if (!hit && victims.has(c.pid)) { hit = { fakeBrowserPid: c.pid, victimPid: victims.get(c.pid) }; c.unref(); continue; }
    try { process.kill(c.pid); } catch {}
  }
}
if (!hit) {
  writeFileSync(path.join(here, 'hunt-result.json'), JSON.stringify({ R, tries, hit: null, note: 'no PID-reuse hit within MAXTRY -- inconclusive, not a pass or fail' }, null, 2));
  console.log(JSON.stringify({ tries, hit: null }));
  process.exit(0);
}
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') };
delete env.SUTRADHAR_CLI_STATE_DIR;
const dry = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--dry-run', '--json'], { env, cwd: R, encoding: 'utf8' }));
const killedPids = dry.actions.filter((a) => a.type === 'kill').map((a) => a.pid);
const res = {
  R, tries, hit,
  fakeBrowserPidPlannedForKill: killedPids.includes(hit.fakeBrowserPid),
  reusedPidVictimPlannedForKill_MUST_BE_FALSE: killedPids.includes(hit.victimPid),
  allKilledPids: killedPids,
  dryActions: dry.actions,
  keptForReusedVictim: dry.kept.filter((k) => k.pid === hit.victimPid),
};
writeFileSync(path.join(here, 'hunt-result.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
try { process.kill(hit.fakeBrowserPid); } catch {}
