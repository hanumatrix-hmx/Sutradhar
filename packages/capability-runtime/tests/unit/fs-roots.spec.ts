/**
 * @file packages/capability-runtime/tests/unit/fs-roots.spec.ts
 * @description Unit tests for FR2-05's single root-resolution helper: `parseRootsEnv` (env
 * string parsing) and `resolveFsRoots` (option > env > default precedence).
 */

import path from 'node:path';
import {
  parseRootsEnv,
  resolveFsRoots,
  DOWNLOAD_ROOTS_ENV,
  UPLOAD_ROOTS_ENV,
  defaultDownloadRoot,
} from '../../src/index.js';

describe('@sutradhar/capability-runtime parseRootsEnv', () => {
  it('R1: splits on ";" for win32', () => {
    expect(parseRootsEnv(DOWNLOAD_ROOTS_ENV, 'C:\\a;D:\\b', 'win32').roots).toEqual(['C:\\a', 'D:\\b']);
  });

  it('R2: splits on ":" for linux', () => {
    expect(parseRootsEnv(DOWNLOAD_ROOTS_ENV, '/a:/b', 'linux').roots).toEqual(['/a', '/b']);
  });

  it('R3: trims entries and drops empties', () => {
    expect(parseRootsEnv(DOWNLOAD_ROOTS_ENV, ' /a : :/b ', 'linux').roots).toEqual(['/a', '/b']);
  });

  it('R4: a relative entry throws, naming the var, the entry and "absolute"', () => {
    let error: Error | undefined;
    try {
      parseRootsEnv(DOWNLOAD_ROOTS_ENV, 'out', 'linux');
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeDefined();
    expect(error!.message).toContain(DOWNLOAD_ROOTS_ENV);
    expect(error!.message).toContain('"out"');
    expect(error!.message).toContain('absolute');
  });

  it('R5: tilde expansion', () => {
    expect(parseRootsEnv(DOWNLOAD_ROOTS_ENV, '~', 'linux', '/h').roots).toEqual(['/h']);
    expect(parseRootsEnv(DOWNLOAD_ROOTS_ENV, '~/dl', 'linux', '/h').roots).toEqual(['/h/dl']);
    expect(() => parseRootsEnv(DOWNLOAD_ROOTS_ENV, '~bob/x', 'linux', '/h')).toThrow();
  });

  it('R6: empty, undefined and all-delimiter values all count as unset', () => {
    expect(parseRootsEnv(DOWNLOAD_ROOTS_ENV, '', 'linux').roots).toBeUndefined();
    expect(parseRootsEnv(DOWNLOAD_ROOTS_ENV, undefined, 'linux').roots).toBeUndefined();
    expect(parseRootsEnv(DOWNLOAD_ROOTS_ENV, ';;', 'win32').roots).toBeUndefined();
  });

  it('R7: a comma in an entry warns but keeps the entry as-is', () => {
    const { roots, warnings } = parseRootsEnv(DOWNLOAD_ROOTS_ENV, '/a,/b', 'linux');
    expect(roots).toEqual(['/a,/b']);
    expect(warnings[0]).toContain('":"');
  });
});

describe('@sutradhar/capability-runtime resolveFsRoots', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('R8: precedence — option beats env, env beats default; upload unset is unrestricted', () => {
    // NOTE (FR2-05 deviation from the spec's literal example): `options.allowedDownloadRoots`
    // entries go through plain `path.resolve` (R11 — "today's behavior", unchanged by this
    // item), which resolves against the REAL host platform, not an injected one. On win32
    // `path.resolve('/o')` becomes `<current drive>:\o`, not the literal POSIX string `/o` the
    // spec's example assumed. Asserting against `path.resolve('/o')` keeps this test meaningful
    // (and platform-portable) without weakening what it actually checks: precedence.
    const withOption = resolveFsRoots({
      options: { allowedDownloadRoots: ['/o'] },
      env: { [DOWNLOAD_ROOTS_ENV]: '/e' },
      platform: 'linux',
    });
    expect(withOption.allowedDownloadRoots).toEqual([path.resolve('/o')]);
    expect(withOption.sources.download).toBe('option');

    const envOnly = resolveFsRoots({ env: { [DOWNLOAD_ROOTS_ENV]: '/e' }, platform: 'linux' });
    expect(envOnly.allowedDownloadRoots).toEqual(['/e']);
    expect(envOnly.sources.download).toBe('env');

    const neither = resolveFsRoots({ env: {}, platform: 'linux' });
    expect(neither.allowedDownloadRoots).toEqual([defaultDownloadRoot()]);
    expect(neither.sources.download).toBe('default');
    expect(neither.allowedUploadRoots).toBeUndefined();
    expect(neither.sources.upload).toBe('unrestricted');
  });

  it('R9: an empty options array counts as unset, falling through to env', () => {
    const result = resolveFsRoots({
      options: { allowedDownloadRoots: [] },
      env: { [DOWNLOAD_ROOTS_ENV]: '/e' },
      platform: 'linux',
    });
    expect(result.allowedDownloadRoots).toEqual(['/e']);
  });

  it('R10: omitting the env object entirely skips the env layer, even if process.env has the var', () => {
    process.env[DOWNLOAD_ROOTS_ENV] = '/e';
    const result = resolveFsRoots({ platform: 'linux' });
    expect(result.sources.download).toBe('default');
    expect(result.allowedDownloadRoots).toEqual([defaultDownloadRoot()]);
  });

  it('R11: relative options entries are resolved against process.cwd() (today\'s behavior)', () => {
    const result = resolveFsRoots({ options: { allowedDownloadRoots: ['relative-dir'] }, platform: process.platform });
    expect(result.allowedDownloadRoots).toEqual([path.resolve('relative-dir')]);
  });
});
