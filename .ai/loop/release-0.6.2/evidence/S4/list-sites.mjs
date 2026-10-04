// S4 step 1: list EVERY call in packages/*/src (not dist, not tests) of any method in sync-throw-methods.txt, on any
// receiver, including multi-line chains. Key = file:line:col (forward slashes), one per call.
// Usage: node list-sites.mjs <sync-throw-methods.txt> <out sites.txt> [<repo root, default cwd>] [--selftest-only]
// Env: RG = absolute path of a ripgrep binary with PCRE2 (default: the ZCode-bundled rg; `rg` is not on PATH here).
// Also exports the blind-spot regex (.call/.apply/.bind, optional `?.(`, bracket calls) via `--blindspot <root>`.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const RG = process.env.RG ?? 'C:/Program Files/ZCode/resources/tools/ripgrep/rg.exe';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const argv = process.argv.slice(2);
const mode = argv[0] === '--blindspot' ? 'blindspot' : 'sites';
const [listFile, outFile, rootArg] = mode === 'sites' ? argv : [argv[1], undefined, argv[2]];
const root = path.resolve(rootArg ?? process.cwd()).split(path.sep).join('/');

const names = readFileSync(listFile, 'utf8').split(/\r?\n/).filter(Boolean).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
const alt = names.map(esc).join('|');
const sitePattern = `\\.\\s*(?:${alt})\\s*\\(`;
// Blind-spot pattern, grouped per intent (plan 4.S4 step 1): `.call/.apply/.bind` or an optional call OF A LISTED METHOD,
// a bracket call of a listed method, or destructuring a listed word-name out of an object. The plan's literal text has a bare
// top-level `\?\.\(` alternative, which would match every optional call in the tree (unrelated code); that is not the blind
// spot, so it is scoped to a listed method here (stated deviation, recorded in the README).
const wordNames = names.filter((n) => /^\w+$/.test(n));
const blindPattern = `\\.(?:${alt})\\s*(?:\\.(?:call|apply|bind)\\(|\\?\\.\\()|\\[['"](?:${alt})['"]\\]\\s*\\(|(?:const|let|var)\\s*\\{[^}]*\\b(?:${wordNames.join('|')})\\b[^}]*\\}\\s*=`;

function rg(pattern, cwdRoot, files, extra = []) {
  const args = ['-nUHb', '--pcre2', '-o', ...extra, '--no-heading', '--no-messages', '--glob', '!**/dist/**', '--glob', '!**/node_modules/**', '-e', pattern, '--', ...files];
  const r = spawnSync(RG, args, { cwd: cwdRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
  if (r.error) throw r.error;
  if (r.status !== 0 && r.status !== 1) throw new Error(`rg exit ${r.status}: ${r.stderr}`);
  // multi-line matches print continuation lines without a prefix: keep only lines that start a hit
  return r.stdout.split(/\r?\n/).filter((l) => /^[^:]+:\d+:\d+:/.test(l));
}

// rg's --column is unreliable with -U (multi-line mode reports file-relative columns after a prior match), so the hit is
// located with -b (absolute byte offset of the match start) and line/col are recomputed from the file bytes (col = bytes
// from the line start + 1; sources are ASCII at every hit). Each call is one key (two on one line = two keys).
function toKeys(lines, cwdRoot) {
  const cache = new Map();
  return lines.map((l) => {
    const m = /^(.*?):(\d+):(\d+):(.*)$/s.exec(l.replaceAll('\\', '/'));
    if (!m) throw new Error('unparsable rg line: ' + l);
    const [, file, rgLine, off, text] = m;
    if (!cache.has(file)) cache.set(file, readFileSync(path.join(cwdRoot, file)));
    const buf = cache.get(file);
    const o = Number(off);
    const lineStart = buf.lastIndexOf(10, o - 1) + 1;
    let line = 1; for (let i = buf.indexOf(10); i >= 0 && i < o; i = buf.indexOf(10, i + 1)) line++;
    if (line !== Number(rgLine)) throw new Error('line mismatch ' + file + ': rg ' + rgLine + ' vs computed ' + line);
    return { key: file + ':' + line + ':' + (o - lineStart + 1), text };
  });
}

// ---- self-test (scratch string + scratch file under the ISO tmpdir; asserts the regex and the rg invocation)
{
  const re = new RegExp(sitePattern, 'g');
  const must = ['frame.$$eval(', 'x.$(', 'y\n  .waitForSelector(', 'a.$eval (', 'q . evaluate('];
  for (const s of must) { re.lastIndex = 0; if (!re.test(s)) { console.error(`SELF-TEST FAIL: regex does not match ${JSON.stringify(s)}`); process.exit(1); } }
  for (const s of ['$eval(', 'evaluate(', '$(', 'const evaluate = 1', 'foo.evaluateX(', 'foo.notAMethod(']) { re.lastIndex = 0; if (re.test(s)) { console.error(`SELF-TEST FAIL: regex matches ${JSON.stringify(s)}`); process.exit(1); } }
  const dir = path.join(os.tmpdir(), 'list-sites-selftest');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'a.ts'), 'frame.$$eval(1)\nx.$(2)\ny\n  .waitForSelector(3)\n$eval(4)\nz.evaluate(5); w.click(6)\n');
  const hits = toKeys(rg(sitePattern, dir, ['a.ts']), dir).map((k) => k.key);
  const want = ['a.ts:1:6', 'a.ts:2:2', 'a.ts:4:3', 'a.ts:6:2', 'a.ts:6:17'];
  if (JSON.stringify(hits) !== JSON.stringify(want)) { console.error(`SELF-TEST FAIL: rg hits ${JSON.stringify(hits)} != ${JSON.stringify(want)}`); process.exit(1); }
  console.error('self-test OK: regex matches frame.$$eval( / x.$( / multi-line .waitForSelector( ; no match on dotless $eval( ; rg keys per call (two on one line = two keys)');
}

const srcDirs = readdirSync(`${root}/packages`, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`${root}/packages/${d.name}/src`)).map((d) => `packages/${d.name}/src`);

if (mode === 'blindspot') {
  const hits = toKeys(rg(blindPattern, root, srcDirs), root).map((k) => `${k.key} ${k.text}`);
  console.log(`blind-spot hits: ${hits.length}`);
  for (const h of hits) console.log(h);
  process.exit(hits.length === 0 ? 0 : 1);
}

const lines = rg(sitePattern, root, srcDirs);
const keys = toKeys(lines, root);
keys.sort((a, b) => (a.key.split(':')[0] < b.key.split(':')[0] ? -1 : a.key.split(':')[0] > b.key.split(':')[0] ? 1 : Number(a.key.split(':')[1]) - Number(b.key.split(':')[1]) || Number(a.key.split(':')[2]) - Number(b.key.split(':')[2])));
writeFileSync(outFile, keys.map((k) => `${k.key} ${k.text.replace(/\s+/g, ' ')}`).join('\n') + '\n');
console.log(`sites: ${keys.length} in ${new Set(keys.map((k) => k.key.split(':')[0])).size} files (methods: ${names.length}, rg=${RG})`);
