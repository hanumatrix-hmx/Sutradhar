// FR2-12 escalation-1: revert-and-confirm for the GAP-279 fix (getLastGotoResponse fallback).
// Reverts the fallback line back to null (pre-fix: only mainDocumentResponseCapture or the
// URL-match ring-buffer search), then runs the capability-runtime vitest suite in a FRESH child
// process and confirms RA13b (this round's own live-shape unit test for the exact GAP-279 named
// repro: live capture never fires, url has moved on, ring-buffer empty) fails. Restores from an
// in-memory copy and sha256-verifies. CRLF-aware. A full live-Chrome dialog-open repro (the
// literal audit-4 scenario) is NOT re-run here -- see the escalation-1 final report for why
// (time-boxed; this proves the fallback mechanism itself, not the dialog-timing trigger for it).
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

const origBuf = await fs.readFile(FILE);
const origSha = sha(origBuf);
const origText = origBuf.toString('utf8');

const FROM = "const gotoResponseFallback = options.url ? (tab.getLastGotoResponse?.() ?? null) : null;";
const TO = "const gotoResponseFallback = null; // REVERTED for GAP-279 revert-confirm";
const idx = origText.indexOf(FROM);
if (idx === -1) throw new Error('GAP-279 fix anchor not found');
const mutated = origText.slice(0, idx) + TO + origText.slice(idx + FROM.length);
await fs.writeFile(FILE, mutated, 'utf8');

function run(args, opts = {}) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 300000, ...opts });
}
const build = run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
const out = { buildStatus: build.status };
if (build.status === 0) {
  const v = run([VITEST, 'run'], { cwd: PKG });
  const s = ((v.stdout ?? '') + (v.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, '');
  out.testsLine = (s.match(/Tests\s+(.*)\n/) || [])[1] ?? 'unparsed';
  out.failedNames = [...s.matchAll(/(?:×|FAIL)\s+([^\n]*)/g)].map((x) => x[1].slice(0, 160));
} else {
  out.buildOutput = (build.stdout ?? '') + (build.stderr ?? '');
}

await fs.writeFile(FILE, origBuf);
const restored = await fs.readFile(FILE);
out.restoredShaMatches = sha(restored) === origSha;
const rebuild = run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
out.rebuildAfterRestoreStatus = rebuild.status;

await fs.writeFile(path.join(here, 'revert-confirm-gap279-results.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
