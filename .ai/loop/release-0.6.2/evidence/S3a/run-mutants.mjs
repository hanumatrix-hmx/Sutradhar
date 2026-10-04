// S3a source mutants for packages/cli (unit level). Run under the isolation preamble (Git Bash), TEMP etc. set.
// Each mutant: copy-restore of ONE source file (sha256 before, apply with an exact expected replacement count, run the
// CLI unit files, restore, sha256 equal). A mutant that does not fail the suite SURVIVES = FAIL.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP;
if (!SP || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (mutants)'); process.exit(97); }
const WT = process.env.WT;
const CLI = `${WT}/packages/cli`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const TO = `${CLI}/src/text-output.ts`;
const PA = `${CLI}/src/parse-args.ts`;

const mutants = [
  { id: 'M-048g', note: 'marker goes to stderr instead of stdout', file: TO, count: 1,
    find: 'return { stdout: marker === null ? [r.text] : [r.text, marker], stderr: [], exitCode: 0 };',
    repl: 'return { stdout: [r.text], stderr: marker === null ? [] : [marker], exitCode: 0 };' },
  { id: 'M-048g2', note: 'marker emitted even for a complete read (empty marker line)', file: TO, count: 1,
    find: 'return { stdout: marker === null ? [r.text] : [r.text, marker], stderr: [], exitCode: 0 };',
    repl: 'return { stdout: [r.text, marker ?? \'\'], stderr: [], exitCode: 0 };' },
  { id: 'M-048g3', note: '--json also prints the marker line', file: TO, count: 1,
    find: 'if (jsonMode) return { stdout: [JSON.stringify(r, null, 2)], stderr: [], exitCode: 0 };',
    repl: 'if (jsonMode) return { stdout: [JSON.stringify(r, null, 2), formatPageTextMarker(r) ?? \'\'], stderr: [], exitCode: 0 };' },
  { id: 'M-048j', note: '--offset parsed but not passed to readTextWindow', file: TO, count: 1,
    find: '...(flags.offset !== undefined ? { offset: flags.offset } : {}),', repl: '' },
  { id: 'M-048j2', note: '--max-chars parsed but not passed', file: TO, count: 1,
    find: '...(flags.maxChars !== undefined ? { maxChars: flags.maxChars } : {}),', repl: '' },
  { id: 'M-048i-unit', note: 'text goes through snapshot() again (re-stamps ids)', file: TO, count: 1,
    find: '  let result: PageTextResult;\n  try {\n    result = await runtime.readTextWindow(',
    repl: '  let result: PageTextResult;\n  await (runtime as unknown as { snapshot(s: string): Promise<unknown> }).snapshot(sessionId);\n  try {\n    result = await runtime.readTextWindow(' },
  { id: 'M-048r', note: 'PageTextReadError printed as empty stdout, exit 0', file: TO, count: 1,
    find: "return { stdout: [], stderr: [`Error: text read failed: ${err.message}`], exitCode: 1 };",
    repl: 'return { stdout: [], stderr: [], exitCode: 0 };' },
  { id: 'M-048r2', note: 'read error reported with the Fatal: prefix', file: TO, count: 1,
    find: 'Error: text read failed: ${err.message}', repl: 'Fatal: ${err.message}' },
  { id: 'M-048r3', note: 'read error matched by instanceof-ish identity (name check removed: everything is a read error)', file: TO, count: 1,
    find: "(err as { name?: unknown }).name === 'PageTextReadError'", repl: 'true' },
  { id: 'M-048x1', note: 'offset regex accepts negatives', file: PA, count: 1, find: '/^\\d+$/.test(raw)', repl: '/^-?\\d+$/.test(raw)' },
  { id: 'M-048x2', note: 'max-chars upper bound not enforced', file: PA, count: 1,
    find: 'maxCharsParsed >= 1 && maxCharsParsed <= MAX_PAGE_TEXT_CHARS', repl: 'maxCharsParsed >= 1' },
  { id: 'M-048x3', note: 'max-chars lower bound not enforced (0 accepted)', file: PA, count: 1,
    find: 'maxCharsParsed >= 1 && maxCharsParsed <= MAX_PAGE_TEXT_CHARS', repl: 'maxCharsParsed >= 0 && maxCharsParsed <= MAX_PAGE_TEXT_CHARS' },
  { id: 'M-048x4', note: '--offset accepted on any verb', file: PA, count: 1,
    find: "offsetIndex !== -1 && verb !== 'text'", repl: 'false' },
  { id: 'M-048x5', note: '--offset value not consumed (leaks into cleanArgs)', file: PA, count: 1,
    find: '(offsetIndex !== -1 && offsetRaw !== undefined && i === offsetIndex + 1) ||', repl: '' },
  { id: 'M-048x6', note: 'a flag given with no value is not an error', file: PA, count: 1,
    find: "offsetIndex !== -1 && offsetRaw === undefined\n          ? '--offset needs a value (e.g. text --offset 4000)'", repl: "false\n          ? '--offset needs a value (e.g. text --offset 4000)'" },
];

const runSuite = () => {
  const r = spawnSync(process.execPath, [`${WT}/node_modules/vitest/vitest.mjs`, 'run', '--globals', 'tests/unit/text-output.spec.ts', 'tests/unit/parse-args.spec.ts', 'tests/unit/help-text.spec.ts'], {
    cwd: CLI, timeout: 600000, encoding: 'utf8', env: { ...process.env },
  });
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
