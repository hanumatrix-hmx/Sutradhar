// FR2-04 escalation-2: revert-and-confirm harness for points 1-3.
//
// For a named point, this:
//  1. Reads the CURRENT (fixed, working-tree) bytes of each target file, sha256's them.
//  2. Replaces each target file with its content AT `--from-ref` (default HEAD, 652124a — the
//     commit this escalation started from, i.e. the pre-fix code) — CRLF/LF-aware: git's own
//     `show` output already uses the repo's checked-in line endings, so no extra normalization is
//     needed, but we compare/report both byte length and a normalized-newline sha so a pure
//     CRLF<->LF difference would still be caught rather than silently "matching".
//  3. Runs the given vitest file(s) for the point and records pass/fail counts — the whole point is
//     that this MUST show new failures (the point's own new tests, which encode the fix, now fail
//     against the pre-fix code).
//  4. Restores the ORIGINAL (fixed) bytes from step 1 and sha-verifies the restore succeeded byte
//     for byte. Aborts loudly (exit 2) if a restore ever fails to verify — never leaves the tree in
//     the reverted state.
//
// usage: node revert-confirm.mjs <point-name> <fromRef> <file1[,file2,...]> <vitestCwd> <vitestArgs...>
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const shaNormalized = (buf) => crypto.createHash('sha256').update(buf.toString('utf-8').replace(/\r\n/g, '\n')).digest('hex');

const [, , pointName, fromRef, filesArg, vitestCwd, ...vitestArgs] = process.argv;
if (!pointName || !fromRef || !filesArg || !vitestCwd) {
  console.error('usage: node revert-confirm.mjs <point-name> <fromRef> <file1[,file2]> <vitestCwd> [vitestArgs...]');
  process.exit(2);
}
const files = filesArg.split(',').map((f) => path.join(repoRoot, f));
const VITEST = path.join(repoRoot, 'node_modules/.bin/vitest.CMD');

const report = { point: pointName, fromRef, files: filesArg.split(','), at: new Date().toISOString() };

async function runVitest(label) {
  const r = spawnSync(VITEST, ['run', ...vitestArgs], { cwd: path.join(repoRoot, vitestCwd), encoding: 'utf-8', shell: true, timeout: 300000 });
  const outText = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const summary = (outText.match(/Tests\s+.*\(\d+\)/g) || []).pop() ?? '(no summary line found)';
  const failedNames = [...outText.matchAll(/(?:FAIL|×)\s+(.{0,200})/g)].map((x) => x[1].trim());
  return { label, exitCode: r.status, summary, failedCount: failedNames.length, failedNames: failedNames.slice(0, 40), outTail: outText.slice(-4000) };
}

try {
  // 1. Save current (fixed) bytes.
  const originals = [];
  for (const f of files) {
    const buf = await fs.readFile(f);
    originals.push({ f, buf, sha: sha(buf), shaNorm: shaNormalized(buf) });
  }
  report.originalShas = originals.map((o) => ({ file: path.relative(repoRoot, o.f), sha256: o.sha, sha256_normalized_eol: o.shaNorm, bytes: o.buf.length }));

  // 2. Confirm the "fixed" tests pass BEFORE reverting (sanity baseline).
  report.beforeRevert = await runVitest('fixed-code (baseline, should be all-pass)');

  // 3. Revert each file to fromRef.
  for (const o of originals) {
    const rel = path.relative(repoRoot, o.f).split(path.sep).join('/');
    const content = execFileSync('git', ['show', `${fromRef}:${rel}`], { cwd: repoRoot, maxBuffer: 64 << 20 });
    await fs.writeFile(o.f, content);
  }

  // 4. Run vitest against the REVERTED (pre-fix) code — expect NEW failures.
  report.afterRevert = await runVitest(`reverted-to-${fromRef} (should show NEW failures)`);

  // 5. Restore.
  for (const o of originals) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await fs.writeFile(o.f, o.buf);
        break;
      } catch (e) {
        if (attempt === 9) throw e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  const restored = [];
  for (const o of originals) {
    const buf = await fs.readFile(o.f);
    restored.push({ file: path.relative(repoRoot, o.f), sha256: sha(buf), matches: sha(buf) === o.sha });
  }
  report.restore = restored;
  const restoreOk = restored.every((r) => r.matches);
  report.restoreOk = restoreOk;
  if (!restoreOk) {
    console.error('RESTORE FAILED — sha mismatch, see report for details. Aborting with exit 2.');
    await fs.writeFile(path.join(here, `revert-confirm-${pointName}.txt`), JSON.stringify(report, null, 2));
    process.exit(2);
  }

  // 6. Confirm the fixed tests pass again AFTER restore (closes the loop).
  report.afterRestore = await runVitest('restored (should be all-pass again, same as baseline)');

  await fs.writeFile(path.join(here, `revert-confirm-${pointName}.txt`), JSON.stringify(report, null, 2));
  console.log(`[${pointName}] before=${report.beforeRevert.summary} | reverted=${report.afterRevert.summary} (failed:${report.afterRevert.failedCount}) | afterRestore=${report.afterRestore.summary} | restoreOk=${restoreOk}`);
} catch (e) {
  console.error('FATAL', e?.stack ?? e);
  await fs.writeFile(path.join(here, `revert-confirm-${pointName}.txt`), JSON.stringify({ ...report, fatalError: String(e?.stack ?? e) }, null, 2));
  process.exit(2);
}
