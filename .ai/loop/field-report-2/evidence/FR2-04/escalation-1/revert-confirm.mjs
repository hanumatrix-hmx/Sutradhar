// FR2-04 escalation-1: revert-and-confirm harness for the 5 decision points. For each point:
// 1. Read the target file's ORIGINAL bytes (CRLF/LF preserved exactly, no re-encoding) + sha256.
// 2. Apply a real source mutation that reintroduces the specific bug the point fixed.
// 3. Run the targeted vitest file(s) and record whether the mutation is CAUGHT (a test fails).
// 4. Restore the file's EXACT original bytes and confirm via sha256 that the restore is byte-
//    identical to what was read in step 1 (never rewritten/re-encoded).
// 5. Re-run the same vitest file(s) and confirm they pass again post-revert.
//
// usage: node revert-confirm.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const VITEST = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vitest.CMD' : 'vitest');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function readRaw(relPath) {
  return readFileSync(path.join(repoRoot, relPath));
}
function writeRaw(relPath, buf) {
  writeFileSync(path.join(repoRoot, relPath), buf);
}

function runVitest(cwdRel, specRel) {
  const args = specRel.split(' '); // may be several spec files
  try {
    const out = execFileSync(VITEST, ['run', ...args], {
      cwd: path.join(repoRoot, cwdRel),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true, // vitest.CMD needs shell interpretation on Windows
    });
    return { pass: true, tail: out.split('\n').slice(-8).join('\n') };
  } catch (e) {
    const out = String(e.stdout ?? '') + String(e.stderr ?? '');
    return { pass: false, tail: out.split('\n').slice(-25).join('\n') };
  }
}

// Applies `find` -> `repl` on the raw buffer's UTF-8 text WITHOUT altering line endings elsewhere
// (the file's own CRLF/LF mix, if any, is preserved verbatim outside the touched line since we
// only ever replace an exact substring match, never re-serialize the whole file).
function mutate(buf, find, repl) {
  const text = buf.toString('utf-8');
  if (!text.includes(find)) throw new Error(`mutation anchor not found: ${JSON.stringify(find).slice(0, 120)}`);
  const mutated = text.replace(find, repl);
  return Buffer.from(mutated, 'utf-8');
}

const points = [
  {
    id: 'point1-history-based-safety',
    desc:
      'GAP-245/decision 1: attributeDialogHolders must key "safe to close" off confirmedSafe HISTORY, ' +
      'not current topology. Mutation reverts to fix-3\'s "every blocked target is a candidate" (confirmedSafe ignored).',
    file: 'packages/browser/src/session/dialog-cdp.ts',
    find: 'const result = resolvedChildren.length > 0 ? resolvedChildren[0]!.holder : byId.get(id)!.confirmedSafe ? undefined : id;',
    repl: 'const result = resolvedChildren.length > 0 ? resolvedChildren[0]!.holder : id; // MUTATION point1: confirmedSafe ignored (fix-3 regression)',
    cwd: 'packages/browser',
    spec: 'tests/unit/dialog-cdp.spec.ts',
  },
  {
    id: 'point2-gap246-isolated-recovery',
    desc:
      'GAP-246/decision 2: a never-confirmed target with no sibling must still be recoverable. ' +
      'Mutation reintroduces fix-3\'s blanket "no sibling at all -> refuse" rule inside tryRecoverUnknownTarget.',
    file: 'packages/browser/src/session/dialog-warden.ts',
    find: '      await closeTargetAtBrowserLevel(this.browser, targetId);',
    repl:
      '      // MUTATION point2: reintroduce fix-3\'s blanket "isolated -> refuse" rule.\n' +
      '      if (!dialogs.some((d) => d.blockedBy === targetId)) return { closed: false, refused: true };\n' +
      '      await closeTargetAtBrowserLevel(this.browser, targetId);',
    cwd: 'packages/browser',
    spec: 'tests/unit/dialog-warden.spec.ts',
  },
  {
    id: 'point3-gap247-direct-broker-refuses',
    desc:
      'GAP-247/decision 3: DirectCdpBroker (warden down) must never destructively close a target based on ' +
      'a topology guess. Mutation restores the old "close whatever attribution names as holder" behavior.',
    file: 'packages/cli/src/dialog-broker.ts',
    find:
      '      return {\n' +
      '        refused: true,\n' +
      '        message:\n' +
      "          `Tab ${targetId} is unresponsive, but the dialog warden is not running, so this dialog cannot be ` +\n" +
      "          'safely attributed to one specific tab without guessing (guessing here has been measured to close ' +\n" +
      "          'the wrong, innocent tab) — no automatic recovery was attempted. Run \"sutradhar close\" to end the ' +\n" +
      "          'session, or retry once a warden is available.',\n" +
      '      };',
    repl:
      '      // MUTATION point3: restore fix-3\'s unsafe "close whatever the guess names" behavior.\n' +
      '      await closeTargetAtBrowserLevel(this.browser!, targetId);\n' +
      '      return { closedTarget: true, message: `Tab ${targetId} was closed (MUTATED).` };',
    cwd: 'packages/cli',
    spec: 'tests/unit/direct-cdp-broker.spec.ts',
    // point3's mutation calls closeTargetAtBrowserLevel again -- restore the import removed earlier.
    extraFileFixup: (relPath, buf) => {
      const text = buf.toString('utf-8');
      if (text.includes('closeTargetAtBrowserLevel,')) return buf;
      return Buffer.from(
        text.replace(
          "  attributeDialogHolders,\n  probeTargetsConcurrently,\n} from '@sutradhar/browser';",
          "  attributeDialogHolders,\n  probeTargetsConcurrently,\n  closeTargetAtBrowserLevel,\n} from '@sutradhar/browser';",
        ),
        'utf-8',
      );
    },
  },
  {
    id: 'point5a-A13-warden-drops-discoveredAt',
    desc: 'GAP-249 A13 (audit-4 mutations.mjs): the warden must feed real discoveredAt into attribution.',
    file: 'packages/browser/src/session/dialog-warden.ts',
    find: 'discoveredAt: this.discoveredAt.get(info.targetId),',
    repl: 'discoveredAt: undefined, // MUTATION A13',
    cwd: 'packages/browser',
    spec: 'tests/unit/dialog-cdp.spec.ts tests/unit/dialog-warden.spec.ts',
  },
  {
    id: 'point5b-A20-selectDialog-picks-collateral',
    desc: 'GAP-249 A20 (audit-4 mutations.mjs): selectDialog must skip a blockedBy/confirmedSafe entry.',
    file: 'packages/cli/src/dialog-cli.ts',
    find: 'const target = sorted.find((d) => !d.blockedBy && !d.confirmedSafe);',
    repl: 'const target = sorted[0]; // MUTATION A20',
    cwd: 'packages/cli',
    spec: 'tests/unit/dialog-cli.spec.ts',
  },
];

const report = [];
for (const p of points) {
  const entry = { id: p.id, desc: p.desc, file: p.file };
  const original = readRaw(p.file);
  const originalSha = sha256(original);
  entry.originalSha256 = originalSha;

  // Build @sutradhar/browser first if this point touches it and the other package depends on the
  // built dist (dialog-broker.ts/dialog-cli.ts import from '@sutradhar/browser').
  function buildBrowserIfNeeded() {
    try {
      execFileSync(path.join(repoRoot, 'node_modules', '.bin', 'tsc.CMD'), ['-p', 'packages/browser/tsconfig.json'], {
        cwd: repoRoot,
        stdio: 'ignore',
        windowsHide: true,
        shell: true,
      });
    } catch {}
  }

  try {
    let mutated = mutate(original, p.find, p.repl);
    if (p.extraFileFixup) mutated = p.extraFileFixup(p.file, mutated);
    writeRaw(p.file, mutated);
    if (p.file.startsWith('packages/browser/')) buildBrowserIfNeeded();
    entry.mutatedResult = runVitest(p.cwd, p.spec);
    entry.mutationCaught = !entry.mutatedResult.pass; // a real regression must FAIL the suite
  } catch (e) {
    entry.error = String(e?.stack ?? e);
    entry.mutationCaught = undefined;
  } finally {
    // Restore EXACT original bytes, unconditionally, even if the try block threw.
    writeRaw(p.file, original);
    if (p.file.startsWith('packages/browser/')) buildBrowserIfNeeded();
  }

  const restored = readRaw(p.file);
  entry.restoredSha256 = sha256(restored);
  entry.restoreVerified = entry.restoredSha256 === originalSha;
  entry.postRevertResult = runVitest(p.cwd, p.spec);

  report.push(entry);
  console.log(
    `[${p.id}] mutationCaught=${entry.mutationCaught} restoreVerified=${entry.restoreVerified} postRevertPass=${entry.postRevertResult?.pass}`,
  );
}

const outPath = path.join(here, 'revert-confirm-results.json');
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('written', outPath);

const allGood = report.every((e) => e.mutationCaught === true && e.restoreVerified === true && e.postRevertResult?.pass === true);
console.log(allGood ? 'ALL POINTS: mutation caught + sha-verified restore + post-revert pass' : 'SOME POINTS FAILED — see revert-confirm-results.json');
process.exit(allGood ? 0 : 1);
