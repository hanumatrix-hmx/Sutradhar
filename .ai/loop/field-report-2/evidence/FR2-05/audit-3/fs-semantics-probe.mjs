// FR2-05 audit-3: establish the real NTFS per-directory case-sensitivity semantics on THIS machine
// before building attacks on them. Every fsutil call targets ONLY a directory inside a fresh
// mkdtemp dir this script created (under os.tmpdir()); nothing else on disk is touched. The flag
// is disabled again and the whole temp dir removed in `finally`.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const out = [];
const log = (k, v) => { out.push({ k, v }); console.log(k, '=>', typeof v === 'string' ? v : JSON.stringify(v)); };
const fsutil = (...a) => { try { return execFileSync('fsutil', ['file', ...a], { encoding: 'utf8' }).trim(); } catch (e) { return 'ERR ' + String(e.stdout || e.stderr || e.message).trim(); } };
const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr205-a3-fssem-'));
const flagged = [];
const enable = (d) => { const r = fsutil('setCaseSensitiveInfo', d, 'enable'); if (!r.startsWith('ERR')) flagged.push(d); return r; };
try {
  // 1. empty dir enable
  const P = path.join(R, 'P'); await fs.mkdir(P);
  log('enable-empty', enable(P));
  log('query-P', fsutil('queryCaseSensitiveInfo', P));
  // 2. inheritance: child created AFTER parent flagged
  const Pc = path.join(P, 'childAfter'); await fs.mkdir(Pc);
  log('query-child-created-after-flag', fsutil('queryCaseSensitiveInfo', Pc));
  // 3. non-empty dir enable: Q with pre-existing child
  const Q = path.join(R, 'Q'); await fs.mkdir(path.join(Q, 'preChild'), { recursive: true });
  log('enable-nonempty', enable(Q));
  log('query-Q', fsutil('queryCaseSensitiveInfo', Q));
  log('query-Q-preChild', fsutil('queryCaseSensitiveInfo', path.join(Q, 'preChild')));
  // 4. in a case-sensitive dir, are 'X' and 'x' distinct?
  await fs.mkdir(path.join(P, 'Same'));
  let distinct;
  try { await fs.mkdir(path.join(P, 'same')); distinct = true; } catch (e) { distinct = 'mkdir failed: ' + e.code; }
  log('P-Same-vs-same-distinct', distinct);
  log('P-entries', await fs.readdir(P));
  // 5. what does Node realpath return for a wrong-case path in an INsensitive dir (on-disk case?)
  const I = path.join(R, 'Ins'); await fs.mkdir(path.join(I, 'MixedCase'), { recursive: true });
  log('realpath-wrongcase-insensitive', await fs.realpath(path.join(R, 'ins', 'mixedcase')));
  // 6. fsutil on a junction pointing to a flagged dir -- does it report target's flag?
  const J = path.join(R, 'J');
  try { execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', J, P], { stdio: 'ignore' }); } catch {}
  log('junction-exists', existsSync(J));
  log('query-junction-to-flagged', fsutil('queryCaseSensitiveInfo', J));
  // 7. disable non-empty (P has Same+same -> expected refusal); Q (no case-dupes)
  log('disable-Q', fsutil('setCaseSensitiveInfo', Q, 'disable'));
} finally {
  // unlink junction first, then disable flags where possible, then remove the tree
  try { await fs.rm(path.join(R, 'J'), { force: true, recursive: false }); } catch {}
  try { execFileSync('cmd.exe', ['/d', '/c', 'rmdir', path.join(R, 'J')], { stdio: 'ignore' }); } catch {}
  await fs.rm(R, { recursive: true, force: true }).catch((e) => log('rm-error', String(e)));
  log('cleanup-R-gone', !existsSync(R));
  await fs.writeFile(new URL('./fs-semantics-probe.json', import.meta.url), JSON.stringify({ R, out }, null, 2));
}
