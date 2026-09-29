// audit-3 helper: applies a JSON patch file to audit-findings.json.
// patch = { upsertFindings: [ {id, ...fields} ], addVerified: [ ... ], setNotReached: [...], verdict }
// An upserted finding replaces the fields it names on an existing finding with the same id.
import fs from 'node:fs/promises';
import path from 'node:path';
import { here } from './lib.mjs';
const patch = JSON.parse(await fs.readFile(process.argv[2], 'utf-8'));
const f = path.join(here, 'audit-findings.json');
const j = JSON.parse(await fs.readFile(f, 'utf-8'));
for (const u of patch.upsertFindings ?? []) {
  const ex = j.findings.find((x) => x.id === u.id);
  if (ex) Object.assign(ex, u); else j.findings.push(u);
}
for (const v of patch.addVerified ?? []) j.verified.push(v);
if (patch.setNotReached) j.notReached = patch.setNotReached;
if (patch.verdict) j.verdict = patch.verdict;
await fs.writeFile(f, JSON.stringify(j, null, 2));
console.log('findings:', j.findings.map((x) => `${x.id}(${x.severity})`).join(' '), '| verified:', j.verified.length);
