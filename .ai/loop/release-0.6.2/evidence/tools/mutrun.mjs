// Generic CRLF-aware copy-restore source mutant runner.
// usage: node mutrun.mjs <spec.json>   spec = { pkg, files: [vitest file args], mutants: [{id, note, file, count, find, repl}] }
// Run under the isolation preamble (TEMP etc. set). sha256 before/after is checked; a surviving mutant exits 1.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (mutants)'); process.exit(97); }
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const suites = spec.suites; // [{pkg, files}]
const runSuites = () => {
  let status = 0; const tests = []; const failed = [];
  for (const s of suites) {
    const r = spawnSync(process.execPath, [`${WT}/node_modules/vitest/vitest.mjs`, 'run', '--globals', ...s.files], {
      cwd: `${WT}/packages/${s.pkg}`, timeout: 900000, encoding: 'utf8', env: { ...process.env },
    });
    const clean = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
    if (r.status !== 0) status = r.status ?? 1;
    tests.push(/Tests\s+(.*)/.exec(clean)?.[1] ?? '?');
    failed.push(...(clean.match(/^\s*(?:FAIL|×)\s+.*$/gm) ?? []).map((x) => x.trim().slice(0, 160)));
  }
  return { status, tests: tests.join(' ; '), failed: [...new Set(failed)].slice(0, 4) };
};
const base = runSuites();
console.log(`BASELINE exit=${base.status} tests=${base.tests}`);
if (base.status !== 0) process.exit(2);
let survivors = 0;
for (const m of spec.mutants) {
  const file = m.file.startsWith('/') || /^[A-Za-z]:/.test(m.file) ? m.file : `${WT}/${m.file}`;
  const orig = readFileSync(file);
  const shaBefore = sha(orig);
  const text = orig.toString('utf8');
  const crlf = text.includes('\r\n');
  const n0 = crlf ? text.replace(/\r\n/g, '\n') : text;
  const cnt = n0.split(m.find).length - 1;
  if (cnt !== m.count) { console.log(`${m.id} BAD-APPLY expected ${m.count}, got ${cnt}`); process.exit(3); }
  let mutated = n0.split(m.find).join(m.repl);
  if (crlf) mutated = mutated.replace(/\n/g, '\r\n');
  let res;
  try { writeFileSync(file, mutated); res = runSuites(); } finally { writeFileSync(file, orig); }
  const shaAfter = sha(readFileSync(file));
  const killed = res.status !== 0;
  if (!killed) survivors++;
  console.log(`${m.id} ${killed ? 'KILLED' : 'SURVIVED'} exit=${res.status} tests=${res.tests} restored-sha-equal=${shaBefore === shaAfter} replacements=${cnt} crlf=${crlf} :: ${m.note} :: ${res.failed.join(' | ')}`);
  if (shaBefore !== shaAfter) { console.log('RESTORE MISMATCH'); process.exit(4); }
}
console.log(`survivors=${survivors}`);
process.exit(survivors === 0 ? 0 : 1);
