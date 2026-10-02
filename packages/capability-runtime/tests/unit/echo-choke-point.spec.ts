/**
 * @file packages/capability-runtime/tests/unit/echo-choke-point.spec.ts
 * @description FR2-14 fix-2 (N1): every message built from project-config FILE contents goes
 * through ONE choke point (`echo.ts`: capped at 64 chars, 200 for a path; single line; control, NUL
 * and bidi characters replaced). Fix-1 capped the message paths that were SEEN; audit-2 found the
 * next one (`~user` in the toAbs catch: 20,335 chars, 3 raw lines). So this suite is property-based
 * in two ways, so that a new message path cannot escape unnoticed:
 *
 *  1. GENERATED hostile corpus x EVERY key x many value shapes, run through the real loader (real
 *     files, discovered and explicit): every error, warning and refusal it produces must be capped
 *     and single-line, measured by an oracle that knows nothing about echo.ts (it counts runs of
 *     marker characters that exist nowhere in the static message text).
 *  2. A SOURCE-LEVEL guard: every `${...}` interpolation in project-config.ts (and in
 *     resolveConfigPath) must be on a reviewed list of safe expressions; a new interpolation of
 *     file-derived text fails the suite until it is routed through the choke point AND reviewed.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig, PROJECT_CONFIG_KNOWN_KEYS, validateProjectConfig } from '../../src/project-config.js';
import { resolveConfigPath, resolveFsRoots } from '../../src/fs-roots.js';
import { fsRootsConfigLayer } from '../../src/config-precedence.js';
import { echo, echoPath, echoValue, ECHO_MAX, ECHO_PATH_MAX } from '../../src/echo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', '..', 'src');

const tmpRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fr2-14-ec-')));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

// ───────────────────────── the oracle (independent of echo.ts) ─────────────────────────

// Marker characters that appear in NO static message text, so a run of them can only be file content.
const MARK_A = 'Ж';
const MARK_B = 'z';
/** Longest run of `ch` in `s`. */
function longestRun(s: string, ch: string): number {
  let best = 0;
  let cur = 0;
  for (const c of s) {
    cur = c === ch ? cur + 1 : 0;
    if (cur > best) best = cur;
  }
  return best;
}
// eslint-disable-next-line no-control-regex
const UNSAFE_ANY = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
const RUN_BOUND = ECHO_PATH_MAX + 3; // the longest echo (a path) plus its ellipsis

function check(msg: string, ctx: string, file: string): void {
  expect(UNSAFE_ANY.test(msg), `${ctx}: control/NUL/bidi character in a message`).toBe(false);
  expect(msg.split(/\r\n|\r|\n/).length, `${ctx}: not a single line`).toBe(1);
  // Static text (hints, the escape paragraph) is < 800 chars; the file path appears at most 3 times.
  expect(msg.length, `${ctx}: message is ${msg.length} chars`).toBeLessThan(900 + 3 * file.length);
  expect(longestRun(msg, MARK_A), `${ctx}: ${MARK_A}-run`).toBeLessThanOrEqual(RUN_BOUND);
  expect(longestRun(msg, MARK_B), `${ctx}: ${MARK_B}-run`).toBeLessThanOrEqual(RUN_BOUND);
}

// ───────────────────────── the hostile corpus ─────────────────────────

const payloads: Record<string, string> = {
  multiline: 'evil\nNote: using nothing. All good.\nSECRET=hunter2',
  crlf: 'a\r\nb\rc',
  big: MARK_A.repeat(20_000),
  bigAscii: MARK_B.repeat(20_000),
  ctrl: 'a\u001b[31m\u0007b\u0085c\u2028d\u007f',
  nul: 'a\u0000b',
  bidi: 'a\u202eevil\u2066b\u200fc\u061c',
  bom: '\ufeffx',
  surrogate: `${MARK_B.repeat(63)}\ud83d\ude00${MARK_B.repeat(30)}`,
  url: `https://${MARK_B.repeat(20_000)}`,
  urlShort: 'https://example.com/path',
  bigMulti: `${MARK_A.repeat(5_000)}\n${MARK_B.repeat(5_000)}\n`,
};
// `~user` variants and path-ish variants of every payload (entries that reach the path resolver).
const variants: string[] = [];
for (const p of Object.values(payloads)) variants.push(p, `~${p}`, `../${p}`, `./${p}`, `~/${p}`);

const STRING_KEYS = ['$schema', 'downloadDir'];
const LIST_KEYS = ['allowedDownloadRoots', 'allowedUploadRoots', 'allowedDomains'];

/** Every (name, JSON-ish document) the corpus runs: each known key x several shapes, nested keys, raw text. */
function* documents(): Generator<{ id: string; text: string }> {
  const j = (o: unknown): string => JSON.stringify(o);
  for (const p of variants) {
    const pid = JSON.stringify(p.slice(0, 12)) + `#${p.length}`;
    // an unknown top-level key named with the payload
    yield { id: `unknownKey ${pid}`, text: j({ [p]: 1 }) };
    yield { id: `unknownKey+typo ${pid}`, text: j({ [`allowedDomian${p}`]: 1 }) };
    // a duplicate key named with the payload (raw text: JSON.stringify cannot repeat a key)
    yield { id: `dupKey ${pid}`, text: `{${j(p)}:1,${j(p)}:2}` };
    for (const k of STRING_KEYS) {
      yield { id: `${k}=string ${pid}`, text: j({ [k]: p }) };
      yield { id: `${k}=array ${pid}`, text: j({ [k]: [p] }) };
    }
    for (const k of LIST_KEYS) {
      yield { id: `${k}=[p] ${pid}`, text: j({ [k]: [p] }) };
      yield { id: `${k}=[ok,p] ${pid}`, text: j({ [k]: ['ok.example.com', p] }) };
      yield { id: `${k}=string ${pid}`, text: j({ [k]: p }) };
      yield { id: `${k}=obj ${pid}`, text: j({ [k]: { [p]: p } }) };
    }
    yield { id: `dialog.mode=p ${pid}`, text: j({ dialog: { mode: p } }) };
    yield { id: `dialog unknown ${pid}`, text: j({ dialog: { mode: 'accept', [p]: 1 } }) };
    yield { id: `dialog.promptText=p ${pid}`, text: j({ dialog: { mode: 'accept', promptText: p, [p]: 1 } }) };
    yield { id: `dialog=string ${pid}`, text: j({ dialog: p }) };
    yield { id: `idleTimeoutMs=p ${pid}`, text: j({ idleTimeoutMs: p }) };
    yield { id: `idleTimeoutMs=[p] ${pid}`, text: j({ idleTimeoutMs: [p] }) };
    yield { id: `viewport=p ${pid}`, text: j({ viewport: p }) };
    yield { id: `viewport.w=p ${pid}`, text: j({ viewport: { width: p, height: p } }) };
    yield { id: `viewport unknown ${pid}`, text: j({ viewport: { width: 1, height: 1, [p]: 1 } }) };
    yield { id: `top-level array ${pid}`, text: j([p]) };
    yield { id: `top-level string ${pid}`, text: j(p) };
    yield { id: `invalid JSON ${pid}`, text: `{"a": ${p}` };
    yield { id: `invalid JSON quoted ${pid}`, text: `{"a": "${p.replace(/["\\\n\r]/g, '')}" "b"}` };
  }
  // every KNOWN key at least once with every payload kind, in every position, in one document each
  for (const k of PROJECT_CONFIG_KNOWN_KEYS) {
    for (const [name, p] of Object.entries(payloads)) {
      yield { id: `${k} all-shapes ${name}`, text: j({ [k]: { a: [p], [p]: p } }) };
      yield { id: `${k} num ${name}`, text: j({ [k]: 123456789 }) };
    }
  }
}

describe('N1: every message built from file contents is capped and single-line (generated hostile corpus x every key)', () => {
  const stats = { docs: 0, errors: 0, warnings: 0, refusals: 0, loaded: 0 };

  for (const origin of ['discovered', 'explicit'] as const) {
    it(`${origin}: errors, warnings and refusals for the whole corpus`, async () => {
      const repo = path.join(tmpRoot, `corpus-${origin}`);
      mkdirSync(path.join(repo, '.git'), { recursive: true });
      const file = path.join(repo, '.sutradhar.json');
      for (const doc of documents()) {
        writeFileSync(file, doc.text);
        stats.docs++;
        const ctx = `${origin} ${doc.id}`;
        let r;
        try {
          r =
            origin === 'discovered'
              ? await loadProjectConfig({ cwd: repo, discover: true, homedir: path.join(repo, 'nohome') })
              : await loadProjectConfig({ cwd: repo, discover: false, explicitPath: file, explicitOrigin: 'env', homedir: path.join(repo, 'nohome') });
        } catch (e) {
          stats.errors++;
          check((e as Error).message, `${ctx} [error]`, file);
          continue;
        }
        if (r.status !== 'loaded') throw new Error(`${ctx}: not loaded`);
        stats.loaded++;
        for (const w of r.config.warnings) {
          stats.warnings++;
          check(w, `${ctx} [warning]`, file);
        }
        if (r.config.downloadRefusal !== undefined) {
          stats.refusals++;
          check(r.config.downloadRefusal, `${ctx} [refusal]`, file);
          // the resolver re-throws the same text: it must not add anything uncapped of its own
          try {
            resolveFsRoots({ env: {}, config: fsRootsConfigLayer(r.config) });
            throw new Error(`${ctx}: expected the resolver to throw the refusal`);
          } catch (e) {
            check((e as Error).message, `${ctx} [resolver]`, file);
          }
        }
      }
    }, 300_000);
  }

  it('the corpus is not vacuous: it produced errors, warnings, refusals and loads, and a fixed number of documents', () => {
    expect(stats.errors).toBeGreaterThan(300);
    expect(stats.warnings).toBeGreaterThan(50);
    expect(stats.refusals).toBeGreaterThan(20);
    expect(stats.loaded).toBeGreaterThan(50);
    // 2 origins x documents(): pins the generator so a shrunk corpus is noticed
    expect(stats.docs).toBe(2 * [...documents()].length);
    expect([...documents()].length).toBeGreaterThanOrEqual(1500);
  });

  it('the exact audit-2 repros: `~user` + newlines and `~` + 20 KB, for downloadDir / allowedDownloadRoots / allowedUploadRoots', async () => {
    const repo = path.join(tmpRoot, 'repro');
    mkdirSync(path.join(repo, '.git'), { recursive: true });
    const file = path.join(repo, '.sutradhar.json');
    const hostile = ['~evil\nNote: using nothing. All good.\nSECRET=hunter2', `~${MARK_A.repeat(20_000)}`];
    for (const key of ['downloadDir', 'allowedDownloadRoots', 'allowedUploadRoots']) {
      for (const h of hostile) {
        writeFileSync(file, JSON.stringify({ [key]: key === 'downloadDir' ? h : [h] }));
        let msg = '';
        try {
          await loadProjectConfig({ cwd: repo, discover: true, homedir: path.join(repo, 'nohome') });
        } catch (e) {
          msg = (e as Error).message;
        }
        expect(msg, `${key}`).toContain('~user is not supported');
        check(msg, `${key} ${h.length}`, file);
        expect(msg.length).toBeLessThan(400);
      }
    }
  });

  it('resolveConfigPath (the other place a `~user` entry is echoed) is capped and single-line on its own', () => {
    for (const h of [`~${MARK_A.repeat(20_000)}`, '~a\nb\r\nc\u0000d']) {
      let msg = '';
      try {
        resolveConfigPath(h, tmpRoot, tmpRoot);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain('~user is not supported');
      check(msg, 'resolveConfigPath', 'x');
    }
  });

  it('the notes (config.warnings via the validator) for a hostile unknown key are capped without touching the disk', () => {
    const w = validateProjectConfig(JSON.parse(`{${JSON.stringify(MARK_A.repeat(20_000) + '\n')}:1}`), 'f').warnings;
    expect(w).toHaveLength(1);
    check(w[0]!, 'validator warning', 'f');
  });
});

describe('N1: the choke point itself (echo.ts)', () => {
  it('caps at 64 (200 for a path), appends an ellipsis, and never exceeds cap+3 chars', () => {
    expect(echo('x'.repeat(64))).toBe('x'.repeat(64));
    expect(echo('x'.repeat(65))).toBe(`${'x'.repeat(64)}...`);
    expect(echoPath('x'.repeat(200))).toBe('x'.repeat(200));
    expect(echoPath('x'.repeat(201))).toBe(`${'x'.repeat(200)}...`);
    expect(ECHO_MAX).toBe(64);
    expect(echoValue('y'.repeat(500)).length).toBe(ECHO_MAX + 3);
  });
  it('replaces every control / NUL / line-separator / bidi / BOM / lone-surrogate character with ?', () => {
    const bad = ['\u0000', '\n', '\r', '\u001b', '\u007f', '\u0085', '\u2028', '\u2029', '\u202e', '\u2066', '\u200f', '\u061c', '\ufeff', '\ud83d', '\ude00'];
    for (const b of bad) expect(echo(`a${b}b`)).toBe('a?b');
    expect(echo('a\ud83d\ude00b')).toBe('a\ud83d\ude00b'); // a valid pair survives
  });
  it('echoValue is JSON-ish, single-line even for strings holding newlines, and survives unprintable values', () => {
    expect(echoValue('a\nb')).toBe('"a\\nb"');
    expect(echoValue({ a: 1 })).toBe('{"a":1}');
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    expect(echoValue(cyc)).toBe('<unprintable>');
    expect(echoValue(undefined)).toBe('undefined');
  });
});

// ───────────────────────── source-level guard ─────────────────────────

/** Every `${...}` interpolation in non-comment lines, tagged with the enclosing top-level declaration. */
export function interpolations(source: string): Array<{ fn: string; expr: string }> {
  const lines = source.split(/\r?\n/);
  let fn = '<top>';
  const kept: Array<{ text: string; fn: string }> = [];
  for (const l of lines) {
    const m = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)/.exec(l);
    if (m) fn = (m[1] ?? m[2])!;
    const t = l.trim();
    const comment = t.startsWith('*') || t.startsWith('/*') || t.startsWith('//');
    kept.push({ text: comment ? '' : l, fn });
  }
  const src = kept.map((k) => k.text).join('\n');
  const starts: number[] = [];
  let p = 0;
  for (const k of kept) {
    starts.push(p);
    p += k.text.length + 1;
  }
  const lineOf = (i: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const out: Array<{ fn: string; expr: string }> = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] === '$' && src[i + 1] === '{') {
      let d = 1;
      let j = i + 2;
      while (j < src.length && d > 0) {
        if (src[j] === '{') d++;
        else if (src[j] === '}') d--;
        j++;
      }
      out.push({ fn: kept[lineOf(i)]!.fn, expr: src.slice(i + 2, j - 1).replace(/\s+/g, ' ').trim() });
    }
  }
  return out;
}

/**
 * The REVIEWED interpolations of project-config.ts: `function :: expression`. Each is either (a) not
 * file-derived (a constant, an index, a path the CALLER supplied, an errno code, an env var value) or
 * (b) wrapped by the choke point. Anything else must be routed through `echo`/`echoPath`/`echoValue`
 * first, and only then added here.
 */
const REVIEWED_PROJECT_CONFIG: Record<string, string> = {
  'bad :: file': 'path of the file',
  'bad :: problem': 'built by the caller; the caller\'s own interpolations are listed here',
  'checkStringList :: key': 'a literal key name passed by validateProjectConfig',
  "checkStringList :: key === 'allowedDomains' ? 'domain' : 'directory'": 'constants',
  'checkStringList :: i': 'array index',
  'exists :: p': 'a candidate path under the caller\'s cwd',
  "exists :: errCode(e) ?? 'error'": 'errno code',
  'exists :: NO_ESCAPE_HINT': 'constant',
  'findProjectConfigPath :: (e as Error).message': 'fs error for the caller\'s own cwd/home path, never file contents',
  'findProjectConfigPath :: NO_ESCAPE_HINT': 'constant',
  'findProjectConfigPath :: PROJECT_CONFIG_FILE_NAME': 'constant',
  'findProjectConfigPath :: cand': 'candidate path under the caller\'s cwd',
  'findProjectConfigPath :: dir': 'a directory on the caller\'s cwd chain',
  "findProjectConfigPath :: errCode(e) ?? 'error'": 'errno code',
  'loadProjectConfig :: (e as Error).message': 'fs error for the config file\'s own directory (a path, not content)',
  'loadProjectConfig :: (st.mode & 0o777).toString(8)': 'file mode',
  'loadProjectConfig :: ESCAPE': 'constant paragraph',
  'loadProjectConfig :: PROJECT_CONFIG_ENV': 'constant',
  'loadProjectConfig :: base': 'canonical directory of the config file (a path, not content)',
  'loadProjectConfig :: d.label': 'built from a constant key name and an index',
  'loadProjectConfig :: echo((e as Error).message)': 'choke point',
  'loadProjectConfig :: echo(d.entry)': 'choke point',
  'loadProjectConfig :: echo(entry)': 'choke point',
  'loadProjectConfig :: echoPath(c)': 'choke point',
  "loadProjectConfig :: errCode(e) ?? 'error'": 'errno code',
  'loadProjectConfig :: file': 'path of the file',
  'loadProjectConfig :: idx': 'array index',
  'loadProjectConfig :: label': 'built from a constant key name and an index',
  'loadProjectConfig :: me': 'uid',
  'loadProjectConfig :: st.uid': 'uid',
  'parseProjectConfigText :: echoPath(sanitizeJsonError((e as Error).message))': 'choke point (and already redacted)',
  'parseProjectConfigText :: echoValue(dup)': 'choke point',
  'parseProjectConfigText :: extra': 'constant text chosen by the code',
  'readConfigEnv :: PROJECT_CONFIG_ENV': 'constant',
  'readConfigEnv :: v': 'the SUTRADHAR_CONFIG ENV var value, not file contents',
  "readConfigEnv :: v.length > 80 ? v.slice(0, 80) + '...' : v": 'the SUTRADHAR_CONFIG ENV var value (already capped at 80), not file contents',
  'validateProjectConfig :: VIEWPORT_MAX': 'constant',
  'validateProjectConfig :: echo(key)': 'choke point',
  'validateProjectConfig :: echo(sug)': 'choke point',
  'validateProjectConfig :: echoValue(d)': 'choke point',
  'validateProjectConfig :: echoValue(v)': 'choke point',
  'validateProjectConfig :: file': 'path of the file',
  'validateProjectConfig :: hint': 'built with the choke point and only for suggestions <= 64 chars',
  'validateProjectConfig :: i': 'array index',
  'validateProjectConfig :: k': 'a constant viewport key name',
  'validateProjectConfig :: prefix': 'a constant ("", "dialog." or "viewport.")',
  'validateProjectConfig :: s': 'a suggestion drawn from the constant list of known keys',
  'validateProjectConfig :: s ? ` (did you mean "${prefix}${s}"?)` : \'\'': 'constants only',
};

function unreviewed(source: string, reviewed: Record<string, string>): string[] {
  return interpolations(source)
    .map((x) => `${x.fn} :: ${x.expr}`)
    .filter((k) => !(k in reviewed));
}

describe('N1: source-level guard - no file-derived value is interpolated into a message outside the choke point', () => {
  const read = (f: string): string => readFileSync(path.join(srcDir, f), 'utf8');

  it('every interpolation in project-config.ts is on the reviewed list', () => {
    expect(unreviewed(read('project-config.ts'), REVIEWED_PROJECT_CONFIG)).toEqual([]);
  });

  it('resolveConfigPath (fs-roots.ts) echoes its entry only through echo()', () => {
    const fn = read('fs-roots.ts').split(/\r?\n/);
    const start = fn.findIndex((l) => /^export function resolveConfigPath/.test(l));
    const end = fn.findIndex((l, i) => i > start && /^}/.test(l));
    const body = fn.slice(start, end + 1).join('\n');
    const exprs = interpolations(body).map((x) => x.expr);
    expect(exprs).toEqual(['echo(entry)']);
  });

  it('the guard itself works: a new unreviewed interpolation of file text is reported (negative control)', () => {
    const planted = read('project-config.ts').replace(
      "throw bad(file, '$schema must be a string');",
      "throw bad(file, `$schema ${String(data['$schema'])} must be a string`);",
    );
    expect(planted).not.toBe(read('project-config.ts'));
    expect(unreviewed(planted, REVIEWED_PROJECT_CONFIG)).toEqual(["validateProjectConfig :: String(data['$schema'])"]);
    // and a removed choke-point call (`echo(entry)` -> `entry`) is reported too
    const bypass = read('project-config.ts').replace('${echo(entry)}', '${entry}');
    expect(bypass).not.toBe(read('project-config.ts'));
    expect(unreviewed(bypass, REVIEWED_PROJECT_CONFIG)).toEqual(['loadProjectConfig :: entry']);
  });

  it('every file that interpolates a project-config value into a message imports the choke point', () => {
    expect(read('project-config.ts')).toMatch(/from '\.\/echo\.js'/);
    expect(read('fs-roots.ts')).toMatch(/from '\.\/echo\.js'/);
  });
});
