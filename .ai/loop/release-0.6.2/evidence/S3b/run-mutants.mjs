// S3b source mutants for packages/mcp-server (unit level). Run under the isolation preamble (Git Bash).
// Each mutant: copy-restore of ONE file (sha256 before, exact expected replacement count, run tools.spec.ts, restore, sha256 equal).
// A mutant that does not fail the suite SURVIVES = FAIL.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP;
if (!SP || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (mutants)'); process.exit(97); }
const WT = process.env.WT;
const PKG = `${WT}/packages/mcp-server`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const TS = `${PKG}/src/tools.ts`;
const SPEC = `${PKG}/tests/unit/tools.spec.ts`;
const BT = '`';

const mutants = [
  { id: 'M-048k', note: 'snapshot ignores textMaxChars (always 2000)', file: TS, count: 1, find: 'textMaxChars: textMaxChars ?? 2000,', repl: 'textMaxChars: 2000,' },
  { id: 'M-048k2', note: 'snapshot default is not 2000', file: TS, count: 1, find: 'textMaxChars: textMaxChars ?? 2000,', repl: 'textMaxChars: textMaxChars ?? 4000,' },
  { id: 'M-048k3', note: 'snapshot never renders the marker', file: TS, count: 1, find: "(textMarker ? `\\n${textMarker}` : '')", repl: "''" },
  { id: 'M-048k4', note: 'snapshot never renders pageTextError', file: TS, count: 1, find: "(snap.pageTextError ? `\\nPage text unavailable: ${snap.pageTextError}` : '')", repl: "''" },
  { id: 'M-048k5', note: 'snapshot marker rendered even when pageTextTruncated is false', file: TS, count: 1, find: "snap.pageTextTruncated && typeof snap.pageTextTotalChars === 'number'", repl: "typeof snap.pageTextTotalChars === 'number'" },
  { id: 'M-048k6', note: 'schema ceiling removed (snapshot + get_page_text)', file: TS, count: 2, find: '.max(MCP_MAX_PAGE_TEXT_CHARS)', repl: '' },
  { id: 'M-048l', note: 'get_page_text ignores offset', file: TS, count: 1, find: 'offset: offset ?? 0, maxChars: maxChars ?? 4000', repl: 'offset: 0, maxChars: maxChars ?? 4000' },
  { id: 'M-048l2', note: 'get_page_text ignores maxChars', file: TS, count: 1, find: 'offset: offset ?? 0, maxChars: maxChars ?? 4000', repl: 'offset: offset ?? 0, maxChars: 4000' },
  { id: 'M-048l3', note: 'get_page_text drops the marker', file: TS, count: 1, find: "text: marker ? `${r.text}\\n${marker}` : r.text", repl: 'text: r.text' },
  { id: 'M-048m', note: 'tool missing from EXPECTED_BROWSER_TOOLS (count test)', file: SPEC, count: 1, find: "  'browser.snapshot',\n  'browser.get_page_text',\n", repl: "  'browser.snapshot',\n" },
  { id: 'M-048s', note: 'get_page_text returns empty text instead of isError on a read error', file: TS, count: 1,
    find: "return errorResult((e as Error).name === 'PageTextReadError' ? `page text read failed: ${reason}` : `get_page_text failed: ${reason}`);",
    repl: "if ((e as Error).name === 'PageTextReadError') return { content: [{ type: 'text' as const, text: '' }] }; return errorResult(`get_page_text failed: ${reason}`);" },
  { id: 'M-048s2', note: 'read error not matched by name', file: TS, count: 1, find: "(e as Error).name === 'PageTextReadError' ? `page text read failed", repl: 'false ? `page text read failed' },
];

const runSuite = () => {
  const r = spawnSync(process.execPath, [`${WT}/node_modules/vitest/vitest.mjs`, 'run', '--globals', 'tests/unit/tools.spec.ts'], { cwd: PKG, timeout: 600000, encoding: 'utf8', env: { ...process.env } });
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
