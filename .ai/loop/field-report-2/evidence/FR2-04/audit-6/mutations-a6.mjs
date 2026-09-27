// FR2-04 audit-6: mutation-test attributeDialogHolders, the proactive-probe wiring, the GAP-252
// allKnown plumbing, recovery refusal paths and the escalation-2 message logic -- BEYOND
// escalation-2's own 4-mutation mutation-confirm (E3'/E4'/E6/E7). Each mutation is a single
// exact find/replace (must match exactly once), the relevant vitest files are run, and the file
// is restored from an in-memory copy and SHA-verified before the next mutation. A restore
// mismatch aborts the whole run immediately.
// usage: node mutations-a6.mjs [idRegex]
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const CDP = 'packages/browser/src/session/dialog-cdp.ts';
const WARDEN = 'packages/browser/src/session/dialog-warden.ts';
const BROKER = 'packages/cli/src/dialog-broker.ts';
const DCLI = 'packages/cli/src/dialog-cli.ts';
const BROWSER_TESTS = { cwd: 'packages/browser', files: ['tests/unit/dialog-cdp.spec.ts', 'tests/unit/dialog-warden.spec.ts'] };
const CLI_TESTS = { cwd: 'packages/cli', files: ['tests/unit'] };
const FILTER = new RegExp(process.argv[2] ?? '.');

const M = [
  // ---- attributeDialogHolders (dialog-cdp.ts)
  { id: 'C1 allKnown ignored (GAP-252 plumbing dropped inside the function)', file: CDP, t: BROWSER_TESTS,
    find: '  for (const k of allKnown) linkById.set(k.targetId, k);', repl: '  void allKnown;' },
  { id: 'C2 responsive (non-blocked) known opener becomes a candidate holder', file: CDP, t: BROWSER_TESTS,
    find: 'info && !info.confirmedSafe ? id : undefined;', repl: '!info || !info.confirmedSafe ? id : undefined;' },
  { id: 'C3 oldest child preferred instead of newest', file: CDP, t: BROWSER_TESTS,
    find: '.sort((a, b) => (b.child.discoveredAt ?? 0) - (a.child.discoveredAt ?? 0));', repl: '.sort((a, b) => (a.child.discoveredAt ?? 0) - (b.child.discoveredAt ?? 0));' },
  { id: 'C4 confirmedSafe ignored in resolve()', file: CDP, t: BROWSER_TESTS,
    find: 'info && !info.confirmedSafe ? id : undefined;', repl: 'info ? id : undefined;' },
  { id: 'C5 findRoot only walks through BLOCKED openers (pre-esc2)', file: CDP, t: BROWSER_TESTS,
    find: '      if (opener && linkById.has(opener) && opener !== cur) {', repl: '      if (opener && byId.has(opener) && opener !== cur) {' },
  { id: 'C6 childrenByOpener keyed only on blocked openers (pre-esc2)', file: CDP, t: BROWSER_TESTS,
    find: '    if (b.openerTargetId && linkById.has(b.openerTargetId)) {', repl: '    if (b.openerTargetId && byId.has(b.openerTargetId)) {' },
  { id: 'C7 blockedBy never set', file: CDP, t: BROWSER_TESTS,
    find: 'result.set(b.targetId, { blockedBy: holder === b.targetId ? undefined : holder, confirmedSafe: !!b.confirmedSafe });', repl: 'result.set(b.targetId, { blockedBy: undefined, confirmedSafe: !!b.confirmedSafe });' },
  { id: 'C8 findRoot walks only one level up', file: CDP, t: BROWSER_TESTS,
    find: '    for (let i = 0; i <= blocked.length + allKnown.length; i++) {', repl: '    for (let i = 0; i < 1; i++) {' },
  { id: 'C9 resolve ignores children entirely (every blocked node its own holder)', file: CDP, t: BROWSER_TESTS,
    find: '    const children = childrenByOpener.get(id) ?? [];', repl: '    const children: DialogAttributionInput[] = [];' },
  // ---- DialogWarden (dialog-warden.ts)
  { id: 'W1 proactive probe never scheduled', file: WARDEN, t: BROWSER_TESTS,
    find: '          if (!this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {', repl: '          if (false) {' },
  { id: 'W2 proactive probe confirms even if a tracked dialog arrived meanwhile', file: WARDEN, t: BROWSER_TESTS,
    find: "                  if (state === 'responsive' && !this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {", repl: "                  if (state === 'responsive') {" },
  { id: 'W3 warden does not pass allTargets (GAP-252 plumbing dropped at the call site)', file: WARDEN, t: BROWSER_TESTS,
    find: '    const attribution = attributeDialogHolders(blockedInfos, allTargets);', repl: '    const attribution = attributeDialogHolders(blockedInfos);' },
  { id: 'W4 targetdestroyed keeps confirmedResponsiveSince (expected near-equivalent)', file: WARDEN, t: BROWSER_TESTS,
    find: '      this.confirmedResponsiveSince.delete(targetId);', repl: '      void 0;' },
  { id: 'W5 recovery ignores confirmedSafe (closes a history-proven target)', file: WARDEN, t: BROWSER_TESTS,
    find: '    if (entry.confirmedSafe) {', repl: '    if (false) {' },
  { id: 'W6 recovery ignores blockedBy (closes collateral)', file: WARDEN, t: BROWSER_TESTS,
    find: '    if (entry.blockedBy) {\n      const holder = dialogs.find((d) => d.targetId === entry.blockedBy);', repl: '    if (false) {\n      const holder = dialogs.find((d) => d.targetId === entry.blockedBy);' },
  { id: 'W7 listWithLiveness never passes confirmedSafe to attribution', file: WARDEN, t: BROWSER_TESTS,
    find: '        confirmedSafe: this.confirmedResponsiveSince.has(info.targetId),\n      }));', repl: '        confirmedSafe: false,\n      }));' },
  { id: 'W8 proactive delay back to 500ms (GAP-251 regression)', file: WARDEN, t: BROWSER_TESTS,
    find: 'const DEFAULT_PROACTIVE_CONFIRM_DELAY_MS = 0;', repl: 'const DEFAULT_PROACTIVE_CONFIRM_DELAY_MS = 500;' },
  { id: "W9 an 'error' probe result is not treated as blocked", file: WARDEN, t: BROWSER_TESTS,
    find: "      .filter(({ info }) => states.get(info.targetId) !== 'responsive')", repl: "      .filter(({ info }) => states.get(info.targetId) === 'blocked')" },
  { id: 'W10 proactive probe fires without the Page.enable ack (moved before the send)', file: WARDEN, t: BROWSER_TESTS,
    find: "      const enableTimeout = setTimeout(() => {}, 2000);", repl: "      const enableTimeout = setTimeout(() => {}, 2000);\n      livenessProbe(session, LIVENESS_PROBE_MS).then((st) => { if (st === 'responsive' && !this.dialogs.has(targetId)) this.confirmedResponsiveSince.set(targetId, Date.now()); }).catch(() => {});" },
  { id: 'W11 proactive probe confirms regardless of result', file: WARDEN, t: BROWSER_TESTS,
    find: "                  if (state === 'responsive' && !this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {", repl: "                  if (!this.confirmedResponsiveSince.has(targetId) && !this.dialogs.has(targetId)) {" },
  // ---- CLI side
  { id: 'B1 DirectCdpBroker does not pass allKnown', file: BROKER, t: CLI_TESTS,
    find: '    const attribution = attributeDialogHolders(blockedInfos, candidates.map(({ info }) => ({ targetId: info.targetId, openerTargetId: info.openerTargetId })));', repl: '    const attribution = attributeDialogHolders(blockedInfos);' },
  { id: 'B2 DirectCdpBroker drops wardenDown marker on unknown entries', file: BROKER, t: CLI_TESTS,
    find: '          blockedBy: attribution.get(info.targetId)?.blockedBy,\n          wardenDown: true,', repl: '          blockedBy: attribution.get(info.targetId)?.blockedBy,' },
  { id: 'B3 gate auto-handles unknown entries under a policy (GAP-240 regression)', file: BROKER, t: CLI_TESTS,
    find: "      const real = listed.dialogs.filter((d) => d.dialogType !== 'unknown');", repl: "      const real = listed.dialogs.filter((d) => d.dialogType !== 'unknown' || true);" },
  { id: 'D1 describeUnknownDialog: always claims this tab is the actual target', file: DCLI, t: CLI_TESTS,
    find: '  const isActualTarget = target !== undefined && target.targetId === d.targetId && target.openedAt === d.openedAt;', repl: '  const isActualTarget = true;' },
  { id: 'D2 describeUnknownDialog: wardenDown holder branch removed', file: DCLI, t: CLI_TESTS,
    find: '    if (d.wardenDown) {\n      return [`  Note: ${tab} may be the dialog holder', repl: '    if (false) {\n      return [`  Note: ${tab} may be the dialog holder' },
  { id: 'D3 selectDialog may pick a confirmedSafe entry', file: DCLI, t: CLI_TESTS,
    find: '  const target = sorted.find((d) => !d.blockedBy && !d.confirmedSafe);', repl: '  const target = sorted.find((d) => !d.blockedBy);' },
  { id: 'D4 selectDialog may pick a collateral (blockedBy) entry', file: DCLI, t: CLI_TESTS,
    find: '  const target = sorted.find((d) => !d.blockedBy && !d.confirmedSafe);', repl: '  const target = sorted.find((d) => !d.confirmedSafe);' },
];

function runVitest(t) {
  const VITEST = path.join(repoRoot, 'node_modules/.bin/vitest.CMD');
  const r = spawnSync(VITEST, ['run', ...t.files], { cwd: path.join(repoRoot, t.cwd), encoding: 'utf-8', shell: true, timeout: 400000 });
  const outText = (String(r.stdout) + String(r.stderr)).replace(/\x1b\[[0-9;]*m/g, '');
  const summary = (outText.match(/Tests\s+.*\(\d+\)/g) || []).pop() ?? '(no summary line found)';
  const failedNames = [...outText.matchAll(/(?:FAIL|×)\s+(.{0,160})/g)].map((x) => x[1].trim());
  return { exitCode: r.status, summary, failedNames: failedNames.slice(0, 6) };
}

const results = [];
const outFile = path.join(here, 'mutations-a6.json');
for (const m of M.filter((x) => FILTER.test(x.id))) {
  const abs = path.join(repoRoot, m.file);
  const orig = await fs.readFile(abs);
  const origSha = sha(orig);
  const text = orig.toString('utf-8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const find = m.find.replace(/\n/g, eol);
  const repl = m.repl.replace(/\n/g, eol);
  const count = text.split(find).length - 1;
  if (count !== 1) { results.push({ id: m.id, error: `find matched ${count} times` }); console.log(`ERROR    ${m.id}: find matched ${count}`); continue; }
  let r;
  try {
    await fs.writeFile(abs, text.replace(find, repl));
    r = runVitest(m.t);
  } finally {
    await fs.writeFile(abs, orig);
    const after = sha(await fs.readFile(abs));
    if (after !== origSha) { console.error(`RESTORE FAILED for ${m.file} after ${m.id}`); process.exit(2); }
  }
  const killed = r.exitCode !== 0;
  results.push({ id: m.id, file: m.file, killed, ...r, restoredSha: origSha });
  console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${m.id} :: ${r.summary}`);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
}
await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, allRestored: true }, null, 2));
console.log(`done: ${results.filter((x) => x.killed).length} killed / ${results.filter((x) => x.killed === false).length} survived / ${results.filter((x) => x.error).length} errors`);
