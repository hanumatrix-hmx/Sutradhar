// audit-3 GAP-325 live mutant G1: every SHOWN cross-origin frame never answers (hidden ones are still answered from the
// parent side). Usage: node g1-apply.mjs apply|restore. Keeps a byte copy for restore and checks sha256.
import fs from 'node:fs'; import crypto from 'node:crypto';
const F = 'packages/browser/src/verifier/execution-verifier.ts';
const BAK = '.ai/loop/field-report-2/evidence/FR2-07/audit-3/g1-orig.bin';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const NL = String.fromCharCode(10);
const from = "          if (s === 'unjudgeable') return 'unjudged';" + NL;
const inject = "          { let xo = false; try { xo = !!main && f !== main && new URL(f.url()).origin !== new URL(main.url()).origin; } catch { xo = false; } if (xo) await new Promise(() => {}); } // G1 MUTANT" + NL;
if (process.argv[2] === 'apply') {
  const o = fs.readFileSync(F); fs.writeFileSync(BAK, o);
  const s = o.toString('utf8'); if (s.split(from).length !== 2) throw new Error('pattern count');
  fs.writeFileSync(F, s.replace(from, from + inject)); console.log('applied; orig sha', sha(o));
} else {
  const o = fs.readFileSync(BAK); fs.writeFileSync(F, o); console.log('restored sha', sha(fs.readFileSync(F)));
}
