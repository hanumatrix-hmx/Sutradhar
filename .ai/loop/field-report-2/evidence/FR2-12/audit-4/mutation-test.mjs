// FR2-12 audit-4: auditor-authored mutations of fix-3's NEW code (mainDocumentResponseCapture,
// boundedFireAndForget, the session-leak split). Each mutation: patch runtime.ts in place (exact
// byte substring, CRLF-safe single-line anchors), tsc-build capability-runtime, run its FULL vitest
// suite, then run the listed live probes IN A FRESH NODE PROCESS (avoids the ESM module-cache trap
// that invalidated fix-3's own GAP-274 revert-confirm), then restore from the in-memory original and
// sha256-verify. Touches ONLY packages/capability-runtime/src/runtime.ts (+ its dist via tsc).
// Writes audit-4/mutation-results.json. Usage: node mutation-test.mjs [id,id,...]
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-4')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const PKG = path.join(root, 'packages', 'capability-runtime');
const FILE = path.join(PKG, 'src', 'runtime.ts');
const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const VITEST = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const M = [
  { id: 'M1-unbounded', from: 'function boundedFireAndForget(work: Promise<unknown>, boundMs: number): Promise<void> {', to: 'function boundedFireAndForget(work: Promise<unknown>, boundMs: number): Promise<void> {\n  return work.then(() => {}, () => {}); // MUT M1', live: ['dialog'] },
  { id: 'M2-bound-60s', from: 'const AUDIT_CDP_SETUP_BOUND_MS = 1000;', to: 'const AUDIT_CDP_SETUP_BOUND_MS = 60000;', live: ['dialog'] },
  { id: 'M3-first-response-wins', from: 'if (!mainFrameId || frameId !== mainFrameId) return;', to: 'if (!mainFrameId || frameId !== mainFrameId || mainDocumentResponseCapture) return;', live: ['273'] },
  { id: 'M4-no-frameId-filter', from: 'if (!mainFrameId || frameId !== mainFrameId) return;', to: 'void frameId; void mainFrameId;', live: ['273'] },
  { id: 'M5-no-Document-type-filter', from: "if (type !== 'Document' || !response", to: "void type; if (!response", live: ['273'] },
  { id: 'M6-primary-capture-ignored', from: '      mainDocumentResponseCapture ??', to: '      (false ? mainDocumentResponseCapture : null) ??', live: ['273'] },
  { id: 'M7-clear-client-in-catch', from: '// `createCDPSession()` itself failed (synchronously or otherwise) before `cdpClient`', to: 'cdpClient = null; // `createCDPSession()` itself failed (synchronously or otherwise) before `cdpClient`', live: ['leak'] },
  { id: 'M8-no-detach', from: '        await cdpClient.detach().catch(() => {});', to: '        void 0;', live: ['leak'] },
  { id: 'M9-rejection-not-swallowed', from: '    () => false,', to: '    (e) => { throw e; },', live: ['leak'] },
  { id: 'M10-no-Network.enable', from: "await client.send('Network.enable').catch(() => {});", to: 'void 0;', live: ['273'] },
  { id: 'M11-mainFrameId-only-from-frameTree', from: 'if (frame?.id) mainFrameId = frame.id;', to: 'void frame;', live: ['273'] },
];
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const OUTF = path.join(here, ONLY ? `mutation-results-${ONLY.join('_')}.json` : 'mutation-results.json');
const orig = await fs.readFile(FILE);
const origSha = sha(orig);
const origText = orig.toString('utf8');
const run = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 600000, ...opts });
function vitest() {
  const r = run([VITEST, 'run'], { cwd: PKG });
  const s = (r.stdout ?? '') + (r.stderr ?? '');
  const clean = s.replace(/\x1b\[[0-9;]*m/g, '');
  const m = clean.match(/Tests\s+(.*)\n/);
  const failed = [...clean.matchAll(/(?:×|FAIL)\s+(.*RA\d+[^\n]*|.*›[^\n]*)/g)].map((x) => x[1].slice(0, 140)).slice(0, 8);
  return { status: r.status, tests: m ? m[1].trim() : 'unparsed', failed };
}
function live(kind, id) {
  if (kind === 'dialog') {
    const r = run([path.join(here, 'probe-hang4.mjs'), 'dialog-auto', '1'], { timeout: 300000 });
    const lines = (r.stdout ?? '').split('\n').filter((l) => /audit/.test(l) && !l.includes('"level"')).map((l) => l.slice(0, 140));
    return { status: r.status, lines };
  }
  if (kind === '273') {
    const r = run([path.join(here, 'probe-273.mjs'), '2', '0', 'quick', id], { timeout: 400000 });
    return { status: r.status, lines: (r.stdout ?? '').split('\n').filter((l) => /^runtime/.test(l)).map((l) => l.slice(0, 200)) };
  }
  if (kind === 'leak') {
    const r = run([path.join(here, 'probe-leak-paths.mjs')], { timeout: 200000 });
    return { status: r.status, lines: (r.stdout ?? '').split('\n').filter((l) => l.trim() && !l.includes('"level"')).map((l) => l.slice(0, 160)) };
  }
}
const results = [];
try {
  for (const m of M) {
    if (ONLY && !ONLY.includes(m.id)) continue;
    const i = origText.indexOf(m.from);
    if (i < 0 || origText.indexOf(m.from, i + 1) >= 0 && !m.id.startsWith('M3') && !m.id.startsWith('M4')) { results.push({ id: m.id, error: 'anchor not found/unique' }); continue; }
    await fs.writeFile(FILE, origText.slice(0, i) + m.to + origText.slice(i + m.from.length), 'utf8');
    const res = { id: m.id };
    try {
      const b = run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
      res.build = b.status === 0 ? 'ok' : 'FAIL ' + (b.stdout + b.stderr).slice(0, 400);
      if (b.status === 0) {
        res.vitest = vitest();
        res.live = {};
        for (const k of m.live) res.live[k] = live(k, m.id);
      }
    } finally {
      await fs.writeFile(FILE, orig);
      if (sha(await fs.readFile(FILE)) !== origSha) throw new Error('RESTORE SHA MISMATCH');
    }
    results.push(res);
    console.log(JSON.stringify(res));
    await fs.writeFile(OUTF, JSON.stringify({ origSha, results }, null, 2));
  }
} finally {
  await fs.writeFile(FILE, orig);
  const ok = sha(await fs.readFile(FILE)) === origSha;
  const b = run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
  await fs.writeFile(OUTF, JSON.stringify({ origSha, restoredShaMatch: ok, finalRebuild: b.status, results }, null, 2));
  console.log('restored', ok, 'rebuild', b.status);
}
