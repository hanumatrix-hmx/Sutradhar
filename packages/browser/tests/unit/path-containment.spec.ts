/**
 * @file packages/browser/tests/unit/path-containment.spec.ts
 * @description Unit tests for the shared FR2-05 containment helpers: the pure prefix check
 * (`isPathWithinRoot`) and the real-filesystem, symlink/junction-safe helpers
 * (`canonicalizePath`, `findContainingRoot`).
 */

import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  isPathWithinRoot,
  canonicalizePath,
  findContainingRoot,
  defaultDownloadRoot,
  detectCaseSensitivity,
  isRootCaseSensitive,
  DEFAULT_DOWNLOAD_ROOT_DIRNAME,
} from '../../src/actions/path-containment.js';

/** Best-effort: enables NTFS per-directory case sensitivity via `fsutil` (no admin rights
 *  required on modern Windows; this is also how WSL-created directories get it by default).
 *  Returns false (rather than throwing) when unavailable, so GAP-300 tests that need a REAL
 *  case-sensitive directory can skip themselves cleanly on a machine/CI image without it. */
function tryEnableCaseSensitive(dir: string): boolean {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync('fsutil', ['file', 'setCaseSensitiveInfo', dir, 'enable'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

describe('@sutradhar/browser path-containment isPathWithinRoot', () => {
  it('PC1: win32 semantics (platform injected)', () => {
    expect(isPathWithinRoot('C:\\out\\a', 'C:\\out', 'win32')).toBe(true);
    expect(isPathWithinRoot('C:\\out', 'C:\\out', 'win32')).toBe(true);
    expect(isPathWithinRoot('C:\\out-evil', 'C:\\out', 'win32')).toBe(false);
    expect(isPathWithinRoot('C:\\OUT\\a', 'c:\\out', 'win32')).toBe(true);
    expect(isPathWithinRoot('D:\\out\\a', 'C:\\out', 'win32')).toBe(false);
    expect(isPathWithinRoot('C:\\x', 'C:\\', 'win32')).toBe(true);
    expect(isPathWithinRoot('\\\\?\\C:\\out\\a', 'C:\\out', 'win32')).toBe(false);
    expect(isPathWithinRoot('C:\\out\\..foo', 'C:\\out', 'win32')).toBe(true);
    expect(isPathWithinRoot('C:\\x', 'C:\\out', 'win32')).toBe(false);
  });

  it('PC2: posix semantics', () => {
    expect(isPathWithinRoot('/out/a', '/out', 'linux')).toBe(true);
    expect(isPathWithinRoot('/out-evil', '/out', 'linux')).toBe(false);
    expect(isPathWithinRoot('/OUT/a', '/out', 'linux')).toBe(false);
    expect(isPathWithinRoot('/etc', '/', 'linux')).toBe(true);
    expect(isPathWithinRoot('/', '/out', 'linux')).toBe(false);
  });
});

describe('@sutradhar/browser path-containment canonicalizePath/findContainingRoot (real fs)', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'sutradhar-pc-'));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('PC3: a not-yet-created tail is re-appended to the canonicalized existing ancestor', async () => {
    const result = await canonicalizePath(path.join(tmp, 'nope', 'deeper'));
    expect(result).toBe(path.join(realpathSync.native(tmp), 'nope', 'deeper'));
  });

  it('PC4: a link (existing) with a not-yet-created tail resolves through the link, not the literal path', async () => {
    const root = path.join(tmp, 'pc4-root');
    const outside = path.join(tmp, 'pc4-outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, path.join(root, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');

    const result = await canonicalizePath(path.join(root, 'jn', 'newsub'));
    expect(result).toBe(path.join(realpathSync.native(outside), 'newsub'));
  });

  it('PC5: a dangling link rejects with a "broken symlink/junction" message', async () => {
    const root = path.join(tmp, 'pc5-root');
    const target = path.join(tmp, 'pc5-target');
    mkdirSync(root, { recursive: true });
    mkdirSync(target, { recursive: true });
    const linkPath = path.join(root, 'dj');
    symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    rmSync(target, { recursive: true, force: true });

    await expect(canonicalizePath(path.join(root, 'dj', 'sub'))).rejects.toThrow(/broken symlink\/junction/);
  });

  it('PC6: findContainingRoot returns the matching root, undefined when escaped via a link, and skips unresolvable roots', async () => {
    const root = path.join(tmp, 'pc6-root');
    const outside = path.join(tmp, 'pc6-outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, path.join(root, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(findContainingRoot(path.join(root, 'a'), [root])).resolves.toBe(root);
    await expect(findContainingRoot(path.join(root, 'jn', 'x'), [root])).resolves.toBeUndefined();
    await expect(
      findContainingRoot(path.join(root, 'a'), [root + '-missing', root]),
    ).resolves.toBe(root);
  });

  it('PC7: defaultDownloadRoot is <os.tmpdir()>/sutradhar-downloads', () => {
    expect(defaultDownloadRoot()).toBe(path.join(os.tmpdir(), DEFAULT_DOWNLOAD_ROOT_DIRNAME));
  });

  // ── FR2-05 fix-1 (GAP-294, CRITICAL): trailing dot/space component rejection ────────────────
  it('PC8 (GAP-294): a junction component with a trailing dot is rejected outright on win32, even though it does not exist as "jn."', async () => {
    const root = path.join(tmp, 'pc8-root');
    const outside = path.join(tmp, 'pc8-outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, path.join(root, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');

    // "jn." (never created on disk — only "jn" exists) with a not-yet-created tail.
    await expect(canonicalizePath(path.join(root, 'jn.', 'sub'), 'win32')).rejects.toThrow(
      /trailing dot or space/,
    );
    // Trailing space variant.
    await expect(canonicalizePath(path.join(root, 'jn '), 'win32')).rejects.toThrow(
      /trailing dot or space/,
    );
    // Combined: multiple dots, and dot+space.
    await expect(canonicalizePath(path.join(root, 'jn..'), 'win32')).rejects.toThrow(
      /trailing dot or space/,
    );
    await expect(canonicalizePath(path.join(root, 'jn. '), 'win32')).rejects.toThrow(
      /trailing dot or space/,
    );
  });

  it('PC9 (GAP-294): the trick anywhere along the path is rejected, not just the last component', async () => {
    const root = path.join(tmp, 'pc9-root');
    mkdirSync(root, { recursive: true });
    // The trick planted in an EARLIER component than the final one.
    await expect(
      canonicalizePath(path.join(root, 'subdir.', 'jn.', 'sub'), 'win32'),
    ).rejects.toThrow(/trailing dot or space/);
    await expect(canonicalizePath(path.join(root, 'a ', 'b'), 'win32')).rejects.toThrow(
      /trailing dot or space/,
    );
  });

  it('PC10 (GAP-294): findContainingRoot rejects a candidate using the trick, and never approves it', async () => {
    const root = path.join(tmp, 'pc10-root');
    const outside = path.join(tmp, 'pc10-outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, path.join(root, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(
      findContainingRoot(path.join(root, 'jn.', 'sub'), [root], 'win32'),
    ).rejects.toThrow(/trailing dot or space/);
  });

  it('PC11 (GAP-294): a legitimate path with no trailing dot/space component is unaffected', async () => {
    const result = await canonicalizePath(path.join(tmp, 'nope', 'deeper'), 'win32');
    expect(result).toBe(path.join(realpathSync.native(tmp), 'nope', 'deeper'));
    // A literal ".." inside a real (non-dot-segment) name, e.g. "..foo", is not itself a
    // trailing-dot component and must still be allowed (matches PC1's `C:\out\..foo` case).
    await expect(canonicalizePath(path.join(tmp, '..foo'), 'win32')).resolves.toBeTruthy();
  });

  it('PC12 (GAP-294): on POSIX, a literal trailing dot/space component is a real (if unusual) name and is NOT rejected — Windows-only normalization', async () => {
    if (process.platform === 'win32') return; // this behavior can only be exercised on POSIX
    const dir = path.join(tmp, 'pc12-dir. ');
    mkdirSync(dir, { recursive: true });
    await expect(canonicalizePath(path.join(dir, 'x'), 'linux')).resolves.toBeTruthy();
  });

  // ── FR2-05 fix-1 (GAP-295, major): Unicode case-folding bypass ──────────────────────────────
  it('PC13 (GAP-295): isPathWithinRoot no longer folds the Kelvin sign (U+212A) or Angstrom sign (U+212B) onto plain ASCII letters', () => {
    const KELVIN = '\u212A'; // looks like "K", folds to "k" under toLowerCase()
    const ANGSTROM = '\u212B'; // looks like "Å", folds to "å" under toLowerCase()
    expect(isPathWithinRoot(`C:\\wor${KELVIN}\\a`, 'C:\\work', 'win32')).toBe(false);
    expect(isPathWithinRoot(`C:\\${ANGSTROM}bc\\a`, 'C:\\abc', 'win32')).toBe(false);
    // Plain ASCII case differences must still fold normally on win32.
    expect(isPathWithinRoot('C:\\WORK\\a', 'C:\\work', 'win32')).toBe(true);
    expect(isPathWithinRoot('C:\\Work\\A', 'c:\\WORK', 'win32')).toBe(true);
  });

  it('PC13b: residual — a genuine look-alike Unicode ROOT vs a real ASCII candidate is also kept distinct', () => {
    const KELVIN = '\u212A';
    expect(isPathWithinRoot('C:\\work\\a', `C:\\wor${KELVIN}`, 'win32')).toBe(false);
  });

  // ── FR2-05 fix-1 (GAP-298): a root that is itself a symlink/junction ────────────────────────
  it('PC14 (GAP-298): a configured root that is itself a symlink/junction is canonicalized before comparison', async () => {
    const realRoot = path.join(tmp, 'pc14-real-root');
    const rootLink = path.join(tmp, 'pc14-root-link');
    const outside = path.join(tmp, 'pc14-outside');
    mkdirSync(realRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(realRoot, rootLink, process.platform === 'win32' ? 'junction' : 'dir');

    // A candidate genuinely inside the real target, addressed via the root's link spelling,
    // must be accepted.
    await expect(findContainingRoot(path.join(rootLink, 'a', 'b'), [rootLink])).resolves.toBe(
      rootLink,
    );
    // A candidate outside the real target must still be rejected even though the root itself
    // is a link (this exercises B3's root-canonicalization, unguarded before this fix — GAP-298).
    await expect(
      findContainingRoot(path.join(outside, 'x'), [rootLink]),
    ).resolves.toBeUndefined();
  });

  // ── FR2-05 fix-2 (GAP-300, CRITICAL): case-sensitive-directory containment escape ───────────
  describe('GAP-300: case-sensitive directories', () => {
    let csRoot: string;
    let haveRealCaseSensitiveDir = false;

    beforeAll(() => {
      csRoot = mkdtempSync(path.join(os.tmpdir(), 'fr2-05-cs-'));
      haveRealCaseSensitiveDir = tryEnableCaseSensitive(csRoot);
    });

    afterAll(() => {
      rmSync(csRoot, { recursive: true, force: true });
    });

    it('PC15: isPathWithinRoot with an explicit caseSensitive=true never folds ASCII case, on any platform', () => {
      expect(isPathWithinRoot('C:\\OUT\\a', 'C:\\out', 'win32', true)).toBe(false);
      expect(isPathWithinRoot('C:\\out\\a', 'C:\\out', 'win32', true)).toBe(true);
      expect(isPathWithinRoot('/OUT/a', '/out', 'linux', true)).toBe(false);
    });

    it('PC16: isPathWithinRoot with an explicit caseSensitive=false folds ASCII case even on POSIX', () => {
      expect(isPathWithinRoot('/OUT/a', '/out', 'linux', false)).toBe(true);
    });

    it('PC17: detectCaseSensitivity reports true (case-sensitive) for a real fsutil-enabled directory, false for an ordinary one', () => {
      if (!haveRealCaseSensitiveDir) {
        console.warn('PC17 skipped: fsutil setCaseSensitiveInfo unavailable in this environment');
        return;
      }
      return Promise.all([
        expect(detectCaseSensitivity(csRoot, 'win32')).resolves.toBe(true),
        expect(detectCaseSensitivity(os.tmpdir(), 'win32')).resolves.toBe(false),
      ]);
    });

    it('PC18: detectCaseSensitivity is non-win32 case-sensitive by default (POSIX) without touching disk', async () => {
      await expect(detectCaseSensitivity('/does/not/exist', 'linux')).resolves.toBe(true);
    });

    it('PC19 (GAP-300 exact repro shape 1 — NEW look-alike sibling): findContainingRoot rejects a case-different NEW directory inside a real case-sensitive parent', async () => {
      if (!haveRealCaseSensitiveDir) {
        console.warn('PC19 skipped: no real case-sensitive test directory available');
        return;
      }
      const root = path.join(csRoot, 'dlroot');
      mkdirSync(root, { recursive: true });
      // The attacker path never creates `DLROOT` — it doesn't exist yet, matching the live
      // repro (a NEW look-alike folder Chrome would create through `Browser.setDownloadBehavior`).
      const attacker = path.join(csRoot, 'DLROOT', 'sub');
      await expect(findContainingRoot(attacker, [root], 'win32')).resolves.toBeUndefined();
    });

    it('PC20 (GAP-300 exact repro shape 2 — EXISTING look-alike sibling): findContainingRoot rejects a case-different EXISTING directory inside a real case-sensitive parent', async () => {
      if (!haveRealCaseSensitiveDir) {
        console.warn('PC20 skipped: no real case-sensitive test directory available');
        return;
      }
      const root = path.join(csRoot, 'uproot2');
      const lookalike = path.join(csRoot, 'UPROOT2');
      mkdirSync(root, { recursive: true });
      mkdirSync(lookalike, { recursive: true }); // genuinely a DIFFERENT real directory here
      await expect(
        findContainingRoot(path.join(lookalike, 'secret.txt'), [root], 'win32'),
      ).resolves.toBeUndefined();
      // The real, same-case path must still resolve normally.
      await expect(findContainingRoot(path.join(root, 'ok.txt'), [root], 'win32')).resolves.toBe(
        root,
      );
    });

    it('PC21: legitimate ASCII case differences are still allowed under an ORDINARY (case-insensitive) directory', async () => {
      const root = path.join(csRoot, '..', 'fr2-05-cs-ordinary-parent');
      mkdirSync(root, { recursive: true });
      try {
        // No fsutil enable here — this parent is whatever the OS default is (case-insensitive
        // on a stock Windows install). A differently-cased spelling of the SAME directory must
        // still be accepted, or every normal Windows caller would start seeing false rejects.
        const upper = root.toUpperCase();
        if (upper !== root) {
          await expect(findContainingRoot(path.join(upper, 'x'), [root], 'win32')).resolves.toBe(
            root,
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('PC22: isRootCaseSensitive returns true for a root whose deepest existing ancestor cannot be probed (defensive fail-closed default)', async () => {
      await expect(isRootCaseSensitive('/definitely/does/not/exist', 'linux')).resolves.toBe(true);
    });
  });
});
