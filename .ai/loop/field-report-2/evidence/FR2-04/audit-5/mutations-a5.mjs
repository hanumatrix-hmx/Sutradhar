// FR2-04 audit-5: mutation-test escalation-1 (e70394a) + re-run audit-4 named survivors.
// Harness derived from audit-3/mutations.mjs: each mutation edits ONE product source file
// (EOL-aware), runs the WHOLE vitest suite of that package, then restores the original bytes and
// verifies sha256 (the run aborts with exit 2 if a restore ever fails). KILLED = any test failed.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { repoRoot, here } from './lib.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const VITEST = path.join(repoRoot, 'node_modules/.bin/vitest.CMD');
const CDP = 'packages/browser/src/session/dialog-cdp.ts';
const W = 'packages/browser/src/session/dialog-warden.ts';
const B = 'packages/cli/src/dialog-broker.ts';
const DC = 'packages/cli/src/dialog-cli.ts';
const NEWEST = '(y.discoveredAt ?? 0) - (x.discoveredAt ?? 0)';
const OLDEST = '(x.discoveredAt ?? 0) - (y.discoveredAt ?? 0)';

const C = 'packages/cli/src/warden-control.ts';
const CLI = 'packages/cli/src/cli.ts';

// audit-5: (a) audit-4's named survivors A13/A20/M22/M23/M26 re-anchored to e70394a (point 8);
// (b) escalation-1's own design points (point 6).
const M = [
  { id: 'A13-warden-drops-discoveredAt', file: W, find: '        discoveredAt: this.discoveredAt.get(info.targetId),', repl: '        discoveredAt: undefined,', pkg: 'browser' },
  { id: 'A20-selectDialog-picks-first', file: DC, find: '  const target = sorted.find((d) => !d.blockedBy && !d.confirmedSafe);', repl: '  const target = sorted[0];', pkg: 'cli' },
  { id: 'A20b-selectDialog-ignores-blockedBy', file: DC, find: '  const target = sorted.find((d) => !d.blockedBy && !d.confirmedSafe);', repl: '  const target = sorted.find((d) => !d.confirmedSafe);', pkg: 'cli' },
  { id: 'A20c-selectDialog-ignores-confirmedSafe', file: DC, find: '  const target = sorted.find((d) => !d.blockedBy && !d.confirmedSafe);', repl: '  const target = sorted.find((d) => !d.blockedBy);', pkg: 'cli' },
  { id: 'M22-lock-no-readback', file: C, find: 'return after.pid === payload.pid && after.startedAt === payload.startedAt;', repl: 'return true;', pkg: 'cli' },
  { id: 'M23-rival-check-disabled', file: C, find: 'return !!health && health.wsEndpoint === wsEndpoint;', repl: 'return false;', pkg: 'cli' },
  { id: 'M26-closedTarget-not-surfaced', file: B, find: '    if (body?.closedTarget) return { closedTarget: true, message: body.message };', repl: '    void body;', pkg: 'cli' },
  // --- escalation-1 design (point 6) ---
  { id: 'E1-confirmedSafe-opaque(skips-subtree)', file: CDP, find: '    const children = childrenByOpener.get(id) ?? [];', repl: '    const children = byId.get(id)!.confirmedSafe ? [] : (childrenByOpener.get(id) ?? []);', pkg: 'browser' },
  { id: 'E1b-split-graph(no-edges-through-confirmedSafe)', file: CDP, find: '    if (b.openerTargetId && byId.has(b.openerTargetId)) {', repl: '    if (b.openerTargetId && byId.has(b.openerTargetId) && !byId.get(b.openerTargetId)!.confirmedSafe) {', pkg: 'browser' },
  { id: 'E2-confirmedSafe-can-be-holder', file: CDP, find: ': byId.get(id)!.confirmedSafe ? undefined : id;', repl: ': id;', pkg: 'browser' },
  { id: 'E3-proactive-probe-immediate-for-all', file: W, find: 'const delayMs = bootstrap ? 0 : (this.opts.proactiveConfirmDelayMs ?? DEFAULT_PROACTIVE_CONFIRM_DELAY_MS);', repl: 'const delayMs = 0;', pkg: 'browser' },
  { id: 'E4-no-bootstrap-exception', file: W, find: 'const delayMs = bootstrap ? 0 : (this.opts.proactiveConfirmDelayMs ?? DEFAULT_PROACTIVE_CONFIRM_DELAY_MS);', repl: 'const delayMs = this.opts.proactiveConfirmDelayMs ?? DEFAULT_PROACTIVE_CONFIRM_DELAY_MS;', pkg: 'browser' },
  { id: 'E5-no-proactive-probe', file: W, find: '          if (!this.confirmedResponsiveSince.has(targetId)) {', repl: '          if (false) {', pkg: 'browser' },
  { id: 'E6-no-reactive-confirmation', file: W, find: "      if (states.get(info.targetId) === 'responsive' && this.pageEnableAckedAt.has(info.targetId) && !this.confirmedResponsiveSince.has(info.targetId)) {", repl: '      if (false) {', pkg: 'browser' },
  { id: 'E7-reactive-confirm-without-ack', file: W, find: "      if (states.get(info.targetId) === 'responsive' && this.pageEnableAckedAt.has(info.targetId) && !this.confirmedResponsiveSince.has(info.targetId)) {", repl: "      if (states.get(info.targetId) === 'responsive' && !this.confirmedResponsiveSince.has(info.targetId)) {", pkg: 'browser' },
  { id: 'E8-warden-recovery-ignores-confirmedSafe', file: W, find: '    if (entry.confirmedSafe) {', repl: '    if (false) {', pkg: 'browser' },
  { id: 'E9-warden-never-passes-confirmedSafe', file: W, find: '        confirmedSafe: this.confirmedResponsiveSince.has(info.targetId),', repl: '        confirmedSafe: false,', pkg: 'browser' },
  { id: 'E11-proactive-ignores-tracked-dialog(guard)', file: W, find: '              if (this.stopped || this.confirmedResponsiveSince.has(targetId) || this.dialogs.has(targetId)) return;', repl: '              if (this.stopped || this.confirmedResponsiveSince.has(targetId)) return;', pkg: 'browser' },
  { id: 'E12-proactive-marks-safe-regardless-of-state', file: W, find: "                  if (state === 'responsive' && !this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {", repl: '                  if (!this.confirmedResponsiveSince.has(targetId)) {', pkg: 'browser' },
  { id: 'E13-destroy-keeps-confirmed', file: W, find: '      this.confirmedResponsiveSince.delete(targetId);', repl: '      void 0;', pkg: 'browser' },
  { id: 'E10-direct-refusal-becomes-throw', file: B, find: "      if (state === 'responsive') throw err;", repl: "      if (state === 'responsive' || true) throw err;", pkg: 'cli' },
  { id: 'E18-wardenbroker-drops-confirmedSafe-branch', file: B, find: '      if (body.confirmedSafe) {', repl: '      if (false) {', pkg: 'cli' },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = [];
const outFile = path.join(here, `mutations-a5-${only.length ? only.join('+').slice(0,40) : 'all'}.json`);
for (const m of M) {
  if (only.length && !only.some((o) => m.id.startsWith(o))) continue;
  const abs = path.join(repoRoot, m.file);
  const orig = await fs.readFile(abs);
  const origSha = sha(orig);
  const text = orig.toString('utf-8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const find = m.find.replace(/\n/g, eol), repl = m.repl.replace(/\n/g, eol);
  const count = text.split(find).length - 1;
  if (m.multi ? count < 1 : count !== 1) { results.push({ id: m.id, error: `find matched ${count} times` }); console.log(m.id, 'SKIP find count', count); continue; }
  const mutated = m.multi ? text.split(find).join(repl) : text.replace(find, repl);
  try {
    for (let k = 0; k < 20; k++) { try { await fs.writeFile(abs, mutated); break; } catch (e) { if (k === 19) throw e; await new Promise((r) => setTimeout(r, 500 * (k + 1))); } }
    const t0 = Date.now();
    const r = spawnSync(VITEST, ['run'], { cwd: path.join(repoRoot, 'packages', m.pkg), encoding: 'utf-8', shell: true, timeout: 400000 });
    const outText = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
    const tl = (outText.match(/Tests\s+.*\(\d+\)/g) || []).pop() ?? '';
    const failedNames = [...outText.matchAll(/(?:FAIL|×)\s+(.{0,160})/g)].map((x) => x[1].trim()).slice(0, 6);
    const killed = r.status !== 0;
    results.push({ id: m.id, file: m.file, occurrences: count, verdict: killed ? 'KILLED' : 'SURVIVED', tests: tl, failed: failedNames, ms: Date.now() - t0 });
    console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${m.id} :: ${tl} :: ${failedNames.slice(0, 2).join(' | ')}`);
  } finally {
    for (let k = 0; k < 20; k++) { try { await fs.writeFile(abs, orig); break; } catch (e) { console.error('restore retry', k, e.code); await new Promise((r) => setTimeout(r, 500 * (k + 1))); } }
    const after = sha(await fs.readFile(abs));
    results[results.length - 1].restoredShaOk = after === origSha;
    await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    if (after !== origSha) { console.error('RESTORE FAILED for', m.file); process.exit(2); }
  }
}
console.log('done', results.length);
