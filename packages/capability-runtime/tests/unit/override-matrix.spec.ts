/**
 * @file packages/capability-runtime/tests/unit/override-matrix.spec.ts
 * @description FR2-14 fix-1 (F1/F2): a layer ABOVE the config file must always win, and a
 * discovered file's own rule (containment, `.git`) must never block it. Audit-1 found the one path
 * where it did (an out-of-tree `downloadDir` refused even with SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS
 * set), because the refusal was raised at LOAD time, before any layer was known.
 *
 * GENERATED, not hand-picked: for every key x higher layer present (none / env / option / both) x
 * file state (ok / out-of-tree / hostile) x `null`-ness of the option, the winner must be the
 * highest PRESENT layer, using REAL files loaded by the real loader from real temp trees. The
 * oracle is the table below, independent of the resolvers. Malformed files are a separate, documented
 * rule (D7: they fail closed whatever else is set).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ALLOWED_DOMAINS_ENV,
  IDLE_TIMEOUT_ENV,
  resolveAllowedDomains,
  resolveIdleTimeoutMs,
  resolveViewport,
  resolveRuntimeDialogPolicy,
  fsRootsConfigLayer,
} from '../../src/config-precedence.js';
import { resolveFsRoots, DOWNLOAD_ROOTS_ENV, UPLOAD_ROOTS_ENV } from '../../src/fs-roots.js';
import { loadProjectConfig, type LoadedProjectConfig } from '../../src/project-config.js';

const tmpRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fr2-14-om-')));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));
let n = 0;

async function loadFile(content: object): Promise<LoadedProjectConfig> {
  const X = path.join(tmpRoot, `r${n++}`, 'repo');
  mkdirSync(path.join(X, '.git'), { recursive: true });
  writeFileSync(path.join(X, '.sutradhar.json'), JSON.stringify(content));
  const r = await loadProjectConfig({ cwd: X, discover: true, homedir: path.join(X, 'nohome') });
  if (r.status !== 'loaded') throw new Error('expected a loaded config');
  return r.config;
}

type FileState = 'ok' | 'outOfTree' | 'hostile';
const STATES: FileState[] = ['ok', 'outOfTree', 'hostile'];
const ENV_ENV = path.resolve(os.tmpdir(), 'om-env');
const OPT_OPT = path.resolve(os.tmpdir(), 'om-opt');

interface Row {
  key: string;
  files: Record<FileState, object>;
  /** states in which the file's own rule refuses it (a download key only). */
  refused: FileState[];
  /** Higher layers, highest first; `apply` puts the value in the inputs, `expected` is what it must resolve to. */
  higher: Array<{ name: 'option' | 'env'; apply: (i: Inputs) => void; expected: unknown }>;
  /** What the file alone must resolve to, per state (non-refused). */
  fileExpected: (X: string) => Record<FileState, unknown>;
  call: (i: Inputs, cfg: LoadedProjectConfig) => unknown;
  /** The option layer set to `null` (a JS / JSON caller's "not set"): must behave like undefined. */
  nullOption?: (i: Inputs) => void;
}
interface Inputs {
  env: Record<string, string | undefined>;
  option: Record<string, unknown>;
}

const rows: Row[] = [
  {
    key: 'downloadDir',
    files: { ok: { downloadDir: './dl' }, outOfTree: { downloadDir: '../out' }, hostile: { downloadDir: '.git/hooks' } },
    refused: ['outOfTree', 'hostile'],
    higher: [
      { name: 'option', apply: (i) => (i.option['allowedDownloadRoots'] = [OPT_OPT]), expected: [OPT_OPT] },
      { name: 'env', apply: (i) => (i.env[DOWNLOAD_ROOTS_ENV] = ENV_ENV), expected: [ENV_ENV] },
    ],
    fileExpected: (X) => ({ ok: [path.join(X, 'dl')], outOfTree: undefined, hostile: undefined }),
    call: (i, c) =>
      resolveFsRoots({ options: { allowedDownloadRoots: i.option['allowedDownloadRoots'] as string[] | undefined }, env: i.env, config: fsRootsConfigLayer(c) }).allowedDownloadRoots,
    nullOption: (i) => (i.option['allowedDownloadRoots'] = null),
  },
  {
    key: 'allowedDownloadRoots',
    files: {
      ok: { allowedDownloadRoots: ['./dl', './out'] },
      outOfTree: { allowedDownloadRoots: ['./dl', '../out'] },
      hostile: { allowedDownloadRoots: ['./dl', '.git'] },
    },
    refused: ['outOfTree', 'hostile'],
    higher: [
      { name: 'option', apply: (i) => (i.option['allowedDownloadRoots'] = [OPT_OPT]), expected: [OPT_OPT] },
      { name: 'env', apply: (i) => (i.env[DOWNLOAD_ROOTS_ENV] = ENV_ENV), expected: [ENV_ENV] },
    ],
    fileExpected: (X) => ({ ok: [path.join(X, 'dl'), path.join(X, 'out')], outOfTree: undefined, hostile: undefined }),
    call: (i, c) =>
      resolveFsRoots({ options: { allowedDownloadRoots: i.option['allowedDownloadRoots'] as string[] | undefined }, env: i.env, config: fsRootsConfigLayer(c) }).allowedDownloadRoots,
    nullOption: (i) => (i.option['allowedDownloadRoots'] = null),
  },
  {
    key: 'allowedUploadRoots',
    files: {
      ok: { allowedUploadRoots: ['./up'] },
      outOfTree: { allowedUploadRoots: ['../up'] },
      hostile: { allowedUploadRoots: ['/'] },
    },
    refused: [],
    higher: [
      { name: 'option', apply: (i) => (i.option['allowedUploadRoots'] = [OPT_OPT]), expected: [OPT_OPT] },
      { name: 'env', apply: (i) => (i.env[UPLOAD_ROOTS_ENV] = ENV_ENV), expected: [ENV_ENV] },
    ],
    fileExpected: (X) => ({ ok: [path.join(X, 'up')], outOfTree: [path.resolve(X, '..', 'up')], hostile: [path.resolve('/')] }),
    call: (i, c) =>
      resolveFsRoots({ options: { allowedUploadRoots: i.option['allowedUploadRoots'] as string[] | undefined }, env: i.env, config: fsRootsConfigLayer(c) }).allowedUploadRoots,
    nullOption: (i) => (i.option['allowedUploadRoots'] = null),
  },
  {
    key: 'allowedDomains',
    files: { ok: { allowedDomains: ['file.test'] }, outOfTree: { allowedDomains: ['1'] }, hostile: { allowedDomains: ['localhost', 'file.test'] } },
    refused: [],
    higher: [
      { name: 'option', apply: (i) => (i.option['allowedDomains'] = ['opt.test']), expected: ['opt.test'] },
      { name: 'env', apply: (i) => (i.env[ALLOWED_DOMAINS_ENV] = 'env.test'), expected: ['env.test'] },
    ],
    fileExpected: () => ({ ok: ['file.test'], outOfTree: ['1'], hostile: ['localhost', 'file.test'] }),
    call: (i, c) => resolveAllowedDomains({ option: i.option['allowedDomains'] as string[] | undefined, env: i.env, config: c }).value,
    nullOption: (i) => (i.option['allowedDomains'] = null),
  },
  {
    key: 'idleTimeoutMs',
    files: { ok: { idleTimeoutMs: 4000 }, outOfTree: { idleTimeoutMs: 2147483647 }, hostile: { idleTimeoutMs: 0 } },
    refused: [],
    higher: [
      { name: 'option', apply: (i) => (i.option['idleTimeoutMs'] = 7000), expected: 7000 },
      { name: 'env', apply: (i) => (i.env[IDLE_TIMEOUT_ENV] = '5000'), expected: 5000 },
    ],
    fileExpected: () => ({ ok: 4000, outOfTree: 2147483647, hostile: undefined }),
    call: (i, c) => resolveIdleTimeoutMs({ option: i.option['idleTimeoutMs'] as number | undefined, env: i.env, config: c, fallback: 1_800_000 }).value,
    nullOption: (i) => (i.option['idleTimeoutMs'] = null),
  },
  {
    key: 'viewport',
    files: {
      ok: { viewport: { width: 800, height: 600 } },
      outOfTree: { viewport: { width: 1, height: 1 } },
      hostile: { viewport: { width: 10_000_000, height: 10_000_000 } },
    },
    refused: [],
    higher: [{ name: 'option', apply: (i) => (i.option['viewport'] = { width: 401, height: 301 }), expected: { width: 401, height: 301 } }],
    fileExpected: () => ({ ok: { width: 800, height: 600 }, outOfTree: { width: 1, height: 1 }, hostile: { width: 10_000_000, height: 10_000_000 } }),
    call: (i, c) => resolveViewport({ option: i.option['viewport'] as { width: number; height: number } | undefined, config: c }).value,
    nullOption: (i) => (i.option['viewport'] = null),
  },
  {
    key: 'dialog',
    files: {
      ok: { dialog: { mode: 'dismiss' } },
      outOfTree: { dialog: { mode: 'report' } },
      hostile: { dialog: { mode: 'accept', promptText: 'yes' } },
    },
    refused: [],
    higher: [{ name: 'option', apply: (i) => (i.option['dialogPolicy'] = { mode: 'dismiss', promptText: undefined }), expected: { mode: 'dismiss', promptText: undefined } }],
    fileExpected: () => ({ ok: { mode: 'dismiss' }, outOfTree: { mode: 'report' }, hostile: { mode: 'accept', promptText: 'yes' } }),
    call: (i, c) => resolveRuntimeDialogPolicy({ option: i.option['dialogPolicy'] as undefined, config: c, surface: 'mcp' }).value,
    nullOption: (i) => (i.option['dialogPolicy'] = null),
  },
];

describe('FR2-14 fix-1: a layer above the file always wins (generated override matrix)', () => {
  const higherSubsets = (r: Row): Array<typeof r.higher> => {
    const out: Array<typeof r.higher> = [];
    for (let mask = 0; mask < 1 << r.higher.length; mask++) out.push(r.higher.filter((_, i) => mask & (1 << i)));
    return out;
  };

  let total = 0;
  for (const row of rows) {
    for (const state of STATES) {
      it(`${row.key} x file=${state} x every subset of higher layers`, async () => {
        const cfg = await loadFile(row.files[state]);
        const X = cfg.baseDir;
        for (const present of higherSubsets(row)) {
          const i: Inputs = { env: {}, option: {} };
          present.forEach((l) => l.apply(i));
          const label = `${row.key}/${state}/[${present.map((l) => l.name).join('+') || 'none'}]`;
          if (present.length > 0) {
            // A higher layer is present: it wins, and the file's refusal/rule never blocks it.
            expect({ label, got: row.call(i, cfg) }).toEqual({ label, got: present[0]!.expected });
          } else if (row.refused.includes(state)) {
            // The file layer is the effective one: only now is its refusal raised (fail closed).
            expect(() => row.call(i, cfg), label).toThrow(/outside this config's directory|inside a \.git directory/);
          } else {
            expect({ label, got: row.call(i, cfg) }).toEqual({ label, got: row.fileExpected(X)[state] });
          }
          total++;
        }
        // F2: the highest option set to `null` is "not set": the lower layers apply instead.
        if (row.nullOption) {
          for (const present of higherSubsets(row).filter((p) => p.every((l) => l.name !== 'option'))) {
            const i: Inputs = { env: {}, option: {} };
            present.forEach((l) => l.apply(i));
            row.nullOption(i);
            const label = `${row.key}/${state}/null-option+[${present.map((l) => l.name).join('+') || 'none'}]`;
            if (present.length > 0) expect({ label, got: row.call(i, cfg) }).toEqual({ label, got: present[0]!.expected });
            else if (row.refused.includes(state)) expect(() => row.call(i, cfg), label).toThrow();
            else expect({ label, got: row.call(i, cfg) }).toEqual({ label, got: row.fileExpected(X)[state] });
            total++;
          }
        }
      });
    }
  }

  it('the matrix is not vacuous: exactly 108 cells ran (5 keys x 3 file states x (4 layer subsets + 2 null-option rows) + 2 keys x 3 x (2 + 1))', () => {
    expect(total).toBe(108);
  });

  it('F1 repro: an out-of-tree downloadDir + SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS resolves to the env roots, not an error', async () => {
    const cfg = await loadFile({ downloadDir: '../out' });
    expect(cfg.downloadRefusal).toContain('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS');
    const r = resolveFsRoots({ env: { [DOWNLOAD_ROOTS_ENV]: ENV_ENV }, config: fsRootsConfigLayer(cfg) });
    expect(r.allowedDownloadRoots).toEqual([ENV_ENV]);
    expect(r.sources.download).toBe('env');
    expect(() => resolveFsRoots({ env: {}, config: fsRootsConfigLayer(cfg) })).toThrow(/outside this config's directory/);
  });

  it('a malformed file still fails closed whatever is set above it (D7): the loader throws before any layer exists', async () => {
    const X = path.join(tmpRoot, `r${n++}`, 'repo');
    mkdirSync(path.join(X, '.git'), { recursive: true });
    for (const bad of [{ idleTimeoutMs: 'x' }, { viewport: { width: 0, height: 5 } }, { viewport: { width: 1e9, height: 1e9 } }, { allowedDomains: [] }]) {
      writeFileSync(path.join(X, '.sutradhar.json'), JSON.stringify(bad));
      await expect(loadProjectConfig({ cwd: X, discover: true, homedir: path.join(X, 'nohome') })).rejects.toThrow(/Invalid project config/);
    }
  });

  it('explicit zero/false-like values still win over the file (null is the only "unset" besides undefined)', async () => {
    const cfg = await loadFile({ idleTimeoutMs: 4000 });
    expect(resolveIdleTimeoutMs({ option: 0, config: cfg, fallback: 1 }).value).toBeUndefined(); // 0 = disabled, and it WON
    expect(resolveIdleTimeoutMs({ option: 0, config: cfg, fallback: 1 }).source).toBe('option');
    expect(resolveIdleTimeoutMs({ option: null as unknown as undefined, config: cfg, fallback: 1 }).source).toBe('config');
  });
});
