/**
 * @file packages/cli/tests/unit/download-roots.spec.ts
 * @description Unit tests for the CLI's pure `download` verb helpers (FR2-05): the per-
 * invocation root grant and the "is this a usable download destination" check.
 */

import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { cliDownloadGrant, assertDownloadDirUsable } from '../../src/download-roots.js';

describe('@sutradhar/cli cliDownloadGrant', () => {
  it('CL1: an explicit relative dir resolves against cwd and is appended to the configured roots', () => {
    const result = cliDownloadGrant(['/c'], './out', '/w');
    expect(result).toEqual({ roots: ['/c', path.resolve('/w', 'out')], downloadDir: path.resolve('/w', 'out') });
  });

  it('CL2: no explicit dir leaves the configured roots untouched and downloadDir undefined', () => {
    const result = cliDownloadGrant(['/c'], undefined, '/w');
    expect(result).toEqual({ roots: ['/c'], downloadDir: undefined });
  });

  it('CL3: the input configured array is never mutated', () => {
    const configured = Object.freeze(['/c']);
    expect(() => cliDownloadGrant(configured, './out', '/w')).not.toThrow();
    expect(configured).toEqual(['/c']);
  });
});

describe('@sutradhar/cli assertDownloadDirUsable', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'sutradhar-cl-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('CL4: rejects an existing file, resolves for a nonexistent path and for an existing directory', async () => {
    const file = path.join(tmp, 'afile');
    await writeFile(file, 'x');
    await expect(assertDownloadDirUsable(file)).rejects.toThrow(/not a directory/);
    await expect(assertDownloadDirUsable(path.join(tmp, 'does-not-exist'))).resolves.toBeUndefined();
    await expect(assertDownloadDirUsable(tmp)).resolves.toBeUndefined();
  });
});
