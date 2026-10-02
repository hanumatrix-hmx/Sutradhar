/**
 * @file packages/sutradhar/tests/unit/launch-config.spec.ts
 * @description FR2-14: the SDK's project-config wiring. The SDK reads NO config unless asked
 * (`discoverConfig: true` or `configFile`) and never reads SUTRADHAR_* env vars (FR2-05 D5). The
 * precedence rule (option > config file > default) is checked with a generated matrix: every
 * subset of {option, config} for every setting, with a REAL config file on disk.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
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

const tmpRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fr2-14-sdk-')));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));
let n = 0;
function project(cfg: object): string {
  const d = path.join(tmpRoot, `p${n++}`);
  mkdirSync(path.join(d, '.git'), { recursive: true });
  writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify(cfg));
  return d;
}
const ctor = (): Record<string, unknown> => capabilityRuntimeMock.SutradharRuntimeMock.mock.calls.at(-1)![0];
const launchedWith = (): Record<string, unknown> => {
  const inst = capabilityRuntimeMock.SutradharRuntimeMock.mock.results.at(-1)!.value as { launch: ReturnType<typeof vi.fn> };
  return inst.launch.mock.calls[0]![0];
};

describe('sutradhar SDK launch() + .sutradhar.json (FR2-14)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;
  /** process.chdir is unsupported in vitest workers; every product path reads process.cwd(). */
  const cd = (d: string): void => {
    cwdSpy?.mockRestore();
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(d);
  };
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    cwdSpy?.mockRestore();
    cwdSpy = undefined;
    process.env = { ...ORIGINAL_ENV };
    warn.mockRestore();
  });

  it('SC1 (opt-in): a plain launch() reads no config even when one sits in the cwd', async () => {
    const d = project({ allowedDomains: ['c.com'], viewport: { width: 700, height: 500 }, dialog: { mode: 'dismiss' }, idleTimeoutMs: 4000, allowedUploadRoots: ['./u'] });
    cd(d);
    const b = await launch();
    expect(ctor()['allowedDomains']).toBeUndefined();
    expect(ctor()['idleTimeoutMs']).toBeUndefined();
    expect(ctor()['dialogPolicy']).toBeUndefined();
    expect(ctor()['allowedUploadRoots']).toBeUndefined();
    expect(ctor()['allowedDownloadRoots']).toEqual([defaultDownloadRoot()]);
    expect(launchedWith()['launch']).toBeUndefined();
    await b.close();
  });

  it('SC2: discoverConfig finds the file from the cwd and a parent applies to a child directory', async () => {
    const d = project({ allowedDomains: ['c.com'], viewport: { width: 700, height: 500 } });
    const child = path.join(d, 'a', 'b');
    mkdirSync(child, { recursive: true });
    cd(child);
    const b = await launch({ discoverConfig: true });
    expect(ctor()['allowedDomains']).toEqual(['c.com']);
    expect((launchedWith()['launch'] as { viewport: unknown }).viewport).toEqual({ width: 700, height: 500 });
    await b.close();
  });

  it('SC3: options beat the discovered config', async () => {
    const d = project({ allowedDomains: ['c.com'], viewport: { width: 700, height: 500 } });
    cd(d);
    const b = await launch({ discoverConfig: true, allowedDomains: ['o.com'], viewport: { width: 1, height: 2 } });
    expect(ctor()['allowedDomains']).toEqual(['o.com']);
    expect((launchedWith()['launch'] as { viewport: unknown }).viewport).toEqual({ width: 1, height: 2 });
    await b.close();
  });

  it('SC4: configFile is relative to process.cwd() and is loaded explicitly', async () => {
    const d = project({});
    mkdirSync(path.join(d, 'sub'));
    writeFileSync(path.join(d, 'sub', 'cfg.json'), JSON.stringify({ allowedDomains: ['sub.com'] }));
    cd(d);
    const b = await launch({ configFile: 'sub/cfg.json' });
    expect(ctor()['allowedDomains']).toEqual(['sub.com']);
    await b.close();
  });

  it('SC5: configFile and discoverConfig together reject with a TypeError, before any runtime exists', async () => {
    await expect(launch({ configFile: 'x.json', discoverConfig: true })).rejects.toThrow(/either configFile or discoverConfig/);
    await expect(launch({ configFile: 'x.json', discoverConfig: true })).rejects.toBeInstanceOf(TypeError);
    expect(capabilityRuntimeMock.SutradharRuntimeMock).not.toHaveBeenCalled();
  });

  it('SC6: the SDK ignores SUTRADHAR_CONFIG and SUTRADHAR_ALLOWED_DOMAINS (a library does not read ambient env)', async () => {
    const d = project({ allowedDomains: ['c.com'] });
    cd(d);
    process.env['SUTRADHAR_CONFIG'] = 'none';
    process.env['SUTRADHAR_ALLOWED_DOMAINS'] = 'e.com';
    process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = '5000';
    const b = await launch({ discoverConfig: true });
    expect(ctor()['allowedDomains']).toEqual(['c.com']);
    expect(ctor()['idleTimeoutMs']).toBeUndefined();
    await b.close();
  });

  it('SC7: a config dialog "report" maps to auto with one [sutradhar] warning', async () => {
    const d = project({ dialog: { mode: 'report' } });
    cd(d);
    const b = await launch({ discoverConfig: true });
    expect(ctor()['dialogPolicy']).toEqual({ mode: 'auto' });
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.filter((m) => m.startsWith('[sutradhar]') && m.includes('auto'))).toHaveLength(1);
    await b.close();
  });

  it('SC8: an explicit dialogPolicy "report" rejects with a TypeError before any runtime is constructed', async () => {
    await expect(launch({ dialogPolicy: { mode: 'report' } })).rejects.toThrow(/not supported by the SDK/);
    expect(capabilityRuntimeMock.SutradharRuntimeMock).not.toHaveBeenCalled();
  });

  it('SC9: idleTimeoutMs from the config reaches the runtime; with no config it stays undefined (unchanged)', async () => {
    const d = project({ idleTimeoutMs: 4000 });
    cd(d);
    let b = await launch({ discoverConfig: true });
    expect(ctor()['idleTimeoutMs']).toBe(4000);
    await b.close();
    b = await launch();
    expect(ctor()['idleTimeoutMs']).toBeUndefined();
    await b.close();
  });

  it('SC10: a broken config rejects launch() with the loader message and builds no runtime', async () => {
    const d = project({ allowedDomains: [] });
    cd(d);
    await expect(launch({ discoverConfig: true })).rejects.toThrow(/Invalid project config .*allowedDomains must list at least one domain/);
    expect(capabilityRuntimeMock.SutradharRuntimeMock).not.toHaveBeenCalled();
    await expect(launch({ configFile: path.join(d, 'missing.json') })).rejects.toThrow(/does not exist/);
  });

  it('SC11: a hostile discovered config cannot widen the download root; an explicit configFile can (trusted like an option)', async () => {
    const d = project({ downloadDir: '../../escape' });
    cd(d);
    await expect(launch({ discoverConfig: true })).rejects.toThrow(/outside this config's directory/);
    expect(capabilityRuntimeMock.SutradharRuntimeMock).not.toHaveBeenCalled();
    const b = await launch({ configFile: path.join(d, '.sutradhar.json') });
    expect(ctor()['allowedDownloadRoots']).toEqual([path.resolve(d, '../../escape')]);
    await b.close();
  });

  // ── generated matrix: every subset of {option, config} for every setting ──────────────────
  interface S {
    label: string;
    cfg: Record<string, unknown>;
    opt: Record<string, unknown>;
    cfgExpected: unknown;
    optExpected: unknown;
    fallback: unknown;
    read: () => unknown;
  }
  it('matrix: option > config > default for every setting, all 4 subsets each', async () => {
    const OPT = path.resolve(os.tmpdir(), 'sdk-opt');
    const settings = (d: string): S[] => [
      { label: 'allowedDomains', cfg: { allowedDomains: ['config.test'] }, opt: { allowedDomains: ['option.test'] }, cfgExpected: ['config.test'], optExpected: ['option.test'], fallback: undefined, read: () => ctor()['allowedDomains'] },
      { label: 'idleTimeoutMs', cfg: { idleTimeoutMs: 4000 }, opt: { idleTimeoutMs: 42 }, cfgExpected: 4000, optExpected: 42, fallback: undefined, read: () => ctor()['idleTimeoutMs'] },
      { label: 'dialog', cfg: { dialog: { mode: 'dismiss' } }, opt: { dialogPolicy: { mode: 'accept' } }, cfgExpected: { mode: 'dismiss' }, optExpected: { mode: 'accept' }, fallback: undefined, read: () => ctor()['dialogPolicy'] },
      { label: 'viewport', cfg: { viewport: { width: 700, height: 500 } }, opt: { viewport: { width: 1, height: 2 } }, cfgExpected: { width: 700, height: 500 }, optExpected: { width: 1, height: 2 }, fallback: undefined, read: () => (launchedWith()['launch'] as { viewport?: unknown } | undefined)?.viewport },
      { label: 'downloadRoots', cfg: { allowedDownloadRoots: ['./cfgdl'] }, opt: { allowedDownloadRoots: [OPT] }, cfgExpected: [path.join(d, 'cfgdl')], optExpected: [OPT], fallback: [defaultDownloadRoot()], read: () => ctor()['allowedDownloadRoots'] },
      { label: 'uploadRoots', cfg: { allowedUploadRoots: ['./cfgul'] }, opt: { allowedUploadRoots: [OPT] }, cfgExpected: [path.join(d, 'cfgul')], optExpected: [OPT], fallback: undefined, read: () => ctor()['allowedUploadRoots'] },
    ];
    const labels = ['allowedDomains', 'idleTimeoutMs', 'dialog', 'viewport', 'downloadRoots', 'uploadRoots'];
    let runs = 0;
    for (const label of labels) {
      for (let mask = 0; mask < 4; mask++) {
        const d = project({});
        const s = settings(d).find((x) => x.label === label)!;
        const useOpt = (mask & 1) !== 0;
        const useCfg = (mask & 2) !== 0;
        writeFileSync(path.join(d, 'cfg.json'), JSON.stringify(useCfg ? s.cfg : {}));
        cd(d);
        capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
        const b = await launch({ configFile: 'cfg.json', ...(useOpt ? s.opt : {}) });
        const want = useOpt ? s.optExpected : useCfg ? s.cfgExpected : s.fallback;
        expect({ label, useOpt, useCfg, got: s.read() }).toEqual({ label, useOpt, useCfg, got: want });
        await b.close();
        runs++;
      }
    }
    expect(runs).toBe(24);
  });
});

// ───────────────────────── FR2-14 fix-1 ─────────────────────────
describe('fix-1 F1/F2/F9: SDK override matrix over REAL discovered files', () => {
  let cwdSpy: ReturnType<typeof vi.spyOn> | undefined;
  const cd = (d: string): void => {
    cwdSpy?.mockRestore();
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(d);
  };
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    cwdSpy?.mockRestore();
    cwdSpy = undefined;
    warn.mockRestore();
  });
  const OPT = path.resolve(os.tmpdir(), 'sdk-om-opt');

  for (const key of ['downloadDir', 'allowedDownloadRoots'] as const) {
    const files: Record<'ok' | 'outOfTree' | 'hostile', object> =
      key === 'downloadDir'
        ? { ok: { downloadDir: './dl' }, outOfTree: { downloadDir: '../out' }, hostile: { downloadDir: '.git/hooks' } }
        : { ok: { allowedDownloadRoots: ['./dl'] }, outOfTree: { allowedDownloadRoots: ['../out'] }, hostile: { allowedDownloadRoots: ['.git'] } };
    for (const state of ['ok', 'outOfTree', 'hostile'] as const) {
      it(`${key} x file=${state}: the allowedDownloadRoots option beats it; null does not; none refuses a bad file`, async () => {
        const d = project(files[state]);
        cd(d);
        let b = await launch({ discoverConfig: true, allowedDownloadRoots: [OPT] });
        expect(ctor()['allowedDownloadRoots']).toEqual([OPT]);
        await b.close();
        if (state === 'ok') {
          b = await launch({ discoverConfig: true, allowedDownloadRoots: null as unknown as undefined });
          expect(ctor()['allowedDownloadRoots']).toEqual([path.join(d, 'dl')]);
          await b.close();
        } else {
          await expect(launch({ discoverConfig: true, allowedDownloadRoots: null as unknown as undefined })).rejects.toThrow(/allowedDownloadRoots/);
          await expect(launch({ discoverConfig: true })).rejects.toThrow(/outside this config's directory|inside a \.git directory/);
          // an explicit file is trusted like an option
          b = await launch({ configFile: path.join(d, '.sutradhar.json') });
          await b.close();
        }
      });
    }
  }

  it('F2: null options never drop the config layer (allowedDomains, dialogPolicy, idleTimeoutMs, viewport, configFile)', async () => {
    const d = project({ allowedDomains: ['c.test'], dialog: { mode: 'dismiss' }, idleTimeoutMs: 4000, viewport: { width: 5, height: 6 } });
    cd(d);
    const nul = null as unknown as undefined;
    const b = await launch({ discoverConfig: true, configFile: nul, allowedDomains: nul, dialogPolicy: nul, idleTimeoutMs: nul, viewport: nul });
    expect(ctor()['allowedDomains']).toEqual(['c.test']);
    expect(ctor()['dialogPolicy']).toEqual({ mode: 'dismiss' });
    expect(ctor()['idleTimeoutMs']).toBe(4000);
    expect((launchedWith()['launch'] as { viewport: unknown }).viewport).toEqual({ width: 5, height: 6 });
    await b.close();
  });

  it('F9: a DISCOVERED config that auto-accepts dialogs is announced; an explicit file, an option and a non-accept mode are not', async () => {
    const d = project({ dialog: { mode: 'accept' } });
    cd(d);
    const accepts = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('dialog.mode "accept"'));
    let b = await launch({ discoverConfig: true });
    expect(accepts()).toHaveLength(1);
    expect(accepts()[0]).toContain(path.join(d, '.sutradhar.json'));
    await b.close();
    warn.mockClear();
    b = await launch({ configFile: path.join(d, '.sutradhar.json') });
    expect(accepts()).toHaveLength(0);
    await b.close();
    b = await launch({ discoverConfig: true, dialogPolicy: { mode: 'dismiss' } });
    expect(accepts()).toHaveLength(0);
    await b.close();
    const d2 = project({ dialog: { mode: 'dismiss' } });
    cd(d2);
    b = await launch({ discoverConfig: true });
    expect(accepts()).toHaveLength(0);
    await b.close();
  });
});
