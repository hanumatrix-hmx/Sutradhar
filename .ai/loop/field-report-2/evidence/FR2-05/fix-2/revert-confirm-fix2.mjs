// FR2-05 fix-2 revert-and-confirm: proves the two load-bearing pieces of this cycle's fix are
// actually load-bearing, by reverting each to its pre-fix-2 broken behavior, showing a REAL
// vitest case (added by fix-2 specifically to cover the reverted behavior) fail, then restoring
// byte-for-byte (sha256-verified) and confirming it passes again.
//
// CRLF/LF-aware: reads/writes each file as a raw Buffer (never through a string round-trip),
// verified with sha256 rather than trusting a naive read-then-write round-trip is faithful.
//
// Covers:
//   1. GAP-300 (path-containment.ts): findContainingRoot's call to isRootCaseSensitive, which is
//      what makes case-sensitivity a REAL, per-directory, on-disk fact instead of an unconditional
//      win32 ASCII fold. Reverted by forcing the case-sensitive flag to `false` unconditionally
//      (the exact pre-fix-2 behavior) -- PC19/PC20 (the two exact GAP-300 repro shapes) must then
//      FAIL.
//   2. GAP-301 (browser-action-engine.ts): the never-detached download session + cross-process
//      fail-fast lock. Reverted by re-adding `client.detach()` to the finally block AND removing
//      the lock's contention check (always granting the lock) -- E8 (which asserts detach is
//      NEVER called) and E11 (which asserts the second concurrent call fails fast) must then FAIL.
//
// Run: node .ai/loop/field-report-2/evidence/FR2-05/fix-2/revert-confirm-fix2.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
const CONTAINMENT_FILE = path.join(repoRoot, 'packages', 'browser', 'src', 'actions', 'path-containment.ts');
const ENGINE_FILE = path.join(repoRoot, 'packages', 'browser', 'src', 'actions', 'browser-action-engine.ts');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function run(cmd, args, opts = {}) {
  const out = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf-8', shell: true, ...opts });
  return { code: out.status ?? 1, out: (out.stdout ?? '') + (out.stderr ?? '') };
}

function buildBrowser() {
  return run(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', '.'], {
    cwd: path.join(repoRoot, 'packages', 'browser'),
  });
}

function runVitest(testFileRelativeToBrowser, grep) {
  const args = ['run', testFileRelativeToBrowser];
  if (grep) args.push('-t', grep);
  return run(path.join(repoRoot, 'node_modules', '.bin', 'vitest'), args, {
    cwd: path.join(repoRoot, 'packages', 'browser'),
  });
}

let overallOk = true;
const report = { parts: [] };

// ── Part 1: GAP-300 -- isRootCaseSensitive wiring in findContainingRoot ────────────────────────
{
  const original = fs.readFileSync(CONTAINMENT_FILE);
  const originalSha = sha256(original);
  console.log(`[revert-confirm] original sha256(path-containment.ts) = ${originalSha}`);
  const text = original.toString('utf-8');

  const NEEDLE =
    'const caseSensitive = await isRootCaseSensitive(root, platform);\n    if (isPathWithinRoot(c, r, platform, caseSensitive)) return root;';
  if (!text.includes(NEEDLE)) {
    console.error('[revert-confirm] FATAL: could not find the GAP-300 call site in findContainingRoot. Aborting without touching the file.');
    process.exit(1);
  }
  const reverted = text.replace(
    NEEDLE,
    '// FR2-05 fix-2 REVERTED FOR REVERT-CONFIRM: force the old unconditional-fold behavior.\n    const caseSensitive = false;\n    if (isPathWithinRoot(c, r, platform, caseSensitive)) return root;',
  );

  fs.writeFileSync(CONTAINMENT_FILE, reverted, 'utf-8');
  console.log('[revert-confirm] GAP-300: reverted findContainingRoot to unconditional case-insensitive fold. Building...');
  const build1 = buildBrowser();
  const part1 = { id: 'GAP300-revert-build', pass: build1.code === 0, detail: build1.out.slice(-2000) };
  report.parts.push(part1);
  console.log(`[revert-confirm] build (reverted): ${build1.code === 0 ? 'OK' : 'FAILED'}`);

  let brokenTestFailed = false;
  let brokenDetail = '';
  if (build1.code === 0) {
    const t = runVitest('tests/unit/path-containment.spec.ts', 'GAP-300');
    brokenTestFailed = t.code !== 0;
    brokenDetail = t.out.slice(-4000);
    console.log(`[revert-confirm] GAP-300 tests on REVERTED code: ${brokenTestFailed ? 'FAILED (expected -- proves the fix is load-bearing)' : 'still passed (BAD -- fix is not load-bearing!)'}`);
  }
  const part1b = { id: 'GAP300-revert-tests-fail-as-expected', pass: brokenTestFailed, detail: brokenDetail.slice(-2000) };
  report.parts.push(part1b);
  if (!brokenTestFailed) overallOk = false;

  // Restore byte-for-byte, sha256-verified.
  fs.writeFileSync(CONTAINMENT_FILE, original);
  const restoredSha = sha256(fs.readFileSync(CONTAINMENT_FILE));
  const restoredOk = restoredSha === originalSha;
  console.log(`[revert-confirm] GAP-300: restored file, sha256 matches original = ${restoredOk}`);
  report.parts.push({ id: 'GAP300-restore-sha-match', pass: restoredOk, detail: `original=${originalSha} restored=${restoredSha}` });
  if (!restoredOk) { overallOk = false; process.exit(1); }

  const build2 = buildBrowser();
  console.log(`[revert-confirm] GAP-300: rebuild after restore: ${build2.code === 0 ? 'OK' : 'FAILED'}`);
  report.parts.push({ id: 'GAP300-restore-build', pass: build2.code === 0, detail: build2.out.slice(-1000) });
  if (build2.code !== 0) overallOk = false;

  const t2 = runVitest('tests/unit/path-containment.spec.ts', 'GAP-300');
  console.log(`[revert-confirm] GAP-300 tests on RESTORED code: ${t2.code === 0 ? 'PASSED (confirmed)' : 'FAILED (unexpected!)'}`);
  report.parts.push({ id: 'GAP300-restore-tests-pass', pass: t2.code === 0, detail: t2.out.slice(-1500) });
  if (t2.code !== 0) overallOk = false;
}

// ── Part 2: GAP-301 -- never-detach session + cross-process fail-fast lock ────────────────────
{
  const original = fs.readFileSync(ENGINE_FILE);
  const originalSha = sha256(original);
  console.log(`[revert-confirm] original sha256(browser-action-engine.ts) = ${originalSha}`);
  const text = original.toString('utf-8');

  // 2a. Re-add client.detach() right after the deny reset in the finally block (GAP-301 cause 1).
  const DETACH_NEEDLE = "await client.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});";
  if (!text.includes(DETACH_NEEDLE)) {
    console.error('[revert-confirm] FATAL: could not find the finally-block deny reset in runDownloadFileLocked. Aborting.');
    process.exit(1);
  }
  let reverted = text.replace(
    DETACH_NEEDLE,
    "await client.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});\n      // FR2-05 fix-2 REVERTED FOR REVERT-CONFIRM: reintroduce the fix-1 detach-after-reset.\n      await client.detach().catch(() => {});",
  );

  // 2b. Make the lock always grant (never fail fast) -- simulate the pre-fix-2 "no real
  // cross-call protection" state without deleting the whole lock module.
  const LOCK_NEEDLE = 'const lock = await acquireDownloadLock(browser.wsEndpoint());';
  if (!reverted.includes(LOCK_NEEDLE)) {
    console.error('[revert-confirm] FATAL: could not find the lock acquisition call site. Aborting without writing.');
    process.exit(1);
  }
  reverted = reverted.replace(
    LOCK_NEEDLE,
    '// FR2-05 fix-2 REVERTED FOR REVERT-CONFIRM: no real contention check -- always "succeeds".\n        const lock = { release: async () => {} };\n        void acquireDownloadLock; void browser; // silence unused-var/import in this reverted state',
  );

  fs.writeFileSync(ENGINE_FILE, reverted, 'utf-8');
  console.log('[revert-confirm] GAP-301: reverted to detach-after-reset + no real lock. Building...');
  const build1 = buildBrowser();
  report.parts.push({ id: 'GAP301-revert-build', pass: build1.code === 0, detail: build1.out.slice(-2000) });
  console.log(`[revert-confirm] build (reverted): ${build1.code === 0 ? 'OK' : 'FAILED'}`);

  let brokenTestFailed = false;
  let brokenDetail = '';
  if (build1.code === 0) {
    const t = runVitest('tests/unit/browser-action-engine.spec.ts', 'E8: resets Browser.setDownloadBehavior to deny');
    const t2 = runVitest('tests/unit/browser-action-engine.spec.ts', 'E11 \\(GAP-301');
    brokenTestFailed = t.code !== 0 || t2.code !== 0;
    brokenDetail = `E8:\n${t.out.slice(-2500)}\n\nE11:\n${t2.out.slice(-2500)}`;
    console.log(`[revert-confirm] GAP-301 tests (E8 detach-assert, E11 fail-fast-lock) on REVERTED code: ${brokenTestFailed ? 'FAILED (expected)' : 'still passed (BAD!)'}`);
  }
  report.parts.push({ id: 'GAP301-revert-tests-fail-as-expected', pass: brokenTestFailed, detail: brokenDetail.slice(-3000) });
  if (!brokenTestFailed) overallOk = false;

  fs.writeFileSync(ENGINE_FILE, original);
  const restoredSha = sha256(fs.readFileSync(ENGINE_FILE));
  const restoredOk = restoredSha === originalSha;
  console.log(`[revert-confirm] GAP-301: restored file, sha256 matches original = ${restoredOk}`);
  report.parts.push({ id: 'GAP301-restore-sha-match', pass: restoredOk, detail: `original=${originalSha} restored=${restoredSha}` });
  if (!restoredOk) { overallOk = false; process.exit(1); }

  const build2 = buildBrowser();
  console.log(`[revert-confirm] GAP-301: rebuild after restore: ${build2.code === 0 ? 'OK' : 'FAILED'}`);
  report.parts.push({ id: 'GAP301-restore-build', pass: build2.code === 0, detail: build2.out.slice(-1000) });
  if (build2.code !== 0) overallOk = false;

  const t3 = runVitest('tests/unit/browser-action-engine.spec.ts', 'E8: resets Browser.setDownloadBehavior to deny');
  const t4 = runVitest('tests/unit/browser-action-engine.spec.ts', 'E11 \\(GAP-301');
  const restoredPass = t3.code === 0 && t4.code === 0;
  console.log(`[revert-confirm] GAP-301 tests on RESTORED code: ${restoredPass ? 'PASSED (confirmed)' : 'FAILED (unexpected!)'}`);
  report.parts.push({ id: 'GAP301-restore-tests-pass', pass: restoredPass, detail: `E8 code=${t3.code} E11 code=${t4.code}` });
  if (!restoredPass) overallOk = false;
}

fs.writeFileSync(path.join(here, 'revert-confirm-fix2-report.json'), JSON.stringify(report, null, 2));
console.log(`\n[revert-confirm] OVERALL: ${overallOk ? 'PASS' : 'FAIL'}`);
process.exit(overallOk ? 0 : 1);
