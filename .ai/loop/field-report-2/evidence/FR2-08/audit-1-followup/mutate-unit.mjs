// AUDIT-1 mutants (new, not the builder's U1-U23). Each: sha256 before, exactly-once replace, run the package's
// vitest, restore, sha256 after must equal before. Source only (vitest reads src); dist is not touched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const WT = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const CW = 'packages/browser/src/actions/condition-wait.ts';
const PS = 'packages/browser/src/actions/page-settle.ts';
const EV = 'packages/browser/src/verifier/execution-verifier.ts';
const PA = 'packages/cli/src/parse-args.ts';
const WO = 'packages/cli/src/waitfor-output.ts';
const RT = 'packages/capability-runtime/src/runtime.ts';
const B = { pkg: 'packages/browser', specs: ['tests/unit/condition-wait.spec.ts', 'tests/unit/page-settle.spec.ts', 'tests/unit/browser-action-engine.spec.ts', 'tests/unit/execution-verifier.spec.ts'] };
const M = [
  { id: 'X1', why: 'dialog gate ignores js-only conditions (js probe runs into an open dialog)', file: CW, ...B, find: 'condition.textGone !== undefined || condition.js !== undefined;', repl: 'condition.textGone !== undefined;' },
  { id: 'X2', why: 'dialog grace timer never resets once a dialog is handled (a later dialog fails instantly)', file: CW, ...B, find: '        dialogSince = undefined;', repl: '        /* mutant */' },
  { id: 'X3', why: 'an unavailable textGone pass sets presentAtStart=false (vacuous verdict from a pass that saw nothing)', file: CW, ...B, find: "          st.results[k] = 'unavailable';\n          st.details[k] = r.detail;\n          continue;", repl: "          st.results[k] = 'unavailable';\n          st.details[k] = r.detail;\n          if (k === 'textGone') presentAtStart ??= false;\n          continue;" },
  { id: 'X4', why: 'Target closed / Session closed treated as a fatal js throw instead of transient', file: CW, ...B, find: '|Target closed|Session closed/i', repl: '/i' },
  { id: 'X5', why: 'settle ignores the network-idle half (only DOM quiet awaited)', file: PS, ...B, find: 'Promise.race([Promise.all([domQuiet, networkIdle]), hardBound])', repl: 'Promise.race([domQuiet, hardBound])' },
  { id: 'X6', why: 'a settle object override of timeoutMs is ignored', file: PS, ...B, find: 'timeoutMs: settle.timeoutMs ?? DEFAULT_SETTLE_SPEC.timeoutMs,', repl: 'timeoutMs: DEFAULT_SETTLE_SPEC.timeoutMs,' },
  { id: 'X7', why: 'shared probe: a HUNG frame counts as absent (fail-open: textGone met while a frame never answered)', file: EV, ...B, find: "return r.timedOut ? 'hung' : 'failed';", repl: "return r.timedOut ? 'absent' : 'failed';" },
  { id: 'X8', why: 'CLI: dialog-blocked wait exits 1 instead of 3', file: WO, pkg: 'packages/cli', specs: ['tests/unit/waitfor-output.spec.ts'], find: '? EXIT_BLOCKED_BY_DIALOG : 1', repl: '? 1 : 1' },
  { id: 'X9', why: 'CLI: --url value not consumed (leaks into positional args)', file: PA, pkg: 'packages/cli', specs: ['tests/unit/parse-args.spec.ts'], find: '(waitUrlIndex !== -1 && waitUrlValue !== undefined && i === waitUrlIndex + 1) ||', repl: '' },
  { id: 'X10', why: 'runtime waitFor: validation after resolveTab (browser contacted before a bad condition is rejected)', file: RT, pkg: 'packages/capability-runtime', specs: ['tests/unit/runtime.spec.ts'], find: '    const { condition: c, timeoutMs } = normalizePageCondition(condition, condition?.timeoutMs);\n    const { tab } = this.resolveTab(sessionId, tabId);', repl: '    const { tab } = this.resolveTab(sessionId, tabId);\n    const { condition: c, timeoutMs } = normalizePageCondition(condition, condition?.timeoutMs);' },
  { id: 'X11', why: 'runtime waitFor: history always records success:true', file: RT, pkg: 'packages/capability-runtime', specs: ['tests/unit/runtime.spec.ts'], find: "      actionType: 'wait_for',\n      selector: describePageCondition(c),\n      success: result.success,", repl: "      actionType: 'wait_for',\n      selector: describePageCondition(c),\n      success: true," },
];
const only = process.argv[2] ? process.argv[2].split(',') : null;
const out = [];
for (const m of M) {
  if (only && !only.includes(m.id)) continue;
  const f = path.join(WT, m.file);
  const before = sha(f);
  const src = fs.readFileSync(f, 'utf-8').replace(/\r\n/g, '\n');
  const crlf = fs.readFileSync(f, 'utf-8').includes('\r\n');
  const count = src.split(m.find).length - 1;
  if (count !== 1) { out.push({ id: m.id, why: m.why, error: `pattern occurs ${count} times` }); console.log(m.id, 'PATTERN', count); continue; }
  const orig = fs.readFileSync(f);
  let mut = src.replace(m.find, m.repl);
  if (crlf) mut = mut.replace(/\n/g, '\r\n');
  fs.writeFileSync(f, mut);
  let r;
  try {
    r = spawnSync(process.execPath, [path.join(WT, 'node_modules/vitest/vitest.mjs'), 'run', '--globals', ...m.specs], { cwd: path.join(WT, m.pkg), encoding: 'utf-8', timeout: 600000 });
  } finally { fs.writeFileSync(f, orig); }
  const after = sha(f);
  const txt = (r.stdout || '') + (r.stderr || '');
  const failed = [...txt.matchAll(/FAIL\s+(.+)/g)].map((x) => x[1].slice(0, 160));
  const row = { id: m.id, why: m.why, file: m.file, caught: r.status !== 0, exit: r.status, tests: (txt.match(/Tests\s+.*/) || [''])[0].replace(/\x1b\[[0-9;]*m/g, ''), firstFailures: [...new Set(failed)].slice(0, 4), shaBefore: before, shaAfter: after, restored: before === after };
  out.push(row);
  console.log(m.id, row.caught ? 'CAUGHT' : 'SURVIVED', row.tests, 'restored=' + row.restored);
}
fs.writeFileSync(path.join(WT, '.ai/loop/field-report-2/evidence/FR2-08/audit-1-followup', `mutation-unit${only ? '-' + only.join('_') : ''}.json`), JSON.stringify(out, null, 2));
