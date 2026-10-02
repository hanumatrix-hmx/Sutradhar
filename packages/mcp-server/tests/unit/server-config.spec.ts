/**
 * @file packages/mcp-server/tests/unit/server-config.spec.ts
 * @description FR2-14: `.sutradhar.json` wiring in createSutradharServer. The precedence rule is
 * proven with a GENERATED matrix: for every setting the MCP server reads, every subset of its
 * layers (option / env var / config file) is presented at once and the constructor options the
 * runtime actually receives must come from the highest-precedence present layer. The oracle is the
 * layer list written here, independent of the resolvers.
 */

const capabilityRuntimeMock = vi.hoisted(() => ({
  SutradharRuntimeMock: vi.fn().mockImplementation(() => ({
    getSessionManager: () => ({}),
    getEventBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }),
  })),
}));
const toolsMock = vi.hoisted(() => ({ registerToolsSpy: vi.fn() }));

vi.mock('@sutradhar/capability-runtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SutradharRuntime: capabilityRuntimeMock.SutradharRuntimeMock,
}));
vi.mock('../../src/tools.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/tools.js')>();
  return {
    ...orig,
    registerTools: (...args: Parameters<typeof orig.registerTools>) => {
      toolsMock.registerToolsSpy(...args);
      return orig.registerTools(...args);
    },
  };
});

import os from 'node:os';
import path from 'node:path';
import { createSutradharServer } from '../../src/server.js';
import {
  DOWNLOAD_ROOTS_ENV,
  UPLOAD_ROOTS_ENV,
  defaultDownloadRoot,
  type LoadedProjectConfig,
  type ProjectConfigFile,
} from '@sutradhar/capability-runtime';

const BASE = path.join(os.tmpdir(), 'fr2-14-mcp-base');
function cfg(values: ProjectConfigFile, resolved: LoadedProjectConfig['resolved'] = {}): LoadedProjectConfig {
  return { path: path.join(BASE, '.sutradhar.json'), baseDir: BASE, origin: 'discovered', values, resolved, warnings: [] };
}
const ENV_KEYS = ['SUTRADHAR_ALLOWED_DOMAINS', 'SUTRADHAR_IDLE_TIMEOUT_MS', DOWNLOAD_ROOTS_ENV, UPLOAD_ROOTS_ENV, 'SUTRADHAR_CONFIG'];
const ctorOptions = (): Record<string, unknown> => capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0]![0];

describe('createSutradharServer + projectConfig', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
    toolsMock.registerToolsSpy.mockClear();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // ── generated matrix ──────────────────────────────────────────────────────
  interface Layer {
    name: 'option' | 'env' | 'config';
    apply: (o: Record<string, unknown>, c: { values: ProjectConfigFile; resolved: LoadedProjectConfig['resolved'] }) => void;
    expected: unknown;
  }
  interface Setting {
    label: string;
    layers: Layer[];
    read: () => unknown;
    fallback: unknown;
  }
  const ENV_DL = path.resolve(os.tmpdir(), 'mcp-env-dl');
  const OPT_DL = path.resolve(os.tmpdir(), 'mcp-opt-dl');
  const CFG_DL = path.join(BASE, 'cfg-dl');
  const settings: Setting[] = [
    {
      label: 'allowedDomains',
      read: () => ctorOptions()['allowedDomains'],
      fallback: undefined,
      layers: [
        { name: 'option', apply: (o) => (o['allowedDomains'] = ['option.test']), expected: ['option.test'] },
        { name: 'env', apply: () => (process.env['SUTRADHAR_ALLOWED_DOMAINS'] = 'env.test'), expected: ['env.test'] },
        { name: 'config', apply: (_o, c) => (c.values.allowedDomains = ['config.test']), expected: ['config.test'] },
      ],
    },
    {
      label: 'idleTimeoutMs',
      read: () => ctorOptions()['idleTimeoutMs'],
      fallback: 30 * 60 * 1000,
      layers: [
        { name: 'option', apply: (o) => (o['idleTimeoutMs'] = 42), expected: 42 },
        { name: 'env', apply: () => (process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = '5000'), expected: 5000 },
        { name: 'config', apply: (_o, c) => (c.values.idleTimeoutMs = 4000), expected: 4000 },
      ],
    },
    {
      label: 'dialogPolicy',
      read: () => ctorOptions()['dialogPolicy'],
      fallback: undefined,
      layers: [
        { name: 'option', apply: (o) => (o['dialogPolicy'] = { mode: 'accept' }), expected: { mode: 'accept' } },
        // no env var exists for dialog: that layer is skipped on purpose (§4.9, no invented env vars)
        { name: 'config', apply: (_o, c) => (c.values.dialog = { mode: 'dismiss' }), expected: { mode: 'dismiss' } },
      ],
    },
    {
      label: 'allowedDownloadRoots',
      read: () => ctorOptions()['allowedDownloadRoots'],
      fallback: [defaultDownloadRoot()],
      layers: [
        { name: 'option', apply: (o) => (o['allowedDownloadRoots'] = [OPT_DL]), expected: [OPT_DL] },
        { name: 'env', apply: () => (process.env[DOWNLOAD_ROOTS_ENV] = ENV_DL), expected: [ENV_DL] },
        { name: 'config', apply: (_o, c) => (c.resolved.allowedDownloadRoots = [CFG_DL]), expected: [CFG_DL] },
      ],
    },
    {
      label: 'allowedUploadRoots',
      read: () => ctorOptions()['allowedUploadRoots'],
      fallback: undefined,
      layers: [
        { name: 'option', apply: (o) => (o['allowedUploadRoots'] = [OPT_DL]), expected: [OPT_DL] },
        { name: 'env', apply: () => (process.env[UPLOAD_ROOTS_ENV] = ENV_DL), expected: [ENV_DL] },
        { name: 'config', apply: (_o, c) => (c.resolved.allowedUploadRoots = [CFG_DL]), expected: [CFG_DL] },
      ],
    },
  ];

  for (const s of settings) {
    it(`matrix: ${s.label} — every subset of ${s.layers.map((l) => l.name).join('/')} resolves to the highest-precedence present layer`, async () => {
      let n = 0;
      for (let mask = 0; mask < 1 << s.layers.length; mask++) {
        for (const k of ENV_KEYS) delete process.env[k];
        capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
        const options: Record<string, unknown> = { disableAgent: true };
        const c = { values: {} as ProjectConfigFile, resolved: {} as LoadedProjectConfig['resolved'] };
        const present = s.layers.filter((_, i) => mask & (1 << i));
        present.forEach((l) => l.apply(options, c));
        await createSutradharServer({ ...options, projectConfig: cfg(c.values, c.resolved) } as never);
        const want = present.length ? present[0]!.expected : s.fallback;
        expect({ setting: s.label, present: present.map((l) => l.name), got: s.read() }).toEqual({
          setting: s.label,
          present: present.map((l) => l.name),
          got: want,
        });
        n++;
      }
      expect(n).toBe(1 << s.layers.length);
    });
  }

  it('viewport: option defaultViewport > config viewport > none (all 4 subsets), seen by registerTools', async () => {
    for (let mask = 0; mask < 4; mask++) {
      toolsMock.registerToolsSpy.mockClear();
      await createSutradharServer({
        disableAgent: true,
        ...(mask & 1 ? { defaultViewport: { width: 11, height: 12 } } : {}),
        projectConfig: mask & 2 ? cfg({ viewport: { width: 700, height: 500 } }) : undefined,
      });
      const got = toolsMock.registerToolsSpy.mock.calls[0]![1].defaultViewport;
      expect({ mask, got }).toEqual({ mask, got: mask & 1 ? { width: 11, height: 12 } : mask & 2 ? { width: 700, height: 500 } : undefined });
    }
  });

  it('MC5: SUTRADHAR_IDLE_TIMEOUT_MS=abc rejects with the variable name and builds no runtime (C2: it used to disable the reaper silently)', async () => {
    for (const bad of ['abc', '-1', '999', '1.5']) {
      capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
      process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = bad;
      await expect(createSutradharServer({ disableAgent: true })).rejects.toThrow(/SUTRADHAR_IDLE_TIMEOUT_MS must be 0/);
      expect(capabilityRuntimeMock.SutradharRuntimeMock).not.toHaveBeenCalled();
    }
  });

  it('MC4b: env 0 beats config 4000 and disables the reaper', async () => {
    process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = '0';
    await createSutradharServer({ disableAgent: true, projectConfig: cfg({ idleTimeoutMs: 4000 }) });
    expect(ctorOptions()['idleTimeoutMs']).toBeUndefined();
  });

  it('MC6: no config and no option leaves dialogPolicy undefined (the runtime default, auto)', async () => {
    await createSutradharServer({ disableAgent: true });
    expect(ctorOptions()['dialogPolicy']).toBeUndefined();
  });

  it('MC6b: config dialog report passes through on MCP with no warning', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await createSutradharServer({ disableAgent: true, projectConfig: cfg({ dialog: { mode: 'report' } }) });
    expect(ctorOptions()['dialogPolicy']).toEqual({ mode: 'report' });
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('MC8: with no projectConfig the constructor options are exactly the pre-FR2-14 ones (same env)', async () => {
    process.env['SUTRADHAR_ALLOWED_DOMAINS'] = 'a.com, b.com';
    process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = '5000';
    await createSutradharServer({ disableAgent: true });
    expect(ctorOptions()).toMatchObject({
      idleTimeoutMs: 5000,
      allowedDomains: ['a.com', 'b.com'],
      allowedDownloadRoots: [defaultDownloadRoot()],
      restrictNavigationToLocal: false,
    });
    expect(ctorOptions()['allowedUploadRoots']).toBeUndefined();
    expect(ctorOptions()['dialogPolicy']).toBeUndefined();
  });

  it('MC8b (D13c): an empty allowedDomains option no longer suppresses the env var', async () => {
    process.env['SUTRADHAR_ALLOWED_DOMAINS'] = 'e.com';
    await createSutradharServer({ disableAgent: true, allowedDomains: [] });
    expect(ctorOptions()['allowedDomains']).toEqual(['e.com']);
  });

  it('MC9: a supplied runtime is left alone (0 constructions, even with a bad env var) but defaultViewport still reaches registerTools', async () => {
    process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = 'abc';
    const supplied = { getSessionManager: () => ({}), getEventBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }) } as never;
    await createSutradharServer({ disableAgent: true, runtime: supplied, projectConfig: cfg({ viewport: { width: 3, height: 4 } }) });
    expect(capabilityRuntimeMock.SutradharRuntimeMock).not.toHaveBeenCalled();
    expect(toolsMock.registerToolsSpy.mock.calls[0]![1].defaultViewport).toEqual({ width: 3, height: 4 });
  });

  it('a config can never override anything set explicitly: with option+env+config all present the config values appear nowhere in the constructor options', async () => {
    process.env['SUTRADHAR_ALLOWED_DOMAINS'] = 'env.test';
    process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = '5000';
    process.env[DOWNLOAD_ROOTS_ENV] = ENV_DL;
    process.env[UPLOAD_ROOTS_ENV] = ENV_DL;
    await createSutradharServer({
      disableAgent: true,
      allowedDomains: ['option.test'],
      dialogPolicy: { mode: 'accept' },
      projectConfig: cfg(
        { allowedDomains: ['config.test'], idleTimeoutMs: 4000, dialog: { mode: 'dismiss' } },
        { allowedDownloadRoots: [CFG_DL], allowedUploadRoots: [CFG_DL] },
      ),
    });
    const text = JSON.stringify(ctorOptions());
    expect(text).not.toContain('config.test');
    expect(text).not.toContain('cfg-dl');
    expect(text).not.toContain('dismiss');
    expect(ctorOptions()).toMatchObject({ allowedDomains: ['option.test'], idleTimeoutMs: 5000, allowedDownloadRoots: [ENV_DL], allowedUploadRoots: [ENV_DL], dialogPolicy: { mode: 'accept' } });
  });
});
