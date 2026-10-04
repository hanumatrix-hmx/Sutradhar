// S3c source mutants for packages/sutradhar (unit level). Run under the isolation preamble (Git Bash).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP;
if (!SP || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (mutants)'); process.exit(97); }
const WT = process.env.WT;
const PKG = `${WT}/packages/sutradhar`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PAGE = `${PKG}/src/page.ts`;
const IDX = `${PKG}/src/index.ts`;

const mutants = [
  { id: 'M-048n', note: 'page.text drops tabId', file: PAGE, count: 1, find: 'this.runtime.readTextWindow(this.sessionId, this.tabId, options)', repl: 'this.runtime.readTextWindow(this.sessionId, undefined, options)' },
  { id: 'M-048n2', note: 'page.text drops the options', file: PAGE, count: 1, find: 'this.runtime.readTextWindow(this.sessionId, this.tabId, options)', repl: 'this.runtime.readTextWindow(this.sessionId, this.tabId)' },
  { id: 'M-048n3', note: 'page.text swallows a read failure into an empty result', file: PAGE, count: 1,
    find: 'return this.runtime.readTextWindow(this.sessionId, this.tabId, options);',
    repl: "return this.runtime.readTextWindow(this.sessionId, this.tabId, options).catch(() => ({ sessionId: this.sessionId, tabId: this.tabId, url: '', text: '', offset: 0, returnedChars: 0, totalChars: 0, truncated: false, source: 'dom' as const }));" },
  { id: 'M-048o', note: 'formatPageTextMarker not re-exported', file: IDX, count: 1, find: '  formatPageTextMarker,\n', repl: '' },
  { id: 'M-048o2', note: 'PageTextReadError not re-exported', file: IDX, count: 1, find: '  PageTextReadError,\n', repl: '' },
  { id: 'M-048o3', note: 'MAX_PAGE_TEXT_CHARS not re-exported', file: IDX, count: 1, find: '  MAX_PAGE_TEXT_CHARS,\n', repl: '' },
];

const runSuite = () => {
  const r = spawnSync(process.execPath, [`${WT}/node_modules/vitest/vitest.mjs`, 'run', '--globals', 'tests/unit/page-text.spec.ts'], { cwd: PKG, timeout: 600000, encoding: 'utf8', env: { ...process.env } });
  const clean = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
  return { status: r.status, tests: /Tests\s+(.*)/.exec(clean)?.[1] ?? '?', failed: (clean.match(/^\s*(?:FAIL|×)\s+.*$/gm) ?? []).slice(0, 3) };
};
const base = runSuite();
console.log(`BASELINE exit=${base.status} tests=${base.tests}`);
if (base.status !== 0) process.exit(2);
let survivors = 0; let n = 0;
for (const m of mutants) {
  const orig = readFileSync(m.file);
  const shaBefore = sha(orig);
  const text = orig.toString('utf8');
  const crlf = text.includes('\r\n');
  const norm0 = crlf ? text.replace(/\r\n/g, '\n') : text;
  const cnt = norm0.split(m.find).length - 1;
  if (cnt !== m.count) { console.log(`${m.id} BAD-APPLY expected ${m.count}, got ${cnt}`); process.exit(3); }
  let mutated = norm0.split(m.find).join(m.repl);
  if (crlf) mutated = mutated.replace(/\n/g, '\r\n');
  let res;
  try { writeFileSync(m.file, mutated); res = runSuite(); } finally { writeFileSync(m.file, orig); }
  const shaAfter = sha(readFileSync(m.file));
  const killed = res.status !== 0; n++;
  if (!killed) survivors++;
  console.log(`${m.id} ${killed ? 'KILLED' : 'SURVIVED'} exit=${res.status} (${res.tests}) restored-sha-equal=${shaBefore === shaAfter} :: ${m.note}`);
  for (const f of res.failed) console.log(`    ${f.trim().slice(0, 170)}`);
  if (shaBefore !== shaAfter) { console.log('RESTORE MISMATCH'); process.exit(4); }
}
console.log(`SUMMARY mutants=${n} survivors=${survivors}`);
process.exitCode = survivors === 0 ? 0 : 1;
