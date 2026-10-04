// S2 source mutants for packages/capability-runtime. Run under the isolation preamble (Git Bash), cwd = worktree root.
// Each mutant: copy-restore of ONE source file (sha256 before, apply with an exact expected replacement count,
// run the capability-runtime vitest files, restore, sha256 equal). A mutant that does not fail the suite SURVIVES = FAIL.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP;
if (!SP || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (mutants)'); process.exit(97); }
const WT = process.env.WT;
const RT = `${WT}/packages/capability-runtime`;
const sha = (b) => createHash('sha256').update(b).digest('hex');

const PT = `${RT}/src/page-text.ts`;
const RTS = `${RT}/src/runtime.ts`;
const mutants = [
  { id: 'M-048a', note: 'window ignores offset', file: PT, find: 'let start = o;', repl: 'let start = 0;', count: 2 },
  { id: 'M-048b', note: 'totalChars from the slice', file: PT, find: 'totalChars: w.total,', repl: 'totalChars: w.slice.length,', count: 1 },
  {
    id: 'M-048c', note: 'validation after evaluate', file: RTS, count: 1,
    find: `    const { offset, maxChars } = validatePageTextOptions(opts);
    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    const w = await this.pageTextWindow(tab, { offset, maxChars });`,
    repl: `    const { tab } = this.resolveTab(sessionId, tabId);
    const page = this.requirePage(tab);
    const w = await this.pageTextWindow(tab, { offset: opts?.offset ?? 0, maxChars: opts?.maxChars ?? 4000 });
    const { offset, maxChars } = validatePageTextOptions(opts);
    void maxChars;`,
  },
  { id: 'M-048d', note: 'PDF keeps slice(0,4000)', file: RTS, find: 'return result.text;', repl: 'return result.text.slice(0, 4000);', count: 1 },
  { id: 'M-048e', note: 'marker emitted when not truncated', file: PT, find: '  if (!r.truncated) return null;\n', repl: '', count: 1 },
  {
    id: 'M-048f', note: 'surrogate rule removed (back-up and extend, both twins)', file: PT, count: 4,
    // four statements: two start back-ups and two end extensions
    find: /    if \(c >= 0xdc00 && c <= 0xdfff && p >= 0xd800 && p <= 0xdbff\) start -= 1;|    if \(last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff\) end \+= 1;/g,
    repl: '',
  },
  { id: 'M-048f2', note: 'shrink instead of extend', file: PT, find: 'end += 1;', repl: 'end -= 1;', count: 2 },
  {
    id: 'M-048p1', note: 'probe evaluate error swallowed (treated as not-a-PDF)', file: RTS, count: 1,
    find: `      isPdf = (await page.evaluate(() => document.contentType === 'application/pdf')) as boolean;
    } catch (err) {
      throw new PageTextReadError('dom', pageTextFailureReason(err), err);
    }`,
    repl: `      isPdf = (await page.evaluate(() => document.contentType === 'application/pdf')) as boolean;
    } catch (err) {
      isPdf = false;
    }`,
  },
  {
    id: 'M-048p2', note: 'window evaluate error swallowed -> empty text, total 0', file: RTS, count: 1,
    find: `      raw = (await page.evaluate(pageWindowInPage, opts.offset, opts.maxChars)) as RawTextWindow;
    } catch (err) {
      throw new PageTextReadError('dom', pageTextFailureReason(err), err);
    }`,
    repl: `      raw = (await page.evaluate(pageWindowInPage, opts.offset, opts.maxChars)) as RawTextWindow;
    } catch (err) {
      raw = { total: 0, start: 0, slice: '' };
    }`,
  },
  {
    id: 'M-048q', note: 'PDF parse failure falls back to DOM text', file: RTS, count: 1,
    find: '    if (isPdf) {', repl: '    if (isPdf && (await this.readPdfText(page, tab.url).then(() => true, () => false))) {',
  },
  { id: 'M-048t', note: 'truncated ignores offset > 0', file: PT, find: 'return offset > 0 || offset + returnedChars < totalChars;', repl: 'return offset + returnedChars < totalChars;', count: 1 },
  { id: 'M-048u', note: 'snapshot ignores textMaxChars', file: RTS, find: 'this.pageTextWindow(tab, { offset: 0, maxChars: textMaxChars })', repl: 'this.pageTextWindow(tab, { offset: 0, maxChars: 4000 })', count: 1 },
  { id: 'M-048v', note: 'snapshot drops pageTextTotalChars', file: RTS, find: '      pageTextTotalChars,\n      pageTextTruncated,', repl: '      pageTextTotalChars: 0,\n      pageTextTruncated,', count: 1 },
  { id: 'M-048w', note: 'PDF empty text falls back to DOM', file: RTS, find: 'const full = await this.readPdfText(page, tab.url);', repl: 'const full = (await this.readPdfText(page, tab.url)) || String(await page.evaluate(() => document.body?.innerText ?? ""));', count: 1 },
];

const ISO = process.env.TEMP;
const runSuite = () => {
  const r = spawnSync(process.execPath, [`${WT}/node_modules/vitest/vitest.mjs`, 'run', '--globals', 'tests/unit/page-text.spec.ts', 'tests/unit/runtime.spec.ts'], {
    cwd: RT, timeout: 600000, encoding: 'utf8', env: { ...process.env },
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const failed = (clean.match(/^\s*(?:FAIL|×)\s+.*$/gm) ?? []).slice(0, 3);
  const tests = /Tests\s+(.*)/.exec(clean)?.[1] ?? '?';
  return { status: r.status, tests, failed };
};

const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
let survivors = 0;
const rows = [];
// baseline (unmutated) must pass
const base = runSuite();
console.log(`BASELINE exit=${base.status} tests=${base.tests}`);
if (base.status !== 0) { console.log('baseline failed; abort'); process.exit(2); }
for (const m of mutants) {
  if (only && !only.includes(m.id)) continue;
  const orig = readFileSync(m.file);
  const shaBefore = sha(orig);
  const text = orig.toString('utf8');
  let mutated; let n;
  if (m.find instanceof RegExp) { n = (text.match(m.find) ?? []).length; mutated = text.replace(m.find, m.repl); }
  else { n = text.split(m.find).length - 1; mutated = text.split(m.find).join(m.repl); }
  if (n !== m.count) { console.log(`${m.id} BAD-APPLY expected ${m.count} replacements, got ${n}`); process.exit(3); }
  let res;
  try {
    writeFileSync(m.file, mutated);
    res = runSuite();
  } finally {
    writeFileSync(m.file, orig);
  }
  const shaAfter = sha(readFileSync(m.file));
  const killed = res.status !== 0;
  if (!killed) survivors++;
  rows.push({ id: m.id, note: m.note, killed, exit: res.status, tests: res.tests, shaEqual: shaBefore === shaAfter });
  console.log(`${m.id} ${killed ? 'KILLED' : 'SURVIVED'} exit=${res.status} (${res.tests}) restored-sha-equal=${shaBefore === shaAfter} :: ${m.note}`);
  for (const f of res.failed) console.log(`    ${f.trim().slice(0, 170)}`);
  if (shaBefore !== shaAfter) { console.log('RESTORE MISMATCH'); process.exit(4); }
}
console.log(`SUMMARY mutants=${rows.length} killed=${rows.filter((r) => r.killed).length} survivors=${survivors}`);
process.exitCode = survivors === 0 ? 0 : 1;
