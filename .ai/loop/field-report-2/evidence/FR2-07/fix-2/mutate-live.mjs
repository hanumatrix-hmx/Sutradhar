// FR2-07 fix-2 step 5b: LIVE mutants. Reuses the mutant table of mutate-fix2.mjs (imported by text), applies one, rebuilds
// packages/browser/dist (tsc), runs a targeted slice of the live matrix (mcp surface), restores the source AND rebuilds.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
const repo = process.argv[2]; const out = process.argv[3];
const target = path.join(repo, 'packages/browser/src/verifier/execution-verifier.ts');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const original = fs.readFileSync(target); const before = sha(original); const src = original.toString('utf8');
const table = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'mutate-fix2.mjs'), 'utf8');
const arr = table.slice(table.indexOf('const MUTANTS = ['), table.indexOf('const results = []'));
const MUTANTS = new Function(arr.replace('const MUTANTS =', 'return') )();
const PLAN = { M1: 'M:iframe-cross-origin,M:iframe-same-origin,M:nested', M2: 'M:main-element,M:shadow-element', M4: 'M:main-element|zero-area,M:shadow-element|zero-area', M6: 'H', M7: 'M:shadow-bare-text', M8: 'M:nested' };
const tsc = () => spawnSync(process.execPath, [path.join(repo, 'node_modules/typescript/bin/tsc'), '-p', 'packages/browser'], { cwd: repo, encoding: 'utf8', timeout: 300000 });
const res = [];
try {
  for (const [id, only] of Object.entries(PLAN)) {
    const m = MUTANTS.find((x) => x.id === id);
    if (src.split(m.from).length !== 2) throw new Error('pattern ' + id);
    fs.writeFileSync(target, src.replace(m.from, () => m.to));
    const b = tsc();
    const r = spawnSync(process.execPath, ['tools/scenario-suite/verify-fr2-07-verification.mjs', '--only=' + only, '--surface=mcp'], { cwd: repo, encoding: 'utf8', timeout: 900000, env: { ...process.env, SUTRADHAR_FR2_07_EVIDENCE_DIR: path.join(repo, '.ai/loop/field-report-2/evidence/FR2-07/fix-2/mutant-live', id) }, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(target, original); tsc();
    const lines = (r.stdout || '').split('\n'); const summary = lines.filter((l) => /passed/.test(l)).pop() ?? '';
    const fails = lines.filter((l) => /FAIL/.test(l)).map((l) => l.slice(0, 160));
    res.push({ id, why: m.why, filter: only, tscExit: b.status, caughtLive: r.status !== 0, summary, failCount: fails.length, firstFails: fails.slice(0, 3), restored: sha(fs.readFileSync(target)) === before });
    console.log(id, r.status !== 0 ? 'CAUGHT LIVE' : 'NOT CAUGHT', summary);
  }
} finally { fs.writeFileSync(target, original); tsc(); }
fs.writeFileSync(out, JSON.stringify({ before, after: sha(fs.readFileSync(target)), res }, null, 2));
console.log('sha', before, sha(fs.readFileSync(target)));
