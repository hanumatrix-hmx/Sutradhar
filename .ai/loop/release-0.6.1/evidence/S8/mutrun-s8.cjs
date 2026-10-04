// S8 auditor mutant runner. Operates ONLY on the scratch copy $SP/S8/mut/packages/cli (never the worktree source).
// For each mutant: restore the copy's file from the worktree, apply the edit (anchor must occur EXACTLY once), run vitest
// on the named spec files (JSON reporter), record which tests failed, restore, verify the copy is byte-identical to WT.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const SP = 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const MUT = SP + '/S8/mut/packages/cli';
const defs = require(process.argv[2]); const only = process.argv[3] ? process.argv[3].split(',') : null;
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const restore = (rel) => fs.copyFileSync(path.join(WT, 'packages/cli', rel), path.join(MUT, rel));
const out = [];
for (const m of defs) {
  if (only && !only.includes(m.id)) continue;
  for (const e of m.edits) restore(e.file);
  for (const e of m.edits) {
    const f = path.join(MUT, e.file); const s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
    const n = s.split(e.from).length - 1;
    if (n !== 1) { out.push(`## ${m.id}: ANCHOR-COUNT=${n} in ${e.file} (not applied)`); console.log(out.at(-1)); m.bad = true; break; }
    fs.writeFileSync(f, s.replace(e.from, e.to));
  }
  if (m.bad) { for (const e of m.edits) restore(e.file); continue; }
  const jf = path.join(SP, 'S8', `mut-${m.id}.json`);
  const t0 = performance.now();
  const r = cp.spawnSync(process.execPath, [path.join(WT, 'node_modules/vitest/vitest.mjs'), 'run', '--globals', '--reporter=json', `--outputFile=${jf}`, ...m.specs], { cwd: MUT, env: process.env, encoding: 'utf8', timeout: 600000 });
  let failed = [], total = '?';
  try { const j = JSON.parse(fs.readFileSync(jf, 'utf8')); total = `${j.numFailedTests} failed | ${j.numPassedTests} passed | ${j.numPendingTests} skipped`;
    for (const tr of j.testResults) for (const a of tr.assertionResults) if (a.status === 'failed') failed.push(`${path.basename(tr.name)} > ${a.fullName}`); } catch (e) { total = 'NO-JSON ' + e.message; }
  for (const e of m.edits) restore(e.file);
  const same = m.edits.every((e) => sha(path.join(MUT, e.file)) === sha(path.join(WT, 'packages/cli', e.file)));
  const caught = failed.length > 0 && (m.mustFail ?? []).every((t) => failed.some((f) => f.includes(t)));
  out.push(`## ${m.id}: vitest-exit=${r.status} ${total} ms=${Math.round(performance.now() - t0)} restored-identical=${same}\n   change: ${m.desc}\n   must-fail=${JSON.stringify(m.mustFail ?? [])} CAUGHT=${caught}\n` + failed.map((f) => '   FAILED: ' + f).join('\n'));
  console.log(out.at(-1));
}
fs.appendFileSync(process.argv[4] ?? path.join(SP, 'S8', 'mutants.out'), out.join('\n') + '\n');
