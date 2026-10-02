/**
 * @file packages/capability-runtime/tests/unit/project-config.spec.ts
 * @description FR2-14 unit tests for the `.sutradhar.json` loader: validation, parsing, upward
 * discovery, ownership, SUTRADHAR_CONFIG, relative-path resolution and the hostile-config
 * containment rules (D12). Real fs under a temp dir. Discovery and containment are checked with
 * GENERATED matrices against independent oracles (not hand-picked examples): the FR2-07/FR2-11
 * lesson is that rules tested by one example per bug keep failing audit.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
  statSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { stat as realStat, lstat as realLstat, readFile as realReadFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  PROJECT_CONFIG_EXAMPLE,
  PROJECT_CONFIG_KNOWN_KEYS,
  PROJECT_CONFIG_SCHEMA_ID,
  PROJECT_CONFIG_MAX_BYTES,
  ProjectConfigError,
  parseProjectConfigText,
  validateProjectConfig,
  loadProjectConfig,
  findProjectConfigPath,
  readConfigEnv,
  suggestKey,
  type ConfigFs,
} from '../../src/project-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, '..', '..');
const repoRoot = path.join(pkgDir, '..', '..');

const tmpRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fr2-14-pc-')));
let counter = 0;
const fresh = (): string => {
  const d = path.join(tmpRoot, `c${counter++}`);
  mkdirSync(d, { recursive: true });
  return d;
};
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

const write = (file: string, content: string | object): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
};
const CFG = '.sutradhar.json';

function errOf(fn: () => unknown): ProjectConfigError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProjectConfigError);
    return e as ProjectConfigError;
  }
  throw new Error('expected a ProjectConfigError, nothing thrown');
}
async function errOfAsync(fn: () => Promise<unknown>): Promise<ProjectConfigError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProjectConfigError);
    return e as ProjectConfigError;
  }
  throw new Error('expected a ProjectConfigError, nothing thrown');
}

// ───────────────────────── schema + ajv oracle ─────────────────────────
const schema = JSON.parse(readFileSync(path.join(pkgDir, 'schemas', 'project-config.schema.json'), 'utf-8'));
const mcpRequire = createRequire(path.join(repoRoot, 'packages', 'mcp-server', 'package.json'));
const { AjvJsonSchemaValidator } = mcpRequire('@modelcontextprotocol/sdk/validation/ajv') as {
  AjvJsonSchemaValidator: new () => { getValidator(s: unknown): (x: unknown) => { valid: boolean } };
};
const ajvValidate = new AjvJsonSchemaValidator().getValidator(schema);

/** Removes keys the schema does not declare, at the top level and in dialog/viewport (D5). */
function stripUnknown(x: unknown): unknown {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return x;
  const o = x as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (!(k in schema.properties)) continue;
    const v = o[k];
    if ((k === 'dialog' || k === 'viewport') && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const sub: Record<string, unknown> = {};
      for (const kk of Object.keys(v as object)) {
        if (kk in schema.properties[k].properties) sub[kk] = (v as Record<string, unknown>)[kk];
      }
      out[k] = sub;
    } else out[k] = v;
  }
  return out;
}
const handAccepts = (x: unknown): boolean => {
  try {
    validateProjectConfig(x, 'f');
    return true;
  } catch (e) {
    if (e instanceof ProjectConfigError) return false;
    throw e;
  }
};

describe('validation (V1-V12)', () => {
  it('V1: the example validates unchanged with no warnings', () => {
    const r = validateProjectConfig(PROJECT_CONFIG_EXAMPLE, 'f');
    expect(r.values).toEqual(PROJECT_CONFIG_EXAMPLE);
    expect(r.warnings).toEqual([]);
  });

  it('V2: a wrong type for each key throws a message starting with the key', () => {
    const cases: Array<[string, unknown]> = [
      ['downloadDir', 5],
      ['downloadDir', ''],
      ['allowedUploadRoots', 'x'],
      ['allowedDomains', [1]],
      ['dialog', 'accept'],
      ['viewport', [1, 2]],
    ];
    for (const [k, v] of cases) {
      expect(errOf(() => validateProjectConfig({ [k]: v }, 'f')).message).toMatch(new RegExp(`^Invalid project config f: ${k}`));
    }
  });

  it('V3 (D8): [] for each array key is an error that says to remove the key', () => {
    for (const k of ['allowedDownloadRoots', 'allowedUploadRoots', 'allowedDomains']) {
      const m = errOf(() => validateProjectConfig({ [k]: [] }, 'f')).message;
      expect(m).toContain('at least one');
      expect(m).toContain('remove the key for no restriction');
    }
  });

  it('V4: domains accept bare hostnames and reject every non-bare shape', () => {
    for (const ok of ['example.com', 'a.b.example.co.uk', 'localhost', '127.0.0.1', '[::1]', 'EXAMPLE.com']) {
      expect(handAccepts({ allowedDomains: [ok] })).toBe(true);
    }
    for (const bad of ['https://x.com', 'x.com/p', '*.x.com', 'x.com:8080', '', ' x.com', '.x.com', '-x.com', 'x.com.', 'x..com', 'x com', 'x.com?a=1', 'user@x.com']) {
      expect(handAccepts({ allowedDomains: [bad] })).toBe(false);
    }
    expect(errOf(() => validateProjectConfig({ allowedDomains: ['https://x.com'] }, 'f')).message).toContain('write "x.com"');
  });

  it('V5: dialog rules', () => {
    expect(handAccepts({ dialog: { mode: 'nope' } })).toBe(false);
    expect(errOf(() => validateProjectConfig({ dialog: {} }, 'f')).message).toContain('mode');
    expect(errOf(() => validateProjectConfig({ dialog: { mode: 'dismiss', promptText: 'x' } }, 'f')).message).toBe(
      'Invalid project config f: dialog.promptText only applies with dialog.mode "accept" (it is the text entered into prompt() dialogs)',
    );
    expect(handAccepts({ dialog: { mode: 'accept', promptText: '' } })).toBe(true);
    const r = validateProjectConfig({ dialog: { mode: 'report', foo: 1 } }, 'f');
    expect(r.warnings).toEqual(['f: unknown key "dialog.foo" ignored']);
    expect(r.values.dialog).toEqual({ mode: 'report' });
  });

  it('V6: idleTimeoutMs boundaries', () => {
    for (const ok of [0, 1000, 2147483647]) expect(handAccepts({ idleTimeoutMs: ok })).toBe(true);
    for (const bad of [999, -1, 1.5, '5000', 2147483648, null, NaN]) {
      expect(handAccepts({ idleTimeoutMs: bad })).toBe(false);
    }
    expect(errOf(() => validateProjectConfig({ idleTimeoutMs: 30 }, 'f')).message).toBe(
      'Invalid project config f: idleTimeoutMs must be 0 (never close idle sessions) or an integer number of milliseconds between 1000 and 2147483647; got 30',
    );
  });

  it('V7: viewport rules', () => {
    for (const bad of [{ width: 0, height: 1 }, { width: 1.5, height: 1 }, { width: 1 }, { height: 1 }, {}, { width: '1', height: 1 }]) {
      expect(handAccepts({ viewport: bad })).toBe(false);
    }
    expect(errOf(() => validateProjectConfig({ viewport: { width: 1 } }, 'f')).message).toContain('viewport.height must be a positive integer');
    const r = validateProjectConfig({ viewport: { width: 1, height: 1, depth: 2 } }, 'f');
    expect(r.warnings[0]).toContain('viewport.depth');
  });

  it('V8: unknown keys warn (with a did-you-mean hint) and are dropped', () => {
    const r = validateProjectConfig({ allowedDomian: ['x.com'] }, 'f');
    expect(r.warnings).toEqual(['f: unknown key "allowedDomian" ignored (did you mean "allowedDomains"?)']);
    expect(r.values).toEqual({});
    const z = validateProjectConfig({ zzzzqqq: 1 }, 'f');
    expect(z.warnings).toEqual(['f: unknown key "zzzzqqq" ignored']);
    expect(validateProjectConfig({ AllowedDomains: ['x.com'] }, 'f').warnings[0]).toContain('did you mean "allowedDomains"');
  });

  it('V9: $schema is recognized silently', () => {
    expect(validateProjectConfig({ $schema: 'anything' }, 'f').warnings).toEqual([]);
  });

  it('V10: a __proto__ key can never reach a prototype', () => {
    const data = JSON.parse('{"__proto__":{"polluted":1},"viewport":{"width":2,"height":3}}');
    const r = validateProjectConfig(data, 'f');
    expect(r.warnings.join('\n')).toContain('__proto__');
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(r.values)).toBe(Object.prototype);
    expect(r.values.viewport).toEqual({ width: 2, height: 3 });
  });

  it('V11: a non-object top level is rejected', () => {
    for (const x of [[], null, 'x', 3, true]) {
      expect(errOf(() => validateProjectConfig(x, 'f')).message).toContain('must contain a JSON object');
    }
  });

  it('V12: output keys are always a subset of the known keys', () => {
    const r = validateProjectConfig({ ...PROJECT_CONFIG_EXAMPLE, bogus: 1, __proto__x: 2 }, 'f');
    for (const k of Object.keys(r.values)) expect(PROJECT_CONFIG_KNOWN_KEYS).toContain(k);
  });

  it('every one of the 128 key subsets of the example validates, returns exactly that subset, with no warnings', () => {
    const keys = PROJECT_CONFIG_KNOWN_KEYS.filter((k) => k !== '$schema');
    expect(keys.length).toBe(7);
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const sub: Record<string, unknown> = {};
      keys.forEach((k, i) => {
        if (mask & (1 << i)) sub[k] = (PROJECT_CONFIG_EXAMPLE as Record<string, unknown>)[k];
      });
      const r = validateProjectConfig(sub, 'f');
      expect(r.values).toEqual(sub);
      expect(r.warnings).toEqual([]);
    }
  });

  it('every pair of keys: one invalid value rejects the whole file whichever key it is on (no key is skipped)', () => {
    const keys = PROJECT_CONFIG_KNOWN_KEYS.filter((k) => k !== '$schema');
    const invalid: Record<string, unknown> = {
      downloadDir: 5,
      allowedDownloadRoots: [],
      allowedUploadRoots: [''],
      allowedDomains: [],
      dialog: { mode: 'x' },
      idleTimeoutMs: 1,
      viewport: { width: 0, height: 0 },
    };
    for (const a of keys) {
      for (const b of keys) {
        if (a === b) continue;
        const data = { [a]: (PROJECT_CONFIG_EXAMPLE as Record<string, unknown>)[a], [b]: invalid[b] };
        expect(handAccepts(data)).toBe(false);
      }
    }
  });
});

describe('differential: hand-written validator vs the committed JSON schema (ajv)', () => {
  const zoo: unknown[] = [
    null, true, false, 0, 1, -1, 1.5, 999, 1000, 2147483647, 2147483648, '', 'x', 'example.com', ' x.com', 'https://x.com',
    [], [''], ['x'], ['example.com'], ['*.x.com'], [1], [null], {}, { width: 1, height: 1 }, { width: 0, height: 1 },
    { mode: 'accept' }, { mode: 'accept', promptText: 5 }, { mode: 'dismiss', promptText: 'x' }, { mode: 'accept', promptText: 'x' },
    { mode: 'report' }, { mode: 'auto' }, { mode: 'nope' }, ['a.com', 'b.com'], ['./dl', '../x'], [['x']],
  ];
  it('S5a: 7 keys x the value zoo agree on accept/reject', () => {
    let n = 0;
    for (const key of PROJECT_CONFIG_KNOWN_KEYS) {
      for (const v of zoo) {
        const x = { [key]: v };
        const ajvOk = ajvValidate(stripUnknown(x)).valid;
        expect({ key, v: JSON.stringify(v), hand: handAccepts(x) }).toEqual({ key, v: JSON.stringify(v), hand: ajvOk });
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(35);
  });
  it('S5b: top-level non-objects and nested unknown keys agree too', () => {
    for (const x of [[], null, 'x', 3, { dialog: { mode: 'report', foo: 1 } }, { viewport: { width: 1, height: 1, d: 1 } }, { a: 1 }]) {
      expect(handAccepts(x)).toBe(ajvValidate(stripUnknown(x)).valid);
    }
  });
  it('S5c: ajv rejects every raw entry with an unknown key (the schema is strict for editors; the loader is lenient only here)', () => {
    for (const x of [{ allowedDomian: ['x.com'] }, { dialog: { mode: 'report', foo: 1 } }, { viewport: { width: 1, height: 1, depth: 2 } }]) {
      expect(ajvValidate(x).valid).toBe(false);
    }
  });
});

describe('schema drift guards (S1-S4)', () => {
  it('S1: the schema parses, is draft-07, and carries the documented id', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.$id).toBe(PROJECT_CONFIG_SCHEMA_ID);
  });
  it('S2: schema keys == example keys == known keys', () => {
    const s = Object.keys(schema.properties).sort();
    expect(s).toEqual(Object.keys(PROJECT_CONFIG_EXAMPLE).sort());
    expect(s).toEqual([...PROJECT_CONFIG_KNOWN_KEYS].sort());
  });
  it('S3: nested key sets and required lists match', () => {
    expect(Object.keys(schema.properties.dialog.properties).sort()).toEqual(Object.keys(PROJECT_CONFIG_EXAMPLE.dialog).sort());
    expect(schema.properties.dialog.required).toEqual(['mode']);
    expect(Object.keys(schema.properties.viewport.properties).sort()).toEqual(Object.keys(PROJECT_CONFIG_EXAMPLE.viewport).sort());
    expect(schema.properties.viewport.required).toEqual(['width', 'height']);
  });
  it('S4: ajv accepts the example', () => {
    expect(ajvValidate(PROJECT_CONFIG_EXAMPLE).valid).toBe(true);
  });
});

describe('parse (PR1-PR8)', () => {
  it('PR1: a UTF-8 BOM is stripped', () => {
    expect(parseProjectConfigText('﻿{}', 'f')).toEqual({});
  });
  it('PR2: malformed JSON names the file and says so', () => {
    const m = errOf(() => parseProjectConfigText('{"a":}', '/x/.sutradhar.json')).message;
    expect(m).toContain('/x/.sutradhar.json');
    expect(m).toContain('is not valid JSON');
  });
  it('PR3: over 64 KiB', () => {
    expect(PROJECT_CONFIG_MAX_BYTES).toBe(65536);
    expect(errOf(() => parseProjectConfigText(' '.repeat(65537) + '{}', 'f')).message).toContain('larger than 64 KiB');
    expect(parseProjectConfigText('{}' + ' '.repeat(65534), 'f')).toEqual({});
  });
  it('PR4: empty and whitespace-only', () => {
    for (const t of ['', '  \n', '﻿']) expect(errOf(() => parseProjectConfigText(t, 'f')).message).toContain('is empty');
  });
  it('PR5: comments get a specific hint', () => {
    expect(errOf(() => parseProjectConfigText('// c\n{}', 'f')).message).toContain('comments are not allowed');
    expect(errOf(() => parseProjectConfigText('{/* c */}', 'f')).message).toContain('comments are not allowed');
  });
  it('PR6: duplicate keys are an error at every depth (the last would otherwise silently win)', () => {
    const cases = [
      '{"allowedDomains":["a.com"],"allowedDomains":["b.com"]}',
      '{"viewport":{"width":1,"width":2,"height":3}}',
      '{"unknown":1,"unknown":2}',
      '{"a":{"k":1},"b":{"k":1},"a":2}',
      '{"allowedDomains":["a.com"],"allowed\\u0044omains":[]}',
    ];
    for (const c of cases) expect(errOf(() => parseProjectConfigText(c, 'f')).message).toMatch(/duplicate key/);
    // the same key in DIFFERENT objects, or in sibling array elements, is fine
    expect(parseProjectConfigText('{"a":{"k":1},"b":{"k":1},"c":[{"k":1},{"k":2}]}', 'f')).toBeTruthy();
    // strings that merely look like duplicate keys are fine
    expect(parseProjectConfigText('{"a":"x","b":"a","c":["a","a"]}', 'f')).toBeTruthy();
  });
  it('PR7: error messages never echo file contents (a secret-looking value)', () => {
    // The secret STARTS with the marker: Node's own message quotes ~10 characters of the text around the
    // error, so the marker must sit inside that snippet for an un-redacted message to be caught (mutant U14).
    const SECRET = 'SECRET-sk-live-123';
    const bad = [
      `{"token":"${SECRET}" x}`,
      `{"a": ${SECRET}}`,
      `{"a":1} ${SECRET}`,
      `{"a":"${SECRET}`,
      `${SECRET}`,
      `{"token":"${SECRET}","token":"${SECRET}"}`,
    ];
    for (const t of bad) expect(errOf(() => parseProjectConfigText(t, 'f')).message).not.toContain('SECRET');
  });
  it('PR8: a UTF-16 or NUL-containing file gets an encoding hint', () => {
    expect(errOf(() => parseProjectConfigText('{\u0000}', 'f')).message).toMatch(/UTF-8|NUL/);
  });
});

describe('promptText and unknown-key values are never echoed (secret hygiene)', () => {
  const SECRET = 'hunter2-SECRET-VALUE';
  it('warnings name only the key, errors never include the promptText value', () => {
    const r = validateProjectConfig({ password: SECRET, dialog: { mode: 'accept', promptText: SECRET, extra: SECRET } }, 'f');
    expect(r.warnings.join('\n')).not.toContain(SECRET);
    const e1 = errOf(() => validateProjectConfig({ dialog: { mode: 'dismiss', promptText: SECRET } }, 'f'));
    expect(e1.message).not.toContain(SECRET);
    const e2 = errOf(() => validateProjectConfig({ dialog: { mode: 'accept', promptText: 5, note: SECRET } }, 'f'));
    expect(e2.message).not.toContain(SECRET);
    const e3 = errOf(() => validateProjectConfig({ dialog: { mode: SECRET } }, 'f'));
    expect(e3.message).not.toContain(SECRET);
  });
});

describe('suggestKey', () => {
  it('suggests within distance 2 or case-insensitively, otherwise nothing', () => {
    expect(suggestKey('allowedDomian', PROJECT_CONFIG_KNOWN_KEYS)).toBe('allowedDomains');
    expect(suggestKey('VIEWPORT', PROJECT_CONFIG_KNOWN_KEYS)).toBe('viewport');
    expect(suggestKey('qqqqqqqq', PROJECT_CONFIG_KNOWN_KEYS)).toBeUndefined();
  });
});

describe('discovery: generated matrix vs an independent oracle (D1-D12)', () => {
  /**
   * Level 0 = cwd ... level 4 = the case root, which ALWAYS carries a .git directory so the walk
   * can never leave the case (hermetic). file/git/home are optional extra placements.
   */
  type Plan = { file: number | null; git: number | null; gitAsFile: boolean; home: number | null };
  const oracle = (p: Plan): { found: number | null; stop: 'found' | 'git-root' | 'home'; at: number; checked: number[] } => {
    const checked: number[] = [];
    for (let lvl = 0; lvl <= 4; lvl++) {
      checked.push(lvl);
      if (p.file === lvl) return { found: lvl, stop: 'found', at: lvl, checked };
      if (lvl === 4 || p.git === lvl) return { found: null, stop: 'git-root', at: lvl, checked };
      if (p.home === lvl) return { found: null, stop: 'home', at: lvl, checked };
    }
    throw new Error('unreachable');
  };

  const levels = [null, 0, 1, 2, 3, 4];
  const plans: Plan[] = [];
  for (const file of levels) for (const git of levels) for (const home of levels) for (const gitAsFile of [false, true]) {
    plans.push({ file, git, home, gitAsFile });
  }

  it(`finds the nearest file / stops at git root / stops at home for all ${plans.length} placements`, async () => {
    let i = 0;
    for (const plan of plans) {
      const caseRoot = fresh();
      const dirs: string[] = [];
      for (let lvl = 4; lvl >= 0; lvl--) {
        const d = lvl === 4 ? caseRoot : path.join(dirs[0]!, `l${lvl}`);
        dirs.unshift(d);
        mkdirSync(d, { recursive: true });
      }
      // dirs[lvl] is the directory at that level (0 = deepest)
      const gitAt = (lvl: number): void => {
        if (plan.gitAsFile) write(path.join(dirs[lvl]!, '.git'), 'gitdir: x');
        else mkdirSync(path.join(dirs[lvl]!, '.git'), { recursive: true });
      };
      mkdirSync(path.join(dirs[4]!, '.git'), { recursive: true }); // outer hermetic boundary is always a dir
      if (plan.git !== null && plan.git !== 4) gitAt(plan.git);
      if (plan.file !== null) write(path.join(dirs[plan.file]!, CFG), '{}');
      const home = plan.home === null ? path.join(caseRoot, 'no-such-home') : dirs[plan.home]!;

      const r = await findProjectConfigPath(dirs[0]!, { homedir: home });
      const o = oracle(plan);
      const ctx = JSON.stringify({ plan, o });
      if (o.found !== null) {
        expect({ ctx, path: r.path, stop: r.stoppedAt }).toEqual({ ctx, path: path.join(dirs[o.found]!, CFG), stop: 'found' });
      } else {
        expect({ ctx, path: r.path, stop: r.stoppedAt, dir: r.stopDir }).toEqual({ ctx, path: undefined, stop: o.stop, dir: dirs[o.at] });
      }
      expect(r.searched).toEqual(o.checked.map((l) => path.join(dirs[l]!, CFG)));
      i++;
    }
    expect(i).toBe(plans.length);
  }, 120_000);

  it('D8: a cwd outside the injected home is not stopped by it; a file at a non-root ancestor is found', async () => {
    const root = fresh();
    write(path.join(root, 'a', CFG), '{}');
    mkdirSync(path.join(root, 'a', 'b', 'c'), { recursive: true });
    const r = await findProjectConfigPath(path.join(root, 'a', 'b', 'c'), { homedir: path.join(root, 'elsewhere') });
    expect(r.path).toBe(path.join(root, 'a', CFG));
  });

  it('D9: the filesystem root is never probed, even if a file "exists" there', async () => {
    const fsRoot = path.parse(process.cwd()).root;
    const probed: string[] = [];
    const enoent = (p: string) => Object.assign(new Error('nope'), { code: 'ENOENT', path: p });
    const spyFs: ConfigFs = {
      stat: async (p: string) => {
        probed.push(p);
        if (path.dirname(path.dirname(p)) === path.dirname(p) || path.dirname(p) === fsRoot) {
          return { isFile: () => true, size: 2, uid: 0, mode: 0o100600 };
        }
        throw enoent(p);
      },
      lstat: async (p: string) => {
        throw enoent(p);
      },
      readFile: async () => Buffer.from('{}'),
    };
    const start = path.join(fsRoot, 'zz-fr2-14-a', 'zz-b');
    const r = await findProjectConfigPath(start, { homedir: path.join(fsRoot, 'zz-home'), fs: spyFs });
    expect(r.stoppedAt).toBe('filesystem-root');
    expect(r.path).toBeUndefined();
    expect(probed.every((p) => path.dirname(p) !== fsRoot)).toBe(true);
    expect(probed).toContain(path.join(fsRoot, 'zz-fr2-14-a', CFG));
    // and starting AT the root probes nothing at all
    probed.length = 0;
    const r2 = await findProjectConfigPath(fsRoot, { homedir: path.join(fsRoot, 'zz-home'), fs: spyFs });
    expect(r2.stoppedAt).toBe('filesystem-root');
    expect(probed).toEqual([]);
  });

  it('D10: a directory named .sutradhar.json is an error', async () => {
    const d = fresh();
    mkdirSync(path.join(d, '.git'));
    mkdirSync(path.join(d, CFG));
    const e = await errOfAsync(() => loadProjectConfig({ cwd: d, discover: true, homedir: path.join(d, 'nohome') }));
    expect(e.message).toContain('is not a regular file');
  });

  it('D11: a stat error other than ENOENT/ENOTDIR fails closed with the code', async () => {
    const d = fresh();
    mkdirSync(path.join(d, '.git'));
    const fs: ConfigFs = {
      stat: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
      lstat: realLstat,
      readFile: realReadFile,
    };
    const e = await errOfAsync(() => loadProjectConfig({ cwd: d, discover: true, homedir: path.join(d, 'nohome'), fs }));
    expect(e.message).toContain('cannot be read (EACCES)');
  });

  it('D12: a symlink to a file is followed; a symlink loop and a dangling symlink are errors (never a silent miss)', async () => {
    const d = fresh();
    mkdirSync(path.join(d, '.git'));
    write(path.join(d, 'real.json'), { viewport: { width: 5, height: 6 } });
    let canLink = true;
    try {
      symlinkSync(path.join(d, 'real.json'), path.join(d, CFG), 'file');
    } catch {
      canLink = false;
    }
    if (!canLink) return; // no symlink privilege on this host; recorded as unverified in the evidence
    const ok = await loadProjectConfig({ cwd: d, discover: true, homedir: path.join(d, 'nohome') });
    expect(ok.status === 'loaded' && ok.config.values.viewport).toEqual({ width: 5, height: 6 });
    unlinkSync(path.join(d, CFG));
    symlinkSync(path.join(d, 'gone.json'), path.join(d, CFG), 'file');
    const dangling = await errOfAsync(() => loadProjectConfig({ cwd: d, discover: true, homedir: path.join(d, 'nohome') }));
    expect(dangling.message).toMatch(/broken symbolic link|cannot be read/);
    unlinkSync(path.join(d, CFG));
    symlinkSync(path.join(d, 'loop2.json'), path.join(d, CFG), 'file');
    symlinkSync(path.join(d, CFG), path.join(d, 'loop2.json'), 'file');
    const loop = await errOfAsync(() => loadProjectConfig({ cwd: d, discover: true, homedir: path.join(d, 'nohome') }));
    expect(loop.message).toMatch(/cannot be read|broken symbolic link|not a regular file/);
  });
});

describe('ownership (O1-O5, D12d) with injected stat', () => {
  const setup = (): { d: string; mk: (uid: number, mode: number) => ConfigFs } => {
    const d = fresh();
    mkdirSync(path.join(d, '.git'));
    write(path.join(d, CFG), '{}');
    return {
      d,
      mk: (uid, mode) => ({
        stat: async (p: string) => {
          const s = await realStat(p);
          return { isFile: () => s.isFile(), size: s.size, uid, mode };
        },
        lstat: realLstat,
        readFile: realReadFile,
      }),
    };
  };
  const run = (d: string, fs: ConfigFs, platform: NodeJS.Platform, explicit?: boolean) =>
    loadProjectConfig({
      cwd: d,
      discover: !explicit,
      explicitPath: explicit ? path.join(d, CFG) : undefined,
      explicitOrigin: 'env',
      homedir: path.join(d, 'nohome'),
      platform,
      fs,
      getuid: () => 1000,
    });
  it('O1: another user owns it', async () => {
    const { d, mk } = setup();
    expect((await errOfAsync(() => run(d, mk(1001, 0o100644), 'linux'))).message).toContain('owned by uid 1001');
  });
  it('O2: root-owned is fine; our own is fine', async () => {
    const { d, mk } = setup();
    expect((await run(d, mk(0, 0o100644), 'linux')).status).toBe('loaded');
    expect((await run(d, mk(1000, 0o100600), 'linux')).status).toBe('loaded');
  });
  it('O3: writable by group or others, each bit separately', async () => {
    const { d, mk } = setup();
    for (const mode of [0o100666, 0o100662, 0o100626, 0o100620, 0o100602]) {
      expect((await errOfAsync(() => run(d, mk(1000, mode), 'linux'))).message).toContain('writable by group/others');
    }
  });
  it('O4: win32 has no ownership check (documented residual risk)', async () => {
    const { d, mk } = setup();
    expect((await run(d, mk(1001, 0o100666), 'win32')).status).toBe('loaded');
  });
  it('O5: an explicitly loaded file is trusted like an env var', async () => {
    const { d, mk } = setup();
    expect((await run(d, mk(1001, 0o100666), 'linux', true)).status).toBe('loaded');
  });
});

describe('SUTRADHAR_CONFIG (E1-E6)', () => {
  it('E1/E2: unset, empty, none', () => {
    expect(readConfigEnv({})).toEqual({ kind: 'unset' });
    expect(readConfigEnv({ SUTRADHAR_CONFIG: '' })).toEqual({ kind: 'unset' });
    expect(readConfigEnv({ SUTRADHAR_CONFIG: 'none' })).toEqual({ kind: 'disabled' });
    expect(readConfigEnv({ SUTRADHAR_CONFIG: 'NONE' })).toEqual({ kind: 'disabled' });
  });
  it('E3: a relative path is an error naming the variable', () => {
    const m = errOf(() => readConfigEnv({ SUTRADHAR_CONFIG: 'rel.json' })).message;
    expect(m).toContain('SUTRADHAR_CONFIG');
    expect(m).toContain('absolute');
  });
  it('E4: ~ expands', () => {
    const home = fresh();
    expect(readConfigEnv({ SUTRADHAR_CONFIG: '~/c.json' }, home)).toEqual({ kind: 'path', path: path.join(home, 'c.json') });
  });
  it('E4b: ~user is an error', () => {
    expect(errOf(() => readConfigEnv({ SUTRADHAR_CONFIG: '~bob/c.json' }, '/h')).message).toContain('~user');
  });
  it('E5: a missing explicit file is an error', async () => {
    const d = fresh();
    const e = await errOfAsync(() => loadProjectConfig({ cwd: d, discover: false, explicitPath: path.join(d, 'nope.json'), explicitOrigin: 'env' }));
    expect(e.message).toContain('does not exist');
    expect(e.message).toContain('SUTRADHAR_CONFIG');
    const o = await errOfAsync(() => loadProjectConfig({ cwd: d, discover: false, explicitPath: path.join(d, 'nope.json'), explicitOrigin: 'option' }));
    expect(o.message).toContain('configFile');
  });
  it('E6: an explicit path wins over a nearer discovered file and does no walk', async () => {
    const d = fresh();
    mkdirSync(path.join(d, '.git'));
    write(path.join(d, CFG), { viewport: { width: 1, height: 1 } });
    write(path.join(d, 'other.json'), { viewport: { width: 2, height: 2 } });
    const r = await loadProjectConfig({ cwd: d, discover: true, explicitPath: path.join(d, 'other.json'), explicitOrigin: 'env', homedir: path.join(d, 'nohome') });
    expect(r.status === 'loaded' && r.config.origin).toBe('env');
    expect(r.status === 'loaded' && r.config.values.viewport).toEqual({ width: 2, height: 2 });
    expect(r.status === 'loaded' && r.searched).toEqual([]);
  });
  it('E7: discover:false with no explicit path loads nothing and touches no filesystem', async () => {
    let calls = 0;
    const fs: ConfigFs = {
      stat: async () => (calls++, Promise.reject(new Error('x'))),
      lstat: async () => (calls++, Promise.reject(new Error('x'))),
      readFile: async () => (calls++, Buffer.from('')),
    };
    const r = await loadProjectConfig({ cwd: process.cwd(), discover: false, fs });
    expect(r).toMatchObject({ status: 'none', reason: 'not-requested' });
    expect(calls).toBe(0);
  });
  it('E8: an explicit directory / oversize / non-UTF-8 / UTF-16 file each give a clear error', async () => {
    const d = fresh();
    const load = (p: string) => loadProjectConfig({ cwd: d, discover: false, explicitPath: p, explicitOrigin: 'option' });
    expect((await errOfAsync(() => load(d))).message).toContain('is not a regular file');
    write(path.join(d, 'big.json'), '{}' + ' '.repeat(70000));
    expect((await errOfAsync(() => load(path.join(d, 'big.json')))).message).toContain('larger than 64 KiB');
    writeFileSync(path.join(d, 'bad.json'), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    expect((await errOfAsync(() => load(path.join(d, 'bad.json')))).message).toMatch(/UTF-8|UTF-16/);
    writeFileSync(path.join(d, 'u16.json'), Buffer.from('﻿{}', 'utf16le'));
    expect((await errOfAsync(() => load(path.join(d, 'u16.json')))).message).toContain('UTF-16');
    writeFileSync(path.join(d, 'bom.json'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"viewport":{"width":3,"height":4}}')]));
    const ok = await load(path.join(d, 'bom.json'));
    expect(ok.status === 'loaded' && ok.config.values.viewport).toEqual({ width: 3, height: 4 });
  });
});

describe('path resolution (RP1-RP5, D6/D14)', () => {
  const home = path.join(os.tmpdir(), 'fr2-14-fakehome');
  it('RP1: relative paths resolve against the config file, not the cwd', async () => {
    const X = fresh();
    mkdirSync(path.join(X, '.git'));
    write(path.join(X, CFG), { downloadDir: './dl' });
    mkdirSync(path.join(X, 'a', 'b'), { recursive: true });
    const r = await loadProjectConfig({ cwd: path.join(X, 'a', 'b'), discover: true, homedir: path.join(X, 'nohome') });
    expect(r.status === 'loaded' && r.config.resolved.allowedDownloadRoots).toEqual([path.join(X, 'dl')]);
    expect(r.status === 'loaded' && r.config.baseDir).toBe(X);
  });
  it('RP2/RP3: ~ expands, ~user throws, absolute is unchanged (explicit load)', async () => {
    const X = fresh();
    write(path.join(X, 'c.json'), { allowedUploadRoots: ['~/up', path.join(X, 'abs')] });
    const r = await loadProjectConfig({ cwd: X, discover: false, explicitPath: path.join(X, 'c.json'), explicitOrigin: 'env', homedir: home });
    expect(r.status === 'loaded' && r.config.resolved.allowedUploadRoots).toEqual([path.join(home, 'up'), path.join(X, 'abs')]);
    write(path.join(X, 'u.json'), { allowedUploadRoots: ['~bob/x'] });
    const e = await errOfAsync(() => loadProjectConfig({ cwd: X, discover: false, explicitPath: path.join(X, 'u.json'), explicitOrigin: 'env', homedir: home }));
    expect(e.message).toContain('~user is not supported');
  });
  it('RP4: downloadDir goes first and is de-duplicated against allowedDownloadRoots', async () => {
    const X = fresh();
    write(path.join(X, 'c.json'), { downloadDir: './dl', allowedDownloadRoots: ['./x', './dl', './DL'] });
    const r = await loadProjectConfig({ cwd: X, discover: false, explicitPath: path.join(X, 'c.json'), explicitOrigin: 'env', homedir: home });
    const want = process.platform === 'win32' ? [path.join(X, 'dl'), path.join(X, 'x')] : [path.join(X, 'dl'), path.join(X, 'x'), path.join(X, 'DL')];
    expect(r.status === 'loaded' && r.config.resolved.allowedDownloadRoots).toEqual(want);
  });
  it('RP5: forward slashes are fine', async () => {
    const X = fresh();
    write(path.join(X, 'c.json'), { downloadDir: 'sub/dir' });
    const r = await loadProjectConfig({ cwd: X, discover: false, explicitPath: path.join(X, 'c.json'), explicitOrigin: 'env', homedir: home });
    expect(r.status === 'loaded' && r.config.resolved.allowedDownloadRoots).toEqual([path.join(X, 'sub', 'dir')]);
  });
  it('RP6: a NUL in a path is a clear error, not a crash', async () => {
    const X = fresh();
    write(path.join(X, 'c.json'), { allowedUploadRoots: ['a\u0000b'] });
    const e = await errOfAsync(() => loadProjectConfig({ cwd: X, discover: false, explicitPath: path.join(X, 'c.json'), explicitOrigin: 'env', homedir: home }));
    expect(e.message).toContain('NUL');
  });
});

describe('hostile discovered config: containment (CT1-CT7, D12b)', () => {
  const loadRaw = async (X: string, origin: 'discovered' | 'env') =>
    origin === 'discovered'
      ? loadProjectConfig({ cwd: X, discover: true, homedir: path.join(X, 'nohome') })
      : loadProjectConfig({ cwd: X, discover: false, explicitPath: path.join(X, CFG), explicitOrigin: 'env', homedir: path.join(X, 'nohome') });
  // Since fix-1 (F1) the loader RECORDS the containment refusal (`downloadRefusal`) instead of throwing,
  // because an env var / option outranks the file; `resolveFsRoots` throws it iff the file layer wins.
  // These loader-level cases assert the refusal itself, so surface it as the error it stands for.
  const load = async (X: string, origin: 'discovered' | 'env') => {
    const r = await loadRaw(X, origin);
    if (r.status === 'loaded' && r.config.downloadRefusal !== undefined) throw new ProjectConfigError(r.config.path, r.config.downloadRefusal);
    return r;
  };
  const mkRepo = (cfg: object): string => {
    const X = path.join(fresh(), 'repo');
    mkdirSync(path.join(X, '.git'), { recursive: true });
    write(path.join(X, CFG), cfg);
    return X;
  };

  it('CT1/CT6: an escaping downloadDir fails when discovered (naming both escape hatches) and loads when explicit', async () => {
    const X = mkRepo({ downloadDir: '../out' });
    const e = await errOfAsync(() => load(X, 'discovered'));
    expect(e.message).toContain("outside this config's directory");
    expect(e.message).toContain('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS');
    expect(e.message).toContain('SUTRADHAR_CONFIG=');
    expect(e.message).toContain('downloadDir');
    const ex = await load(X, 'env');
    expect(ex.status === 'loaded' && ex.config.resolved.allowedDownloadRoots).toEqual([path.resolve(X, '..', 'out')]);
  });
  it('CT2: the failing allowedDownloadRoots entry is named by index', async () => {
    const X = mkRepo({ allowedDownloadRoots: ['./ok', os.tmpdir()] });
    expect((await errOfAsync(() => load(X, 'discovered'))).message).toContain('allowedDownloadRoots[1]');
  });
  it('CT3: ./dl and the directory itself are fine', async () => {
    const X = mkRepo({ downloadDir: './dl', allowedDownloadRoots: ['.', './dl/deeper'] });
    expect((await load(X, 'discovered')).status).toBe('loaded');
  });
  it('CT4: anything inside .git is refused (any case), also when it does not exist yet', async () => {
    for (const rel of ['.git/hooks', '.GIT/hooks', './.git', 'a/../.git/x', '.Git']) {
      const X = mkRepo({ downloadDir: rel });
      const e = await errOfAsync(() => load(X, 'discovered'));
      expect(e.message).toContain('inside a .git directory');
    }
  });
  it('CT5: a symlink/junction inside the tree that points outside is refused', async () => {
    const X = mkRepo({ downloadDir: './jn/new' });
    const outside = path.join(path.dirname(X), 'outside-target');
    mkdirSync(outside);
    try {
      symlinkSync(outside, path.join(X, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return; // cannot create links on this host: recorded as unverified
    }
    const e = await errOfAsync(() => load(X, 'discovered'));
    expect(e.message).toContain('outside this config');
    expect((await load(X, 'env')).status).toBe('loaded');
  });
  it('CT5b: a link that points INSIDE the tree is fine', async () => {
    const X = mkRepo({ downloadDir: './jn' });
    mkdirSync(path.join(X, 'real'));
    try {
      symlinkSync(path.join(X, 'real'), path.join(X, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    expect((await load(X, 'discovered')).status).toBe('loaded');
  });
  it('CT5c: a junction pointing at .git inside the tree is refused', async () => {
    const X = mkRepo({ downloadDir: './jn/hooks' });
    try {
      symlinkSync(path.join(X, '.git'), path.join(X, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    expect((await errOfAsync(() => load(X, 'discovered'))).message).toContain('.git');
  });
  it('CT5d: a dangling link is refused (fail closed)', async () => {
    const X = mkRepo({ downloadDir: './jn/new' });
    try {
      symlinkSync(path.join(path.dirname(X), 'does-not-exist'), path.join(X, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    await errOfAsync(() => load(X, 'discovered'));
  });
  it('CT7: allowedUploadRoots and allowedDomains outside the tree are honored (they can only narrow)', async () => {
    const X = mkRepo({ allowedUploadRoots: ['../anything', os.tmpdir()], allowedDomains: ['example.com'] });
    const r = await load(X, 'discovered');
    expect(r.status === 'loaded' && r.config.resolved.allowedUploadRoots).toEqual([path.resolve(X, '..', 'anything'), os.tmpdir()]);
  });
  it('CT8 (win32): trailing dot / space components are refused when discovered (FR2-05 GAP-294 rule)', async () => {
    if (process.platform !== 'win32') return;
    for (const rel of ['dl.', 'dl ', 'a./b']) {
      const X = mkRepo({ downloadDir: rel });
      await errOfAsync(() => load(X, 'discovered'));
    }
  });

  // Property test with an independent LEXICAL oracle: no links exist, so containment is purely
  // a function of the normalized relative path.
  it('CT9: 400 generated relative paths agree with the lexical oracle (inside <=> no leading .., .git <=> any .git segment)', async () => {
    const X = mkRepo({});
    let seed = 0x9e3779b9;
    const rnd = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const segs = ['..', '..', '.', 'a', 'b', '.git', 'sub', 'a.b'];
    for (let n = 0; n < 400; n++) {
      const len = 1 + Math.floor(rnd() * 6);
      const parts = Array.from({ length: len }, () => segs[Math.floor(rnd() * segs.length)]!);
      const rel = parts.join('/');
      const norm = path.posix.normalize(rel);
      const outside = norm === '..' || norm.startsWith('../');
      const hasGit = !outside && norm.split('/').some((s) => s.toLowerCase() === '.git');
      write(path.join(X, CFG), { downloadDir: rel });
      let outcome: string;
      try {
        const r = await load(X, 'discovered');
        outcome = r.status === 'loaded' ? 'ok' : 'none';
      } catch (e) {
        const m = (e as Error).message;
        outcome = m.includes('inside a .git directory') ? 'git' : m.includes('outside this config') ? 'outside' : `other:${m}`;
      }
      const want = outside ? 'outside' : hasGit ? 'git' : 'ok';
      expect({ rel, outcome }).toEqual({ rel, outcome: want });
    }
  }, 120_000);

  it('CT10: a hostile discovered file with EVERY key set cannot produce a download root outside its tree', async () => {
    const X = mkRepo({
      downloadDir: '../../../Startup',
      allowedDownloadRoots: ['~/.ssh'],
      allowedUploadRoots: ['/'],
      allowedDomains: ['x.com'],
      dialog: { mode: 'accept' },
      idleTimeoutMs: 0,
      viewport: { width: 1, height: 1 },
    });
    await errOfAsync(() => load(X, 'discovered'));
    // and with only the safe keys, nothing in `resolved` is a download root at all
    write(path.join(X, CFG), { allowedUploadRoots: ['/'], dialog: { mode: 'accept' }, idleTimeoutMs: 0 });
    const r = await load(X, 'discovered');
    expect(r.status === 'loaded' && r.config.resolved.allowedDownloadRoots).toBeUndefined();
  });
});

describe('loaded config shape', () => {
  it('reports origin discovered, a fresh values object, and warnings', async () => {
    const X = path.join(fresh(), 'repo');
    mkdirSync(path.join(X, '.git'), { recursive: true });
    write(path.join(X, CFG), { allowedDomian: [], viewport: { width: 9, height: 8 } });
    const r = await loadProjectConfig({ cwd: X, discover: true, homedir: path.join(X, 'nohome') });
    if (r.status !== 'loaded') throw new Error('not loaded');
    expect(r.config.origin).toBe('discovered');
    expect(r.config.path).toBe(path.join(X, CFG));
    expect(r.config.warnings[0]).toContain('allowedDomian');
    expect(r.config.values).toEqual({ viewport: { width: 9, height: 8 } });
    expect(statSync(r.config.path).isFile()).toBe(true);
  });
  it('none: not-found reports where the search stopped', async () => {
    const X = path.join(fresh(), 'repo');
    mkdirSync(path.join(X, '.git'), { recursive: true });
    const r = await loadProjectConfig({ cwd: X, discover: true, homedir: path.join(X, 'nohome') });
    expect(r).toMatchObject({ status: 'none', reason: 'not-found', stoppedAt: 'git-root', stopDir: X });
  });
});

// ───────────────────────── FR2-14 fix-1 ─────────────────────────

describe('fix-1 F3/F7: the home boundary holds under links and case (canonical comparison)', () => {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const tryLink = (target: string, at: string): boolean => {
    try {
      symlinkSync(target, at, linkType);
      return true;
    } catch {
      return false; // no link privilege on this host: recorded as unverified in the evidence
    }
  };

  it('F3: a cwd that is a link INSIDE home pointing elsewhere still stops at home (nothing above home is read)', async () => {
    const top = fresh();
    mkdirSync(path.join(top, '.git'), { recursive: true }); // hermetic outer boundary
    write(path.join(top, CFG), { allowedDomains: ['above-home.test'] });
    const home = path.join(top, 'home');
    mkdirSync(home);
    const elsewhere = path.join(fresh(), 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    if (!tryLink(elsewhere, path.join(home, 'link'))) return;
    const r = await findProjectConfigPath(path.join(home, 'link'), { homedir: home });
    expect(r.path).toBeUndefined();
    expect(r.stoppedAt).toBe('home');
    expect(r.stopDir).toBe(home);
    // negative control: a cwd that is NOT in home does walk up to the file
    const r2 = await findProjectConfigPath(path.join(top, 'home'), { homedir: path.join(top, 'other-home') });
    expect(r2.path).toBe(path.join(top, CFG));
  });

  it('A8 killer: a home that is passed THROUGH A LINK is still the boundary (literal equality would walk past it)', async () => {
    const top = fresh();
    mkdirSync(path.join(top, '.git'), { recursive: true });
    write(path.join(top, CFG), { allowedDomains: ['above-home.test'] });
    const realHome = path.join(top, 'real-home');
    mkdirSync(path.join(realHome, 'proj', 'sub'), { recursive: true });
    const homeLink = path.join(top, 'home-link');
    if (!tryLink(realHome, homeLink)) return;
    // homedir given as the LINK, cwd given by its real path (and the reverse): the canonical forms are equal
    for (const [cwd, hd] of [
      [path.join(realHome, 'proj', 'sub'), homeLink],
      [path.join(homeLink, 'proj', 'sub'), realHome],
    ] as const) {
      const r = await findProjectConfigPath(cwd, { homedir: hd });
      expect({ cwd, home: hd, path: r.path, stop: r.stoppedAt }).toEqual({ cwd, home: hd, path: undefined, stop: 'home' });
    }
  });

  it('A8b killer (win32/case-insensitive fs): a home spelled in a different case, or with a trailing separator, is still the boundary', async () => {
    const top = fresh();
    mkdirSync(path.join(top, '.git'), { recursive: true });
    write(path.join(top, CFG), { allowedDomains: ['above-home.test'] });
    const home = path.join(top, 'Home');
    mkdirSync(path.join(home, 'proj'), { recursive: true });
    const variants = [home + path.sep, home + path.sep + '.' + path.sep];
    if (process.platform === 'win32') variants.push(home.toUpperCase(), home.toLowerCase());
    for (const hd of variants) {
      const r = await findProjectConfigPath(path.join(home, 'proj'), { homedir: hd });
      expect({ hd, path: r.path, stop: r.stoppedAt }).toEqual({ hd, path: undefined, stop: 'home' });
    }
  });
});

describe('fix-1 F4: what error messages echo from the file is capped and single-line', () => {
  it('a 20 KB unknown key name is echoed as at most 64 chars plus an ellipsis', () => {
    const w = validateProjectConfig(JSON.parse(`{"${'k'.repeat(20_000)}": 1}`), 'f').warnings.join('\n');
    expect(w.length).toBeLessThan(200);
    expect(w).toContain('...');
  });
  it('control characters in a key name or an echoed value cannot add lines', () => {
    const w = validateProjectConfig({ ['a\nb\u001b[31mc']: 1 }, 'f').warnings.join('');
    expect(w).not.toMatch(/[\u0000-\u001f]/);
    const m = errOf(() => validateProjectConfig({ allowedDomains: ['x\ny'.repeat(40)] }, 'f')).message;
    expect(m).not.toMatch(/[\n\r\u001b]/);
  });
  it('a long allowedDomains entry and idleTimeoutMs string are capped at 64 chars in the message', () => {
    const long = 'sk_live_' + 'S'.repeat(500);
    const m1 = errOf(() => validateProjectConfig({ allowedDomains: [long + '!'] }, 'f')).message;
    expect(m1.includes('S'.repeat(80))).toBe(false);
    expect(m1).toContain('sk_live_');
    const m2 = errOf(() => validateProjectConfig({ idleTimeoutMs: long }, 'f')).message;
    expect(m2.includes('S'.repeat(80))).toBe(false);
  });
  it('a long download entry in the containment refusal is capped (entry 64, resolved path 200)', async () => {
    const X = path.join(fresh(), 'repo');
    mkdirSync(path.join(X, '.git'), { recursive: true });
    write(path.join(X, CFG), { downloadDir: '../' + 'd'.repeat(600) });
    const r = await loadProjectConfig({ cwd: X, discover: true, homedir: path.join(X, 'nohome') });
    const msg = r.status === 'loaded' ? (r.config.downloadRefusal ?? '') : '';
    expect(msg).toContain('outside this config');
    expect(msg.includes('d'.repeat(250))).toBe(false);
  });
});

describe('fix-1 F8: viewport bounds are validated at load', () => {
  it('rejects a width or height above 10,000,000 (and keeps accepting the limit itself)', () => {
    for (const v of [{ width: 1e9, height: 1e9 }, { width: 10_000_001, height: 5 }, { width: 5, height: 10_000_001 }]) {
      expect(errOf(() => validateProjectConfig({ viewport: v }, 'f')).message).toContain('positive integer (at most 10000000)');
    }
    expect(handAccepts({ viewport: { width: 10_000_000, height: 10_000_000 } })).toBe(true);
  });
  it('agrees with the committed JSON schema on the bound (differential)', () => {
    for (const v of [{ width: 1e9, height: 1 }, { width: 10_000_000, height: 1 }, { width: 10_000_001, height: 1 }]) {
      expect({ v, hand: handAccepts({ viewport: v }), schema: ajvValidate({ viewport: v }).valid }).toEqual({
        v,
        hand: ajvValidate({ viewport: v }).valid,
        schema: handAccepts({ viewport: v }),
      });
    }
  });
});
