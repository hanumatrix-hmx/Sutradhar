// audit-5 revert-and-confirm: applies each mutation to packages/cli/src/gc.ts, runs the FULL cli vitest
// suite, records pass/fail counts, restores the original bytes, and verifies the sha256 after each.
const fs = require('fs'); const path = require('path'); const cp = require('child_process'); const crypto = require('crypto');
const repo = path.resolve(__dirname, '../../../../../..'); const file = path.join(repo, 'packages/cli/src/gc.ts');
const orig = fs.readFileSync(file); const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const origSha = sha(orig);
const M = [
  ['F4-M1 revert GAP-193 Puppeteer gate (dirsWithKilledBrowser may authorize)',
    'if (!dir.ownerFile) {\n        kept.push({ path: dir.path, reason: \'not-sutradhar\' });',
    'if (!dir.ownerFile && !dirsWithKilledBrowser.has(norm)) {\n        kept.push({ path: dir.path, reason: \'not-sutradhar\' });'],
  ['F4-M2 revert GAP-193 grace ordering (dirsWithKilledBrowser before grace)',
    '    if (withinGrace(ageMs)) {\n      kept.push({ path: dir.path, reason: \'grace\' });\n      continue;\n    }\n    if (processEnumeration.ok && dirsWithKilledBrowser.has(norm)) {\n      actions.push({ type: \'deleteDir\', path: dir.path, reason: \'orphan-browser\', result: \'planned\' });\n      continue;\n    }',
    '    if (processEnumeration.ok && dirsWithKilledBrowser.has(norm)) {\n      actions.push({ type: \'deleteDir\', path: dir.path, reason: \'orphan-browser\', result: \'planned\' });\n      continue;\n    }\n    if (withinGrace(ageMs)) {\n      kept.push({ path: dir.path, reason: \'grace\' });\n      continue;\n    }'],
  ['F4-M3 remove GAP-194 legacyProbes consultation',
    '} else if (legacyProbes?.[normalizePathForCompare(udd)] === true) {',
    '} else if (false) {'],
  ['A5-N1 probeLegacyChromeReachable: unparsable/missing port reads as REACHABLE',
    'if (!Number.isInteger(port) || port <= 0) return false;',
    'if (!Number.isInteger(port) || port <= 0) return true;'],
  ['A5-N2 ownerFile-only gate: delete owner-file\'d Puppeteer dir even when owner ALIVE',
    'const ownerDead = !ownerAliveAndSame(dir.ownerFile.ownerPid, dir.ownerFile.ownerStartMs, processes);',
    'const ownerDead = true;'],
  ['A5-N3 collectGcSnapshot never populates legacyProbes (production wiring of GAP-194)',
    'legacyProbes[normalizePathForCompare(udd)] = await probeLegacyChromeReachable(udd);',
    'void udd;'],
];
const out = { origSha, results: [] };
for (const [name, from, to] of M) {
  const src = orig.toString('utf8');
  if (!src.includes(from)) { out.results.push({ name, error: 'anchor not found' }); continue; }
  fs.writeFileSync(file, src.replace(from, to));
  let txt = '';
  try { txt = cp.execSync('..\\..\\node_modules\\.bin\\vitest.CMD run', { cwd: path.join(repo, 'packages/cli'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { txt = (e.stdout || '') + (e.stderr || ''); }
  fs.writeFileSync(file, orig);
  const clean = txt.replace(/\x1b\[[0-9;]*m/g, '');
  const tests = (clean.match(/Tests\s+(.*)/) || [])[1];
  const failing = [...clean.matchAll(/(?:FAIL|×)\s+(.*)/g)].map((m) => m[1].trim()).slice(0, 8);
  out.results.push({ name, tests, caught: /failed/.test(tests || ''), failing, restoredShaOk: sha(fs.readFileSync(file)) === origSha });
}
out.finalShaOk = sha(fs.readFileSync(file)) === origSha;
fs.writeFileSync(path.join(__dirname, 'a5-revert-and-confirm.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
