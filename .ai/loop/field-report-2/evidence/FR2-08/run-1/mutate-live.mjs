// FR2-08 LIVE mutants: applies one mutant of my own code, REBUILDS the package (tsc), runs a targeted slice of the live
// verify script against real Chrome, restores the source byte-identically (sha256) and REBUILDS again.
// Usage: node mutate-live.mjs <repoRoot> <outJson> [--only=L1,L2]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = process.argv[2];
const out = process.argv[3];
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tscOf = (pkg) => () => spawnSync(process.execPath, [path.join(repo, 'node_modules/typescript/bin/tsc'), '-p', pkg], { cwd: repo, encoding: 'utf8', timeout: 300000 });

const CW = 'packages/browser/src/actions/condition-wait.ts';
const PS = 'packages/browser/src/actions/page-settle.ts';
const CLI = 'packages/cli/src/cli.ts';
const MUTANTS = [
  { id: 'L1', why: 'wait_for treats "unavailable" as met', file: CW, pkg: 'packages/browser', surface: 'mcp', only: 'H3,M:iframe-cross-origin|visibility-hidden|inner',
    from: "CONDITION_KEYS.every((k) => condition[k] === undefined || st.results[k] === 'met')", to: "CONDITION_KEYS.every((k) => condition[k] === undefined || st.results[k] !== 'unmet')" },
  { id: 'L2', why: 'textGone reads "unavailable" as gone', file: CW, pkg: 'packages/browser', surface: 'mcp', only: 'H3',
    from: "          st.results[k] = 'unavailable';\n          st.details[k] = r.detail;\n          continue;", to: "          st.results[k] = k === 'textGone' ? 'met' : 'unavailable';\n          st.details[k] = r.detail;\n          continue;" },
  { id: 'L3', why: 'the condition is checked ONCE only', file: CW, pkg: 'packages/browser', surface: 'mcp', only: 'L1',
    from: 'if (left <= 0) return finish(false);', to: 'return finish(false);' },
  { id: 'L4', why: 'a pending native dialog is ignored', file: CW, pkg: 'packages/browser', surface: 'mcp', only: 'N10',
    from: '        if (dialog) {\n          const t = now();', to: '        if ((false as boolean) && dialog) {\n          const t = now();' },
  { id: 'L5', why: 'NO Node-side settle hard bound (the T5 defect restored)', file: PS, pkg: 'packages/browser', surface: 'mcp', only: 'N18',
    from: 'await Promise.race([Promise.all([domQuiet, networkIdle]), hardBound]);', to: 'await Promise.all([domQuiet, networkIdle]);' },
  { id: 'L6', why: 'multiple conditions are ORed instead of ANDed', file: CW, pkg: 'packages/browser', surface: 'mcp', only: 'L9',
    from: "CONDITION_KEYS.every((k) => condition[k] === undefined || st.results[k] === 'met')", to: "CONDITION_KEYS.some((k) => condition[k] !== undefined && st.results[k] === 'met')" },
  { id: 'L7', why: 'the CLI accepts a condition flag on another verb (D16 rejection removed)', file: CLI, pkg: 'packages/cli', surface: 'cli', only: 'N-C3',
    from: "  if (verb !== 'waitfor' && Object.keys(waitForFlags).length > 0) {", to: "  if (false as boolean) {" },
  { id: 'L9', why: 'settle skipped for the runtime-level tools (settlePage is a no-op): navigate/click_at_point/handle_dialog/fill_form return before the page finished', file: 'packages/capability-runtime/src/runtime.ts', pkg: 'packages/capability-runtime', surface: 'mcp', only: 'S:navigate,S:click_at_point,S:handle_dialog,S:fill_form,S:go_back',
    from: 'if (settle && this.hasRealPage(tab)) await waitForPageSettle(tab.page!, settle);', to: '' },
  { id: 'L10', why: 'the newly wired browser.hover tool drops settle before calling the runtime', file: 'packages/mcp-server/src/tools.ts', pkg: 'packages/mcp-server', surface: 'mcp', only: 'S:hover',
    from: 'runtime.hover(sessionId, target, tabId, offset, ...expectSettleArgs(expect, settle))', to: 'runtime.hover(sessionId, target, tabId, offset, ...(expect ? [expect] : []))' },
  { id: 'L8', why: 'a js throw is treated as transient (the wait runs to its timeout instead of failing at once)', file: CW, pkg: 'packages/browser', surface: 'mcp', only: 'N2',
    from: '          if (isTransientContextError(e)) {', to: '          if (true as boolean) {' },
];

const res = [];
const originals = new Map();
const rebuilt = new Set();
try {
  for (const m of MUTANTS) {
    if (only.length && !only.includes(m.id)) continue;
    const target = path.join(repo, m.file);
    if (!originals.has(target)) originals.set(target, fs.readFileSync(target));
    const original = originals.get(target);
    const before = sha(original);
    const src = original.toString('utf8').replace(/\r\n/g, '\n');
    if (src.split(m.from).length !== 2) { res.push({ id: m.id, error: 'pattern' }); console.log(m.id, 'PATTERN ERROR'); continue; }
    fs.writeFileSync(target, src.replace(m.from, () => m.to));
    const tsc = tscOf(m.pkg);
    const b = tsc();
    const evDir = path.join(repo, '.ai/loop/field-report-2/evidence/FR2-08/run-1/mutant-live', m.id);
    const t0 = performance.now();
    const r = spawnSync(process.execPath, ['tools/scenario-suite/verify-fr2-08-conditions.mjs', `--only=${m.only}`, `--surface=${m.surface}`], { cwd: repo, encoding: 'utf8', timeout: 900000, env: { ...process.env, SUTRADHAR_FR2_08_EVIDENCE_DIR: evDir }, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(target, original);
    const b2 = tsc(); // rebuild the RESTORED source
    const lines = (r.stdout || '').split('\n');
    const summary = lines.filter((l) => /passed/.test(l)).pop() ?? '';
    const fails = lines.filter((l) => /\] FAIL/.test(l)).map((l) => l.slice(0, 200));
    const row = { id: m.id, why: m.why, only: m.only, surface: m.surface, tscMutantExit: b.status, tscRestoreExit: b2.status, caughtLive: r.status !== 0 && fails.length > 0, exit: r.status, summary, failCount: fails.length, firstFails: fails.slice(0, 3), restoredIdentical: sha(fs.readFileSync(target)) === before, ms: Math.round(performance.now() - t0) };
    res.push(row);
    console.log(m.id, row.caughtLive ? 'CAUGHT LIVE' : 'NOT CAUGHT', summary, row.restoredIdentical ? 'restored' : 'RESTORE MISMATCH');
  }
} finally {
  for (const [t, b] of originals) fs.writeFileSync(t, b);
  for (const pkg of ['packages/browser', 'packages/cli', 'packages/capability-runtime', 'packages/mcp-server']) tscOf(pkg)();
}
const shas = {};
for (const [t, b] of originals) shas[path.relative(repo, t)] = { before: sha(b), after: sha(fs.readFileSync(t)) };
fs.writeFileSync(out, JSON.stringify({ allIdentical: Object.values(shas).every((x) => x.before === x.after), shas, res }, null, 2));
console.log('done; all identical:', Object.values(shas).every((x) => x.before === x.after));
