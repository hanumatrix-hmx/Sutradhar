/**
 * @file packages/browser/tests/unit/path-containment.spec.ts
 * @description Unit tests for the shared FR2-05 containment helpers: the pure prefix check
 * (`isPathWithinRoot`) and the real-filesystem, symlink/junction-safe helpers
 * (`canonicalizePath`, `findContainingRoot`).
 */

import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import {
  isPathWithinRoot,
  canonicalizePath,
  findContainingRoot,
  defaultDownloadRoot,
  DEFAULT_DOWNLOAD_ROOT_DIRNAME,
} from '../../src/actions/path-containment.js';

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
});
