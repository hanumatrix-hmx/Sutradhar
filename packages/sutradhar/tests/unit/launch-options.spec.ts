/**
 * @file packages/sutradhar/tests/unit/launch-options.spec.ts
 * @description Unit tests for FR2-05's SDK wiring: `launch()`'s allowedDownloadRoots/
 * allowedUploadRoots pass through `resolveFsRoots` into the constructed `SutradharRuntime`, and
 * the SDK deliberately does NOT read the SUTRADHAR_ALLOWED_* env vars (D5).
 */

import path from 'node:path';

const capabilityRuntimeMock = vi.hoisted(() => ({
  SutradharRuntimeMock: vi.fn().mockImplementation(() => ({
    launch: vi.fn().mockResolvedValue({ hasRealBrowser: true, sessionId: 's' }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@sutradhar/capability-runtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SutradharRuntime: capabilityRuntimeMock.SutradharRuntimeMock,
}));

import { launch } from '../../src/index.js';
import { defaultDownloadRoot } from '@sutradhar/capability-runtime';

describe('sutradhar SDK launch() fs-roots wiring (FR2-05)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('SL1: explicit options are resolved to absolute paths and passed to the runtime constructor', async () => {
    const browser = await launch({ allowedDownloadRoots: ['/d'], allowedUploadRoots: ['/u'] });
    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.allowedDownloadRoots).toEqual([path.resolve('/d')]);
    expect(optionsArg.allowedUploadRoots).toEqual([path.resolve('/u')]);
    await browser.close();
  });

  it('SL2: SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS in the environment is ignored — the SDK does not read env vars', async () => {
    process.env['SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS'] = path.resolve('/should-be-ignored');
    const browser = await launch();
    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.allowedDownloadRoots).toEqual([defaultDownloadRoot()]);
    await browser.close();
  });
});
