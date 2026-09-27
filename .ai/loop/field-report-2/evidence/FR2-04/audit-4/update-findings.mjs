// audit-4 helper: merge a JSON patch file (argv[2]) into audit-findings.json.
// Patch shape: { verdict?, findings?: [...] (upserted by id), verified?: [...] (upserted by id), notes?: [...] (appended) }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const f = path.join(here, 'audit-findings.json');
const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
const patch = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const upsert = (arr, items) => {
  for (const it of items ?? []) {
    const i = arr.findIndex((x) => x.id === it.id);
    if (i >= 0) arr[i] = { ...arr[i], ...it }; else arr.push(it);
  }
};
if (patch.verdict) j.verdict = patch.verdict;
upsert(j.findings, patch.findings);
upsert(j.verified, patch.verified);
for (const n of patch.notes ?? []) j.notes.push(n);
for (const [k, v] of Object.entries(patch.extra ?? {})) j[k] = v;
j.updatedAt = new Date().toISOString();
fs.writeFileSync(f, JSON.stringify(j, null, 2));
console.log(`findings=${j.findings.length} verified=${j.verified.length} verdict=${j.verdict}`);
