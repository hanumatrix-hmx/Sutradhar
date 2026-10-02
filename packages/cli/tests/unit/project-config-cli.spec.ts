/**
 * @file packages/cli/tests/unit/project-config-cli.spec.ts
 * @description FR2-14: the CLI's pure project-config logic. cli.ts runs main() on import so its
 * wiring is exercised through `resolveCliSettings` (the single function cli.ts calls for every
 * setting) with GENERATED matrices: every subset of the layers the CLI has for a setting
 * (flag / persisted-flag state / env / config) is presented at once, and the winner must be the
 * highest-precedence present layer. The oracle is the layer list written here, not the resolvers.
 */
import os from 'node:os';
import path from 'node:path';
import {
  DOWNLOAD_ROOTS_ENV,
  UPLOAD_ROOTS_ENV,
  ALLOWED_DOMAINS_ENV,
  defaultDownloadRoot,
  ProjectConfigError,
  type ConfigDiscovery,
  type LoadedProjectConfig,
  type ProjectConfigFile,
} from '@sutradhar/capability-runtime';
import {
  cliDialogFromConfig,
  cliTrustNotice,
  formatDoctorConfigLines,
  resolveCliSettings,
  type CliSettingsInput,
} from '../../src/project-config-cli.js';
import { resolveDialogPolicy } from '../../src/dialog-cli.js';
import { parseArgs } from '../../src/parse-args.js';

const BASE = path.join(os.tmpdir(), 'fr2-14-cli-base');
const FILE = path.join(BASE, '.sutradhar.json');
function cfg(values: ProjectConfigFile, resolved: LoadedProjectConfig['resolved'] = {}, origin: LoadedProjectConfig['origin'] = 'discovered', warnings: string[] = []): LoadedProjectConfig {
  return { path: FILE, baseDir: BASE, origin, values, resolved, warnings };
}

interface Layer {
  name: string;
  apply: (i: CliSettingsInput) => void;
  expected: unknown;
}
function runMatrix(label: string, layers: Layer[], read: (i: CliSettingsInput) => { value: unknown; source: string }, fallback: { name: string; expected: unknown }): number {
  let n = 0;
  for (let mask = 0; mask < 1 << layers.length; mask++) {
    const input: CliSettingsInput = { flags: {}, env: {}, state: undefined, config: undefined };
    const present = layers.filter((_, i) => mask & (1 << i));
    present.forEach((l) => l.apply(input));
    const want = present[0] ?? fallback;
    const got = read(input);
    expect({ label, present: present.map((l) => l.name), source: got.source, value: got.value }).toEqual({
      label,
      present: present.map((l) => l.name),
      source: want.name,
      value: want.expected,
    });
    n++;
  }
  return n;
}
const settle = (i: CliSettingsInput) => resolveCliSettings(i);

describe('resolveCliSettings: generated precedence matrices (CLI: flag > persisted flag > env > config > default)', () => {
  const ENV_DL = path.resolve(os.tmpdir(), 'cli-env-dl');
  const CFG_DL = path.join(BASE, 'cfg-dl');

  it('allowedDomains: flag > env > config > none (8 subsets) — env is the NEW D13b layer', () => {
    const layers: Layer[] = [
      { name: 'flag', apply: (i) => (i.flags.allowlistDomains = ['flag.test']), expected: ['flag.test'] },
      { name: 'env', apply: (i) => (i.env[ALLOWED_DOMAINS_ENV] = 'env.test'), expected: ['env.test'] },
      { name: 'config', apply: (i) => (i.config = cfg({ allowedDomains: ['config.test'] })), expected: ['config.test'] },
    ];
    expect(runMatrix('domains', layers, (i) => settle(i).allowedDomains, { name: 'default', expected: undefined })).toBe(8);
  });

  it('download roots: env > config > default (4 subsets)', () => {
    const layers: Layer[] = [
      { name: 'env', apply: (i) => (i.env[DOWNLOAD_ROOTS_ENV] = ENV_DL), expected: [ENV_DL] },
      { name: 'config', apply: (i) => (i.config = cfg({}, { allowedDownloadRoots: [CFG_DL] })), expected: [CFG_DL] },
    ];
    expect(
      runMatrix('download', layers, (i) => ({ value: settle(i).fsRoots.allowedDownloadRoots, source: settle(i).fsRoots.sources.download }), {
        name: 'default',
        expected: [defaultDownloadRoot()],
      }),
    ).toBe(4);
  });

  it('upload roots: env > config > unrestricted (4 subsets)', () => {
    const layers: Layer[] = [
      { name: 'env', apply: (i) => (i.env[UPLOAD_ROOTS_ENV] = ENV_DL), expected: [ENV_DL] },
      { name: 'config', apply: (i) => (i.config = cfg({}, { allowedUploadRoots: [CFG_DL] })), expected: [CFG_DL] },
    ];
    expect(
      runMatrix('upload', layers, (i) => {
        const r = settle(i).fsRoots;
        return { value: r.allowedUploadRoots, source: r.sources.upload === 'unrestricted' ? 'default' : r.sources.upload };
      }, { name: 'default', expected: undefined }),
    ).toBe(4);
  });

  it('viewport: flag > persisted state > config > default (8 subsets); whole object only', () => {
    const layers: Layer[] = [
      { name: 'flag', apply: (i) => (i.flags.viewport = { width: 100, height: 101 }), expected: { width: 100, height: 101 } },
      { name: 'state', apply: (i) => (i.state = { ...i.state, viewport: { width: 200, height: 201 } }), expected: { width: 200, height: 201 } },
      { name: 'config', apply: (i) => (i.config = cfg({ viewport: { width: 700, height: 500 } })), expected: { width: 700, height: 500 } },
    ];
    expect(runMatrix('viewport', layers, (i) => settle(i).viewport, { name: 'default', expected: undefined })).toBe(8);
  });

  it('dialog (config report): flag > persisted state > config > default report (8 subsets)', () => {
    const layers: Layer[] = [
      { name: 'flag', apply: (i) => (i.flags.dialog = 'accept'), expected: { mode: 'accept', promptText: undefined } },
      { name: 'state', apply: (i) => (i.state = { ...i.state, dialogPolicy: { action: 'dismiss', setAt: 't' } }), expected: { mode: 'dismiss', promptText: undefined } },
      { name: 'config', apply: (i) => (i.config = cfg({ dialog: { mode: 'accept', promptText: 'C' } })), expected: { mode: 'accept', promptText: 'C' } },
    ];
    expect(
      runMatrix('dialog', layers, (i) => ({ value: settle(i).dialog.policy, source: settle(i).dialog.source }), {
        name: 'default',
        expected: { mode: 'report' },
      }),
    ).toBe(8);
  });

  it('dialog persistence: only a FLAG ever asks to persist; state/config/default never do (D10: config never leaks into state.json)', () => {
    const base: CliSettingsInput = { flags: {}, env: {}, state: undefined, config: cfg({ dialog: { mode: 'accept' } }) };
    expect(settle(base).dialog.persist).toBe('keep');
    expect(settle({ ...base, flags: { dialog: 'report' } }).dialog.persist).toBe('set');
    expect(settle({ ...base, flags: { dialog: 'accept' } }).dialog.persist).toBe('set');
    expect(settle({ ...base, state: { dialogPolicy: { action: 'dismiss', setAt: 't' } } }).dialog.persist).toBe('keep');
  });

  it('every layer present at once (flag + state + env + config): flag wins everywhere; no config value leaks', () => {
    const r = settle({
      flags: { allowlistDomains: ['flag.test'], viewport: { width: 1, height: 2 }, dialog: 'dismiss' },
      env: { [ALLOWED_DOMAINS_ENV]: 'env.test', [DOWNLOAD_ROOTS_ENV]: ENV_DL, [UPLOAD_ROOTS_ENV]: ENV_DL },
      state: { viewport: { width: 3, height: 4 }, dialogPolicy: { action: 'accept', setAt: 't' } },
      config: cfg({ allowedDomains: ['config.test'], viewport: { width: 5, height: 6 }, dialog: { mode: 'accept', promptText: 'C' } }, { allowedDownloadRoots: [CFG_DL], allowedUploadRoots: [CFG_DL] }),
    });
    const text = JSON.stringify(r);
    expect(text).not.toContain('config.test');
    expect(text).not.toContain('cfg-dl');
    expect(r.allowedDomains.value).toEqual(['flag.test']);
    expect(r.viewport.value).toEqual({ width: 1, height: 2 });
    expect(r.dialog.policy).toEqual({ mode: 'dismiss', promptText: undefined });
    expect(r.fsRoots.allowedDownloadRoots).toEqual([ENV_DL]);
  });

  it('a malformed env roots value throws (fail closed) even when a config is present', () => {
    expect(() => settle({ flags: {}, env: { [DOWNLOAD_ROOTS_ENV]: 'relative/path' }, config: cfg({}, { allowedDownloadRoots: [CFG_DL] }) })).toThrow(/absolute/);
  });
});

describe('CC1: cliDialogFromConfig', () => {
  it('auto maps to report with the exact warning; accept/dismiss pass through; none -> undefined', () => {
    const r = cliDialogFromConfig(cfg({ dialog: { mode: 'auto' } }));
    expect(r.policy).toEqual({ mode: 'report' });
    expect(r.warnings).toEqual([`${FILE}: dialog.mode "auto" is not supported by the CLI (each command is a separate process); using "report"`]);
    expect(cliDialogFromConfig(cfg({ dialog: { mode: 'accept', promptText: 'x' } }))).toEqual({ policy: { mode: 'accept', promptText: 'x' }, warnings: [] });
    expect(cliDialogFromConfig(cfg({ dialog: { mode: 'dismiss' } }))).toEqual({ policy: { mode: 'dismiss' }, warnings: [] });
    expect(cliDialogFromConfig(cfg({ dialog: { mode: 'report' } }))).toEqual({ policy: { mode: 'report' }, warnings: [] });
    expect(cliDialogFromConfig(cfg({}))).toEqual({ policy: undefined, warnings: [] });
    expect(cliDialogFromConfig(undefined)).toEqual({ policy: undefined, warnings: [] });
  });
});

describe('CC2: cliTrustNotice (D12c)', () => {
  const d = cfg({});
  it('discovered + download from config -> the exact note', () => {
    expect(cliTrustNotice(d, { downloadSource: 'config', dialogSource: 'default', dialogMode: 'report' })).toBe(
      `Note: using downloadDir/allowedDownloadRoots from project config ${FILE}. Set SUTRADHAR_CONFIG=none to ignore it.`,
    );
  });
  it('dialog accept from config is also named, joined with ", "', () => {
    expect(cliTrustNotice(d, { downloadSource: 'config', dialogSource: 'config', dialogMode: 'accept' })).toBe(
      `Note: using downloadDir/allowedDownloadRoots, dialog.mode "accept" from project config ${FILE}. Set SUTRADHAR_CONFIG=none to ignore it.`,
    );
    expect(cliTrustNotice(d, { downloadSource: 'default', dialogSource: 'config', dialogMode: 'accept' })).toBe(
      `Note: using dialog.mode "accept" from project config ${FILE}. Set SUTRADHAR_CONFIG=none to ignore it.`,
    );
  });
  it('no note for an explicit file, for non-config sources, or for a dismiss/report config dialog', () => {
    expect(cliTrustNotice(cfg({}, {}, 'env'), { downloadSource: 'config', dialogSource: 'config', dialogMode: 'accept' })).toBeUndefined();
    expect(cliTrustNotice(d, { downloadSource: 'env', dialogSource: 'flag', dialogMode: 'accept' })).toBeUndefined();
    expect(cliTrustNotice(d, { downloadSource: 'default', dialogSource: 'config', dialogMode: 'dismiss' })).toBeUndefined();
    expect(cliTrustNotice(undefined, { downloadSource: 'config', dialogSource: 'config', dialogMode: 'accept' })).toBeUndefined();
  });
});

describe('CC3: formatDoctorConfigLines', () => {
  const sources = { allowedDomains: 'config', downloadRoots: 'config', uploadRoots: 'unrestricted', dialog: 'default', viewport: 'default' };
  const srcLine = 'Config sources:  allowedDomains=config, downloadRoots=config, uploadRoots=unrestricted, dialog=default, viewport=default';
  it('the 5 Config: forms, exact', () => {
    const cwd = path.join(BASE, 'a', 'b');
    const loadedD: ConfigDiscovery = { status: 'loaded', config: cfg({}), searched: [] };
    expect(formatDoctorConfigLines({ discovery: loadedD, cwd, sources })[0]).toBe(`Config:          ${FILE} (discovered)`);
    const loadedE: ConfigDiscovery = { status: 'loaded', config: cfg({}, {}, 'env'), searched: [] };
    expect(formatDoctorConfigLines({ discovery: loadedE, cwd, sources })[0]).toBe(`Config:          ${FILE} (SUTRADHAR_CONFIG)`);
    const none: ConfigDiscovery = { status: 'none', reason: 'not-found', searched: [FILE, FILE], stoppedAt: 'git-root', stopDir: BASE };
    expect(formatDoctorConfigLines({ discovery: none, cwd, sources })[0]).toBe(`Config:          none (searched 2 directories upward from ${cwd}; stopped at git root ${BASE})`);
    const none2: ConfigDiscovery = { status: 'none', reason: 'not-found', searched: [FILE], stoppedAt: 'filesystem-root' };
    expect(formatDoctorConfigLines({ discovery: none2, cwd, sources })[0]).toBe(`Config:          none (searched 1 directories upward from ${cwd}; stopped at filesystem root)`);
    expect(formatDoctorConfigLines({ discovery: { status: 'none', reason: 'disabled', searched: [] }, cwd, sources })[0]).toBe('Config:          disabled (SUTRADHAR_CONFIG=none)');
    expect(formatDoctorConfigLines({ error: new ProjectConfigError(FILE, 'Invalid project config x: nope'), cwd })).toEqual(['Config:          INVALID: Invalid project config x: nope']);
  });
  it('warnings are one line each, then the sources line in the exact key order', () => {
    const d: ConfigDiscovery = { status: 'loaded', config: cfg({}, {}, 'discovered', ['w1', 'w2']), searched: [] };
    expect(formatDoctorConfigLines({ discovery: d, cwd: BASE, sources })).toEqual([`Config:          ${FILE} (discovered)`, 'Config warning:  w1', 'Config warning:  w2', srcLine]);
  });
  it('nothing in the output echoes a value from the file', () => {
    const d: ConfigDiscovery = { status: 'loaded', config: cfg({ dialog: { mode: 'accept', promptText: 'hunter2-SECRET' } }), searched: [] };
    expect(formatDoctorConfigLines({ discovery: d, cwd: BASE, sources }).join('\n')).not.toContain('hunter2-SECRET');
  });
});

describe('dialog policy: 4-level CLI precedence (DC1, DC2)', () => {
  it('DC1: flag > state > config > report, with persist only for flags', () => {
    expect(resolveDialogPolicy('dismiss', undefined, { dialogPolicy: { action: 'accept', setAt: 'x' } }, { mode: 'accept' })).toEqual({ policy: { mode: 'dismiss', promptText: undefined }, persist: 'set' });
    expect(resolveDialogPolicy(undefined, undefined, { dialogPolicy: { action: 'accept', setAt: 'x' } }, { mode: 'dismiss' })).toEqual({ policy: { mode: 'accept', promptText: undefined }, persist: 'keep' });
    expect(resolveDialogPolicy(undefined, undefined, undefined, { mode: 'dismiss' })).toEqual({ policy: { mode: 'dismiss' }, persist: 'keep' });
    expect(resolveDialogPolicy(undefined, undefined, {}, undefined)).toEqual({ policy: { mode: 'report' }, persist: 'keep' });
  });
  it('DC2 (the P1 regression): --dialog report persists, and then BEATS a config accept on later no-flag commands', () => {
    const first = resolveDialogPolicy('report', undefined, { dialogPolicy: { action: 'accept', setAt: 'x' } }, { mode: 'accept' });
    expect(first).toEqual({ policy: { mode: 'report' }, persist: 'set' });
    // what cli.ts persists for persist:'set'
    const persisted = { dialogPolicy: { action: first.policy.mode as 'report', setAt: 't' } };
    expect(resolveDialogPolicy(undefined, undefined, persisted, { mode: 'accept' })).toEqual({ policy: { mode: 'report', promptText: undefined }, persist: 'keep' });
  });
  it('a flag accept does not inherit the config promptText (whole value, D9)', () => {
    const r = resolveDialogPolicy('accept', undefined, undefined, { mode: 'accept', promptText: 'C' });
    expect(r.policy).toEqual({ mode: 'accept', promptText: undefined });
  });
});

describe('--allowlist-domains given but empty must not silently mean "unrestricted"', () => {
  it('parseArgs reports a flag that was given but yields no domains', () => {
    for (const raw of ['', ' ', ',', ' , ,']) {
      const r = parseArgs(['nav', 'http://x', '--allowlist-domains', raw]);
      expect(r.allowlistDomainsFlag).toBeUndefined();
      expect(r.allowlistDomainsGivenButEmpty).toBe(true);
    }
    expect(parseArgs(['nav', 'http://x']).allowlistDomainsGivenButEmpty).toBe(false);
    expect(parseArgs(['nav', 'http://x', '--allowlist-domains', 'a.com']).allowlistDomainsGivenButEmpty).toBe(false);
    expect(parseArgs(['nav', 'http://x', '--allowlist-domains']).allowlistDomainsGivenButEmpty).toBe(true);
  });
});
