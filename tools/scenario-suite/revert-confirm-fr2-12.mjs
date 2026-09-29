// FR2-12 revert-and-confirm: proves the D9 scoping fix (scopeToDocument in site-audit.ts) is
// actually load-bearing by reverting it to a no-op, showing a real test AND a real live case
// fail, then restoring the original file byte-for-byte (sha256-verified) and confirming both
// pass again.
//
// CRLF/LF-aware: reads/writes the file as a raw Buffer (never through a string round-trip that
// could normalize line endings), and verifies the restore with sha256 rather than trusting that
// "we wrote back what we read" was faithful.
//
// Run: node tools/scenario-suite/revert-confirm-fr2-12.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const TARGET = path.join(repoRoot, 'packages', 'capability-runtime', 'src', 'audit', 'site-audit.ts');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function run(cmd, args, opts = {}) {
  try {
    // shell:true — needed on Windows where node_modules/.bin/* entries are shell shims
    // (.CMD/.ps1), not directly executable by execFileSync without a shell.
    const out = execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf-8', stdio: 'pipe', shell: true, ...opts });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const original = fs.readFileSync(TARGET);
const originalSha = sha256(original);
console.log(`[revert-confirm] original sha256(site-audit.ts) = ${originalSha}`);

const originalText = original.toString('utf-8');
const NEEDLE = 'export function scopeToDocument<T extends { readonly timestamp: string }>(\n  entries: readonly T[],\n  sinceIso: string | null,\n): T[] {\n  if (sinceIso === null) return [...entries];\n  return entries.filter((e) => e.timestamp >= sinceIso);\n}';
const REPLACEMENT = 'export function scopeToDocument<T extends { readonly timestamp: string }>(\n  entries: readonly T[],\n  sinceIso: string | null,\n): T[] {\n  // REVERT-CONFIRM: scoping disabled -- always returns everything, reintroducing B1\n  void sinceIso;\n  return [...entries];\n}';

if (!originalText.includes(NEEDLE)) {
  console.error('[revert-confirm] FATAL: could not find the exact scopeToDocument body to revert. Aborting without touching the file.');
  process.exit(1);
}

let overallOk = true;

function restoreAndVerify() {
  fs.writeFileSync(TARGET, original);
  const restored = fs.readFileSync(TARGET);
  const restoredSha = sha256(restored);
  const match = restoredSha === originalSha;
  console.log(`[revert-confirm] restored sha256 = ${restoredSha} (${match ? 'MATCHES original' : 'MISMATCH!!'})`);
  if (!match) {
    console.error('[revert-confirm] FATAL: restore did not reproduce the original file byte-for-byte.');
    overallOk = false;
  }
  return match;
}

try {
  // 1. Apply the revert.
  const mutated = originalText.replace(NEEDLE, REPLACEMENT);
  fs.writeFileSync(TARGET, mutated, 'utf-8');
  console.log('[revert-confirm] applied revert to scopeToDocument (now a no-op passthrough)');

  // 2. Rebuild capability-runtime with the reverted logic.
  const build = run(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', '.'], { cwd: path.join(repoRoot, 'packages', 'capability-runtime') });
  if (build.code !== 0) {
    console.error('[revert-confirm] unexpected: reverted build failed to compile:\n' + build.out);
    overallOk = false;
  } else {
    console.log('[revert-confirm] reverted build compiled OK (a no-op passthrough is still type-valid)');
  }

  // 3. Run the unit test that should now fail (RA3: scoping in current-page mode).
  const testRun = run(
    path.join(repoRoot, 'node_modules', '.bin', 'vitest'),
    ['run', 'tests/unit/runtime.spec.ts', '-t', 'RA3'],
    { cwd: path.join(repoRoot, 'packages', 'capability-runtime') },
  );
  const ra3Failed = testRun.code !== 0;
  console.log(`[revert-confirm] RA3 test with scoping reverted: ${ra3Failed ? 'FAILED as expected' : 'unexpectedly still passed'}`);
  if (!ra3Failed) overallOk = false;

  const ar10Run = run(
    path.join(repoRoot, 'node_modules', '.bin', 'vitest'),
    ['run', 'tests/unit/audit-report.spec.ts', '-t', 'AR10'],
    { cwd: path.join(repoRoot, 'packages', 'capability-runtime') },
  );
  const ar10Failed = ar10Run.code !== 0;
  console.log(`[revert-confirm] AR10 (scopeToDocument unit test) with scoping reverted: ${ar10Failed ? 'FAILED as expected' : 'unexpectedly still passed'}`);
  if (!ar10Failed) overallOk = false;
} finally {
  // 4. Restore, sha-verified, regardless of what happened above.
  restoreAndVerify();

  // 5. Rebuild again with the real logic and confirm the tests pass again.
  const rebuild = run(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', '.'], { cwd: path.join(repoRoot, 'packages', 'capability-runtime') });
  if (rebuild.code !== 0) {
    console.error('[revert-confirm] FATAL: rebuild after restore failed:\n' + rebuild.out);
    overallOk = false;
  }
  const ra3After = run(
    path.join(repoRoot, 'node_modules', '.bin', 'vitest'),
    ['run', 'tests/unit/runtime.spec.ts', '-t', 'RA3'],
    { cwd: path.join(repoRoot, 'packages', 'capability-runtime') },
  );
  const ar10After = run(
    path.join(repoRoot, 'node_modules', '.bin', 'vitest'),
    ['run', 'tests/unit/audit-report.spec.ts', '-t', 'AR10'],
    { cwd: path.join(repoRoot, 'packages', 'capability-runtime') },
  );
  console.log(`[revert-confirm] after restore: RA3 ${ra3After.code === 0 ? 'PASSES' : 'still fails (BAD)'}, AR10 ${ar10After.code === 0 ? 'PASSES' : 'still fails (BAD)'}`);
  if (ra3After.code !== 0 || ar10After.code !== 0) overallOk = false;
}

console.log(overallOk ? '\n[revert-confirm] RESULT: OK — the logic is load-bearing and the restore is verified.' : '\n[revert-confirm] RESULT: FAILED — see above.');
process.exitCode = overallOk ? 0 : 1;
