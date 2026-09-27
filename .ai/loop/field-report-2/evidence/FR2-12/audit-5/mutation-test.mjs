// FR2-12 audit-5 mutation testing. Each mutation: exactly-one-match replacement in ONE source file,
// run the relevant package vitest suite(s) (src-level, no build needed), record, restore, sha-verify.
// Usage: node mutation-test.mjs [id,id,...]
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, outPath } from './lib.mjs';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const RT = path.join(root, 'packages', 'capability-runtime', 'src', 'runtime.ts');
const TAB = path.join(root, 'packages', 'browser', 'src', 'session', 'browser-tab.ts');
const SA = path.join(root, 'packages', 'capability-runtime', 'src', 'audit', 'site-audit.ts');
const M = [
  // --- GAP-280: audit-4's exact M7/M9/M10, re-applied to runtime.ts
  { id: 'M7-clear-client-in-catch', file: RT, from: '// `createCDPSession()` itself failed (synchronously or otherwise) before `cdpClient`', to: 'cdpClient = null; // `createCDPSession()` itself failed (synchronously or otherwise) before `cdpClient`', pkgs: ['capability-runtime'], expectKilledBy: 'RA16' },
  { id: 'M9-rejection-not-swallowed', file: RT, from: '    () => false,', to: '    (e) => { throw e; },', pkgs: ['capability-runtime'], expectKilledBy: 'RA18' },
  { id: 'M10-no-Network.enable', file: RT, from: "await client.send('Network.enable').catch(() => {});", to: 'void 0;', pkgs: ['capability-runtime'], expectKilledBy: 'RA17' },
  // --- new tab-lifetime tracking (browser-tab.ts)
  { id: 'N1-tab-no-subframe-filter', file: TAB, from: '        if (frame?.parentId) return; // ignore subframes\n        this.lastMainFrameCommitAt', to: '        this.lastMainFrameCommitAt', pkgs: ['browser'] },
  { id: 'N2-tab-commit-never-recorded', file: TAB, from: '        this.lastMainFrameCommitAt = new Date().toISOString();', to: '        void 0;', pkgs: ['browser'] },
  { id: 'N3-tab-first-commit-wins', file: TAB, from: '        this.lastMainFrameCommitAt = new Date().toISOString();', to: '        if (!this.lastMainFrameCommitAt) this.lastMainFrameCommitAt = new Date().toISOString();', pkgs: ['browser'] },
  { id: 'N4-tab-no-Document-type-filter', file: TAB, from: "        if (type !== 'Document' || !response || typeof response.status !== 'number') return;", to: "        if (!response || typeof response.status !== 'number') return;", pkgs: ['browser'] },
  { id: 'N5-tab-no-frameId-filter', file: TAB, from: '        if (!this.lastMainFrameIdForCommitTracking || frameId !== this.lastMainFrameIdForCommitTracking) return;', to: '        void frameId;', pkgs: ['browser'] },
  { id: 'N6-tab-no-Network.enable', file: TAB, from: "await client.send('Network.enable').catch(() => {});", to: 'void 0;', pkgs: ['browser'] },
  { id: 'N7-tab-close-no-detach', file: TAB, from: '      await this.commitTrackingCdpClient.detach().catch(() => {});', to: '      void 0;', pkgs: ['browser'] },
  { id: 'N8-tab-tracking-never-started', file: TAB, from: '      void this.setupCommitTracking(this.page);', to: '      void 0;', pkgs: ['browser'] },
  { id: 'N9-goto-response-never-captured', file: TAB, from: '      this.lastGotoResponse = response ? { url: response.url(), status: response.status() } : null;', to: '      void response;', pkgs: ['browser'] },
  { id: 'N10-tab-docresp-getter-null', file: TAB, from: '    return this.lastMainDocumentResponseCapture;', to: '    return null;', pkgs: ['browser'] },
  { id: 'N11-tab-also-counts-same-doc-navs', file: TAB, from: "      client.on('Network.responseReceived', (event) => {\n        const type = event?.type as string | undefined;", to: "      client.on('Page.navigatedWithinDocument', (event) => { if (!(event as { frameId?: string }).frameId || (event as { frameId?: string }).frameId === this.lastMainFrameIdForCommitTracking) this.lastMainFrameCommitAt = new Date().toISOString(); });\n      client.on('Network.responseReceived', (event) => {\n        const type = event?.type as string | undefined;", pkgs: ['browser'] },
  { id: 'N12-tab-setup-bound-removed', file: TAB, from: '        }, COMMIT_TRACKING_SETUP_BOUND_MS);', to: '        }, 2147483647);', pkgs: ['browser'] },
  // --- runtime.ts consumption of the new getters
  { id: 'R1-currentpage-ignores-tab-commit', file: RT, from: '      : (tab.getLastMainFrameCommitAt?.() ?? null);', to: '      : null;', pkgs: ['capability-runtime'] },
  { id: 'R2-no-goto-fallback-tier', file: RT, from: '    const gotoResponseFallback = options.url ? (tab.getLastGotoResponse?.() ?? null) : null;', to: '    const gotoResponseFallback = null;', pkgs: ['capability-runtime'] },
  { id: 'R3-goto-fallback-in-currentpage-too', file: RT, from: '    const gotoResponseFallback = options.url ? (tab.getLastGotoResponse?.() ?? null) : null;', to: '    const gotoResponseFallback = tab.getLastGotoResponse?.() ?? null;', pkgs: ['capability-runtime'] },
  { id: 'R4-goto-tier-before-live-capture', file: RT, from: '      mainDocumentResponseCapture ??\n      currentPageLiveCapture ??\n      gotoResponseFallback ??', to: '      gotoResponseFallback ??\n      mainDocumentResponseCapture ??\n      currentPageLiveCapture ??', pkgs: ['capability-runtime'] },
  { id: 'R5-no-currentpage-live-capture', file: RT, from: '    const currentPageLiveCapture = options.url ? null : (tab.getLastMainDocumentResponse?.() ?? null);', to: '    const currentPageLiveCapture = null;', pkgs: ['capability-runtime'] },
  { id: 'R6-tab-capture-used-in-url-mode-too', file: RT, from: '    const currentPageLiveCapture = options.url ? null : (tab.getLastMainDocumentResponse?.() ?? null);', to: '    const currentPageLiveCapture = tab.getLastMainDocumentResponse?.() ?? null;', pkgs: ['capability-runtime'] },
  { id: 'R7-url-mode-uses-tab-commit', file: RT, from: '    const effectiveNavCommittedAt = options.url\n      ? navCommittedAt\n', to: '    const effectiveNavCommittedAt = options.url\n      ? (tab.getLastMainFrameCommitAt?.() ?? null)\n', pkgs: ['capability-runtime'] },
  // --- shared scoping (site-audit.ts)
  { id: 'S1-currentpage-scopes-by-timeOrigin', file: SA, from: '  const since = input.navCommittedAt ?? documentStartedAt;', to: "  const since = input.mode === 'current-page' ? documentStartedAt : (input.navCommittedAt ?? documentStartedAt);", pkgs: ['capability-runtime'] },
  { id: 'S2-min-reintroduced', file: SA, from: '  const since = input.navCommittedAt ?? documentStartedAt;', to: '  const since = input.navCommittedAt && documentStartedAt ? (input.navCommittedAt < documentStartedAt ? input.navCommittedAt : documentStartedAt) : (input.navCommittedAt ?? documentStartedAt);', pkgs: ['capability-runtime'] },
];
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const OUTF = outPath(ONLY ? `mutation-results-${ONLY.join('_').slice(0, 60)}.json` : 'mutation-results.json');
const files = [RT, TAB, SA];
const origs = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await fs.readFile(f)])));
const origShas = Object.fromEntries(files.map((f) => [f, sha(origs[f])]));
const out = { origShas: Object.fromEntries(Object.entries(origShas).map(([k, v]) => [path.relative(root, k), v])), results: [] };
const save = () => fs.writeFile(OUTF, JSON.stringify(out, null, 2));
const vitest = (pkg) => {
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: path.join(root, 'packages', pkg), encoding: 'utf8', timeout: 900000 });
  const txt = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests = (txt.match(/^\s*Tests\s+(.*)$/m) || [])[1] ?? '?';
  const failing = [...txt.matchAll(/^\s*(?:×|✗|FAIL)\s+(.+)$/gm)].map((m) => m[1].trim()).filter((x) => !/^tests\//.test(x) || x.includes('>')).slice(0, 8);
  return { exit: r.status, tests, failing };
};
async function restoreAll() {
  for (const f of files) {
    const cur = await fs.readFile(f);
    if (sha(cur) !== origShas[f]) await fs.writeFile(f, origs[f]);
    if (sha(await fs.readFile(f)) !== origShas[f]) throw new Error('RESTORE FAILED ' + f);
  }
}
process.on('SIGINT', async () => { await restoreAll(); process.exit(3); });
try {
  for (const m of M) {
    if (ONLY && !ONLY.includes(m.id)) continue;
    const text = origs[m.file].toString('utf8');
    if (text.includes('\r\n')) { m.from = m.from.replace(/\r?\n/g, '\r\n'); m.to = m.to.replace(/\r?\n/g, '\r\n'); }
    const count = text.split(m.from).length - 1;
    const rec = { id: m.id, file: path.relative(root, m.file), matches: count };
    if (count !== 1) { rec.skipped = 'anchor must match exactly once'; out.results.push(rec); await save(); console.log(m.id, 'SKIPPED matches=', count); continue; }
    await fs.writeFile(m.file, text.replace(m.from, m.to));
    rec.suites = {};
    for (const p of m.pkgs) rec.suites[p] = vitest(p);
    rec.killed = Object.values(rec.suites).some((s) => s.exit !== 0);
    if (m.expectKilledBy) rec.expectKilledBy = m.expectKilledBy;
    await restoreAll();
    rec.restoredShaOk = true;
    out.results.push(rec);
    await save();
    console.log(m.id, rec.killed ? 'KILLED' : 'SURVIVED', JSON.stringify(Object.fromEntries(Object.entries(rec.suites).map(([k, v]) => [k, v.tests]))), rec.killed ? JSON.stringify(Object.values(rec.suites).flatMap((s) => s.failing)).slice(0, 300) : '');
  }
} finally {
  await restoreAll();
  out.finalShas = Object.fromEntries(await Promise.all(files.map(async (f) => [path.relative(root, f), sha(await fs.readFile(f))])));
  out.allRestored = files.every((f) => out.finalShas[path.relative(root, f)] === origShas[f]);
  await save();
  console.log('allRestored', out.allRestored);
}
