// Mutation runner (scratchpad helper, not product code).
// usage: node mutrun.cjs <defs.cjs> <evidence-out.txt> [mutantId...]
// defs.cjs exports { cwd, vitestBin, env?, mutants: [{id, file, edits:[{from,to,all?}], tests:[files], mustFail:[names]}] }
// For each mutant: sha256 before, apply exact-string edits (each `from` must occur), run vitest, ALWAYS restore the
// original bytes, sha256 after (must equal before), report which tests failed.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { spawnSync } = require('child_process');
const defs = require(path.resolve(process.argv[2])); const out = process.argv[3]; const only = process.argv.slice(4);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const lines = [];
const log = (l) => { console.log(l); lines.push(l); };
let allOk = true;
for (const m of defs.mutants) {
  if (only.length && !only.includes(m.id)) continue;
  const file = path.resolve(defs.cwd, m.file);
  const orig = fs.readFileSync(file); const before = sha(orig);
  let text = orig.toString('utf8'); let applied = true;
  const crlf = text.includes('\r\n'); const cv = (s) => (crlf ? s.replace(/\r?\n/g, '\r\n') : s);
  for (const e0 of m.edits) {
    const e = { ...e0, from: cv(e0.from), to: cv(e0.to) };
    const n = text.split(e.from).length - 1;
    if (n === 0 || (!e.all && n !== 1)) { log(`## ${m.id}: EDIT NOT APPLICABLE (occurrences=${n}) for: ${e0.from.slice(0, 80)}`); applied = false; break; }
    text = e.all ? text.split(e.from).join(e.to) : text.replace(e.from, () => e.to);
  }
  if (!applied) { allOk = false; continue; }
  let res;
  try {
    fs.writeFileSync(file, text);
    res = spawnSync(defs.node ?? process.execPath, [defs.vitestBin, 'run', '--globals', ...(m.tests ?? defs.tests)], { cwd: path.resolve(defs.cwd, defs.vitestCwd ?? '.'), env: { ...process.env, ...(defs.env ?? {}) }, encoding: 'utf8', timeout: m.timeoutMs ?? 300000, maxBuffer: 64 * 1024 * 1024 });
  } finally {
    fs.writeFileSync(file, orig);
  }
  const after = sha(fs.readFileSync(file));
  const o = (res.stdout || '') + (res.stderr || ''); const clean = o.replace(/\x1b\[[0-9;]*m/g, '');
  const failed = [...clean.matchAll(/^\s*(?:FAIL|×)\s+(.*)$/gm)].map((x) => x[1].trim());
  const summary = (clean.match(/Tests\s+.*$/m) || ['(no Tests line)'])[0].trim();
  const restored = before === after;
  const needed = m.mustFail ?? [];
  const caught = needed.every((n) => failed.some((f) => f.includes(n)));
  log(`## ${m.id}: exit=${res.status} signal=${res.signal ?? ''} ${summary}`);
  log(`   sha-before=${before} sha-after=${after} restored=${restored}`);
  log(`   must-fail=[${needed.join(', ')}] caught=${caught}`);
  for (const f of [...new Set(failed)].slice(0, 8)) log(`   FAILED: ${f}`);
  if (!restored || !caught || res.status === 0) allOk = false;
}
log(allOk ? 'ALL-MUTANTS-CAUGHT-AND-RESTORED' : 'MUTANT-RUN-PROBLEM');
fs.writeFileSync(out, lines.join('\n') + '\n');
process.exitCode = allOk ? 0 : 1;
