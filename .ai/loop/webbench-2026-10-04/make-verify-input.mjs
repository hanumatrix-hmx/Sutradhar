#!/usr/bin/env node
// make-verify-input.mjs: builds the BLIND verifier input tree (protocol 4.4, review-2 finding 2).
//   node make-verify-input.mjs <runsDir> <outDir> [--mutations <file.json>] [--replay-out <file.json>]
// Output <outDir>/
//   <slot>/<id>.json         stripped record: ONLY {id, answerFields, shortList}. No classification, subflag,
//                            disclosure, toolDefects, notes, blockEvidence, driftChecks, attempts, finalUrl, answer.
//   <slot>/raw/<id>.jsonl    raw logs copied byte-for-byte (the chain must still verify)
//   check-evidence.json      check-evidence.mjs --blind --json run on THIS stripped tree (no classification field)
//   tasks.json               id -> {startingUrl, task, fields} for every task present
// summary.md, brief.md, raw.sha256 and anything else in runsDir are NOT copied.
// --mutations: orchestrator-only canary file [{slot, id, answerFields, shortList?}] applied to the OUTPUT copies
//              (originals in runsDir are never modified). Keep that file outside anything the verifier can read.
// --replay-out: orchestrator-only; writes the replay id list computed from the DRIVER classes (all SUTRADHAR-FAIL,
//              all AGENT-FAIL, ceil(40%) of COMPLETED and 3 EXTERNAL-BLOCK by sha256 rank), sorted by id. Hand the
//              verifier the ids only, after its phase-1 file exists.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LOOP, taskInfo } from './lib.mjs';

const [runsDir, outDir] = process.argv.slice(2);
const opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
if (!runsDir || !outDir) { console.error('usage: node make-verify-input.mjs <runsDir> <outDir> [--mutations f] [--replay-out f]'); process.exit(2); }
const mutations = opt('--mutations') ? JSON.parse(readFileSync(opt('--mutations'), 'utf8')) : [];
const FIELDS = JSON.parse(readFileSync(path.join(LOOP, 'task-fields.json'), 'utf8'));
rmSync(outDir, { recursive: true, force: true });
const tasks = {};
const driverClass = [];
for (const slot of readdirSync(runsDir).filter((d) => statSync(path.join(runsDir, d)).isDirectory() && /^(B[1-6]|K)$/.test(d))) {
  const src = path.join(runsDir, slot);
  mkdirSync(path.join(outDir, slot, 'raw'), { recursive: true });
  for (const f of readdirSync(src).filter((x) => /^\d+\.json$/.test(x))) {
    const id = f.replace('.json', '');
    const rec = JSON.parse(readFileSync(path.join(src, f), 'utf8'));
    driverClass.push({ slot, id, classification: rec.classification });
    const m = mutations.find((x) => x.slot === slot && String(x.id) === id);
    const stripped = { id: rec.id ?? Number(id), answerFields: (m ?? rec).answerFields ?? [], ...(((m ?? rec).shortList) ? { shortList: (m ?? rec).shortList } : {}) };
    writeFileSync(path.join(outDir, slot, f), JSON.stringify(stripped, null, 2));
    const raw = path.join(src, 'raw', `${id}.jsonl`);
    if (existsSync(raw)) copyFileSync(raw, path.join(outDir, slot, 'raw', `${id}.jsonl`));
    const t = taskInfo(id);
    tasks[id] = { startingUrl: t?.startingUrl, task: t?.task, fields: FIELDS[id] ?? [] };
  }
}
writeFileSync(path.join(outDir, 'tasks.json'), JSON.stringify(tasks, null, 2));
const ce = spawnSync(process.execPath, [path.join(LOOP, 'check-evidence.mjs'), outDir, '--blind', '--json'], { encoding: 'utf8' });
writeFileSync(path.join(outDir, 'check-evidence.json'), ce.stdout);
const leak = JSON.stringify(JSON.parse(ce.stdout)).match(/"classification"/g);
if (leak) { console.error('class leak in blind check-evidence output; aborting'); process.exit(1); }
for (const slot of readdirSync(outDir).filter((d) => statSync(path.join(outDir, d)).isDirectory())) {
  for (const f of readdirSync(path.join(outDir, slot)).filter((x) => x.endsWith('.json'))) {
    const s = readFileSync(path.join(outDir, slot, f), 'utf8');
    if (/classification|subflag|disclosure|toolDefects|blockEvidence|driftChecks|"notes"/.test(s)) { console.error(`class-revealing field left in ${slot}/${f}`); process.exit(1); }
  }
}
if (opt('--replay-out')) {
  const rank = (id) => createHash('sha256').update(`sutradhar-webbench-2026-10-04:verify:${id}`).digest('hex');
  const by = (c) => driverClass.filter((x) => x.classification === c && /^B[1-5]$/.test(x.slot)).sort((a, b) => rank(a.id).localeCompare(rank(b.id)));
  const comp = by('COMPLETED');
  const ids = [...by('SUTRADHAR-FAIL'), ...by('AGENT-FAIL'), ...comp.slice(0, Math.ceil(comp.length * 0.4)), ...by('EXTERNAL-BLOCK').slice(0, 3)]
    .map((x) => Number(x.id)).sort((a, b) => a - b);
  writeFileSync(opt('--replay-out'), JSON.stringify({ replayIds: [...new Set(ids)] }, null, 2));
}
console.log(`verify-input written to ${outDir}: ${Object.keys(tasks).length} tasks, ${mutations.length} mutation(s) applied, check-evidence exit ${ce.status}`);
