// FR2-06 audit-2 revert-and-confirm / mutation runner. For each mutation: back up the source file
// (byte-exact), apply a string replacement (asserting it matched exactly once), run the relevant
// vitest file(s), record pass/fail counts + which tests failed, then restore from the backup and
// verify the SHA-256 matches the original. Run from repo root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
const OUT = path.join(root, '.ai/loop/field-report-2/evidence/FR2-06/audit-2/mutation-logs');
fs.mkdirSync(OUT, { recursive: true });
const vitest = path.join(root, 'node_modules/.bin/vitest' + (process.platform === 'win32' ? '.CMD' : ''));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const M = [
  { id: 'M3b-gap206-faithful-revert-same-wrapper-but-validated-lazily-per-hop', file: 'packages/capability-runtime/src/runtime.ts', pkg: 'packages/capability-runtime', tests: ['tests/unit/runtime.spec.ts'],
    from: '    for (const hop of hops) {\n      try {\n        normalizedHops.push', to: '    const __v = (hop: string) => {\n      try {\n        normalizedHops.push',
    from2: '        throw e;\n      }\n    }\n    type Hoppable', to2: '        throw e;\n      }\n    };\n    type Hoppable',
    from3: 'const normalized = normalizedHops[i]!;', to3: '__v(hop); const normalized = normalizedHops[i]!;' },
];

const results = [];
for (const m of M) {
  const abs = path.join(root, m.file);
  const orig = fs.readFileSync(abs);
  const origSha = sha(orig);
  let src = orig.toString('utf8');
  // tolerate CRLF working copies
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const fix = (s) => s.replace(/\n/g, eol);
  const apply = (f, t) => {
    const n = src.split(fix(f)).length - 1;
    if (n !== 1) throw new Error(`${m.id}: pattern matched ${n} times: ${f}`);
    src = src.replace(fix(f), fix(t));
  };
  apply(m.from, m.to);
  if (m.from2) apply(m.from2, m.to2);
  if (m.from3) apply(m.from3, m.to3);
  fs.writeFileSync(abs, src);
  let r;
  try {
    r = spawnSync(vitest, ['run', '--globals', ...m.tests], { cwd: path.join(root, m.pkg), encoding: 'utf8', shell: process.platform === 'win32' });
  } finally {
    fs.writeFileSync(abs, orig);
  }
  const restoredOk = sha(fs.readFileSync(abs)) === origSha;
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  fs.writeFileSync(path.join(OUT, `${m.id}.log`), out);
  const clean = out.replace(/\x1b\[[0-9;]*m/g, '');
  const summary = (clean.match(/Tests\s+.*$/m) ?? [''])[0].trim();
  const failed = [...clean.matchAll(/^\s*(?:×|✗|FAIL)\s+(.+)$/gm)].map((x) => x[1].trim()).slice(0, 30);
  const killed = r.status !== 0;
  results.push({ id: m.id, killed, exit: r.status, summary, failed, restoredOk });
  console.log(`${m.id}: ${killed ? 'KILLED' : 'SURVIVED'} (${summary}) restored=${restoredOk}`);
}
fs.writeFileSync(path.join(OUT, '..', 'mutation-results-M3b.json'), JSON.stringify(results, null, 2));
