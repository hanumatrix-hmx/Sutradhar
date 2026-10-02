/**
 * @file packages/capability-runtime/tests/unit/config-precedence.spec.ts
 * @description FR2-14: precedence proofs. The rule is ONE shape-free function (`firstDefined`)
 * and every key resolver is a thin list of layers, so the tests are GENERATED matrices: for every
 * key x every surface, every subset of the layers that surface has (flag/option/env/state/config)
 * is presented at once, and the winner must be the highest-precedence PRESENT layer. That covers
 * every single layer, every pair and the all-three case (config + env + flag together) without
 * hand-picking examples. The oracle is the layer list itself, written down here independently of
 * the resolvers.
 */
import os from 'node:os';
import path from 'node:path';
import {
  firstDefined,
  parseDomainsEnv,
  parseIdleTimeoutMs,
  resolveAllowedDomains,
  resolveIdleTimeoutMs,
  resolveViewport,
  resolveRuntimeDialogPolicy,
  ALLOWED_DOMAINS_ENV,
  IDLE_TIMEOUT_ENV,
  type ValueSource,
} from '../../src/config-precedence.js';
import { resolveFsRoots, DOWNLOAD_ROOTS_ENV, UPLOAD_ROOTS_ENV } from '../../src/fs-roots.js';
import { defaultDownloadRoot } from '@sutradhar/browser';
import type { LoadedProjectConfig, ProjectConfigFile } from '../../src/project-config.js';

const BASE = path.join(os.tmpdir(), 'fr2-14-prec-base');
function cfg(values: ProjectConfigFile, resolved: LoadedProjectConfig['resolved'] = {}): LoadedProjectConfig {
  return { path: path.join(BASE, '.sutradhar.json'), baseDir: BASE, origin: 'discovered', values, resolved, warnings: [] };
}

interface Layer<I> {
  name: ValueSource;
  apply: (inputs: I) => void;
  expected: unknown;
}
/** Every subset of `layers` (listed highest precedence first); the oracle is "first present". */
function runMatrix<I, R extends { source: ValueSource; value: unknown }>(
  label: string,
  layers: Layer<I>[],
  fresh: () => I,
  call: (i: I) => R,
  fallback: { name: ValueSource; expected: unknown },
): number {
  let n = 0;
  for (let mask = 0; mask < 1 << layers.length; mask++) {
    const inputs = fresh();
    const present = layers.filter((_, i) => mask & (1 << i));
    present.forEach((l) => l.apply(inputs));
    const want = present[0] ?? fallback;
    const got = call(inputs);
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

describe('firstDefined (PG1, PG2)', () => {
  it('PG1: for all 8 subsets of {flag, env, config} the highest-precedence present layer wins', () => {
    let n = 0;
    for (let mask = 0; mask < 8; mask++) {
      const layers: Array<readonly [ValueSource, string | undefined]> = [
        ['flag', mask & 1 ? 'F' : undefined],
        ['env', mask & 2 ? 'E' : undefined],
        ['config', mask & 4 ? 'C' : undefined],
      ];
      const r = firstDefined(layers, { value: 'D', source: 'default' });
      const want = mask & 1 ? ['F', 'flag'] : mask & 2 ? ['E', 'env'] : mask & 4 ? ['C', 'config'] : ['D', 'default'];
      expect([r.value, r.source]).toEqual(want);
      n++;
    }
    expect(n).toBe(8);
  });
  it('PG2: an empty array at any layer counts as absent; an empty string / 0 / false are VALUES', () => {
    expect(firstDefined([['flag', []], ['env', ['e']]], { value: ['d'], source: 'default' })).toEqual({ value: ['e'], source: 'env' });
    expect(firstDefined([['flag', [] as string[]], ['env', [] as string[]]], { value: ['d'], source: 'default' })).toEqual({ value: ['d'], source: 'default' });
    expect(firstDefined<unknown>([['flag', 0], ['env', 5]], { value: 9, source: 'default' })).toEqual({ value: 0, source: 'flag' });
    expect(firstDefined<unknown>([['flag', ''], ['env', 'x']], { value: 'd', source: 'default' })).toEqual({ value: '', source: 'flag' });
  });
  it('never merges: the result is exactly the winning layer object', () => {
    const a = { w: 1, h: 2 };
    const r = firstDefined([['flag', a], ['config', { w: 9, h: 9 }]], { value: { w: 0, h: 0 }, source: 'default' });
    expect(r.value).toBe(a);
  });
});

describe('parse helpers', () => {
  it('parseDomainsEnv: comma/trim/filter; empty -> undefined', () => {
    expect(parseDomainsEnv(' a.com , b.com,, ')).toEqual(['a.com', 'b.com']);
    for (const raw of [undefined, '', ' , ', '   ']) expect(parseDomainsEnv(raw)).toBeUndefined();
  });
  it('parseIdleTimeoutMs: strict', () => {
    expect(parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, undefined)).toBeUndefined();
    expect(parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, '')).toBeUndefined();
    expect(parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, '0')).toBe(0);
    expect(parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, '1000')).toBe(1000);
    expect(parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, '2147483647')).toBe(2147483647);
    for (const bad of ['abc', '-1', '999', '1.5', '2147483648', ' ', '1e3', '0x10', '5000ms', '+5000']) {
      expect(() => parseIdleTimeoutMs(IDLE_TIMEOUT_ENV, bad)).toThrow(
        new RegExp(`^${IDLE_TIMEOUT_ENV} must be 0 \\(never close idle sessions\\) or an integer between 1000 and 2147483647 \\(milliseconds\\); got `),
      );
    }
  });
});

describe('PD allowedDomains: matrix over every surface', () => {
  type I = { flag?: string[]; option?: string[]; env?: Record<string, string | undefined>; config?: LoadedProjectConfig };
  const call = (i: I) => resolveAllowedDomains(i);
  const fresh = (): I => ({});
  const flag: Layer<I> = { name: 'flag', apply: (i) => (i.flag = ['flag.test']), expected: ['flag.test'] };
  const option: Layer<I> = { name: 'option', apply: (i) => (i.option = ['option.test']), expected: ['option.test'] };
  const env: Layer<I> = { name: 'env', apply: (i) => (i.env = { [ALLOWED_DOMAINS_ENV]: 'env.test' }), expected: ['env.test'] };
  const config: Layer<I> = { name: 'config', apply: (i) => (i.config = cfg({ allowedDomains: ['config.test'] })), expected: ['config.test'] };
  const none = { name: 'default' as const, expected: undefined };

  it('CLI: flag > env > config > none (8 combinations)', () => {
    expect(runMatrix('domains/cli', [flag, env, config], fresh, call, none)).toBe(8);
  });
  it('MCP: option > env > config > none (8 combinations)', () => {
    expect(runMatrix('domains/mcp', [option, env, config], fresh, call, none)).toBe(8);
  });
  it('SDK: option > config > none (4 combinations; the SDK passes no env)', () => {
    expect(runMatrix('domains/sdk', [option, config], fresh, call, none)).toBe(4);
  });
  it('(e) env " , " counts as unset so the config applies; (f) option [] counts as absent so env applies (D13c)', () => {
    expect(resolveAllowedDomains({ env: { [ALLOWED_DOMAINS_ENV]: ' , ' }, config: cfg({ allowedDomains: ['c.com'] }) })).toEqual({ value: ['c.com'], source: 'config' });
    expect(resolveAllowedDomains({ option: [], env: { [ALLOWED_DOMAINS_ENV]: 'e.com' } })).toEqual({ value: ['e.com'], source: 'env' });
    expect(resolveAllowedDomains({ flag: [], config: cfg({ allowedDomains: ['c.com'] }) })).toEqual({ value: ['c.com'], source: 'config' });
  });
  it('a config can never WIDEN: whenever a higher layer is present the config values are absent from the result', () => {
    const r = resolveAllowedDomains({ flag: ['f.com'], env: { [ALLOWED_DOMAINS_ENV]: 'e.com' }, config: cfg({ allowedDomains: ['a.com', 'b.com', 'c.com'] }) });
    expect(r.value).toEqual(['f.com']);
  });
});

describe('PI idleTimeoutMs: matrix', () => {
  type I = { option?: number; env?: Record<string, string | undefined>; config?: LoadedProjectConfig; fallback: number | undefined };
  const call = (i: I) => resolveIdleTimeoutMs(i);
  const option: Layer<I> = { name: 'option', apply: (i) => (i.option = 42), expected: 42 };
  const env: Layer<I> = { name: 'env', apply: (i) => (i.env = { [IDLE_TIMEOUT_ENV]: '5000' }), expected: 5000 };
  const config: Layer<I> = { name: 'config', apply: (i) => (i.config = cfg({ idleTimeoutMs: 4000 })), expected: 4000 };
  it('MCP: option > env > config > 30 min default (8 combinations)', () => {
    expect(runMatrix('idle/mcp', [option, env, config], () => ({ fallback: 1_800_000 }), call, { name: 'default', expected: 1_800_000 })).toBe(8);
  });
  it('SDK: option > config > nothing (fallback undefined) (4 combinations)', () => {
    expect(runMatrix('idle/sdk', [option, config], () => ({ fallback: undefined }), call, { name: 'default', expected: undefined })).toBe(4);
  });
  it('zero at a layer disables (undefined) and still beats lower layers', () => {
    expect(resolveIdleTimeoutMs({ option: 0, env: { [IDLE_TIMEOUT_ENV]: '5000' }, fallback: 1 })).toEqual({ value: undefined, source: 'option' });
    expect(resolveIdleTimeoutMs({ option: -5, fallback: 1 })).toEqual({ value: undefined, source: 'option' });
    expect(resolveIdleTimeoutMs({ env: { [IDLE_TIMEOUT_ENV]: '0' }, config: cfg({ idleTimeoutMs: 4000 }), fallback: 1 })).toEqual({ value: undefined, source: 'env' });
    expect(resolveIdleTimeoutMs({ config: cfg({ idleTimeoutMs: 0 }), fallback: 1 })).toEqual({ value: undefined, source: 'config' });
  });
  it('an invalid env value throws instead of silently disabling the reaper (C2)', () => {
    for (const bad of ['abc', '-1', '999', '1.5']) {
      expect(() => resolveIdleTimeoutMs({ env: { [IDLE_TIMEOUT_ENV]: bad }, fallback: 1 })).toThrow(new RegExp(IDLE_TIMEOUT_ENV));
    }
    // even when a HIGHER layer would win: a typo is reported, not hidden behind an option
    expect(() => resolveIdleTimeoutMs({ option: 42, env: { [IDLE_TIMEOUT_ENV]: 'abc' }, fallback: 1 })).toThrow(new RegExp(IDLE_TIMEOUT_ENV));
  });
  it('a non-finite programmatic option throws (NaN used to disable the reaper silently)', () => {
    expect(() => resolveIdleTimeoutMs({ option: NaN, fallback: 1 })).toThrow(/idleTimeoutMs/);
    expect(() => resolveIdleTimeoutMs({ option: Infinity, fallback: 1 })).toThrow(/idleTimeoutMs/);
  });
});

describe('PV viewport: matrix', () => {
  type I = { flag?: { width: number; height: number }; state?: { width: number; height: number }; option?: { width: number; height: number }; config?: LoadedProjectConfig };
  const call = (i: I) => resolveViewport(i);
  const L = (name: 'flag' | 'state' | 'option', w: number): Layer<I> => ({ name, apply: (i) => (i[name] = { width: w, height: w + 1 }), expected: { width: w, height: w + 1 } });
  const config: Layer<I> = { name: 'config', apply: (i) => (i.config = cfg({ viewport: { width: 700, height: 500 } })), expected: { width: 700, height: 500 } };
  const none = { name: 'default' as const, expected: undefined };
  it('CLI: flag > state > config > default (8 combinations)', () => {
    expect(runMatrix('viewport/cli', [L('flag', 100), L('state', 200), config], () => ({}), call, none)).toBe(8);
  });
  it('MCP/SDK: option > config > default (4 combinations)', () => {
    expect(runMatrix('viewport/opt', [L('option', 300), config], () => ({}), call, none)).toBe(4);
  });
  it('PV-W: the object is taken whole from one layer, never mixed (width from one, height from another)', () => {
    expect(resolveViewport({ flag: { width: 390, height: 844 }, config: cfg({ viewport: { width: 700, height: 500 } }) }).value).toEqual({ width: 390, height: 844 });
  });
  it('an invalid layer (hand-edited state) is treated as absent, not trusted', () => {
    expect(resolveViewport({ state: { width: 'x' } as never, config: cfg({ viewport: { width: 7, height: 8 } }) })).toEqual({ value: { width: 7, height: 8 }, source: 'config' });
    expect(resolveViewport({ state: { width: 0, height: 5 } })).toEqual({ value: undefined, source: 'default' });
  });
});

describe('PDL runtime dialog policy: matrix and surface mapping (D11)', () => {
  type I = { option?: { mode: 'auto' | 'report' | 'accept' | 'dismiss'; promptText?: string }; config?: LoadedProjectConfig; surface: 'mcp' | 'sdk' };
  const call = (i: I) => {
    const r = resolveRuntimeDialogPolicy(i);
    return { source: r.source, value: r.value };
  };
  const option: Layer<I> = { name: 'option', apply: (i) => (i.option = { mode: 'accept' }), expected: { mode: 'accept' } };
  const config: Layer<I> = { name: 'config', apply: (i) => (i.config = cfg({ dialog: { mode: 'dismiss' } })), expected: { mode: 'dismiss' } };
  it('mcp and sdk: option > config > undefined (runtime default auto)', () => {
    expect(runMatrix('dialog/mcp', [option, config], () => ({ surface: 'mcp' }), call, { name: 'default', expected: undefined })).toBe(4);
    expect(runMatrix('dialog/sdk', [option, config], () => ({ surface: 'sdk' }), call, { name: 'default', expected: undefined })).toBe(4);
  });
  it('PDL: whole value — an option accept does not inherit the config promptText', () => {
    const r = resolveRuntimeDialogPolicy({ option: { mode: 'accept' }, config: cfg({ dialog: { mode: 'accept', promptText: 'x' } }), surface: 'mcp' });
    expect(r.value).toEqual({ mode: 'accept' });
    expect(r.value).not.toHaveProperty('promptText');
  });
  it('mcp honors all four modes from the config with no warning', () => {
    for (const mode of ['auto', 'report', 'accept', 'dismiss'] as const) {
      const r = resolveRuntimeDialogPolicy({ config: cfg({ dialog: { mode } }), surface: 'mcp' });
      expect(r).toEqual({ value: { mode }, source: 'config', warnings: [] });
    }
  });
  it('sdk: config report maps to auto with one warning naming both modes; explicit option report throws', () => {
    const r = resolveRuntimeDialogPolicy({ config: cfg({ dialog: { mode: 'report' } }), surface: 'sdk' });
    expect(r.value).toEqual({ mode: 'auto' });
    expect(r.source).toBe('config');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/report/);
    expect(r.warnings[0]).toMatch(/auto/);
    expect(() => resolveRuntimeDialogPolicy({ option: { mode: 'report' }, surface: 'sdk' })).toThrow(TypeError);
    expect(() => resolveRuntimeDialogPolicy({ option: { mode: 'report' }, surface: 'sdk' })).toThrow(/not supported by the SDK/);
  });
  it('sdk: a config accept+promptText keeps its promptText', () => {
    const r = resolveRuntimeDialogPolicy({ config: cfg({ dialog: { mode: 'accept', promptText: 'yes' } }), surface: 'sdk' });
    expect(r.value).toEqual({ mode: 'accept', promptText: 'yes' });
  });
});

describe('fs roots through resolveFsRoots: matrix (download and upload) and config-relative paths', () => {
  const ENV_DL = path.resolve(os.tmpdir(), 'envdl');
  const OPT_DL = path.resolve(os.tmpdir(), 'optdl');
  const CFG_DL = path.join(BASE, 'cfgdl');
  type I = { options?: { allowedDownloadRoots?: string[]; allowedUploadRoots?: string[] }; env?: Record<string, string | undefined>; config?: { allowedDownloadRoots?: string[]; allowedUploadRoots?: string[]; baseDir: string } };
  const dlCall = (i: I) => {
    const r = resolveFsRoots(i);
    return { source: r.sources.download as ValueSource, value: r.allowedDownloadRoots };
  };
  const ulCall = (i: I) => {
    const r = resolveFsRoots(i);
    return { source: (r.sources.upload === 'unrestricted' ? 'default' : r.sources.upload) as ValueSource, value: r.allowedUploadRoots };
  };
  const optD: Layer<I> = { name: 'option', apply: (i) => (i.options = { allowedDownloadRoots: [OPT_DL] }), expected: [OPT_DL] };
  const envD: Layer<I> = { name: 'env', apply: (i) => (i.env = { [DOWNLOAD_ROOTS_ENV]: ENV_DL }), expected: [ENV_DL] };
  const cfgD: Layer<I> = { name: 'config', apply: (i) => (i.config = { allowedDownloadRoots: [CFG_DL], baseDir: BASE }), expected: [CFG_DL] };
  const optU: Layer<I> = { name: 'option', apply: (i) => (i.options = { allowedUploadRoots: [OPT_DL] }), expected: [OPT_DL] };
  const envU: Layer<I> = { name: 'env', apply: (i) => (i.env = { [UPLOAD_ROOTS_ENV]: ENV_DL }), expected: [ENV_DL] };
  const cfgU: Layer<I> = { name: 'config', apply: (i) => (i.config = { allowedUploadRoots: [CFG_DL], baseDir: BASE }), expected: [CFG_DL] };

  it('download — CLI: env > config > default', () => {
    expect(runMatrix('dl/cli', [envD, cfgD], () => ({}), dlCall, { name: 'default', expected: [defaultDownloadRoot()] })).toBe(4);
  });
  it('download — MCP: option > env > config > default', () => {
    expect(runMatrix('dl/mcp', [optD, envD, cfgD], () => ({}), dlCall, { name: 'default', expected: [defaultDownloadRoot()] })).toBe(8);
  });
  it('download — SDK: option > config > default (no env passed)', () => {
    expect(runMatrix('dl/sdk', [optD, cfgD], () => ({}), dlCall, { name: 'default', expected: [defaultDownloadRoot()] })).toBe(4);
  });
  it('upload — CLI/MCP/SDK analogues; the default is unrestricted (undefined)', () => {
    expect(runMatrix('ul/cli', [envU, cfgU], () => ({}), ulCall, { name: 'default', expected: undefined })).toBe(4);
    expect(runMatrix('ul/mcp', [optU, envU, cfgU], () => ({}), ulCall, { name: 'default', expected: undefined })).toBe(8);
    expect(runMatrix('ul/sdk', [optU, cfgU], () => ({}), ulCall, { name: 'default', expected: undefined })).toBe(4);
  });
  it('FC2: an env download root shadows the config as a whole (downloadDir is not appended)', () => {
    const r = resolveFsRoots({ env: { [DOWNLOAD_ROOTS_ENV]: ENV_DL }, config: { allowedDownloadRoots: [CFG_DL, path.join(BASE, 'x')], baseDir: BASE } });
    expect(r.allowedDownloadRoots).toEqual([ENV_DL]);
  });
  it('FC6: a relative config entry resolves against baseDir, a relative OPTION against cwd (both in one test)', () => {
    const c = resolveFsRoots({ config: { allowedDownloadRoots: ['rel'], baseDir: BASE } });
    const o = resolveFsRoots({ options: { allowedDownloadRoots: ['rel'] } });
    expect(c.allowedDownloadRoots).toEqual([path.join(BASE, 'rel')]);
    expect(o.allowedDownloadRoots).toEqual([path.resolve('rel')]);
    expect(path.join(BASE, 'rel')).not.toBe(path.resolve('rel'));
  });
  it('an empty config array counts as absent (falls to the default)', () => {
    expect(resolveFsRoots({ config: { allowedDownloadRoots: [], allowedUploadRoots: [], baseDir: BASE } }).sources).toEqual({ download: 'default', upload: 'unrestricted' });
  });
});
