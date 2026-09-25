// audit-3 independent revert-and-confirm. 4 of fix-2's own mutations re-run (M5-fix2, M7, M10-fix2, M11-fix2) plus 4 NEW
// mutations aimed at fix-2's own new logic. Each: apply, run full cli vitest, restore, verify sha256 restored.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const repo = path.resolve(__dirname, '../../../../../..'); const cliDir = path.join(repo, 'packages/cli');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const M = [
  ['M5-fix2 (re-run) GAP-184 scoping removed entirely', 'src/gc.ts',
   `    if (!isBrowserProcess(proc.commandLine)) continue; // GAP-184: never trust a non-browser carrier\n    const udd = extractUserDataDir(proc.commandLine);\n    if (!udd || !isOwnedTempProfileDir(udd, tempRoot, 'cli')) continue; // GAP-184: carrier must be our own real CLI Chrome\n    const marker = parseMarkerArgs(proc.commandLine);`,
   `    const marker = parseMarkerArgs(proc.commandLine);`],
  ['M7 (re-run) probeLock destructive unlinkSync', 'src/profile-cleanup.ts', `      renameSync(lockPath, lockPath);`, `      require('node:fs').unlinkSync(lockPath);`],
  ['M10-fix2 (re-run) PPID start-time guard removed entirely', 'src/gc.ts',
   `        if (!Number.isFinite(parentStart) || !Number.isFinite(childStart) || parentStart > childStart) {\n          break;\n        }`, ``],
  ['M11-fix2 (re-run) GAP-185 unreadable-state protection removed', 'src/gc.ts',
   `        if (marker.stateFile && unreadableStateFiles.has(normalizePathForCompare(marker.stateFile))) {\n          kept.push({ pid: proc.pid, path: udd, reason: 'unknown-liveness' });\n          continue;\n        }\n`, ``],
  ['N1 NEW: GAP-183 ordering comparison ONLY removed (finite check kept) -- i.e. the actual PID-reuse defence is gone', 'src/gc.ts',
   `|| !Number.isFinite(childStart) || parentStart > childStart) {`, `|| !Number.isFinite(childStart)) {`],
  ['N2 NEW: GAP-184 isBrowserProcess carrier check removed (udd + state.json checks kept)', 'src/gc.ts',
   `    if (!isBrowserProcess(proc.commandLine)) continue; // GAP-184: never trust a non-browser carrier\n`, ``],
  ['N3 NEW: GAP-183 "<=" tightened to strict "<" (same-ms genuine child no longer walked -> GAP-176 regression)', 'src/gc.ts',
   `parentStart > childStart) {`, `parentStart >= childStart) {`],
  ['N4 NEW: GAP-183 check applied only at the FIRST hop (later hops trust any ppid link)', 'src/gc.ts',
   `parentStart > childStart) {`, `(hops === 0 && parentStart > childStart)) {`],
];
const log = [];
for (const [name, rel, from, to] of M) {
  const f = path.join(cliDir, rel); const orig = fs.readFileSync(f, 'utf8'); const h0 = sha(f);
  if (!orig.includes(from)) { log.push(`== ${name}: MUTATION DID NOT APPLY`); continue; }
  fs.writeFileSync(f, orig.replace(from, to));
  let r;
  try { r = spawnSync(path.join(repo, 'node_modules/.bin/vitest.cmd'), ['run'], { cwd: cliDir, encoding: 'utf8', shell: true }); }
  finally { fs.writeFileSync(f, orig); }
  const restored = sha(f) === h0;
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const fails = out.split('\n').filter((l) => /^\s*(FAIL|×)\s/.test(l)).map((l) => l.trim().slice(0, 260)).slice(0, 6);
  const tests = (out.match(/Tests\s+.*$/m) || [''])[0].trim();
  log.push(`== ${name} (${rel})\n   vitest exit ${r.status}; ${tests}\n   ${fails.join('\n   ') || '(NO FAILING TEST -- mutation SURVIVED)'}\n   restored-sha-match: ${restored}`);
  console.log(log.at(-1));
}
fs.writeFileSync(path.join(__dirname, 'revert-and-confirm-audit3.txt'), log.join('\n') + '\n');
