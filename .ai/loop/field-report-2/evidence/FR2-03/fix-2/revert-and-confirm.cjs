// fix-2 revert-and-confirm: every mutation audit-2 used (M1-M9, retargeted where fix-2's own
// code changed the surrounding text) PLUS two new mutations for fix-2's own new logic
// (M10: GAP-183's parent-predates-child guard, M11: GAP-185's unreadable-state protection).
// Each mutation is applied, the full cli vitest suite is run, the file is restored, and the
// restore is verified by sha256 -- so this file itself is proof a test caught (or didn't catch)
// each one, not just a self-report.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const repo = path.resolve(__dirname, '../../../../../..'); const cliDir = path.join(repo, 'packages/cli');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const M = [
  ['M1 live-session PID protection: live sessions stop reserving their chromePid (pass 1)', 'src/gc.ts',
   `    if (s.status === 'live') {\n      if (s.chromePid != null) referencedPids.add(s.chromePid);`, `    if (s.status === 'live') {\n      if (false) referencedPids.add(s.chromePid);`],
  ['M2 orphan-dir grace: grace window collapsed to 1ms for no-evidence dirs', 'src/gc.ts',
   `    if (withinGrace(ageMs)) {\n      kept.push({ path: dir.path, reason: 'grace' });`, `    if (ageMs < 1) {\n      kept.push({ path: dir.path, reason: 'grace' });`],
  ['M3 GAP-177: stale-session delete skips the referencedDirs check', 'src/gc.ts',
   `    if (referencedDirs.has(norm)) {\n      kept.push({ path: dir, reason: 'in-use' });\n      continue;\n    }\n    if (!processEnumeration.ok) {\n      const lock = lockProbes[dir] ?? 'unknown';`, `    if (false) {\n      kept.push({ path: dir, reason: 'in-use' });\n      continue;\n    }\n    if (!processEnumeration.ok) {\n      const lock = lockProbes[dir] ?? 'unknown';`],
  ['M4 GAP-178(a): D2 ownership gate disabled in degraded mode only', 'src/gc.ts',
   `      if (!dir.ownerFile && !dirsWithKilledBrowser.has(norm)) {`, `      if (processEnumeration.ok && !dir.ownerFile && !dirsWithKilledBrowser.has(norm)) {`],
  ['M5-fix2 GAP-184: discoverMarkerStateFiles trusts ANY process again (browser+udd-in-tempRoot scoping removed)', 'src/gc.ts',
   `    if (!isBrowserProcess(proc.commandLine)) continue; // GAP-184: never trust a non-browser carrier\n    const udd = extractUserDataDir(proc.commandLine);\n    if (!udd || !isOwnedTempProfileDir(udd, tempRoot, 'cli')) continue; // GAP-184: carrier must be our own real CLI Chrome\n    const marker = parseMarkerArgs(proc.commandLine);`,
   `    const marker = parseMarkerArgs(proc.commandLine);`],
  ['M6 GAP-176: in-use exclusion uses only the killed browser pid, not its tree', 'src/gc.ts',
   `      if (udd && !killedTreePids.has(proc.pid)) referencedDirs.add(normalizePathForCompare(udd));`, `      if (udd && !killedBrowserPids.has(proc.pid)) referencedDirs.add(normalizePathForCompare(udd));`],
  ['M7 GAP-178(c): probeLock reverted to a destructive unlinkSync probe', 'src/profile-cleanup.ts',
   `      renameSync(lockPath, lockPath);`, `      require('node:fs').unlinkSync(lockPath);`],
  ['M8 GAP-178(b): degraded mode skips grace for legacy dirs', 'src/gc.ts',
   `    if (withinGrace(ageMs)) {\n      kept.push({ path: dir.path, reason: 'grace' });\n      continue;\n    }\n    if (!processEnumeration.ok) {`, `    if (processEnumeration.ok && withinGrace(ageMs)) {\n      kept.push({ path: dir.path, reason: 'grace' });\n      continue;\n    }\n    if (!processEnumeration.ok) {`],
  ['M9 GAP-175 wiring: collectGcSnapshot no longer feeds discovered marker state files into the sessions scan', 'src/gc.ts',
   `extraStateFiles: [...extraStateDirs.map((d) => path.join(d, 'state.json')), ...discoveredStateFiles],`, `extraStateFiles: [...extraStateDirs.map((d) => path.join(d, 'state.json'))],`],
  ['M10-fix2 GAP-183: the PPID walk\'s parent-predates-child guard removed (back to trusting any ppid link, incl. reused PIDs)', 'src/gc.ts',
   `        const parentStart = parent.startMs;\n        const childStart = child.startMs;\n        if (!Number.isFinite(parentStart) || !Number.isFinite(childStart) || parentStart > childStart) {\n          break;\n        }\n        if (killedBrowserPids.has(parent.pid) || isBrowserProcess(parent.commandLine)) {`,
   `        if (killedBrowserPids.has(parent.pid) || isBrowserProcess(parent.commandLine)) {`],
  ['M11-fix2 GAP-185: unreadable-state protection removed from the cli-marker kill path (back to killing on a dead marker-owner alone)', 'src/gc.ts',
   `        if (marker.stateFile && unreadableStateFiles.has(normalizePathForCompare(marker.stateFile))) {\n          kept.push({ pid: proc.pid, path: udd, reason: 'unknown-liveness' });\n          continue;\n        }\n        const ownerOk = ownerAliveAndSame(marker.ownerPid, marker.ownerStartMs, processes);`,
   `        const ownerOk = ownerAliveAndSame(marker.ownerPid, marker.ownerStartMs, processes);`],
];
const log = [];
for (const [name, rel, from, to] of M) {
  const f = path.join(cliDir, rel); const orig = fs.readFileSync(f, 'utf8'); const h0 = sha(f);
  if (!orig.includes(from)) { log.push(`== ${name}: MUTATION DID NOT APPLY (target text not found -- verify manually)`); continue; }
  fs.writeFileSync(f, orig.replace(from, to));
  const r = spawnSync(path.join(repo, 'node_modules/.bin/vitest.cmd'), ['run'], { cwd: cliDir, encoding: 'utf8', shell: true });
  fs.writeFileSync(f, orig);
  const restored = sha(f) === h0;
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const fails = out.split('\n').filter((l) => /^\s*(FAIL|×)\s/.test(l)).map((l) => l.trim()).slice(0, 6);
  const tests = (out.match(/Tests\s+.*$/m) || [''])[0].trim();
  log.push(`== ${name} (${rel})\n   vitest exit ${r.status}; ${tests}\n   ${fails.join('\n   ') || '(no failing test)'}\n   restored-sha-match: ${restored}`);
}
fs.writeFileSync(path.join(__dirname, 'revert-and-confirm-fix2.txt'), log.join('\n') + '\n');
console.log(log.join('\n'));
