// FR2-12 audit-6: mutation tests of escalation-2's loaderId invalidation + bfcache detection, plus
// re-application of GAP-286's N4/N11. Each mutation edits ONE src file, runs that package's full
// vitest suite, restores the original bytes, and sha-verifies the restore. Sequential. Writes only
// audit-6/mutation-results.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, outPath } from './lib.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const BT = path.join(root, 'packages', 'browser', 'src', 'session', 'browser-tab.ts');
const RT = path.join(root, 'packages', 'capability-runtime', 'src', 'runtime.ts');
const SA = path.join(root, 'packages', 'capability-runtime', 'src', 'audit', 'site-audit.ts');
const pkgOf = (f) => (f === BT ? 'browser' : 'capability-runtime');

const M = [
  // --- loaderId invalidation (GAP-284)
  { id: 'L1-no-clear-at-all', file: BT, from: `        if (this.lastMainDocumentResponseLoaderId !== newLoaderId) {
          this.lastMainDocumentResponseCapture = null;
          this.lastMainDocumentResponseLoaderId = null;
        }`, to: '' },
  { id: 'L2-clear-unconditionally', file: BT, from: 'if (this.lastMainDocumentResponseLoaderId !== newLoaderId) {', to: 'if (true) {' },
  { id: 'L3-response-never-records-loaderId', file: BT, from: '        this.lastMainDocumentResponseLoaderId = loaderId;\n      });', to: '      });' },
  { id: 'L4-skip-clear-on-bfcache-restore', file: BT, from: 'if (this.lastMainDocumentResponseLoaderId !== newLoaderId) {', to: "if (navType !== 'BackForwardCacheRestore' && this.lastMainDocumentResponseLoaderId !== newLoaderId) {" },
  { id: 'L5-clear-only-when-newLoaderId-null', file: BT, from: 'if (this.lastMainDocumentResponseLoaderId !== newLoaderId) {', to: 'if (newLoaderId === null) {' },
  { id: 'L6-response-gated-on-current-commit-loaderId(drops pre-commit responses)', file: BT, from: "        if (!this.lastMainFrameIdForCommitTracking || frameId !== this.lastMainFrameIdForCommitTracking) return;\n        // Deliberately NOT gated", to: "        if (!this.lastMainFrameIdForCommitTracking || frameId !== this.lastMainFrameIdForCommitTracking) return;\n        if (this.lastMainDocumentResponseLoaderId !== null && loaderId !== this.lastMainDocumentResponseLoaderId) return;\n        // Deliberately NOT gated" },
  // --- bfcache detection (GAP-285)
  { id: 'B1-flag-never-set', file: BT, from: "this.lastCommitWasBfcacheRestore = navType === 'BackForwardCacheRestore';", to: 'this.lastCommitWasBfcacheRestore = false;' },
  { id: 'B2-flag-sticky', file: BT, from: "this.lastCommitWasBfcacheRestore = navType === 'BackForwardCacheRestore';", to: "if (navType === 'BackForwardCacheRestore') this.lastCommitWasBfcacheRestore = true;" },
  { id: 'B3-getter-returns-false', file: BT, from: '    return this.lastCommitWasBfcacheRestore;', to: '    return false;' },
  { id: 'B4-runtime-ignores-flag', file: RT, from: 'const wasBfcacheRestore = options.url ? false : (tab.wasLastMainFrameCommitBfcacheRestore?.() ?? false);', to: 'const wasBfcacheRestore = false;' },
  { id: 'B5-runtime-applies-flag-in-url-mode', file: RT, from: 'const wasBfcacheRestore = options.url ? false : (tab.wasLastMainFrameCommitBfcacheRestore?.() ?? false);', to: 'const wasBfcacheRestore = tab.wasLastMainFrameCommitBfcacheRestore?.() ?? false;' },
  { id: 'B6-computeObservation-ignores-flag', file: SA, from: '!input.wasBfcacheRestore && input.observingSince', to: 'input.observingSince' },
  // --- GAP-286 re-application
  { id: 'N4-no-Document-type-filter(tab)', file: BT, from: "        if (type !== 'Document' || !response || typeof response.status !== 'number') return;\n        if (!this.lastMainFrameIdForCommitTracking", to: "        if (!response || typeof response.status !== 'number') return;\n        if (!this.lastMainFrameIdForCommitTracking" },
  { id: 'N11-samedoc-nav-moves-commit(tab)', file: BT, from: "      client.on('Network.responseReceived', (event) => {\n        const type = event?.type as string | undefined;\n        const frameId = event?.frameId as string | undefined;\n        const loaderId", to: "      client.on('Page.navigatedWithinDocument', (event) => { if ((event as any)?.frameId === this.lastMainFrameIdForCommitTracking) this.lastMainFrameCommitAt = new Date().toISOString(); });\n      client.on('Network.responseReceived', (event) => {\n        const type = event?.type as string | undefined;\n        const frameId = event?.frameId as string | undefined;\n        const loaderId" },
  { id: 'N11b-samedoc-nav-moves-commit-via-frameNavigated-shape(tab)', file: BT, from: "        if (frame?.parentId) return; // ignore subframes\n        const navType", to: "        if (frame?.parentId) return; // ignore subframes\n        void 0;\n        const navType" , note: 'control: a no-op edit; must SURVIVE (sanity check that the harness does not report false kills)' },
];

const ONLY = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const results = [];
const OUT = outPath(process.argv[3] ?? 'mutation-results.json');
const run = (pkg) => {
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: path.join(root, 'packages', pkg), encoding: 'utf8', timeout: 600000 });
  const txt = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests = txt.match(/Tests\s+(.*)\n/)?.[1] ?? '?';
  const failed = [...txt.matchAll(/(?:FAIL|×|✗)\s+(.*?)(?:\n|$)/g)].map((m) => m[1]).filter((s) => / > /.test(s)).slice(0, 8);
  return { status: r.status, tests, failed };
};
for (const m0 of M) {
  if (ONLY && !ONLY.has(m0.id.split('(')[0])) continue;
  const orig = await fs.readFile(m0.file);
  const origSha = sha(orig);
  const txt = orig.toString('utf8');
  const eol = txt.includes(String.fromCharCode(13, 10)) ? String.fromCharCode(13, 10) : String.fromCharCode(10);
  const m = { ...m0, from: m0.from.split(String.fromCharCode(10)).join(eol), to: m0.to.split(String.fromCharCode(10)).join(eol) };
  const count = txt.split(m.from).length - 1;
  if (count !== 1) { results.push({ id: m.id, error: `anchor count ${count}` }); await fs.writeFile(OUT, JSON.stringify(results, null, 2)); continue; }
  let res;
  try {
    await fs.writeFile(m.file, txt.replace(m.from, m.to));
    res = run(pkgOf(m.file));
  } finally {
    await fs.writeFile(m.file, orig);
  }
  const restored = sha(await fs.readFile(m.file)) === origSha;
  const rec = { id: m.id, pkg: pkgOf(m.file), killed: res.status !== 0, tests: res.tests, failed: res.failed, restored, note: m.note };
  results.push(rec);
  console.log(rec.id, rec.killed ? 'KILLED' : 'SURVIVED', rec.tests, 'restored', restored);
  await fs.writeFile(OUT, JSON.stringify(results, null, 2));
}
// final: unmutated suites green
for (const pkg of ['browser', 'capability-runtime']) { const r = run(pkg); results.push({ id: `final-unmutated-${pkg}`, status: r.status, tests: r.tests }); console.log('final', pkg, r.status, r.tests); }
await fs.writeFile(OUT, JSON.stringify(results, null, 2));
