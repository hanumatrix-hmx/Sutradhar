// Revert test: run the shipped guard against HEAD's (pre-fix, committed) version of each of the
// 11 tracked files, one file reverted at a time, to see which historically-defective versions it flags.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execSync } from 'node:child_process';
import { repoRoot, STEALTH_CLAIM_FILES, loadStealthClaimFiles, findStealthClaimViolations } from '../../../../../../tools/scenario-suite/fr2-16/stealth-claim-check.mjs';
for (const target of STEALTH_CLAIM_FILES) {
  const s = fs.mkdtempSync(path.join(os.tmpdir(), 'a4h-'));
  try {
    for (const rel of STEALTH_CLAIM_FILES) { const d = path.join(s, rel); fs.mkdirSync(path.dirname(d), {recursive:true}); fs.copyFileSync(path.join(repoRoot, rel), d); }
    let headText; try { headText = execSync(`git show HEAD:${target}`, {cwd: repoRoot, encoding:'utf8', maxBuffer: 1e8}); } catch { console.log(`NO-HEAD ${target}`); continue; }
    const diff = execSync(`git diff --stat HEAD -- ${target}`, {cwd: repoRoot, encoding:'utf8'}).trim();
    fs.writeFileSync(path.join(s, target), headText);
    const v = findStealthClaimViolations(s, loadStealthClaimFiles(s)).filter(x => x.file === target);
    console.log(`${v.length ? 'FLAGGED' : 'PASSED '} HEAD-version of ${target} (${diff ? 'differs from working tree' : 'identical to working tree'})${v.length ? ' <- ' + v.map(x=>x.pattern.slice(0,45)).join(' | ') : ''}`);
  } finally { fs.rmSync(s, {recursive:true, force:true}); }
}
