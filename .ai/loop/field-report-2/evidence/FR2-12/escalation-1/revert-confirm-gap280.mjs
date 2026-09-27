// FR2-12 escalation-1: revert-and-confirm for GAP-280's three named mutations (M7, M9, M10),
// which audit-4 found survived ALL 204 pre-escalation capability-runtime tests. This script
// proves the NEW tests added in this round (RA16/RA17/RA18 in runtime.spec.ts) actually kill
// each one: apply the exact mutation audit-4 used (from its own mutation-test.mjs, read-only,
// never modified), tsc-build, run the FULL capability-runtime vitest suite in a FRESH child
// process per measurement (never a same-process re-import -- fix-3's own GAP-274 revert-confirm
// mistake), then restore from an in-memory copy of the ORIGINAL file content and sha256-verify
// the restore. CRLF/LF-aware (reads/writes the file as a raw Buffer, substring match is exact
// bytes, no newline normalization).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/escalation-1')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const PKG = path.join(root, 'packages', 'capability-runtime');
const FILE = path.join(PKG, 'src', 'runtime.ts');
const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const VITEST = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Verbatim from audit-4's mutation-test.mjs (read-only source, never touched by this script),
// except CRLF-adjusted (this file is CRLF on disk, matched exactly here rather than normalized,
// per the CRLF/LF-aware requirement).
const M = [
  { id: 'M7-clear-client-in-catch', from: '// `createCDPSession()` itself failed (synchronously or otherwise) before `cdpClient`', to: 'cdpClient = null; // `createCDPSession()` itself failed (synchronously or otherwise) before `cdpClient`', kill: ['RA16'] },
  { id: 'M9-rejection-not-swallowed', from: '    () => false,\r\n', to: '    (e) => { throw e; },\r\n', kill: ['RA18'] },
  { id: 'M10-no-Network.enable', from: "await client.send('Network.enable').catch(() => {});", to: 'void 0;', kill: ['RA17'] },
];

const origBuf = await fs.readFile(FILE);
const origSha = sha(origBuf);
const origText = origBuf.toString('utf8');
const out = { origSha, results: [] };

function run(args, opts = {}) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 300000, ...opts });
}
function build() {
  return run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
}
function vitest() {
  const r = run([VITEST, 'run'], { cwd: PKG });
  const s = ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
  const testsLine = (s.match(/Tests\s+(.*)\n/) || [])[1] ?? 'unparsed';
  const failedNames = [...s.matchAll(/(?:×|FAIL)\s+([^\n]*)/g)].map((x) => x[1].slice(0, 160));
  return { status: r.status, testsLine, failedNames };
}

for (const m of M) {
  const idx = origText.indexOf(m.from);
  if (idx === -1) {
    out.results.push({ id: m.id, error: `anchor not found in current runtime.ts: ${JSON.stringify(m.from)}` });
    continue;
  }
  const mutated = origText.slice(0, idx) + m.to + origText.slice(idx + m.from.length);
  await fs.writeFile(FILE, mutated, 'utf8');
  const b = build();
  if (b.status !== 0) {
    out.results.push({ id: m.id, buildFailed: true, buildOutput: (b.stdout ?? '') + (b.stderr ?? '') });
  } else {
    const v = vitest();
    const killedByExpected = m.kill.every((name) => v.failedNames.some((f) => f.includes(name)));
    out.results.push({ id: m.id, killed: v.status !== 0, testsLine: v.testsLine, failedNames: v.failedNames, killedByExpectedTest: killedByExpected });
  }
  // Restore + sha-verify + rebuild dist back to the real (unmutated) code before the next iteration.
  await fs.writeFile(FILE, origBuf);
  const restored = await fs.readFile(FILE);
  const restoredSha = sha(restored);
  out.results[out.results.length - 1].restoredShaMatches = restoredSha === origSha;
  build(); // restore dist too
}

await fs.writeFile(path.join(here, 'revert-confirm-gap280-results.json'), JSON.stringify(out, null, 2));
for (const r of out.results) {
  console.log(r.id, 'killed:', r.killed, 'byExpectedTest:', r.killedByExpectedTest, 'restoredShaMatches:', r.restoredShaMatches, 'tests:', r.testsLine);
}
process.exit(0);
