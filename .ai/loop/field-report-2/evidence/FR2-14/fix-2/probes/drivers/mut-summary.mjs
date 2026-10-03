import fs from 'node:fs';
const EV = '.ai/loop/field-report-2/evidence/FR2-14/fix-2';
const rows = [];
for (const f of ['mutants.jsonl', 'mutants-audit.jsonl']) {
  for (const l of fs.readFileSync(`${EV}/${f}`, 'utf8').split('\n').filter(Boolean)) rows.push(JSON.parse(l));
}
// last valid (no error) row per id
const byId = new Map();
for (const r of rows) {
  if (!r.error || !byId.has(r.id)) byId.set(r.id, r);
}
const out = ['| id | mutant | caught by (failed tests per package) | restored sha256 | rebuild |', '|---|---|---|---|---|'];
let caught = 0;
let valid = 0;
const survivors = [];
for (const [id, r] of byId) {
  if (r.error) {
    out.push(`| ${id} | ${r.desc} | NOT COUNTED: ${r.error.slice(0, 90)} | ${r.restoredByteIdentical} | ${r.rebuildCode} |`);
    continue;
  }
  valid++;
  if (r.caught) caught++;
  else survivors.push(id);
  const by = Object.entries(r.unit)
    .filter(([, u]) => u.code !== 0)
    .map(([p, u]) => `${p}: ${u.tests.replace(/\s+/g, ' ').split('|').join(',')}`)
    .join('; ');
  out.push(`| ${id} | ${r.desc} | ${r.caught ? by : '**SURVIVED**'} | ${r.restoredByteIdentical} | ${r.rebuildCode} |`);
}
out.push('', `valid mutants: ${valid}; caught by unit tests: ${caught}; survivors: ${survivors.join(', ') || 'none'}`);
const keep = fs.existsSync(`${EV}/mutants-summary.md`) ? fs.readFileSync(`${EV}/mutants-summary.md`, 'utf8') : '';
const tail = keep.includes('Audit-2') ? keep.slice(keep.indexOf('\nAudit-2')) : '';
fs.writeFileSync(`${EV}/mutants-summary.md`, out.join('\n') + '\n' + tail);
console.log(out.slice(-1)[0]);
console.log(rows.filter((r) => r.error).map((r) => r.id + ': ' + r.error.slice(0, 60)).join('\n'));
