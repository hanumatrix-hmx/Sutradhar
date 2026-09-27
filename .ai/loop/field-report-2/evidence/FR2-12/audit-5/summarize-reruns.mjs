// Summarize audit-5/rerun-a* outputs next to audit-4's for the same probes.
import fs from 'node:fs';
import path from 'node:path';
import { here, outPath } from './lib.mjs';
const a4 = path.join(here, '..', 'audit-4');
const rd = (base, f) => { try { return JSON.parse(fs.readFileSync(path.join(base, f), 'utf8')); } catch { return null; } };
const res = {};
const pairs = [
  ['rerun-a3/probe-runtime-all.json', (j) => ({ verdicts: j.verdicts, cdp: j.cdpStats })],
  ['rerun-a3/probe-runtime-heavy.json', (j) => ({ verdicts: j.verdicts, cdp: j.cdpStats })],
  ['rerun-a3/probe-regress-concurrent-vitals.json', (j) => ({ b2: j.b2, vitalsOk: Array.isArray(j.vitals) ? `${j.vitals.filter((v) => v.ok).length}/${j.vitals.length}` : j.vitals, concurrent: JSON.stringify(j.concurrent).slice(0, 300), tabsAfterClose: j.tabsAfterClose, b2Injected: j.b2Injected })],
  ['rerun-a3/probe-real-docstatus.json', (j) => ({ rows: j.rows?.length, missed: j.rows?.filter((r) => r.missed || r.ok === false).length, sample: JSON.stringify(j.rows?.slice(0, 2)).slice(0, 300) })],
  ['rerun-a2/probe-gap262-runtime-all.json', (j) => ({ cases: Object.fromEntries(Object.entries(j.cases ?? {}).map(([k, v]) => [k, typeof v === 'object' ? (v.summary ?? v.verdict ?? JSON.stringify(v).slice(0, 160)) : v])) })],
  ['rerun-a2/probe-regress-concurrent-vitals.json', (j) => ({ b2: j.b2, vitalsOk: Array.isArray(j.vitals) ? `${j.vitals.filter((v) => v.ok).length}/${j.vitals.length}` : j.vitals })],
  ['rerun-a2/gap263-ajv.json', (j) => ({ baseValid: j.baseValid, cases: JSON.stringify(j.cases).slice(0, 400) })],
  ['rerun-a1/probe-runtime.json', (j) => ({ probes: Object.fromEntries(Object.entries(j.probes ?? {}).map(([k, v]) => [k, JSON.stringify(v).slice(0, 220)])) })],
  ['rerun-a1/probe-sdk-schema.json', (j) => ({ cases: JSON.stringify(j.cases).slice(0, 400) })],
];
for (const [f, fn] of pairs) {
  const cur = rd(here, f); const old = rd(a4, f);
  res[f] = { audit5: cur ? fn(cur) : 'MISSING', audit4: old ? fn(old) : 'MISSING' };
}
fs.writeFileSync(outPath('rerun-summary-runtime.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 1).slice(0, 20000));
