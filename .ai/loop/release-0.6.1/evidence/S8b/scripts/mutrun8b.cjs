// S8b mutant runner: ONLY the scratch copy $SP/S8b/mut/packages/cli is mutated (never the worktree). Per mutant: restore the
// copy's files from WT, apply each edit (anchor must occur EXACTLY once; CRLF files keep CRLF), run vitest (JSON), list the
// failed tests, restore, verify byte-identical to WT. CAUGHT = >=1 failure AND every mustFail substring matches a failed test.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const SP = 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const MUT = SP + '/S8b/mut/packages/cli'; const JD = SP + '/S8b/mutjson'; fs.mkdirSync(JD, { recursive: true });
const defs = require(process.argv[2]); const outFile = process.argv[3]; const only = process.argv[4] ? process.argv[4].split(',') : null;
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const restore = (rel) => fs.copyFileSync(path.join(WT, 'packages/cli', rel), path.join(MUT, rel));
const emit = (s) => { console.log(s); fs.appendFileSync(outFile, s + '\n'); };
let summary = [];
for (const m of defs) {
  if (only && !only.includes(m.id)) continue;
  const files = [...new Set((m.edits ?? []).map((e) => e.file))];
  for (const f of files) restore(f);
  let bad = false;
  for (const e of m.edits ?? []) {
    const f = path.join(MUT, e.file); const raw = fs.readFileSync(f, 'utf8'); const crlf = raw.includes('\r\n'); const s = raw.replace(/\r\n/g, '\n');
    const n = s.split(e.from).length - 1;
    if (n !== 1) { emit(`## ${m.id}: ANCHOR-COUNT=${n} in ${e.file} (NOT APPLIED)`); bad = true; break; }
    const t = s.replace(e.from, () => e.to); fs.writeFileSync(f, crlf ? t.replace(/\n/g, '\r\n') : t);
  }
  if (bad) { for (const f of files) restore(f); summary.push(`${m.id} NOT-APPLIED`); continue; }
  const jf = path.join(JD, `mut-${m.id}.json`); try { fs.rmSync(jf); } catch {}
  const t0 = performance.now();
  const r = cp.spawnSync(process.execPath, [path.join(WT, 'node_modules/vitest/vitest.mjs'), 'run', '--globals', '--reporter=json', `--outputFile=${jf}`, ...m.specs], { cwd: MUT, env: process.env, encoding: 'utf8', timeout: 600000 });
  let failed = [], total = '?';
  try { const j = JSON.parse(fs.readFileSync(jf, 'utf8')); total = `${j.numFailedTests} failed | ${j.numPassedTests} passed | ${j.numPendingTests} skipped | suites-failed ${j.numFailedTestSuites}`;
    for (const tr of j.testResults) { if (tr.status === 'failed' && !tr.assertionResults.some((a) => a.status === 'failed')) failed.push(`${path.basename(tr.name)} > SUITE-LOAD-FAILURE ${String(tr.message).slice(0, 200)}`);
      for (const a of tr.assertionResults) if (a.status === 'failed') failed.push(`${path.basename(tr.name)} > ${a.fullName}`); } } catch (e) { total = 'NO-JSON ' + e.message; }
  for (const f of files) restore(f);
  const same = files.every((f) => sha(path.join(MUT, f)) === sha(path.join(WT, 'packages/cli', f)));
  const isBaseline = (m.edits ?? []).length === 0;
  const caught = isBaseline ? failed.length === 0 : failed.length > 0 && (m.mustFail ?? []).every((t) => failed.some((f) => f.includes(t)));
  const loadFail = failed.some((f) => f.includes('SUITE-LOAD-FAILURE'));
  emit(`## ${m.id}: vitest-exit=${r.status} ${total} ms=${Math.round(performance.now() - t0)} restored-identical=${same}\n   change: ${m.desc}\n   must-fail=${JSON.stringify(m.mustFail ?? [])} ${isBaseline ? 'BASELINE-GREEN' : 'CAUGHT'}=${caught}${loadFail ? ' (SUITE-LOAD-FAILURE present)' : ''}\n` + failed.map((f) => '   FAILED: ' + f).join('\n'));
  summary.push(`${m.id} ${isBaseline ? 'BASELINE-GREEN' : 'CAUGHT'}=${caught} restored=${same}${loadFail ? ' LOADFAIL' : ''}`);
}
emit('# SUMMARY\n' + summary.join('\n'));
