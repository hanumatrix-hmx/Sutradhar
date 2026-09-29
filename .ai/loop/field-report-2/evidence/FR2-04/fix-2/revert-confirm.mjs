// FR2-04 fix-2: revert-and-confirm for every touched product file. For each file: read the
// CURRENT (fix-2) content, capture its sha256 and CRLF/LF line-ending style; read the pre-fix-2
// content from `git show HEAD:<path>` (HEAD = d34a830, the audit-2-failed state this fix-2 starts
// from); write that OLD content to disk and confirm its sha256 differs (proving fix-2 actually
// changed something real, not a no-op); then restore the CURRENT content byte-for-byte from the
// in-memory buffer and confirm the sha256 matches the ORIGINAL exactly. Never touches git itself
// (no checkout/stash) -- pure file read/write/compare, so a crash mid-run can't lose anything not
// already re-writable from the buffer this script holds.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const files = [
  'packages/browser/src/session/dialog-cdp.ts',
  'packages/browser/src/session/dialog-warden.ts',
  'packages/cli/src/dialog-broker.ts',
  'packages/cli/src/dialog-cli.ts',
  'packages/cli/src/cli.ts',
  'packages/cli/src/warden-control.ts',
  'packages/browser/tests/unit/dialog-cdp.spec.ts',
  'packages/browser/tests/unit/dialog-warden.spec.ts',
  'packages/cli/tests/unit/dialog-broker.spec.ts',
  'tools/scenario-suite/verify-fr2-04-dialogs.mjs',
];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const lineStyle = (s) => (s.includes('\r\n') ? 'CRLF' : 'LF');

const results = [];
for (const f of files) {
  const current = await fs.readFile(f, 'utf-8');
  const currentSha = sha(current);
  const currentStyle = lineStyle(current);
  let head;
  try {
    head = execSync(`git show HEAD:${f}`, { encoding: 'utf-8', maxBuffer: 32 << 20 });
  } catch (e) {
    head = null; // file didn't exist at HEAD (e.g. a wholly new file) -- fine, note it
  }
  const row = { file: f, currentSha, currentStyle };
  if (head !== null) {
    const headSha = sha(head);
    row.headSha = headSha;
    row.changed = headSha !== currentSha;
    // Write the OLD (HEAD) content, confirm it actually landed and differs.
    await fs.writeFile(f, head, 'utf-8');
    const afterRevert = await fs.readFile(f, 'utf-8');
    row.revertedShaMatchesHead = sha(afterRevert) === headSha;
  } else {
    row.changed = true; // new file
    row.newFile = true;
  }
  // Restore the CURRENT (fix-2) content byte-for-byte from the in-memory buffer.
  await fs.writeFile(f, current, 'utf-8');
  const restored = await fs.readFile(f, 'utf-8');
  row.restoredShaMatchesOriginal = sha(restored) === currentSha;
  results.push(row);
  console.log(JSON.stringify(row));
}
const allOk = results.every((r) => r.restoredShaMatchesOriginal && (r.newFile || (r.changed && r.revertedShaMatchesHead)));
console.log(allOk ? '\nALL REVERT-CONFIRMS OK' : '\nSOME REVERT-CONFIRM FAILED');
process.exit(allOk ? 0 : 1);
