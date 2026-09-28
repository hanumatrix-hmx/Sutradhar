// FR2-05 audit-1: attack the containment boundary (canonicalizePath / findContainingRoot /
// isPathWithinRoot) directly against the real filesystem, using the built dist.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const pc = await import(pathToFileURL(path.join(WT, 'packages/browser/dist/actions/path-containment.js')).href);
const { canonicalizePath, findContainingRoot, isPathWithinRoot } = pc;

const R = fs.mkdtempSync(path.join(os.tmpdir(), 'fr205a1-probe-'));
const root = path.join(R, 'root');
const outside = path.join(R, 'outside');
fs.mkdirSync(root);
fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
fs.writeFileSync(path.join(root, 'ok.txt'), 'ok');
const links = [];
function link(target, p, type) {
  try {
    fs.symlinkSync(target, p, type);
    links.push(p);
    return true;
  } catch (e) {
    return `link-failed:${e.code}`;
  }
}

const results = [];
async function probe(id, candidate, expectContained, note = '') {
  let hit, err, canon;
  try { canon = await canonicalizePath(candidate); } catch (e) { canon = `THROW: ${e.message}`; }
  try { hit = await findContainingRoot(candidate, [root]); } catch (e) { err = e.message; }
  const contained = !!hit;
  const ok = contained === expectContained;
  results.push({ id, candidate, canonical: canon, accepted: contained, error: err, expectAccepted: expectContained, verdict: ok ? 'as-expected' : 'UNEXPECTED', note });
  console.log(`${ok ? 'ok ' : '!! '} ${id}: accepted=${contained} expect=${expectContained} canon=${canon}${err ? ' err=' + err : ''}`);
}

// a. symlinks / junctions
link(outside, path.join(root, 'jn'), 'junction');
link(outside, path.join(root, 'sd'), 'dir');
link(path.join(outside, 'secret.txt'), path.join(root, 'sf.txt'), 'file');
await probe('a1-junction-existing', path.join(root, 'jn'), false);
await probe('a2-junction-newtail', path.join(root, 'jn', 'newsub', 'deeper'), false);
await probe('a3-dirsymlink-existing', path.join(root, 'sd'), false);
await probe('a4-dirsymlink-newtail', path.join(root, 'sd', 'newsub'), false);
await probe('a5-filesymlink', path.join(root, 'sf.txt'), false);
await probe('a6-filesymlink-as-dir-tail', path.join(root, 'sf.txt', 'sub'), false);
await probe('a7-real-file-inside', path.join(root, 'ok.txt'), true);
await probe('a8-new-subdir-inside', path.join(root, 'new', 'deeper'), true);

// d. dangling + chains
fs.mkdirSync(path.join(R, 'gone'));
link(path.join(R, 'gone'), path.join(root, 'dj'), 'junction');
fs.rmdirSync(path.join(R, 'gone'));
await probe('d1-dangling-junction', path.join(root, 'dj', 'sub'), false);
fs.mkdirSync(path.join(R, 'gone2'));
link(path.join(R, 'gone2'), path.join(root, 'ds'), 'dir');
fs.rmdirSync(path.join(R, 'gone2'));
await probe('d2-dangling-dirsymlink', path.join(root, 'ds', 'sub'), false);
// chain A(in root) -> B(in root) -> C(outside)
link(outside, path.join(root, 'chainC'), 'dir');
link(path.join(root, 'chainC'), path.join(root, 'chainB'), 'dir');
link(path.join(root, 'chainB'), path.join(root, 'chainA'), 'dir');
await probe('d3-symlink-chain-3hop', path.join(root, 'chainA', 'newsub'), false);
// junction chain
link(outside, path.join(root, 'jC'), 'junction');
link(path.join(root, 'jC'), path.join(root, 'jB'), 'junction');
await probe('d4-junction-chain', path.join(root, 'jB', 'newsub'), false);
// relative symlink target escaping upward
link('..\\outside', path.join(root, 'relsd'), 'dir');
await probe('d5-relative-symlink-up', path.join(root, 'relsd', 'x'), false);
// chain ending in dangling
link(path.join(R, 'nowhere'), path.join(root, 'dz'), 'dir');
link(path.join(root, 'dz'), path.join(root, 'dy'), 'dir');
await probe('d6-chain-to-dangling', path.join(root, 'dy', 'x'), false);
// symlink loop
link(path.join(root, 'loopB'), path.join(root, 'loopA'), 'dir');
link(path.join(root, 'loopA'), path.join(root, 'loopB'), 'dir');
await probe('d7-symlink-loop', path.join(root, 'loopA', 'x'), false);
// link inside an ancestor above root, root reached through a link (should be fine)

// c. traversal & Windows quirks
await probe('c1-dotdot', path.join(root, '..', 'outside', 'x'), false);
await probe('c2-dotdot-literal', root + '\\sub\\..\\..\\outside', false);
await probe('c3-prefix-evil', root + '-evil\\x', false);
await probe('c4-unc-localhost-admin-share', '\\\\localhost\\' + R[0] + '$' + R.slice(2) + '\\outside\\x', false);
await probe('c5-unc-localhost-admin-share-inside', '\\\\localhost\\' + R[0] + '$' + R.slice(2) + '\\root\\x', true, 'contained spelled via UNC: accept or reject both safe');
await probe('c6-device-path-inside', '\\\\?\\' + root + '\\sub', true, 'genuinely inside; spec N5 expected reject, acceptance is not an escape');
await probe('c7-device-path-outside', '\\\\?\\' + outside + '\\sub', false);
await probe('c8-dotdevice-outside', '\\\\.\\' + outside + '\\sub', false);
await probe('c9-trailing-dot-root', root + '.\\sub', true, 'Win32 strips trailing dot: allowA. == allowA');
await probe('c10-trailing-dot-junction', path.join(root, 'jn.') + '\\newsub', false);
await probe('c11-trailing-space-junction', path.join(root, 'jn ') + '\\newsub', false);
await probe('c12-ads-on-root', root + ':stream', false);
await probe('c13-ads-in-tail', path.join(root, 'x:stream'), true, 'inside; Chrome will fail, not escape');
await probe('c14-ads-on-junction', path.join(root, 'jn') + ':$I30:$INDEX_ALLOCATION\\newsub', false);
await probe('c15-case-variant', root.toUpperCase() + '\\SUB', true);
await probe('c16-drive-relative', R.slice(0, 2) + 'relative\\x', false, 'drive-relative resolved against cwd of drive');
await probe('c17-forward-slashes-junction', (root + '/jn/newsub').replace(/\\/g, '/'), false);
await probe('c18-double-sep', root + '\\\\jn\\\\newsub', false);
await probe('c19-dos-device-CON', path.join(root, 'CON'), true, 'device name; not a directory escape');
// 8.3 short name of the junction (if short names are enabled on this volume)
let short = null;
try {
  short = execFileSync('cmd', ['/c', 'for %I in ("' + path.join(root, 'longjunctionname') + '") do @echo %~sI'], { encoding: 'utf8' }).trim();
} catch {}
link(outside, path.join(root, 'longjunctionname'), 'junction');
try {
  short = execFileSync('cmd', ['/c', 'for %I in ("' + path.join(root, 'longjunctionname') + '") do @echo %~sI'], { encoding: 'utf8' }).trim();
} catch {}
await probe('c20-8dot3-of-junction', (short ?? path.join(root, 'LONGJU~1')) + '\\newsub', false, `short=${short}`);

// Unicode case-folding: KELVIN SIGN (U+212A) lowercases to ASCII 'k' in JS, but NTFS treats it as distinct.
const kroot = path.join(R, 'work');
fs.mkdirSync(kroot);
const kelvinSibling = path.join(R, 'wor\u212A');
let kHit, kErr;
try { kHit = await findContainingRoot(path.join(kelvinSibling, 'sub'), [kroot]); } catch (e) { kErr = e.message; }
fs.mkdirSync(path.join(kelvinSibling, 'sub'), { recursive: true });
const distinctOnDisk = fs.readdirSync(R).includes('wor\u212A') && fs.readdirSync(R).includes('work');
const sameInode = (() => { try { return fs.statSync(kroot).ino === fs.statSync(kelvinSibling).ino; } catch { return 'err'; } })();
results.push({ id: 'c21-unicode-kelvin-casefold', root: kroot, candidate: path.join(kelvinSibling, 'sub'), accepted: !!kHit, error: kErr, distinctDirectoriesOnDisk: distinctOnDisk, sameInode, expectAccepted: false, verdict: kHit && distinctOnDisk && sameInode === false ? 'ESCAPE' : 'as-expected' });
console.log(`c21 kelvin: accepted=${!!kHit} distinctOnDisk=${distinctOnDisk} sameInode=${sameInode}`);
// Same attack with the sibling ALREADY existing on disk (realpath returns its own on-disk name)
let kHit2; try { kHit2 = await findContainingRoot(path.join(kelvinSibling, 'sub', 'x'), [kroot]); } catch (e) { kHit2 = 'THROW ' + e.message; }
results.push({ id: 'c22-unicode-kelvin-existing-sibling', accepted: !!kHit2 && !String(kHit2).startsWith('THROW'), expectAccepted: false });
console.log(`c22 kelvin existing sibling: accepted=${kHit2}`);
// Other Unicode: Angstrom sign U+212B -> å ; long-s? (toLowerCase('\u017F') is itself)
const aroot = path.join(R, 'd\u00e5ta'); fs.mkdirSync(aroot);
let aHit; try { aHit = await findContainingRoot(path.join(R, 'd\u212Bta', 'sub'), [aroot]); } catch (e) { aHit = 'THROW'; }
results.push({ id: 'c23-unicode-angstrom-casefold', accepted: !!aHit && aHit !== 'THROW', expectAccepted: false });
console.log(`c23 angstrom: accepted=${aHit}`);
// NFC vs NFD: root 'café' (NFC); candidate 'café' (NFD) - NTFS treats as different names
const nroot = path.join(R, 'caf\u00e9'); fs.mkdirSync(nroot);
let nHit; try { nHit = await findContainingRoot(path.join(R, 'cafe\u0301', 'sub'), [nroot]); } catch (e) { nHit = 'THROW'; }
results.push({ id: 'c24-unicode-nfd-vs-nfc', accepted: !!nHit && nHit !== 'THROW', expectAccepted: false, note: 'NTFS does not normalize; rejection is correct' });
console.log(`c24 nfd: accepted=${nHit}`);

// e. root itself via junction (operator-configured) — root canonicalizes to target; contained paths accepted
link(outside, path.join(R, 'rootlink'), 'junction');
let rl; try { rl = await findContainingRoot(path.join(outside, 'x'), [path.join(R, 'rootlink')]); } catch (e) { rl = 'THROW'; }
results.push({ id: 'e1-root-is-junction', accepted: !!rl, note: 'operator root is a link; target counts as inside (by design)' });

// isPathWithinRoot pure edge cases
const pure = [
  ['C:\\out\\a', 'C:\\out', true], ['C:\\out-evil', 'C:\\out', false], ['C:\\x', 'C:\\', true],
  ['\\\\?\\C:\\out\\a', 'C:\\out', false], ['D:\\out', 'C:\\out', false], ['C:\\out\\..\\x', 'C:\\out', false],
  ['C:\\wor\u212A\\a', 'C:\\work', false], ['C:\\OUT\u0130\\a', 'C:\\outi', false],
];
for (const [c, r, e] of pure) {
  const got = isPathWithinRoot(c, r, 'win32');
  results.push({ id: `pure:${JSON.stringify([c, r])}`, got, expect: e, verdict: got === e ? 'as-expected' : 'UNEXPECTED' });
  console.log(`${got === e ? 'ok ' : '!! '} pure ${JSON.stringify([c, r])} -> ${got} (expect ${e})`);
}

// cleanup: links first, then tree
for (const l of links.reverse()) { try { fs.unlinkSync(l); } catch { try { fs.rmdirSync(l); } catch {} } }
fs.rmSync(R, { recursive: true, force: true });
console.log('cleanup removed:', !fs.existsSync(R));
fs.writeFileSync(process.argv[2], JSON.stringify({ tmpRoot: R, short, results }, null, 2));
