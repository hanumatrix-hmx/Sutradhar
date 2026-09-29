// audit-4 revert-and-confirm: the Auditor's OWN mutations (not fix-3's), each breaking a structural fix in a different
// place than fix-3's self-mutation did (fix-3 deleted the gate; here the TAGGING and the WIRING are attacked too).
// Each mutation: apply to src, run the real cli vitest suite, record pass/fail counts, restore, verify sha256.
const fs = require('fs'); const path = require('path'); const cp = require('child_process'); const crypto = require('crypto');
const repo = path.resolve(__dirname, '../../../../../..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = { gc: path.join(repo, 'packages/cli/src/gc.ts'), sessions: path.join(repo, 'packages/cli/src/sessions.ts') };
const before = { gc: sha(files.gc), sessions: sha(files.sessions) };
const mutations = [
  { id: 'M1-tagging-always-false', target: 'GAP-189', file: 'sessions', from: 'stateFiles.push({ file: f, viaMarker: !trustedNorm.has(key) });', to: 'stateFiles.push({ file: f, viaMarker: false });' },
  { id: 'M2-wiring-marker-into-trusted-extraStateFiles', target: 'GAP-189', file: 'gc',
    from: "    extraStateFiles: extraStateDirs.map((d) => path.join(d, 'state.json')),\n    markerStateFiles: discoveredStateFiles,",
    to: "    extraStateFiles: [...extraStateDirs.map((d) => path.join(d, 'state.json')), ...discoveredStateFiles],\n    markerStateFiles: [],", },
  { id: 'M3-gate-moved-after-clearState', target: 'GAP-189', file: 'gc',
    from: "    if (s.viaMarker) {\n      if (s.chromePid != null) referencedPids.add(s.chromePid);\n      if (s.profileDir) referencedDirs.add(normalizePathForCompare(s.profileDir));\n      kept.push({ path: s.stateFile, reason: 'unknown-liveness' });\n      continue;\n    }\n    if (s.sessionId && s.endpoint) {\n      actions.push({ type: 'clearState', stateFile: s.stateFile, result: 'planned' });\n    }",
    to: "    if (s.sessionId && s.endpoint) {\n      actions.push({ type: 'clearState', stateFile: s.stateFile, result: 'planned' });\n    }\n    if (s.viaMarker) {\n      if (s.chromePid != null) referencedPids.add(s.chromePid);\n      if (s.profileDir) referencedDirs.add(normalizePathForCompare(s.profileDir));\n      kept.push({ path: s.stateFile, reason: 'unknown-liveness' });\n      continue;\n    }", },
  { id: 'M4-stat-failure-dropped', target: 'GAP-188', file: 'sessions', from: '      ioFailed = true; // EBUSY/EACCES/etc', to: '      continue; // MUTATION: EBUSY/EACCES/etc' },
  { id: 'M5-readFile-failure-dropped', target: 'GAP-188', file: 'sessions', from: "        raw = await readFile(file, 'utf-8');\n      } catch {\n        ioFailed = true;\n      }", to: "        raw = await readFile(file, 'utf-8');\n      } catch {\n        continue;\n      }" },
];
const out = { before, results: [] };
for (const m of mutations) {
  const f = files[m.file]; const orig = fs.readFileSync(f, 'utf8');
  const n = orig.split(m.from).length - 1;
  if (n !== 1) { out.results.push({ id: m.id, error: `pattern occurrences=${n}` }); continue; }
  fs.writeFileSync(f, orig.replace(m.from, m.to));
  let txt; try { txt = cp.execSync('node_modules\\.bin\\vitest run --root packages/cli', { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { txt = (e.stdout || '') + (e.stderr || ''); }
  fs.writeFileSync(f, orig);
  const clean = txt.replace(/\x1b\[[0-9;]*m/g, '');
  const tests = (clean.match(/Tests\s+([^\n]+)/) || [])[1];
  const failedNames = [...clean.matchAll(/(?:FAIL|×)\s+([^\n]+)/g)].map((x) => x[1].trim()).slice(0, 12);
  out.results.push({ id: m.id, target: m.target, tests, caught: /failed/.test(tests || ''), failedNames });
  fs.writeFileSync(path.join(__dirname, `revert-${m.id}.txt`), clean);
  console.log(m.id, '=>', tests);
}
out.after = { gc: sha(files.gc), sessions: sha(files.sessions) };
out.restoredByteIdentical = out.after.gc === before.gc && out.after.sessions === before.sessions;
fs.writeFileSync(path.join(__dirname, 'a4-revert-and-confirm.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ before, after: out.after, restoredByteIdentical: out.restoredByteIdentical }));
