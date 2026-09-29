// FR2-04 audit-4: mutation-test fix-3's attribution (attributeDialogHolders) and its wiring.
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

const M = [
  // --- "prefer newest leaf" ---
  { id: 'A1-ultimateHolder-prefers-oldest-child', file: CDP, find: `: ultimateHolder([...children].sort((x, y) => ${NEWEST})[0]!.targetId);`, repl: `: ultimateHolder([...children].sort((x, y) => ${OLDEST})[0]!.targetId);`, pkg: 'browser' },
  { id: 'A2-leaf-branch-prefers-oldest-sibling', file: CDP, find: `const newestSibling = [...siblings].sort((x, y) => ${NEWEST})[0]!;`, repl: `const newestSibling = [...siblings].sort((x, y) => ${OLDEST})[0]!;`, pkg: 'browser' },
  { id: 'A3-both-prefer-oldest', file: CDP, multi: true, find: NEWEST, repl: OLDEST, pkg: 'browser' },
  { id: 'A4-ignore-discoveredAt(first-in-order)', file: CDP, multi: true, find: NEWEST, repl: '0', pkg: 'browser' },
  // --- opener-chain walk ---
  { id: 'A5-no-recursion(newest-child-directly)', file: CDP, find: `: ultimateHolder([...children].sort((x, y) => ${NEWEST})[0]!.targetId);`, repl: `: [...children].sort((x, y) => ${NEWEST})[0]!.targetId;`, pkg: 'browser' },
  { id: 'A6-no-opener-grouping-at-all', file: CDP, find: '    if (b.openerTargetId && byId.has(b.openerTargetId)) {\n      const arr', repl: '    if (false) {\n      const arr', pkg: 'browser' },
  { id: 'A7-opener-is-its-own-holder', file: CDP, find: '      holder = ultimateHolder(b.targetId);', repl: '      holder = b.targetId;', pkg: 'browser' },
  { id: 'A8-leaf-non-newest-sibling-is-own-holder', file: CDP, find: 'holder = newestSibling.targetId === b.targetId ? b.targetId : ultimateHolder(newestSibling.targetId);', repl: 'holder = b.targetId;', pkg: 'browser' },
  { id: 'A9-leaf-points-at-raw-newest-sibling', file: CDP, find: 'holder = newestSibling.targetId === b.targetId ? b.targetId : ultimateHolder(newestSibling.targetId);', repl: 'holder = newestSibling.targetId;', pkg: 'browser' },
  { id: 'A10-openerTargetId-never-populated', file: CDP, find: 'openerTargetId: openerIdOf(target) },', repl: 'openerTargetId: undefined },', pkg: 'browser' },
  // --- collateral tagging ---
  { id: 'A11-never-tag-collateral', file: CDP, find: 'result.set(b.targetId, holder === b.targetId ? undefined : holder);', repl: 'result.set(b.targetId, undefined);', pkg: 'browser' },
  { id: 'A12-tag-inverted(holder-tagged)', file: CDP, find: 'result.set(b.targetId, holder === b.targetId ? undefined : holder);', repl: 'result.set(b.targetId, holder === b.targetId ? b.targetId : undefined);', pkg: 'browser' },
  // --- wiring ---
  { id: 'A13-warden-drops-discoveredAt', file: W, find: 'discoveredAt: this.discoveredAt.get(info.targetId) }));', repl: 'discoveredAt: undefined }));', pkg: 'browser' },
  { id: 'A14-warden-drops-blockedBy', file: W, find: "        source: 'hint',\n        blockedBy,\n      });", repl: "        source: 'hint',\n        blockedBy: undefined,\n      });", pkg: 'browser' },
  { id: 'A15-warden-recovery-no-redirect(closes-collateral)', file: W, find: '    if (entry.blockedBy) {\n      const holder = dialogs.find', repl: '    if (false) {\n      const holder = dialogs.find', pkg: 'browser' },
  { id: 'A16-warden-recovery-no-isolated-refusal', file: W, find: '    const hasCollateralSibling = dialogs.some((d) => d.blockedBy === targetId);\n    if (!hasCollateralSibling) {', repl: '    const hasCollateralSibling = true;\n    if (!hasCollateralSibling) {', pkg: 'browser' },
  { id: 'A17-direct-drops-blockedBy', file: B, find: '          blockedBy: attribution.get(info.targetId),', repl: '          blockedBy: undefined,', pkg: 'cli' },
  { id: 'A18-direct-recovery-no-redirect', file: B, find: '        if (mine?.blockedBy) {', repl: '        if (false) {', pkg: 'cli' },
  { id: 'A19-direct-recovery-no-isolated-refusal', file: B, find: '        const hasCollateralSibling = relisted.dialogs.some((d) => d.blockedBy === targetId);', repl: '        const hasCollateralSibling = true;', pkg: 'cli' },
  { id: 'A20-selectDialog-picks-collateral', file: DC, find: '  const target = sorted.find((d) => !d.blockedBy);', repl: '  const target = sorted[0];', pkg: 'cli' },
  { id: 'A21-gate-auto-handles-unknown', file: B, find: "      const real = listed.dialogs.filter((d) => d.dialogType !== 'unknown');", repl: '      const real = listed.dialogs;', pkg: 'cli' },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const results = [];
const outFile = path.join(here, `mutations-${only.length ? only.join('+') : 'all'}.json`);
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
